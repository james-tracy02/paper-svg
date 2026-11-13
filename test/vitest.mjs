/**
 * Runs the vitest CLI from the working directory's true path, passing every argument through.
 *
 * On Windows a shell can start in `c:\...` (VS Code opens a workspace with a lowercase drive letter). Vitest then
 * loads its runner from `file:///c:/...`, while the test files' `import "vitest"` resolves against the root, which
 * vitest normalises to `C:/...`. Node keys modules by URL, so the tests get a second copy of vitest whose runner
 * was never set up, and every suite fails at its first `describe` with "Cannot read properties of undefined
 * (reading 'config')". Starting from the true path loads one copy.
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = realpathSync.native(process.cwd());
process.chdir(root);
await import(pathToFileURL(join(root, "node_modules", "vitest", "vitest.mjs")).href);
