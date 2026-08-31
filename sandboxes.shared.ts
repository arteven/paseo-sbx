import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { ActionSummarySchema } from "./actions.shared";

// Field set is pinned to what §5.4 of docs/research/would_that_work.md calls out as consumed —
// `sbx ls --json` has no documented schema, so unknown/extra fields are ignored rather than
// rejected, and malformed entries are dropped instead of failing the whole list.
export const SbxSandboxPortSchema = z.object({
  host_ip: z.string(),
  host_port: z.number(),
  sandbox_port: z.number(),
  protocol: z.string(),
});

export const SbxSandboxSchema = z.object({
  name: z.string(),
  id: z.string(),
  agent: z.string().nullable().default(null),
  status: z.string(),
  ports: z.array(SbxSandboxPortSchema).default([]),
  workspaces: z.array(z.string()).default([]),
});
export type SbxSandbox = z.output<typeof SbxSandboxSchema>;

export const ReconcileSkipSchema = z.object({
  sandbox: z.string(),
  reason: z.string(),
});
export type ReconcileSkip = z.output<typeof ReconcileSkipSchema>;

// Reported so the UI never has to guess why a sandbox has no provider — see docs/research/would_that_work.md.
export const ReconcileOutcomeSchema = z.object({
  generated: z.array(z.string()),
  removed: z.array(z.string()),
  skipped: z.array(ReconcileSkipSchema),
  error: z.string().nullable(),
});
export type ReconcileOutcome = z.output<typeof ReconcileOutcomeSchema>;

export const listSandboxesRpc = defineRpc({
  name: "sbx.list-sandboxes",
  input: z.object({}),
  output: z.object({
    sandboxes: z.array(SbxSandboxSchema),
    error: z.string().nullable(),
    reconcile: ReconcileOutcomeSchema,
    // Custom sandbox actions are global — the same set renders on every sandbox row, in every
    // status — so this rides the existing 5s poll instead of a second RPC/loading state. Labels
    // only; see actions.shared.ts for why the command string itself never reaches the client.
    actions: z.array(ActionSummarySchema),
    actionsWarning: z.string().nullable(),
  }),
});
