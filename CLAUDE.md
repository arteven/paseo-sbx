# paseo-sbx

A Paseo plugin exposing Docker `sbx` sandboxes as Paseo agent providers. `README.md` is the
user-facing version; `docs/design.md` is why the plugin is shaped this way, and `docs/ui.md` is the
styling reference for `*.client.tsx` surfaces. Both are meant to stay accurate — update them when a
decision changes rather than leaving them behind.

## Environment

**`sbx` and `paseo` are host-side tools and are not installed in this sandbox.** Code can be authored
and typechecked here; every integration test runs on the host against a real daemon and real
sandboxes. Do not assume a command works because it typechecks.

Client bundles *can* be compiled and rendered here, which is the only way to catch a host-only render
error without a phone: `npm i @getpaseo/server`, call `compilePlugin(index.ts)` from
`dist/server/server/plugins/compiler.js`, then evaluate the returned client bundle with a stub
`require` mirroring `packages/app/src/plugins/evaluate.ts`.

A shallow clone of `getpaseo/paseo` is worth having — the docs drift, the source does not.

`npm test` runs the TypeScript tests through `tsx`, against `test/sdk-stub` — a two-file stand-in for
`@getpaseo/plugin`, which is host-injected at runtime and deliberately not a dependency. Installing the
real package would drag `@getpaseo/client`/`@getpaseo/protocol` to 0.7.0 and typecheck the reconciler
against a daemon this plugin is not developed against. Extend the stub if a test needs another SDK
*value*; types keep coming from `paseo-plugin.d.ts`.

## Hard rules

- **Never write `async`/`await` or generators in `*.client.tsx` or `*.shared.ts`** — use promise
  chains. `npm run check` enforces this. esbuild lowers `await` only as far as a `function*`, which
  the mobile app's Hermes cannot parse; evaluation then throws and **every** contribution disappears
  at once, with only a `console.warn` to show for it. Desktop's V8 parses generators fine, so it is
  invisible until you open the phone.
- Filename boundaries are compiler-enforced: `*.client.tsx` (React/RN), `*.server.ts` (Node,
  filesystem, process), `*.shared.ts` (Zod contracts). Cross-importing server from client, or vice
  versa, fails compilation.
- All `sbx` shelling lives behind `plugin.handle(...)` RPCs in `*.server.ts`. The client bundle runs
  in the app against a strict require allowlist and has no `node:*`. Handlers time out at 30s.
- Import only host-provided modules at runtime — `@getpaseo/plugin`, `@getpaseo/plugin/server`,
  `react`, `react-native`, `zod`. Git-installed plugins get no `npm install`, so anything else must be
  `import type` (erased) or vendored. An unavailable *module specifier* throws at bundle load, before
  any runtime guard can run, taking the whole plugin down.
- The manifest is identity-only and `.strict()`: `{ "id": "paseo-sbx" }`. Metadata goes in
  `package.json`. The id is also the `plugins.paseo-sbx` config key the reconciler reads its own
  install path from.
- `index.ts` default-exports exactly one function, one identifier param, block body, returning a
  cleanup function. Keep it to contribution wiring.
- Colours come from `resolvePluginColors()` in `theme.shared.ts`. Never inline a raw colour at a call
  site.

## Conventions

- The plugin owns the `sbx-` provider id prefix and nothing else. The reconciler must never touch a
  provider entry it did not generate.
- Provider ids must match `/^[a-z][a-z0-9-]*$/` — sanitise sandbox names and resolve collisions.
- Never log `sbx secret` output, tokens, or credentials. Plugin stdout/stderr is captured and surfaced.
- Never enable `pluginsEnabled` on the user's daemon without asking first.
- Treat undocumented `sbx` JSON output as unstable: consume the minimum set of fields and fail soft.
- The SDK's runtime surface is whatever the *installed app* injects, which can lag the generated
  `paseo-plugin.d.ts`. Guard newer SDK exports at runtime rather than trusting the types.
- There is no Command Center item. It was dropped after a mobile failure that was most likely the
  generator bug above; re-adding is probably safe, but test on a phone first. (`PluginCommandCenterActions`
  yields nothing when `serverId` is null, so the item is absent off a `/h/<id>` route regardless.)
