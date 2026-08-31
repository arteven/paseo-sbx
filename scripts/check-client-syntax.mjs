// Reject async/await and generators in every source file that reaches the *client* bundle.
//
// Why this exists: the plugin compiler builds client bundles with esbuild's
// `supported: { "async-await": false }`, intending to mirror what Metro does for app code before
// Hermes sees it. But esbuild lowers await into a `function*` driven by a __async helper, and
// leaves the generator there — Metro's preset goes further and lowers generators too. The
// generator syntax that survives is a parse error on the Hermes build in the mobile app, so
// `globalThis.eval(bundle)` throws in packages/app/src/plugins/evaluate.ts, registry.ts catches it
// and returns [], and *every* contribution disappears — sidebar item included. Nothing is shown to
// the user: the error only reaches console.warn, and the Settings -> Plugins readout that surfaces
// it does not exist before v0.7.0-beta.3. Desktop's V8 parses generators fine, so this is invisible
// until someone opens the phone.
//
// Use promise chains (.then(onFulfilled, onRejected)) in client code instead.
//
// Server files are exempt: they run in a forked Node process on the daemon, not under Hermes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;

// *.shared.ts is included: shared modules are bundled into the client alongside *.client.tsx.
const isClientReachable = (name) =>
  name.endsWith(".client.tsx") || name.endsWith(".client.ts") || name.endsWith(".shared.ts");

const problems = [];

function check(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(root, file), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const report = (node, what) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    problems.push(`${file}:${line + 1}  ${what}`);
  };

  (function visit(node) {
    if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) report(node, "async function");
    if (node.asteriskToken && ts.isFunctionLike(node)) report(node, "generator function");
    if (ts.isAwaitExpression(node)) report(node, "await expression");
    if (ts.isYieldExpression(node)) report(node, "yield expression");
    if (ts.isForOfStatement(node) && node.awaitModifier) report(node, "for await...of");
    ts.forEachChild(node, visit);
  })(source);
}

for (const name of readdirSync(root)) if (isClientReachable(name)) check(name);

if (problems.length > 0) {
  console.error("Client-bundle syntax check failed — these compile to generators, which the");
  console.error("mobile app's Hermes cannot parse, silently dropping every contribution:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nRewrite as promise chains. See scripts/check-client-syntax.mjs for the mechanism.");
  process.exit(1);
}

console.log("client syntax: OK — no async/await or generators reach the client bundle");
