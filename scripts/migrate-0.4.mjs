/**
 * Rewrites NodeBuilder masking calls for the 0.4 region API, keeping what each call does:
 *
 *   NodeBuilder                              ->  0.4
 *   setMask(s)                               ->  setCut(s)
 *   setClip(s) / setClipIf(c, s)             ->  setCut(s) / setCut(c ? s : undefined)
 *   addMaskGroup(n, mode?, outset?)          ->  addToRegion(n, { inset: true, subtract?, outset? })
 *   addMaskGroups(...n)                      ->  addToRegion(n, { inset: true })
 *   addNegativeMaskGroup(n)                  ->  addToRegion(n, { inset: true, subtract: true })
 *   addClippingGroup(n, outset?)             ->  addToRegion(n, { outset? })
 *   addClippingGroups(...n)                  ->  addToRegion(n)
 *   setMaskOutset(n, o) / setClipOutset(n, o)->  setRegionOutset(n, o)
 *   addMaskedBy(...n) / addClippedBy(...n)   ->  cutBy(n)
 *   setParentMaskedBy / addParentMaskedBy    ->  cutBy(n)
 *   addOutlineMaskedBy / addOutlineClippedBy ->  traceOutlineOf(n)
 *   setMaskOutline(b)                        ->  traceOutline(b)
 *   inheritGroupsForChildren(b?)             ->  regionsForChildren(b?)
 *   inheritMaskingForChildren(b?)            ->  cutsForChildren(b?)
 *   stopInheritedGroups(b?)                  ->  stopInheritedRegions(b?)
 *   stopInheritedMasking(b?)                 ->  stopInheritedCuts(b?)
 *   disableOutlineHoisting()                 ->  insetOutlines()
 *   clipMaskContribution()                   ->  onlyWhereCut()
 *
 * Mask groups become regions whose members inset their outlines (`inset: true`), as mask groups drew; clip groups
 * become regions whose members hoist them. Several names, or spread ones, become one array: `cutBy([a, ...b])`.
 *
 * Calls are matched by the receiver's type, so only NodeBuilder calls change. None of the old names exist in 0.4,
 * so it runs before or after upgrading.
 *
 *   node scripts/migrate-0.4.mjs <tsconfig.json> [--write]
 *
 * Without --write it prints what it would change. With --write it reruns until nested calls (a builder passed
 * as an argument to another call) are rewritten too.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const [configArg, ...flags] = process.argv.slice(2);
if (!configArg) {
  console.error("usage: node scripts/migrate-0.4.mjs <tsconfig.json> [--write]");
  process.exit(1);
}
const write = flags.includes("--write");
const configPath = resolve(configArg);

/** The names argument of a 0.4 call: one name as is, anything else (several, or spread) as an array. */
const names = (args, s) =>
  args.length === 1 && !ts.isSpreadElement(args[0]) ? args[0].getText(s) : `[${args.map((a) => a.getText(s)).join(", ")}]`;

/** `{ a, b }` from entries whose value isn't undefined, or "" when none is left. */
const options = (entries) => {
  const kept = entries.filter(([, value]) => value !== undefined);
  return kept.length ? `{ ${kept.map(([key, value]) => `${key}: ${value}`).join(", ")} }` : "";
};
const withOptions = (method, first, opts) => `${method}(${[first, opts].filter(Boolean).join(", ")})`;
const isZero = (arg) => ts.isNumericLiteral(arg) && Number(arg.text) === 0;

/** A mask group's mode argument as a `subtract` option. */
const subtract = (mode, s) => {
  if (!mode) return undefined;
  if (ts.isStringLiteral(mode)) return mode.text === "negative" ? "true" : undefined;
  return `(${mode.getText(s)}) === "negative"`;
};
const passThrough = (method) => (a, s) => `${method}(${a.map((x) => x.getText(s)).join(", ")})`;

const rules = {
  setMask: passThrough("setCut"),
  setClip: passThrough("setCut"),
  setClipIf: (a, s) => `setCut(${a[0].getText(s)} ? ${a[1].getText(s)} : undefined)`,
  addMaskGroup: (a, s) =>
    withOptions(
      "addToRegion",
      a[0].getText(s),
      options([
        ["inset", "true"],
        ["subtract", subtract(a[1], s)],
        ["outset", a[2] && !isZero(a[2]) ? a[2].getText(s) : undefined],
      ]),
    ),
  addMaskGroups: (a, s) => withOptions("addToRegion", names(a, s), options([["inset", "true"]])),
  addNegativeMaskGroup: (a, s) =>
    withOptions("addToRegion", a[0]?.getText(s) ?? "undefined", options([["inset", "true"], ["subtract", "true"]])),
  addClippingGroup: (a, s) =>
    withOptions("addToRegion", a[0].getText(s), options([["outset", a[1] && !isZero(a[1]) ? a[1].getText(s) : undefined]])),
  addClippingGroups: (a, s) => `addToRegion(${names(a, s)})`,
  setMaskOutset: passThrough("setRegionOutset"),
  setClipOutset: passThrough("setRegionOutset"),
  addMaskedBy: (a, s) => `cutBy(${names(a, s)})`,
  addClippedBy: (a, s) => `cutBy(${names(a, s)})`,
  setParentMaskedBy: (a, s) => `cutBy(${names(a, s)})`,
  addParentMaskedBy: (a, s) => `cutBy(${names(a, s)})`,
  addOutlineMaskedBy: (a, s) => `traceOutlineOf(${names(a, s)})`,
  addOutlineClippedBy: (a, s) => `traceOutlineOf(${names(a, s)})`,
  setMaskOutline: passThrough("traceOutline"),
  inheritGroupsForChildren: passThrough("regionsForChildren"),
  inheritMaskingForChildren: passThrough("cutsForChildren"),
  stopInheritedGroups: passThrough("stopInheritedRegions"),
  stopInheritedMasking: passThrough("stopInheritedCuts"),
  disableOutlineHoisting: () => "insetOutlines()",
  clipMaskContribution: () => "onlyWhereCut()",
};

const BUILDS = new Set(["build", "buildLeft", "buildRight", "buildSide"]);

/** One pass over the project: the edits it makes per file, and the nested ones it had to leave. */
const pass = () => {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  /** Whether `expression` is a NodeBuilder, following chains through calls that no longer type (removed methods). */
  const isNodeBuilder = (expression) => {
    // Inside an optional chain (`a?.b.addMaskGroup()`) the receiver types as `NodeBuilder | undefined`.
    if (checker.typeToString(checker.getNonNullableType(checker.getTypeAtLocation(expression))) === "NodeBuilder") return true;
    if (ts.isParenthesizedExpression(expression)) return isNodeBuilder(expression.expression);
    if (ts.isIdentifier(expression)) {
      const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && !declaration.type) {
        return isNodeBuilder(declaration.initializer);
      }
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
      if (BUILDS.has(expression.expression.name.text)) return false;
      return isNodeBuilder(expression.expression.expression);
    }
    return false;
  };

  const results = [];
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || source.fileName.includes("/node_modules/")) continue;
    const edits = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const rule = rules[node.expression.name.text];
        if (rule && isNodeBuilder(node.expression.expression)) {
          edits.push({ start: node.expression.name.getStart(source), end: node.end, text: rule(node.arguments, source) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!edits.length) continue;
    // Apply from the end; an edit inside a later-applied one's range waits for the next pass.
    edits.sort((a, b) => b.start - a.start);
    let text = readFileSync(source.fileName, "utf8");
    let applied = 0;
    let floor = Infinity;
    for (const edit of edits) {
      if (edit.end > floor) continue;
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      floor = edit.start;
      applied += 1;
    }
    results.push({ file: source.fileName, text, applied, nested: edits.length - applied });
  }
  return results;
};

let total = 0;
for (let round = 1; ; round += 1) {
  const results = pass();
  if (!results.length) break;
  for (const { file, text, applied, nested } of results) {
    total += applied;
    console.log(`${file}: ${applied} call${applied === 1 ? "" : "s"}${nested ? ` (${nested} nested)` : ""}`);
    if (write) writeFileSync(file, text);
  }
  if (!write) {
    if (results.some((result) => result.nested)) console.log("Nested calls are rewritten by further passes with --write.");
    break;
  }
  if (round === 10) throw new Error("Still finding calls after 10 passes");
}
console.log(`${total} calls ${write ? "rewritten" : "to rewrite (dry run; pass --write)"}.`);
