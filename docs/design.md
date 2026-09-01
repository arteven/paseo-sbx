# Design

Why this plugin is shaped the way it is. Citations are `file:line` into `getpaseo/paseo` (read at
`0.7.0-beta.1`) or into the Docker `sbx` docs source (`docker/docs`, `content/manuals/ai/sandboxes/**`,
`data/sbx_cli/*.yaml`). Line numbers drift; search for the named symbol.

For UI conventions, see [`ui.md`](ui.md).

## The constraint

Paseo has no notion of *where* a session runs. `AgentSessionConfig`
(`packages/server/src/server/agent/agent-sdk-types.ts:576`) carries `cwd` and nothing else
location-bearing, the daemon stats that cwd on its own filesystem and refuses anything that is not a
local directory (`agent-manager.ts:4700`), and every provider spawns a local child through one choke
point (`packages/server/src/utils/spawn.ts:55`). There is no container code in `packages/server/src`
at all; Paseo's own Docker support runs *the whole daemon* in a container, one isolation boundary for
the daemon and everything it spawns (`docs/docker.md:182`). SSH is a client transport that tunnels to
an already-running remote daemon (`docs/architecture.md:106`), not a way to place an agent elsewhere.

Nor is there a contribution point to add one. The plugin surface is a closed, hardcoded set of ten
methods (`packages/plugin/src/contracts.ts:287-308`, and the compiler's registration split at
`packages/server/src/server/plugins/compiler.ts:79-92`): `handle`, `addSurface`, `addSidebarItem`,
`addWorkspacePanel`, `addCommandCenterItem`, `addClientSide`, `addAttachmentSource`, `addTheme`,
`addTimelineTransformer`, `addTimelineRenderer`. No `addProvider`, no runtime or transport hook.
Providers resolve through a hardcoded factory map (`provider-registry.ts:193`) that throws for
anything absent from the literal.

So nothing here can make Paseo *aware* the agent is elsewhere. The agent process has to look, to the
daemon, like an ordinary local child that happens to be a thin client.

## Why it works anyway

**sbx mounts the host workspace at the identical absolute path.** `docs/custom-providers.md:534`
warns you to "ensure the agent and Paseo share equivalent absolute workspace paths"; sbx does it for
free via virtiofs passthrough:

```
$ mount | grep Projects
host on /home/arek/Projects/paseo-sbx type virtiofs (rw,nosuid,nodev,relatime)
```

The daemon on the host and the agent in the sandbox agree on `cwd` byte for byte, so the daemon's
local `stat()` is satisfied rather than circumvented. This holds only in direct mode — see
[Limitations](#limitations).

**Plugin server code is unsandboxed Node.** `runtimeRequire` falls through to a real `createRequire`
for anything that is not a plugin-SDK specifier (`plugin-process.ts:73-79`), so `*.server.ts` can
spawn `sbx`, read the filesystem, and read `process.env`. Paseo is explicit that plugin code is
trusted and not sandboxed (`docs/plugins.md:5`). Each plugin runs in a forked subprocess with a 30s
per-RPC timeout (`runtime.ts:16`). The client half is not privileged — the bundle is evaluated in the
app against a strict require allowlist (`packages/app/src/plugins/evaluate.ts`), so every `sbx`
invocation lives behind an RPC.

**`agents.providers` is runtime-mutable.** Every handler receives `{ paseo }`
(`contracts.ts:283`) — the full `PaseoApi`, including `config.get()` / `config.patch()` — and
`daemon-config-store.ts:187` maps `agents.providers` to the mutable wire field `providers`. The app
itself writes this path over RPC when you install from the in-app ACP catalog
(`use-acp-provider-catalog.ts:11-26`). `ProviderOverrideSchema` (`provider-config.ts:46`) requires a
non-builtin id to match `/^[a-z][a-z0-9-]*$/` and to declare both `extends` and `label`.

**`command` is a prefix; the provider appends its own args.** `resolveProviderLaunch`
(`provider-launch-config.ts:88`) returns `argv[0]` as the command and the rest as args, and the
provider appends to that. Config-level `command` always maps to `mode: "replace"`
(`provider-registry.ts:258-273`). So `["<shim>"]` becomes `<shim> <paseo's own claude args>` —
the "custom wrapper script" pattern `docs/custom-providers.md:334` blesses.

One gotcha: `checkProviderLaunchAvailable` (`provider-launch-config.ts:113`) resolves `argv[0]` — the
shim — not the underlying agent binary. The shim must be executable and absolute or on the daemon's
`PATH`, or the provider reads as unavailable.

## Decisions

| Question | Decision |
| --- | --- |
| Base provider | `extends: "claude"` |
| Sandbox ownership | User-managed — the plugin reconciles what `sbx ls` reports, it does not create sandboxes |
| Id namespace | The plugin owns `sbx-*` provider ids and touches nothing else |

`extends: "acp"` is Paseo's *documented* containerised-agent story — `docs/custom-providers.md:506`
even names its example provider `container-agent`, with `params.clientCapabilities.terminal: false` so
the agent runs shell commands in its own environment. It was rejected because user-defined ACP
providers get `supportsExactMcpPreapproval: false` (`provider-registry.ts:812` — only the synthetic
`hub-e2e` id gets a real contract), which makes them fail closed for Hub unattended execution
(`docs/providers.md:36`), and they receive Paseo's tool catalog only through the MCP fallback rather
than natively. Under `extends: "claude"`, `params.clientCapabilities` and `params.supportsMcpServers`
are inert — they are parsed only by `GenericACPProviderParamsSchema` (`generic-acp-agent.ts:21`).

## Architecture

```
Paseo daemon (host)                          sbx sandbox "myproj"
┌──────────────────────────────┐             ┌─────────────────────────────┐
│ plugin subprocess            │             │                             │
│  list-sandboxes RPC handler  │             │                             │
│   ├ spawn ───────────────────┼── sbx ls --json                           │
│   └ reconciler (same call)   │             │                             │
│        │ config.patch({providers, removeProviders})                      │
│        ▼                     │             │                             │
│ agents.providers             │             │                             │
│   sbx-myproj-claude          │             │                             │
│     command: [shim]          │             │                             │
│     env: PASEO_SBX_SANDBOX   │             │                             │
└────────────┬─────────────────┘             │                             │
             │ spawn(shim, <claude args>)    │                             │
             ▼                               │                             │
    paseo-sbx-launch  ──sbx exec -w $PWD─────┼──► claude <args>            │
                                             │      cwd = /home/arek/…     │
                                             │      (same path, virtiofs)  │
                                             └─────────────────────────────┘
```

### The launcher shim

`sbx exec` runs the command in the sandbox's default working directory; the host-side `cwd` of the
`sbx` client is not propagated, so the in-sandbox cwd has to be set with `-w`. `command` is a static
array in config and cannot interpolate a per-session cwd — hence `shims/paseo-sbx-launch`, which
reads `$PWD` at spawn time. It adds two guards:

- **A `$PASEO_SBX_WORKSPACES` cwd-membership check** (colon-split prefix match) before `sbx` is
  invoked at all. Since cwd is always the daemon's `$PWD`, a stale or wrong-sandbox provider pick
  would otherwise hand a foreign path to `-w` instead of failing loudly.
- **An inner `command -v "$0"` check** inside the sandbox. `sbx ls --json`'s `agent` field is
  best-effort, so this turns a sandbox that lied about having the agent into a clear error instead of
  a hang.

Details that are easy to get wrong, and were:

- **No `-i`, no `-t`.** sbx exec's flags mirror `docker exec` (`data/sbx_cli/sbx_exec.yaml`). A TTY
  would corrupt JSON framing through echo and CRLF translation. `-i` keeps the in-sandbox process's
  stdin open past client detach, so a process left behind by an unclean detach never sees EOF and
  never exits. Without `-i`, stdin closes with the client and the agent exits with it.
- **`command -v "$0"`, not `"$1"`.** `sh -c SCRIPT arg0 arg1…` binds the first trailing argument to
  `$0`, not `$1`; `$1` is the agent's own first flag. Checking `$1` both misfires the check against a
  flag and, with the `shift` it implied, silently drops the agent's first real argument.
- **`exec`** so the daemon's direct child stays `sbx` itself, with no extra process layer for signals
  or the exit status to cross.
- **Sandbox selected by env, not argv**, so one shim serves every generated entry.

### Generated provider entry

```json
{
  "sbx-myproj-claude": {
    "extends": "claude",
    "label": "myproj (sbx)",
    "description": "Claude Code in sbx sandbox \"myproj\" — serves /home/arek/Projects/myproj",
    "command": ["/home/arek/.paseo/plugins/paseo-sbx/shims/paseo-sbx-launch"],
    "enabled": true,
    "order": 1000,
    "env": {
      "PASEO_SBX_SANDBOX": "myproj",
      "PASEO_SBX_AGENT": "claude",
      "PASEO_SBX_WORKSPACES": "/home/arek/Projects/myproj"
    }
  }
}
```

Ids are `sbx-{sandbox}-{agent}`: the prefix is how the reconciler recognises what it owns, the agent
suffix keeps the namespace unambiguous if a sandbox ever generates entries for more than one agent.
`slugify` lowercases and collapses runs of non-`[a-z0-9]`; collisions resolve by appending `-2`,
`-3`, … in sandbox-*name* order, not discovery order, so the winner is deterministic across runs.
That ordering is code-unit, never `localeCompare` — collation varies with the daemon's locale and
ICU build, and a flipped winner would rename a provider entry and churn a remove + add for two
sandboxes that never changed.
`order` is one shared constant so generated entries form a stable block below the builtins.

### Reconciler

`PluginContext` has no plugin-activation server hook — `contribute()`'s only argument is the surface
builder, and a `PaseoApi` handle reaches code only through the `{ paseo }` argument `plugin.handle`
passes in. So reconciliation runs inside the `sbx.list-sandboxes` handler on every call, piggybacking
on the client's existing 5s poll.

- The shim's absolute path comes from `config.get()`'s own `plugins["paseo-sbx"]` entry, so it is
  correct wherever the plugin is installed. A missing or non-`directory` source fails soft with an
  error in the UI rather than a guessed path. The shim is checked for the executable bit
  (`accessSync(X_OK)`) with one `chmodSync` attempt before giving up.
- `config.get()`'s `providers` record only echoes `enabled`/`additionalModels` per entry, never the
  full override — there is nothing in it to compare a desired `command`/`env`/`label` against. So
  identity is diffed against it (which `sbx-` ids are no longer wanted → `removeProviders`), and
  content changes are caught separately by keeping a JSON signature of the last desired set in module
  state. An unchanged sandbox list sends no `config.patch` at all.
- Skipped: sandboxes reporting a non-`claude`, non-null `agent` (they cannot run Claude Code), and
  sandboxes with no workspaces (no `$PWD` the shim's guard could ever match). `agent: null` is *not*
  skipped — the field is best-effort and the shim's own check turns a wrong guess into a clear
  launch-time error rather than a missing provider. Stopped sandboxes are not skipped either: `sbx
  exec` auto-starts them, and a loud launch failure beats silently vanishing from the provider list.

### Custom sandbox actions

User-authored `{ label, command }` buttons on each sandbox row, read from `$PASEO_HOME/sbx-actions.json`
— resolved the way Paseo resolves its own `PASEO_HOME` (`paseo-home.ts`), but not through
`ensurePrivateDirectory()`, since a read RPC should not have the side effect of creating `~/.paseo`.
Re-read on every RPC call rather than cached, so an edit hot-reloads within one 5s poll. A malformed
entry is dropped and the rest kept, with a UI warning naming what went — silently discarding an
action the user believes they configured is the worst failure mode to debug.

It does not live in `~/.paseo/config.json`, for three independent reasons: the on-disk
`PersistedConfigSchema` is `.strict()`, so an unknown root key stops the daemon from starting;
`config.patch()` writes are silently dropped by `pickSupportedPatchFields()`
(`daemon-config-store.ts:340`), a hand-written allowlist; and there is no plugin storage API at all
(`public-docs/plugins/reference.md`). The only upstream plugin with any config (`linear`) reads an
env var instead.

Commands run **host-side**, where the daemon is — a user who wants in-sandbox execution writes
`sbx exec` into their own command string. Invocation mirrors Paseo's house style for user-authored
command strings (`string-command-shell.ts` plus `execSetupCommand` in `worktree.ts`): `bash -c` on
POSIX, `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command` on win32, via
`execFile`. `BASH_ENV` is scrubbed for the same reason Paseo scrubs it. `cwd` is the sandbox's first
workspace, falling back to `os.homedir()`. The sandbox name arrives as the env var
`SBX_SANDBOX_NAME` — no textual templating, matching Paseo's own convention of injecting
`PASEO_WORKTREE_PATH` and friends with no substitution anywhere.

The command string never reaches the client; `sbx.run-action` takes `{ sandboxName, actionIndex }`
and re-reads and bounds-checks the index server-side before doing anything, so a config that shrank
between render and press returns a clean "stale" outcome rather than running the wrong command.
Sending the command instead would turn this into a general "run this string on the host" endpoint,
and looking it up by label breaks on duplicate labels.

There is no streaming API reachable from plugin code — the plugin IPC protocol has five message types
and no progress message — so this is request/response only. The RPC's 30s ceiling is its own outcome,
not a failure: `execFile` giving up does not kill the still-running command, so the client races its
own timer and reports "still running".

Accepted trade-offs: no `when` gating (a "Stop" button appears on an already-stopped sandbox and
fails on press), no confirmation step for destructive actions, and the stale-index race is mitigated
rather than eliminated.

## Limitations

**Clone-mode sandboxes are not supported.** With `--clone` the agent works in a private in-container
git clone and the host repo is mounted read-only at `/run/sandbox/source`. Paths no longer correspond,
so Paseo's diff, explorer and git surfaces would point at the host tree while the agent edits the
clone. They are not currently filtered out either — no field for detecting clone mode was found in
`sbx ls --json`.

**`sbx ls --json` has no documented schema.** `data/sbx_cli/sbx_ls.yaml` documents the flags and not
the output. `sandboxes.shared.ts` pins only the fields actually consumed (`name`, `id`, `agent`,
`status`, `ports[]`, `workspaces[]`) and `sandboxes.server.ts` drops entries that do not match rather
than failing the whole list. The same is true of every other `sbx` JSON output; there is no local REST
API and no SDK, so the plugin is CLI-driven by necessity.

**Provider entries are not removed on uninstall.** `contribute()`'s cleanup runs with no arguments
and no `paseo` handle in scope — `PluginContext` exposes one only inside an RPC handler's context — so
there is no way to call `config.patch({ removeProviders })` from teardown. Entries linger, pointing at
a shim path that may no longer exist, until the plugin is re-enabled and reconciles, or a user removes
them by hand.

**Paseo's own MCP tools are unreachable from the sandbox.** `createAgentMcpBaseUrl`
(`bootstrap.ts:250`) bakes a daemon-loopback URL into the session config, injected as an `http` MCP
server named `paseo` (`runtime-mcp-config.ts:44`). From inside the sandbox that points at the
sandbox's own loopback. This is accepted — the sandbox boundary is the point. If those tools are
wanted later, `sbx mcp add` / `sbx mcp load` is the cleanest route; note `/mcp/agents` is
self-authenticating (`auth.ts:122`) on a capability token passed as `Authorization: Bearer`
(`runtime-mcp-config.ts:52`) and regenerated per daemon run.

**Credentials do not cross from the host.** Sandboxes do not inherit `~/.claude`; only project-level
config crosses (`content/manuals/ai/sandboxes/agents/claude-code.md`). Each sandbox needs either
`sbx secret set anthropic` or an in-sandbox `/login`. This is intended sbx behaviour, not a defect.
Operational gotcha: sandbox-scoped secrets take effect immediately on a running sandbox, global
secrets apply only at creation — changing a global secret means recreating the sandbox.

## The sbx surface this uses

From `data/sbx_cli/*.yaml` and `content/manuals/ai/sandboxes/**`.

| Need | Command |
| --- | --- |
| Enumerate sandboxes | `sbx ls --json` (also `-q` for names only; there is no `--format`) |
| Run the agent | `sbx exec -w <cwd> <sandbox> claude <args…>` — starts a stopped sandbox first |
| Create (no attach) | `sbx create --name <n> claude <path> [<path>:ro …]` |
| Lifecycle | `sbx stop <n>` · `sbx run --name <n>` (there is no bare `sbx start`) · `sbx rm [-f] <n>` · `sbx prune` |
| Ports | `sbx ports <n> [--json] [--publish [[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTO]]` |
| Egress policy | `sbx policy ls --json` · `sbx policy log --json` · `sbx policy allow network <domain>` |
| Secrets | `sbx secret set anthropic` · `sbx secret ls` · `--sandbox <n>` for sandbox scope |
| MCP | `sbx mcp add <name> --url\|--command` · `sbx mcp load <name> --sandbox <n>` |
| Daemon health | `sbx daemon status --json` |
