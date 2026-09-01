import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// $PASEO_HOME/sbx-actions.json — our own file, not paseo's persisted config. Storing this in
// paseo's config.json is a trap: that file's on-disk schema is `.strict()`, so an unknown root key
// stops the daemon starting, and `config.patch()` drops unknown fields through an allowlist even if
// it didn't. There is also no plugin settings/storage API to use instead. See
// docs/design.md. Fields are deliberately `label`/`command` only — no id, when,
// confirm, icon, cwd, or env.
export const SbxActionSchema = z.object({
  label: z.string(),
  command: z.string(),
});
export type SbxAction = z.output<typeof SbxActionSchema>;

// What the client is allowed to see. Never the command string — sending it to the client would turn
// this RPC into a general "run this string on the host" endpoint.
export const ActionSummarySchema = z.object({ label: z.string() });
export type ActionSummary = z.output<typeof ActionSummarySchema>;

export const RunActionOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("completed"),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
  }),
  // The config was edited (or now has fewer entries) between the client rendering the button and
  // the press landing. Bounds-checked server-side so a stale index can never run the wrong command.
  z.object({ kind: z.literal("stale") }),
]);
export type RunActionOutcome = z.output<typeof RunActionOutcomeSchema>;

export const runActionRpc = defineRpc({
  name: "sbx.run-action",
  input: z.object({
    sandboxName: z.string(),
    actionIndex: z.number().int().nonnegative(),
  }),
  output: RunActionOutcomeSchema,
});
