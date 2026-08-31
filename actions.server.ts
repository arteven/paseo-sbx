import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ActionSummary, RunActionOutcome, SbxAction } from "./actions.shared";
import { SbxActionSchema } from "./actions.shared";
import { fetchSbxSandboxes } from "./sandboxes.server";

const execFileAsync = promisify(execFile);

const CONFIG_FILE_NAME = "sbx-actions.json";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Mirrors paseo's own $PASEO_HOME resolution (packages/server/src/server/paseo-home.ts):
// env.PASEO_HOME ?? "~/.paseo", expand a leading "~/", then path.resolve. Unlike paseo's version
// this does not call ensurePrivateDirectory() — this is our own file inside that directory, not
// paseo's, and a plugin RPC should not have the side effect of creating ~/.paseo on every poll.
export function resolveActionsConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw === "~" ? os.homedir() : raw;
  return path.resolve(expanded, CONFIG_FILE_NAME);
}

export interface ParsedActionsConfig {
  actions: SbxAction[];
  warning: string | null;
}

// Pure: takes already-JSON.parse'd content. Mirrors the safeParse-inside-flatMap idiom in
// sandboxes.server.ts, but unlike sbx ls's undocumented schema, a user-authored config that drops
// an entry the user believes they configured deserves a warning naming what was dropped rather than
// failing silently.
export function parseActionsConfig(raw: unknown): ParsedActionsConfig {
  if (raw === null || typeof raw !== "object" || !Array.isArray((raw as { actions?: unknown }).actions)) {
    return { actions: [], warning: `${CONFIG_FILE_NAME}: expected an object with an "actions" array` };
  }

  const rawActions = (raw as { actions: unknown[] }).actions;
  const actions: SbxAction[] = [];
  const droppedIndexes: number[] = [];
  rawActions.forEach((entry, index) => {
    const result = SbxActionSchema.safeParse(entry);
    if (result.success) actions.push(result.data);
    else droppedIndexes.push(index);
  });

  const warning =
    droppedIndexes.length > 0
      ? `${CONFIG_FILE_NAME}: dropped ${droppedIndexes.length} invalid action${droppedIndexes.length === 1 ? "" : "s"} (index ${droppedIndexes.join(", ")}) — each needs a string "label" and "command"`
      : null;

  return { actions, warning };
}

// Absent file → no actions, silent (not every install has one). Present but unreadable or
// malformed → fail soft with a warning, since that's a user believing they configured something
// that silently isn't there. Re-read on every call: no caching, no watcher (see
// docs/research/would_that_work.md §5 for why a 5s poll makes that unnecessary).
export function loadActionsConfig(env: NodeJS.ProcessEnv = process.env): ParsedActionsConfig {
  const configPath = resolveActionsConfigPath(env);
  if (!existsSync(configPath)) return { actions: [], warning: null };

  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
  } catch (err) {
    return { actions: [], warning: `${CONFIG_FILE_NAME}: could not read file — ${errorMessage(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { actions: [], warning: `${CONFIG_FILE_NAME}: invalid JSON — ${errorMessage(err)}` };
  }

  return parseActionsConfig(parsed);
}

export function buildActionSummaries(actions: readonly SbxAction[]): ActionSummary[] {
  return actions.map((action) => ({ label: action.label }));
}

// Bounds-checked first, before any shelling out, so a stale index can never run the wrong command.
export function findAction(actions: readonly SbxAction[], index: number): SbxAction | null {
  return actions[index] ?? null;
}

interface StringCommandShellInvocation {
  shell: string;
  args: string[];
}

// Mirrors paseo's own house style for user-authored command strings
// (packages/server/src/utils/string-command-shell.ts + execSetupCommand in
// packages/server/src/utils/worktree.ts) rather than the argv-array/no-shell style used for
// sbx ls above — see docs/research/would_that_work.md.
function buildStringCommandShellInvocation(command: string): StringCommandShellInvocation {
  if (process.platform === "win32") {
    return {
      shell: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    };
  }
  return { shell: "bash", args: ["-c", command] };
}

// Shell startup files should not rewrite this behind our back — paseo's own comment makes the same
// call for its worktree setup commands, and it matters doubly here: this sandbox sets
// BASH_ENV=/etc/sandbox-persistent.sh.
function createStringCommandShellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  delete sanitized.BASH_ENV;
  return sanitized;
}

// Exported as a plain function, not wrapped around `plugin.handle(...)` — see the same note on
// listSandboxesHandler in sandboxes.server.ts.
export async function runActionHandler(
  input: { sandboxName: string; actionIndex: number },
  _context: PluginHandlerContext,
): Promise<RunActionOutcome> {
  const { actions } = loadActionsConfig();
  const action = findAction(actions, input.actionIndex);
  if (!action) return { kind: "stale" };

  const { sandboxes } = await fetchSbxSandboxes();
  const sandbox = sandboxes.find((candidate) => candidate.name === input.sandboxName);
  const cwd = sandbox?.workspaces[0] ?? os.homedir();

  const env: NodeJS.ProcessEnv = {
    ...createStringCommandShellEnv(process.env),
    SBX_SANDBOX_NAME: input.sandboxName,
  };
  const invocation = buildStringCommandShellInvocation(action.command);

  // No explicit timeout here: the host already enforces a 30s ceiling on the RPC round-trip, and
  // killing the child on our own timer would make "still running" a lie the next time it's true.
  // The client races its own 30s timer against this RPC call to surface that outcome distinctly.
  try {
    const { stdout, stderr } = await execFileAsync(invocation.shell, invocation.args, { cwd, env });
    return { kind: "completed", exitCode: 0, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; code?: unknown } | undefined;
    return {
      kind: "completed",
      exitCode: typeof execErr?.code === "number" ? execErr.code : null,
      stdout: execErr?.stdout ?? "",
      stderr: execErr?.stderr ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}
