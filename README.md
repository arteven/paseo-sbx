# paseo-sbx

A [Paseo](https://github.com/getpaseo/paseo) plugin that manages [Docker `sbx`](https://docs.docker.com/ai/sandboxes/)
sandboxes and exposes each one as a Paseo agent provider — so picking "Claude · sbx:myproj" in Paseo runs
Claude Code inside that sandbox, against the same working directory.

**Status: reconciler implemented, not yet verified against a live daemon.** The main surface lists
sandboxes from `sbx ls --json` (name, status, agent, workspaces, ports), polling every 5s, and on every
poll reconciles that list into `agents.providers.sbx-*` entries via `paseo.config.patch()`, each pointed
at the committed launcher shim (`shims/paseo-sbx-launch`). Neither `sbx` nor `paseo` is installed inside
a development sandbox (see `docs/research/would_that_work.md` §8), so this has been typechecked, and
`node:test` tests were written for its pure logic, but neither the tests nor the plugin have been run
end-to-end — this dev sandbox's Node build lacks TypeScript-stripping support, so `npm test` must be
run on the host.

## How it works

Paseo has no plugin extension point for providers or execution environments. Instead the plugin
generates provider entries at runtime:

- Server-side RPCs shell out to the `sbx` CLI (`sbx ls --json`, `create`, `stop`, `rm`, `policy`, …).
- A reconciler writes `agents.providers.sbx-*` entries through `paseo.config.patch()` — runtime-mutable,
  no daemon restart.
- Each entry's `command` points at a small launcher shim that verifies `$PWD` is one of the sandbox's
  workspaces, then execs `sbx exec -i -w "$PWD" "$SANDBOX" claude "$@"`.

It works because sbx mounts the host workspace at the **identical absolute path** inside the sandbox, so
the daemon (on the host) and the agent (in the sandbox) agree on `cwd`.

Design decisions: `extends: "claude"` (keeps Paseo's native Claude integration) and user-managed
sandboxes (the plugin surfaces what exists rather than auto-creating).

## Read this first

[`docs/research/would_that_work.md`](docs/research/would_that_work.md) — the full feasibility study:
what Paseo does and does not support, the mechanisms this relies on with source citations, the sbx
command surface, known risks, and open questions.

## Requirements

- A Paseo daemon running **on the host**, with `pluginsEnabled: true`
- The `sbx` CLI on the daemon's `PATH`
- Sandboxes in direct mode. `--clone` sandboxes are not supported (paths inside them don't correspond to
  the host workspace — see the research doc §3.4) — the plugin does not yet detect and exclude them, so
  avoid pointing it at one.

## License

TBD
