import { accessSync, chmodSync, constants } from "node:fs";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { ProviderOverride } from "@getpaseo/protocol/provider-config";
import type { ReconcileOutcome, ReconcileSkip, SbxSandbox } from "./sandboxes.shared";

const PROVIDER_PREFIX = "sbx-";
const SHIM_RELATIVE_PATH = "shims/paseo-sbx-launch";
const AGENT_NAME = "claude";

// Shared by every generated entry so they form a stable alphabetical block below the builtins
// (which are unordered / default to 0) rather than displacing the user's normal Claude entry.
export const GENERATED_PROVIDER_ORDER = 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Provider ids only need to satisfy /^[a-z][a-z0-9-]*$/ *after* the "sbx-" prefix is prepended,
// so the slug itself has no leading-character constraint of its own — it may be empty, or start
// with a digit, and the prefix still makes the full id valid.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Ordered by sandbox name (not discovery order, which sbx does not guarantee is stable) so that
// which sandbox wins a slug collision is deterministic across reconcile runs.
export function resolveProviderIds(sandboxes: readonly SbxSandbox[]): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const ordered = [...sandboxes].sort((a, b) => a.name.localeCompare(b.name));

  for (const sandbox of ordered) {
    const base = `${PROVIDER_PREFIX}${slugify(sandbox.name)}-${AGENT_NAME}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    ids.set(sandbox.id, candidate);
  }

  return ids;
}

export interface BuildDesiredProvidersInput {
  sandboxes: readonly SbxSandbox[];
  shimPath: string;
}

export interface BuildDesiredProvidersResult {
  providers: Record<string, ProviderOverride>;
  skipped: ReconcileSkip[];
}

// A sandbox that never reported an agent is not skipped — `sbx ls`'s agent field is best-effort,
// and the shim's own `command -v` check turns a wrong guess into a clear launch-time error rather
// than a silently missing provider. A sandbox that *does* report a specific non-claude agent is
// skipped, since we already know for certain the sandbox can't run Claude Code.
export function buildDesiredProviders({
  sandboxes,
  shimPath,
}: BuildDesiredProvidersInput): BuildDesiredProvidersResult {
  const providers: Record<string, ProviderOverride> = {};
  const skipped: ReconcileSkip[] = [];
  const ids = resolveProviderIds(sandboxes);

  for (const sandbox of sandboxes) {
    if (sandbox.agent !== null && sandbox.agent !== "claude") {
      skipped.push({ sandbox: sandbox.name, reason: `reports agent "${sandbox.agent}", not claude` });
      continue;
    }
    if (sandbox.workspaces.length === 0) {
      skipped.push({ sandbox: sandbox.name, reason: "serves no workspaces" });
      continue;
    }

    const id = ids.get(sandbox.id);
    if (!id) continue; // unreachable: resolveProviderIds assigns an id to every sandbox passed in

    providers[id] = {
      extends: "claude",
      label: `${sandbox.name} (sbx)`,
      description: `Claude Code in sbx sandbox "${sandbox.name}" — serves ${sandbox.workspaces.join(", ")}`,
      command: [shimPath],
      enabled: true,
      order: GENERATED_PROVIDER_ORDER,
      env: {
        PASEO_SBX_SANDBOX: sandbox.name,
        PASEO_SBX_AGENT: sandbox.agent ?? "claude",
        PASEO_SBX_WORKSPACES: sandbox.workspaces.join(":"),
      },
    };
  }

  return { providers, skipped };
}

// The daemon's config.get() only echoes back `enabled`/`additionalModels` for each provider (see
// MutableDaemonConfigSchema.providers in @getpaseo/protocol), never the full override — so there
// is nothing in it to diff the desired command/env/label against. This diffs *identity* only, to
// find sbx-owned ids that are no longer desired and must be removed instead of left behind; content
// changes are caught separately by reconcileProviders' own in-memory signature cache.
export function diffProviders(
  existingIds: readonly string[],
  desiredIds: readonly string[],
): { toRemove: string[] } {
  const desired = new Set(desiredIds);
  const toRemove = existingIds.filter((id) => id.startsWith(PROVIDER_PREFIX) && !desired.has(id));
  return { toRemove };
}

// A fresh git checkout does not always preserve the executable bit, and the shim is committed at
// 0755 deliberately (see shims/paseo-sbx-launch) — so a missing +x is corrected in place rather
// than treated as an install error.
function verifyShim(shimPath: string): string | null {
  try {
    accessSync(shimPath, constants.X_OK);
    return null;
  } catch {
    // fall through to attempt a chmod
  }
  try {
    chmodSync(shimPath, 0o755);
    accessSync(shimPath, constants.X_OK);
    return null;
  } catch {
    return `Launcher shim not found or not executable at ${shimPath}. Reinstall the plugin.`;
  }
}

export interface ReconcileDeps {
  paseo: PaseoApi;
}

// Signature of what was last actually patched, kept in module state. The surface polls every 5s;
// without this, an unchanged sandbox list would still trigger a config.patch() round-trip every
// poll. Reset only by process restart — acceptable since a restart also loses any in-flight patch.
let lastPatchSignature: string | null = null;

function computeSignature(providers: Record<string, ProviderOverride>, removeProviders: string[]): string {
  return JSON.stringify({
    providers: Object.fromEntries(Object.entries(providers).sort(([a], [b]) => a.localeCompare(b))),
    removeProviders: [...removeProviders].sort(),
  });
}

export async function reconcileProviders(
  sandboxes: readonly SbxSandbox[],
  { paseo }: ReconcileDeps,
): Promise<ReconcileOutcome> {
  const empty = { generated: [], removed: [], skipped: [] };

  let current;
  try {
    ({ config: current } = await paseo.config.get());
  } catch (err) {
    return { ...empty, error: `Failed to read plugin config: ${errorMessage(err)}` };
  }

  const pluginSource = current.plugins?.sbx;
  if (!pluginSource || pluginSource.source !== "directory") {
    return { ...empty, error: "This plugin's own install path is not in the daemon config (plugins.sbx)." };
  }

  const shimPath = path.join(pluginSource.path, SHIM_RELATIVE_PATH);
  const shimError = verifyShim(shimPath);
  if (shimError) {
    return { ...empty, error: shimError };
  }

  const { providers: desired, skipped } = buildDesiredProviders({ sandboxes, shimPath });
  const existingIds = Object.keys(current.providers ?? {});
  const { toRemove } = diffProviders(existingIds, Object.keys(desired));

  if (Object.keys(desired).length === 0 && toRemove.length === 0) {
    return { generated: [], removed: [], skipped, error: null };
  }

  const signature = computeSignature(desired, toRemove);
  if (signature === lastPatchSignature) {
    return { generated: Object.keys(desired), removed: [], skipped, error: null };
  }

  try {
    await paseo.config.patch({ providers: desired, removeProviders: toRemove });
  } catch (err) {
    return { generated: [], removed: [], skipped, error: `Failed to patch config: ${errorMessage(err)}` };
  }

  lastPatchSignature = signature;
  return { generated: Object.keys(desired), removed: toRemove, skipped, error: null };
}
