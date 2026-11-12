/**
 * Rewrites builder calls for the 0.3 API, keeping what each call does:
 *
 *   NodeBuilder                          ->  0.3
 *   setJointPosition(x, y)   (adds)      ->  moveBy(x, y)
 *   setScale(x, y)           (multiplies)->  scaleBy(x, y)
 *   scalesWith(a, b, ...)                ->  scaleBy(a * b * ...)
 *   scalesWithX(...) / scalesWithY(...)  ->  scaleBy(x, 1) / scaleBy(1, y)
 *   scalesWithFrom(n, x, y)              ->  scaleBy(n, n, { from: { x, y } })   (also X/YFrom)
 *   translatesWithX(...) / Y(...)        ->  moveBy(x, 0) / moveBy(0, y)
 *   rotatesWith(a, b, ...)               ->  rotateBy(a + b + ...)
 *   skewsWith(x, y)                      ->  skewBy(x, y)
 *   transformsWith(t) / withTransform(t) ->  transformBy(t)
 *   mirrorX(b)                           ->  scaleBy(b ? -1 : 1, 1)
 *   fixedRotation(...)                   ->  setFixedRotation(...)
 *   setShape(...)            (no-op)     ->  removed
 *
 *   SpriteBuilder: scalesWith/X/Y -> scaleBy, translatesWithX/Y -> moveBy, rotatesWith -> rotateBy.
 *   (SpriteBuilder.setScale already set, and still does.)
 *
 * Calls are matched by the receiver's type, so a NodeBuilder's `setScale` is told apart from a
 * SpriteBuilder's. Calls with spread arguments are left alone and listed for a manual fix.
 *
 *   node scripts/migrate-0.3.mjs <tsconfig.json> [--write]
 *
 * Without --write it prints what it would change. Run it once, on 0.2 code: a second run would read
 * a 0.3 `NodeBuilder.setScale` (which sets) as the old one and turn it into `scaleBy`. Nested calls
 * are rewritten one level per run; it says so when that happens, and then only those need a rerun.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const [configArg, ...flags] = process.argv.slice(2);
if (!configArg) {
  console.error("usage: node scripts/migrate-0.3.mjs <tsconfig.json> [--write]");
  process.exit(1);
}
const write = flags.includes("--write");

const configPath = resolve(configArg);
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/** An argument as source text, parenthesized when it could bind looser than `*` or `+`. */
const operand = (arg, source) => {
  const text = arg.getText(source);
  const simple =
    ts.isIdentifier(arg) ||
    ts.isNumericLiteral(arg) ||
    ts.isPropertyAccessExpression(arg) ||
    ts.isElementAccessExpression(arg) ||
    ts.isCallExpression(arg) ||
    ts.isParenthesizedExpression(arg) ||
    (ts.isPrefixUnaryExpression(arg) && ts.isNumericLiteral(arg.operand));
  return simple ? text : `(${text})`;
};
const combine = (args, op, identity, source) =>
  args.length === 0 ? identity : args.length === 1 ? args[0].getText(source) : args.map((a) => operand(a, source)).join(` ${op} `);

const nodeRules = {
  setJointPosition: (a, s) => `moveBy(${a[0].getText(s)}, ${a[1].getText(s)})`,
  setScale: (a, s) => `scaleBy(${a[0].getText(s)}, ${a[1].getText(s)})`,
  scalesWith: (a, s) => `scaleBy(${combine(a, "*", "1", s)})`,
  scalesWithX: (a, s) => `scaleBy(${combine(a, "*", "1", s)}, 1)`,
  scalesWithY: (a, s) => `scaleBy(1, ${combine(a, "*", "1", s)})`,
  scalesWithFrom: (a, s) =>
    `scaleBy(${a[0].getText(s)}, ${a[0].getText(s)}, { from: { x: ${a[1].getText(s)}, y: ${a[2].getText(s)} } })`,
  scalesWithXFrom: (a, s) => `scaleBy(${a[0].getText(s)}, 1, { from: { x: ${a[1].getText(s)}, y: 0 } })`,
  scalesWithYFrom: (a, s) => `scaleBy(1, ${a[0].getText(s)}, { from: { x: 0, y: ${a[1].getText(s)} } })`,
  translatesWithX: (a, s) => `moveBy(${combine(a, "+", "0", s)}, 0)`,
  translatesWithY: (a, s) => `moveBy(0, ${combine(a, "+", "0", s)})`,
  rotatesWith: (a, s) => `rotateBy(${combine(a, "+", "0", s)})`,
  skewsWith: (a, s) => `skewBy(${a[0]?.getText(s) ?? "0"}${a[1] ? `, ${a[1].getText(s)}` : ""})`,
  transformsWith: (a, s) => `transformBy(${a[0].getText(s)})`,
  withTransform: (a, s) => `transformBy(${a[0].getText(s)})`,
  mirrorX: (a, s) => `scaleBy(${operand(a[0], s)} ? -1 : 1, 1)`,
  fixedRotation: (a, s) => `setFixedRotation(${a.map((x) => x.getText(s)).join(", ")})`,
  // Never did anything on a NodeBuilder (a sprite's shape is set on its SpriteBuilder).
  setShape: () => null,
};
const spriteRules = {
  scalesWith: nodeRules.scalesWith,
  scalesWithX: nodeRules.scalesWithX,
  scalesWithY: nodeRules.scalesWithY,
  translatesWithX: nodeRules.translatesWithX,
  translatesWithY: nodeRules.translatesWithY,
  rotatesWith: nodeRules.rotatesWith,
};

const BUILDS = new Set(["build", "buildLeft", "buildRight", "buildSide"]);

/**
 * "NodeBuilder" or "SpriteBuilder" when `expression` is one. A call removed in 0.3 types as `any`, so
 * a chain is followed down to the builder it starts from: every builder method but `build*` returns one.
 */
const builderName = (expression) => {
  const name = checker.typeToString(checker.getTypeAtLocation(expression));
  if (name === "NodeBuilder" || name === "SpriteBuilder") return name;
  if (ts.isParenthesizedExpression(expression)) return builderName(expression.expression);
  // A variable typed `any` by such a chain: follow it to its initializer.
  if (ts.isIdentifier(expression)) {
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && !declaration.type) {
      return builderName(declaration.initializer);
    }
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    if (BUILDS.has(expression.expression.name.text)) return undefined;
    return builderName(expression.expression.expression);
  }
  return undefined;
};

let changed = 0;
const manual = [];
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile || source.fileName.includes("/node_modules/")) continue;
  const edits = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const builder = (nodeRules[method] || spriteRules[method]) && builderName(node.expression.expression);
      const rule = builder === "NodeBuilder" ? nodeRules[method] : builder === "SpriteBuilder" ? spriteRules[method] : undefined;
      if (rule) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        const where = `${source.fileName}:${line + 1}`;
        if (node.arguments.some(ts.isSpreadElement)) manual.push(`${where} ${builder}.${method}(...spread)`);
        else {
          const text = rule(node.arguments, source);
          // null removes the call, with its dot, from the chain.
          const start = text === null ? node.expression.expression.end : node.expression.name.getStart(source);
          edits.push({ start, end: node.end, text: text ?? "" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!edits.length) continue;
  // Innermost-last order would break offsets; apply from the end, skipping edits nested in a later one's range.
  edits.sort((a, b) => b.start - a.start);
  let text = readFileSync(source.fileName, "utf8");
  // Nested calls (a builder passed as an argument) are rewritten one level per run; rerun until clean.
  let applied = 0;
  let floor = Infinity;
  for (const edit of edits) {
    if (edit.end > floor) continue;
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    floor = edit.start;
    applied += 1;
  }
  changed += applied;
  console.log(`${source.fileName}: ${applied} call${applied === 1 ? "" : "s"}${applied < edits.length ? ` (${edits.length - applied} nested, rerun)` : ""}`);
  if (write) writeFileSync(source.fileName, text);
}
console.log(`${changed} calls ${write ? "rewritten" : "to rewrite (dry run; pass --write)"}.`);
if (manual.length) console.log(`Fix by hand (spread arguments):\n  ${manual.join("\n  ")}`);
