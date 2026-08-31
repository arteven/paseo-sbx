import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActionSummaries, findAction, parseActionsConfig, resolveActionsConfigPath } from "./actions.server";

test("resolveActionsConfigPath defaults to ~/.paseo when PASEO_HOME is unset", () => {
  const path = resolveActionsConfigPath({});
  assert.ok(path.endsWith("/.paseo/sbx-actions.json"));
  assert.ok(!path.includes("~"));
});

test("resolveActionsConfigPath expands a leading ~/ in PASEO_HOME", () => {
  const path = resolveActionsConfigPath({ PASEO_HOME: "~/custom-paseo" });
  assert.ok(path.endsWith("/custom-paseo/sbx-actions.json"));
  assert.ok(!path.includes("~"));
});

test("resolveActionsConfigPath resolves an absolute PASEO_HOME as-is", () => {
  const path = resolveActionsConfigPath({ PASEO_HOME: "/opt/paseo-home" });
  assert.equal(path, "/opt/paseo-home/sbx-actions.json");
});

test("resolveActionsConfigPath resolves a relative PASEO_HOME against cwd", () => {
  const path = resolveActionsConfigPath({ PASEO_HOME: "relative-home" });
  assert.ok(path.endsWith("/relative-home/sbx-actions.json"));
  assert.ok(path.startsWith("/"));
});

test("parseActionsConfig accepts a well-formed actions array", () => {
  const { actions, warning } = parseActionsConfig({
    actions: [{ label: "Publish 8080", command: "sbx ports $SBX_SANDBOX_NAME --publish 8080:8080" }],
  });
  assert.equal(warning, null);
  assert.deepEqual(actions, [
    { label: "Publish 8080", command: "sbx ports $SBX_SANDBOX_NAME --publish 8080:8080" },
  ]);
});

test("parseActionsConfig ignores unknown extra fields on an otherwise-valid entry", () => {
  const { actions, warning } = parseActionsConfig({
    actions: [{ label: "Stop", command: "sbx stop $SBX_SANDBOX_NAME", id: "stop", confirm: true }],
  });
  assert.equal(warning, null);
  assert.deepEqual(actions, [{ label: "Stop", command: "sbx stop $SBX_SANDBOX_NAME" }]);
});

test("parseActionsConfig drops malformed entries and warns naming what was dropped", () => {
  const { actions, warning } = parseActionsConfig({
    actions: [
      { label: "Publish 8080", command: "sbx ports $SBX_SANDBOX_NAME --publish 8080:8080" },
      { label: "Missing command" },
      { command: "sbx stop $SBX_SANDBOX_NAME" },
      "not even an object",
    ],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].label, "Publish 8080");
  assert.ok(warning);
  assert.match(warning, /dropped 3 invalid actions/);
  assert.match(warning, /index 1, 2, 3/);
});

test("parseActionsConfig warns when the root shape is wrong instead of throwing", () => {
  const { actions, warning } = parseActionsConfig({ notActions: [] });
  assert.deepEqual(actions, []);
  assert.match(warning ?? "", /expected an object with an "actions" array/);
});

test("parseActionsConfig warns when the parsed value isn't an object at all", () => {
  const { actions, warning } = parseActionsConfig("just a string");
  assert.deepEqual(actions, []);
  assert.ok(warning);
});

test("parseActionsConfig treats an empty actions array as valid, no warning", () => {
  const { actions, warning } = parseActionsConfig({ actions: [] });
  assert.deepEqual(actions, []);
  assert.equal(warning, null);
});

test("buildActionSummaries strips commands, keeping only labels", () => {
  const summaries = buildActionSummaries([
    { label: "Publish 8080", command: "sbx ports $SBX_SANDBOX_NAME --publish 8080:8080" },
    { label: "Stop", command: "sbx stop $SBX_SANDBOX_NAME" },
  ]);
  assert.deepEqual(summaries, [{ label: "Publish 8080" }, { label: "Stop" }]);
});

test("findAction returns the action at a valid index", () => {
  const actions = [
    { label: "Publish 8080", command: "sbx ports $SBX_SANDBOX_NAME --publish 8080:8080" },
    { label: "Stop", command: "sbx stop $SBX_SANDBOX_NAME" },
  ];
  assert.deepEqual(findAction(actions, 1), { label: "Stop", command: "sbx stop $SBX_SANDBOX_NAME" });
});

test("findAction returns null for an out-of-range index (stale config)", () => {
  const actions = [{ label: "Stop", command: "sbx stop $SBX_SANDBOX_NAME" }];
  assert.equal(findAction(actions, 1), null);
  assert.equal(findAction(actions, -1), null);
  assert.equal(findAction([], 0), null);
});
