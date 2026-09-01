# paseo-sbx

A [Paseo](https://github.com/getpaseo/paseo) plugin that exposes [Docker `sbx`](https://docs.docker.com/ai/sandboxes/)
sandboxes as Paseo agent providers. Pick "myproj (sbx)" in Paseo's provider picker and Claude Code runs
inside that sandbox, against the same working directory you were already in.

It works because sbx mounts the host workspace at the *identical* absolute path inside the sandbox, so
the daemon (on the host) and the agent (in the sandbox) agree on `cwd`.

## Install

Plugins run unsandboxed on the daemon machine, so install only code you trust — including this.

```bash
paseo plugin add arteven/paseo-sbx --ref v0.1.0
paseo plugin ls
```

Pinning to a tag is the recommended default. Omitting `--ref` tracks the default branch instead, which
means `paseo plugin update paseo-sbx` picks up whatever has landed since.

Plugins also need to be switched on for the daemon: **Settings → Plugins → Enable plugins**, or the root
`pluginsEnabled` field in the daemon's `config.json` followed by `paseo reload`. A **Docker Sandboxes**
item appears in the sidebar once it is running.

To work on it locally instead, clone it and point Paseo at the directory:

```bash
git clone https://github.com/arteven/paseo-sbx.git
cd paseo-sbx && npm install
paseo plugin install "$PWD"
```

## Requirements

- A Paseo daemon running **on the host**, with plugins enabled
- `sbx` **0.39 or newer**, on the daemon's `PATH`
- Sandboxes in direct mode — `--clone` sandboxes are not supported (see [Limitations](#limitations))

Note that `sbx` and `paseo` are both host-side tools: neither exists *inside* a sandbox, so the daemon
has to be running on the host, not in one of the sandboxes it manages.

## How it works

Paseo has no extension point for providers or execution environments, so the plugin generates provider
config entries at runtime instead:

- Server-side RPCs shell out to the `sbx` CLI (`sbx ls --json`, and whatever your custom actions call).
- A reconciler writes `agents.providers.sbx-*` entries through `paseo.config.patch()` — runtime-mutable,
  no daemon restart — one per sandbox, on every poll of the sandbox list.
- Each entry's `command` points at a small launcher shim that checks `$PWD` is one of the sandbox's
  workspaces, then execs `sbx exec -w "$PWD" "$SANDBOX" claude "$@"`.

The plugin owns the `sbx-` provider id prefix and touches no entry it did not generate. Two design
decisions are load-bearing: `extends: "claude"`, which keeps Paseo's native Claude integration rather
than going through ACP, and user-managed sandboxes — the plugin surfaces what `sbx ls` reports and never
creates one for you.

[`docs/design.md`](docs/design.md) has the full reasoning, with citations into Paseo's source.

## Custom sandbox actions

Each sandbox row can show a row of your own buttons — "Publish 8080", "Stop" — that run a shell command
**on the host** when pressed. Configure them in `$PASEO_HOME/sbx-actions.json` (defaults to
`~/.paseo/sbx-actions.json`; not created for you):

```json
{
  "actions": [
    { "label": "Publish 8080", "command": "sbx ports $SBX_SANDBOX_NAME --publish 8080:8080" },
    { "label": "Stop", "command": "sbx stop $SBX_SANDBOX_NAME" }
  ]
}
```

- `label` and `command` are both required; extra fields on an entry are ignored.
- Commands run through the same shell invocation Paseo uses for its own setup commands (`bash -c` on
  Linux and macOS, PowerShell on Windows), with `$SBX_SANDBOX_NAME` set to the sandbox's name. That env
  var is the only way the sandbox is identified — there is no path templating.
- To run something *inside* the sandbox, write `sbx exec $SBX_SANDBOX_NAME …` yourself.
- The same list applies to every row; there is no per-sandbox or per-status config, so a "Stop" button
  shows up on stopped sandboxes too and simply fails on press.
- A missing file means no buttons. A malformed one still loads its valid entries, with a warning naming
  what was dropped — a bad file never blocks the sandbox list itself.
- Exit code, stdout and stderr come back as a toast (and a modal for longer output). No live streaming.

It lives in `$PASEO_HOME` rather than Paseo's `config.json` because there is no plugin storage API and
unknown keys in `config.json` stop the daemon from starting. See
[`docs/design.md`](docs/design.md#custom-sandbox-actions).

## Limitations

- **Not yet verified end to end.** The launcher shim's behaviour is confirmed against a live sbx —
  including that repeated start/kill cycles leave no process behind — but the reconciler's
  `config.patch()` writes, the generated provider entries, and the custom-action execution path have not
  been exercised against a live daemon.
- **Clone-mode sandboxes are not supported and not filtered out.** Paths inside a `--clone` sandbox do
  not correspond to the host's, so Paseo's diff and git surfaces would point at the wrong tree. Nothing
  in `sbx ls --json` identifies them, so the plugin cannot exclude them for you — don't point it at one.
- **Generated providers survive uninstall.** Plugin teardown has no handle to write config, so
  `sbx-*` entries linger until the plugin runs again or you delete them by hand.

## Development

```bash
npm install
npm run check   # typecheck + client-bundle syntax rules
npm test
paseo plugin reload paseo-sbx
```

The tests cover the pure logic only — config parsing, id generation, the reconciler's diff. Anything
that shells out to `sbx` or writes daemon config has to be exercised by hand on a real host.

`docs/ui.md` is the styling reference for anything rendered in a `*.client.tsx` surface; `CLAUDE.md`
carries the constraints that bite when editing plugin code.

## License

MIT — see [LICENSE](LICENSE).
