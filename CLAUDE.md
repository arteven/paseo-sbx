# paseo-sbx

A Paseo plugin exposing Docker `sbx` sandboxes as Paseo agent providers. See `README.md` for the
one-paragraph version.

## Read before changing anything

`docs/research/would_that_work.md` is the design of record — feasibility, mechanisms, source citations,
risks, and open questions. Keep it current when decisions change; it is meant to stay accurate, not
become a historical artifact.

Locked decisions: `extends: "claude"` (not `"acp"`), user-managed sandboxes (the plugin does not
auto-create one per workspace).

## Environment

**`sbx` and `paseo` are host-side tools and are not installed in this sandbox.** Plugin code can be
authored and typechecked here; every integration test must run on the host against a real daemon and
real sandboxes. Do not assume a command works because it typechecks.

A shallow clone of `getpaseo/paseo` is useful for checking API surface against source rather than docs —
the docs drift (e.g. `docs/plugins.md:56` claims the SDK is unpublished; it is on npm).

## Paseo plugin constraints

- Manifest is identity-only and strict: `{ "id": "..." }`.
- `index.ts` default-exports exactly one function, one identifier param, block body, returning a cleanup
  function. Keep it to contribution wiring.
- Filename boundaries are compiler-enforced: `*.client.tsx` (React/RN), `*.server.ts` (Node, filesystem,
  process), `*.shared.ts` (Zod contracts). Cross-importing server from client, or vice versa, fails
  compilation.
- All `sbx` shelling lives behind `plugin.handle(...)` RPCs in `*.server.ts`. The client bundle runs in
  the app with a strict require allowlist and has no `node:*`.
- RPC handlers have a 30s timeout.
- The plugin API is experimental and unversioned; compatibility rides on `server_info` feature flags.

## Conventions

- The plugin owns the `sbx-` provider id prefix and nothing else. The reconciler must never touch a
  provider entry it did not generate.
- Provider ids must match `/^[a-z][a-z0-9-]*$/` — sanitise sandbox names and resolve collisions.
- Never log `sbx secret` output, tokens, or credentials. Plugin stdout/stderr is captured and surfaced.
- Never enable `pluginsEnabled` on the user's daemon without asking first.
- Treat undocumented `sbx` JSON output as unstable: consume the minimum set of fields and fail soft.
