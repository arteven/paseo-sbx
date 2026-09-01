import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDesiredProviders, diffProviders, resolveProviderIds, slugify } from "./reconcile.server";
import type { SbxSandbox } from "./sandboxes.shared";

function sandbox(overrides: Partial<SbxSandbox> & Pick<SbxSandbox, "name" | "id">): SbxSandbox {
  return {
    agent: null,
    status: "running",
    ports: [],
    workspaces: ["/workspace"],
    ...overrides,
  };
}

test("slugify lowercases and collapses non-alphanumerics to single dashes", () => {
  assert.equal(slugify("My Project!!"), "my-project");
  assert.equal(slugify("--leading-and-trailing--"), "leading-and-trailing");
  assert.equal(slugify("already-slug"), "already-slug");
  assert.equal(slugify("!!!"), "");
});

test("resolveProviderIds assigns sbx-<slug>-<agent> ids", () => {
  const ids = resolveProviderIds([sandbox({ name: "myproj", id: "a" })]);
  assert.equal(ids.get("a"), "sbx-myproj-claude");
});

test("resolveProviderIds resolves slug collisions deterministically by name order", () => {
  const ids = resolveProviderIds([
    sandbox({ name: "My Proj", id: "second" }),
    sandbox({ name: "my-proj", id: "first" }),
  ]);
  // "My Proj" and "my-proj" both slugify to "my-proj". Name order picks the base-id winner
  // independent of the array's input order, and it is code-unit order — so "My Proj" wins on "M"
  // < "m", the same way on every machine, rather than deferring to the daemon's collation.
  assert.equal(ids.get("second"), "sbx-my-proj-claude");
  assert.equal(ids.get("first"), "sbx-my-proj-claude-2");
});

test("buildDesiredProviders skips a sandbox reporting a non-claude agent", () => {
  const { providers, skipped } = buildDesiredProviders({
    sandboxes: [sandbox({ name: "codex-box", id: "a", agent: "codex" })],
    shimPath: "/plugin/shims/paseo-sbx-launch",
  });
  assert.deepEqual(providers, {});
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].sandbox, "codex-box");
});

test("buildDesiredProviders does not skip a sandbox with agent: null", () => {
  const { providers, skipped } = buildDesiredProviders({
    sandboxes: [sandbox({ name: "myproj", id: "a", agent: null })],
    shimPath: "/plugin/shims/paseo-sbx-launch",
  });
  assert.equal(skipped.length, 0);
  const provider = providers["sbx-myproj-claude"];
  assert.ok(provider);
  assert.equal(provider.extends, "claude");
  assert.equal(provider.label, "myproj (sbx)");
  assert.equal(provider.description, 'Claude Code in sbx sandbox "myproj" — serves /workspace');
  assert.equal(provider.enabled, true);
  assert.equal(typeof provider.order, "number");
  assert.equal(provider.command?.[0], "/plugin/shims/paseo-sbx-launch");
  assert.equal(provider.env?.PASEO_SBX_SANDBOX, "myproj");
  assert.equal(provider.env?.PASEO_SBX_AGENT, "claude");
  assert.equal(provider.env?.PASEO_SBX_WORKSPACES, "/workspace");
});

test("buildDesiredProviders skips a sandbox with no workspaces", () => {
  const { providers, skipped } = buildDesiredProviders({
    sandboxes: [sandbox({ name: "empty", id: "a", workspaces: [] })],
    shimPath: "/plugin/shims/paseo-sbx-launch",
  });
  assert.deepEqual(providers, {});
  assert.equal(skipped[0].reason, "serves no workspaces");
});

test("diffProviders removes only sbx-owned ids that are no longer desired", () => {
  const { toRemove } = diffProviders(
    ["sbx-myproj-claude", "sbx-old-claude", "claude", "sbx-still-here-claude"],
    ["sbx-myproj-claude", "sbx-still-here-claude"],
  );
  assert.deepEqual(toRemove, ["sbx-old-claude"]);
});
