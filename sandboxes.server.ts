import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SbxSandboxSchema } from "./sandboxes.shared";

const execFileAsync = promisify(execFile);

// Exported as a plain function, not wrapped around `plugin.handle(...)`: the compiler's
// client/server split works by pattern-matching literal `plugin.handle(...)` /
// `plugin.addSurface(...)` call expressions inside index.ts's contribute() body, so that
// call must live there directly — a helper that calls it on the plugin's behalf is invisible
// to that check and gets left dangling in the wrong bundle.
export async function listSandboxesHandler() {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("sbx", ["ls", "--json"]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sandboxes: [], error: `Failed to run "sbx ls --json": ${message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { sandboxes: [], error: 'Could not parse "sbx ls --json" output as JSON.' };
  }

  const rawList =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { sandboxes?: unknown }).sandboxes)
      ? (parsed as { sandboxes: unknown[] }).sandboxes
      : [];

  // sbx ls --json's schema is undocumented (see docs/research/would_that_work.md §5.3) — drop
  // entries that don't match rather than failing the whole list.
  const sandboxes = rawList.flatMap((entry) => {
    const result = SbxSandboxSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });

  return { sandboxes, error: null };
}
