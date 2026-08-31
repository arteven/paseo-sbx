# Would that work? — A Paseo plugin exposing Docker `sbx` sandboxes as providers

**Verdict: yes.** Not as a "provider plugin" — Paseo has no such extension point — but as a plugin that
**generates provider config entries at runtime**, each one launching an agent inside a named sbx sandbox
through a launcher shim.

Status of this document: feasibility research, pre-implementation. Every claim carries a `file:line`
citation into `getpaseo/paseo` (shallow clone of `main`, package version `0.7.0-beta.1`) or into the
Docker `sbx` docs source (`docker/docs`, `content/manuals/ai/sandboxes/**`, `data/sbx_cli/*.yaml`).
Claims that were **not** verified are marked **[UNVERIFIED]**.

Design decisions already taken (see [Decisions](#decisions)): `extends: "claude"`, user-managed sandboxes.

---

## 1. Terminology — the reframe that makes this tractable

"Docker sandboxes as providers" does not map onto Paseo's vocabulary as stated. In Paseo:

> **Provider** — Agent backend (Claude Code, Codex, Copilot, OpenCode, Pi, Oh My Pi).
> — `docs/glossary.md:32`

A provider is *which agent CLI to run*, not *where it runs*. There are in fact four unrelated things
called "provider" in the codebase; only the first is relevant here:

| Sense | Type | Governs execution location? |
| --- | --- | --- |
| **Agent provider** | `ProviderSnapshotEntry` (`packages/protocol/src/messages.ts:348`) | Only indirectly — it owns the argv |
| Forge provider | `ForgeService` (`packages/server/src/services/forge-service.ts:436`) | No |
| Speech provider | `SpeechProviderIdSchema` (`packages/server/src/server/speech/speech-types.ts:3`) | No |
| Usage/quota fetcher | `ProviderUsageFetcher` (`packages/server/src/services/quota-fetcher/provider.ts:6`) | No |

Config carries two unrelated `providers` keys: top-level `providers` is **speech**
(`packages/server/src/server/persisted-config.ts:77`), `agents.providers` is **agent providers**
(`persisted-config.ts:318`). Only the latter matters.

**Restated goal:** one generated provider entry per sandbox, so a sandbox appears in Paseo's ordinary
provider picker and selecting it runs the agent inside that sandbox.

---

## 2. What Paseo does *not* have

### 2.1 No plugin contribution point for providers, runtimes, or sandboxes

The contribution surface is a **closed, hardcoded set of ten methods**. Two independent sources of
truth, and they agree:

- `PluginContext` interface — `packages/plugin/src/contracts.ts:287-308`
- The compiler's registration split list — `packages/server/src/server/plugins/compiler.ts:79-92`

```ts
handle, addSurface, addSidebarItem, addWorkspacePanel, addCommandCenterItem,
addClientSide, addAttachmentSource, addTheme, addTimelineTransformer, addTimelineRenderer
```

There is no `addProvider`, no execution/runtime/transport hook. Providers resolve through a hardcoded
factory map, `PROVIDER_CLIENT_FACTORIES` (`packages/server/src/server/agent/provider-registry.ts:193`);
`getProviderClientFactory` throws for anything absent from that literal (`:250`). The manifest is
identity-only and `.strict()` — `{ "id": "..." }`, nothing else
(`packages/server/src/server/plugins/manifest.ts:6`).

### 2.2 No model of "the machine a session runs on"

This is the deeper constraint, and it is worth internalising before designing anything.

- `AgentSessionConfig` (`packages/server/src/server/agent/agent-sdk-types.ts:576`) carries `cwd: string`
  and nothing else location-bearing. No host, machine, container, or transport field.
- The daemon **stats the cwd on its own filesystem** and refuses if it is not a local directory —
  `packages/server/src/server/agent/agent-manager.ts:4700`:
  ```ts
  normalized.cwd = resolve(normalized.cwd);
  const cwdStats = await stat(normalized.cwd);
  if (!cwdStats.isDirectory()) throw new Error(`Working directory is not a directory: ${normalized.cwd}`);
  ```
- Every provider spawns a local child process through one choke point: `spawnProcess`
  (`packages/server/src/utils/spawn.ts:55`), a plain `child_process.spawn` at `:77`.
- **Zero container code exists in `packages/server/src`.** A grep for `docker|container|podman|devcontainer`
  over non-test server sources returns only a variable named `messageContainer`
  (`.../agent/providers/claude/agent.ts:1393`) and an unrelated `project-icon.ts`. No `executionTarget`,
  `runsOn`, `executionEnvironment`, `remoteExec`, or `runtimeTarget` symbol exists in the repo.
- SSH is a **client transport only**: `packages/desktop/src/daemon/local-transport.ts:107` shells out to
  `ssh` to tunnel a WebSocket to an already-running remote daemon. `docs/architecture.md:106` says so
  outright: *"SSH only tunnels to an already-running daemon."* Agents remain children of that remote daemon.
- Paseo's own Docker support is **"run the whole daemon in a container"**, not per-session containers.
  `docker/base/Dockerfile`'s entrypoint execs a single supervisor process; agents are ordinary children
  inside the same container, which is why `docs/docker.md:73` requires you to bake the agent CLIs into a
  child image. `docs/docker.md:182` states the trust model: *"The container is the isolation boundary for
  agents."* One boundary for the daemon and everything it runs.

The only isolation Paseo models per-session is a **git worktree** — a directory on the same host.

**Consequence:** nothing about this design can make Paseo *aware* that the agent is elsewhere. The agent
process must look, to the daemon, like an ordinary local child that happens to be a thin client. That is
achievable precisely because of §3.4.

---

## 3. Why it works anyway — four load-bearing mechanisms

### 3.1 Plugin server code is unsandboxed Node

`runtimeRequire` falls through to a real `createRequire` for anything that is not a plugin-SDK specifier —
`packages/server/src/server/plugins/plugin-process.ts:73-79`:

```ts
function runtimeRequire(name: string): unknown {
  if (isPluginClientOnlySdkSpecifier(name)) throw new Error(`${name} is available only in plugin client code`);
  if (isPluginSdkSpecifier(name)) return pluginAuthorRuntime;
  return nodeRequire(name);          // ← any node builtin or installed dep
}
```

So `*.server.ts` can `spawn("sbx", …)`, read the filesystem, and read `process.env`. Paseo is explicit:
*"Plugin code is trusted code; Paseo does not sandbox it"* (`docs/plugins.md:5`). Each plugin runs in its
own forked subprocess (`runtime.ts:161`, `stdio: ["ignore","pipe","pipe","ipc"]`), with a 30-second
per-RPC timeout (`runtime.ts:16`).

Note the client half is *not* privileged: the client bundle is `eval`'d inside the app with a strict
`require` allowlist (`packages/app/src/plugins/evaluate.ts:252-276`) — no `node:*`. All sbx shelling
lives behind `plugin.handle(...)` RPCs.

### 3.2 The plugin can write provider entries at runtime, with no restart

Every handler receives `{ paseo }` (`contracts.ts:283`), the full `PaseoApi`
(`packages/client/src/index.ts:400`), which includes `config.get()` / `config.patch()`. And
`agents.providers` is a **runtime-mutable** config path — `packages/server/src/server/daemon-config-store.ts:187`
and `:210` map `agents.providers` ⇄ the mutable wire field `providers`.

This is not theoretical: the app itself writes exactly this path over RPC when you install from the
in-app ACP catalog (`packages/app/src/hooks/use-acp-provider-catalog.ts:11-26`).

The schema being patched — `ProviderOverrideSchema`, `packages/protocol/src/provider-config.ts:46`:

```ts
export const ProviderOverrideSchema = z.object({
  extends: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  models: z.array(ProviderProfileModelSchema).optional(),
  additionalModels: z.array(ProviderProfileModelSchema).optional(),
  disallowedTools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  order: z.number().optional(),
});
```

Validation rules (`provider-config.ts:60-111`): id must match `/^[a-z][a-z0-9-]*$/`; a non-builtin id
**must** declare `extends` and `label`; `extends` must be one of
`["claude","codex","copilot","opencode","pi","omp"]` or the literal `"acp"`. There is no way to introduce
a new base kind from config.

### 3.3 `command` is a *prefix*, and the provider appends its own args

This is the mechanism the whole design rests on, so it was verified in source rather than taken from docs.
`resolveProviderLaunch` — `packages/server/src/server/agent/provider-launch-config.ts:88`:

```ts
if (commandConfig?.mode === "replace") {
  const command = commandConfig.argv[0];
  return { command, args: commandConfig.argv.slice(1), source: "override" };
}
```

The provider then appends its own arguments to `args`. Config-level `command` always maps to
`mode: "replace"` (`provider-registry.ts:258-273`); the `append` mode in `ProviderCommandSchema`
(`provider-config.ts:19`) is not exposed through config. Net effect:

```
command: ["sbx","exec","-w","<cwd>","<sandbox>","claude"]
       → sbx exec -w <cwd> <sandbox> claude <paseo's own claude args>
```

`docs/custom-providers.md:334` blesses this shape as the "custom wrapper script" pattern.

**Availability check gotcha:** `checkProviderLaunchAvailable` (`provider-launch-config.ts:113`) resolves
`launch.command` — i.e. **argv[0], the shim** — when `source === "override"`, not the underlying agent
binary. The shim must therefore be executable and either absolute or on the daemon's `PATH`, or Paseo
marks the provider unavailable. Conversely, this gives free health signalling: if `sbx` is missing, every
generated provider correctly reports unavailable.

### 3.4 sbx satisfies Paseo's one hard constraint for free

`docs/custom-providers.md:534` warns:

> "ensure the agent and Paseo share equivalent absolute workspace paths."

sbx mounts the host workspace at the **identical absolute path** via virtiofs passthrough. Verified
empirically from inside an sbx sandbox:

```
$ mount | grep Projects
host on /home/arek/Projects/paseo-sbx type virtiofs (rw,nosuid,nodev,relatime)
```

The daemon on the host and the agent inside the sandbox agree on `cwd` byte-for-byte. This is the single
biggest reason the design is viable, and it is why the daemon's local `stat()` of the cwd (§2.2) is
satisfied rather than circumvented.

**This holds only in direct mode.** With `--clone`, the agent works in a private in-container git clone
and the host repo is mounted read-only at `/run/sandbox/source` — paths no longer correspond, and Paseo's
diff/explorer/git surfaces would be pointed at the host tree while the agent edits the clone. **Clone-mode
sandboxes must be excluded from provider generation, or surfaced with a loud warning.**

---

## 4. Decisions

| Question | Decision | Consequence |
| --- | --- | --- |
| Base provider | **`extends: "claude"`** | Keeps Paseo's full native Claude integration — real tool catalog, exact MCP pre-approval, Hub unattended execution. Rejects the ACP route. |
| Sandbox ownership | **User-managed** | The plugin surfaces and reconciles what `sbx ls` reports. It does not auto-create a sandbox per workspace. |

### Why `extends: "claude"` over `extends: "acp"`

`extends: "acp"` is Paseo's *documented* containerised-agent story — `docs/custom-providers.md:506` even
names its example provider `"container-agent"`, with `params.clientCapabilities.terminal: false` so the
agent runs shell commands in its own environment instead of Paseo executing them on the daemon host
(`ACPAgentClient.createTerminal` → `spawnProcess`, `.../providers/acp-agent.ts:2383`).

It was rejected because user-defined ACP providers get `supportsExactMcpPreapproval: false`
(`provider-registry.ts:812` — only the synthetic `hub-e2e` id gets a real contract), which makes them
**fail closed for Hub unattended execution** (`docs/providers.md:36`). They also receive Paseo's tool
catalog only through the MCP fallback rather than natively.

**Implication to carry forward:** `params.clientCapabilities` and `params.supportsMcpServers` are parsed
only by `GenericACPProviderParamsSchema` (`.../providers/generic-acp-agent.ts:21`). Under
`extends: "claude"` they are inert. Do not reach for them.

**Open consequence [UNVERIFIED]:** because `clientCapabilities.terminal: false` is unavailable, any
terminal Paseo opens on behalf of the session still runs on the **host**, not in the sandbox. Whether the
Claude provider path routes shell execution through Paseo at all (it should not — Claude Code runs its own
Bash tool in-process, which will be inside the sandbox) needs confirming on a live daemon.

---

## 5. Architecture

```
Paseo daemon (host)                         sbx sandbox "myproj"
┌──────────────────────────────┐            ┌─────────────────────────────┐
│ plugin subprocess             │            │                             │
│  list-sandboxes RPC handler  │            │                             │
│   ├ spawn ────────────────────┼── sbx ls --json                          │
│   └ reconciler (same call) ──┼── (no separate trigger — §5.3)           │
│        │ config.patch({providers, removeProviders})                     │
│        ▼                     │            │                             │
│ agents.providers             │            │                             │
│   sbx-myproj-claude          │            │                             │
│     command: [shim, ...]     │            │                             │
│     env: PASEO_SBX_SANDBOX   │            │                             │
└────────────┬─────────────────┘            │                             │
             │ spawn(shim, <claude args>)   │                             │
             ▼                              │                             │
    paseo-sbx-launch  ──sbx exec -w $PWD────┼──► claude <args>            │
                                            │      cwd = /home/arek/…     │
                                            │      (same path, virtiofs)  │
                                            └─────────────────────────────┘
```

### 5.1 The launcher shim — required, not optional

`sbx exec` runs the command with the sandbox's default working directory; the host-side `cwd` of the
`sbx` client process is not propagated. The in-sandbox cwd must be set with `-w`. Since `command` is a
**static array** written into config, it cannot interpolate the per-session cwd — hence a shim.

Implemented at `shims/paseo-sbx-launch`, tested against a mock `sbx` binary (a real `sbx` is host-only,
see §8). Two additions beyond the sketch above:

- **A `$PASEO_SBX_WORKSPACES` cwd-membership guard**, checked with a colon-split prefix match before
  ever invoking `sbx`. `command` has no separate cwd field — cwd is always the daemon's own `$PWD` at
  spawn time — so a stale or wrong-sandbox provider pick would otherwise silently hand a foreign path to
  `-w` instead of failing loudly.
- **An inner `command -v "$0"` check** (where `$0` is bound to `$PASEO_SBX_AGENT`), run inside the
  sandbox before `exec`ing it. `sbx ls --json`'s `agent` field is unverified (§10 Q1) and best-effort;
  this turns a sandbox that lied about having the requested agent into a clear "no claude in sandbox"
  error instead of a hang.

```sh
#!/usr/bin/env sh
set -eu

matched=0
old_ifs=$IFS
IFS=:
for workspace in $PASEO_SBX_WORKSPACES; do
  case "$PWD" in
    "$workspace" | "$workspace"/*) matched=1 ;;
  esac
done
IFS=$old_ifs

if [ "$matched" -ne 1 ]; then
  served=$(echo "$PASEO_SBX_WORKSPACES" | tr ':' ' ')
  echo "workspace $PWD is not served by sandbox $PASEO_SBX_SANDBOX (serves: $served)" >&2
  exit 1
fi

exec sbx exec -w "$PWD" "$PASEO_SBX_SANDBOX" \
  sh -c 'command -v "$0" >/dev/null || { echo "no $0 in sandbox" >&2; exit 127; }; exec "$0" "$@"' \
  "$PASEO_SBX_AGENT" "$@"
```

Rationale for each piece:

- **No `-i`, no `-t`.** `sbx exec` flags mirror `docker exec` verbatim (`data/sbx_cli/sbx_exec.yaml`:
  *"Flags match the behavior of `docker exec`"*). A TTY would corrupt JSON framing through echo and CRLF
  translation — **confirmed working by the user against a live sbx.** `-i` was tried first (keep stdin
  open even when not attached) but dropped after the user's own hang investigation (§10 Q7, now
  resolved): `-i` was keeping the in-sandbox process's stdin open past client detach, so a leaked process
  never saw EOF and never exited on its own if the client side went away uncleanly. Without `-i`, stdin
  closes with the client, and the agent process exits with it — **confirmed working** against repeated
  start/kill cycles on a live sbx.
- **`command -v "$0"`, not `"$1"`.** `sh -c SCRIPT arg0 arg1…` binds the first trailing argument to `$0`
  inside SCRIPT, not `$1` — `$1` is the *first CLI flag the agent itself receives* (e.g. `--print`), not
  the agent binary name. An earlier version of this shim checked `$1` and then `shift`ed before the final
  `exec "$0" "$@"`, which both misfired the check against a flag instead of the agent name (failing
  almost every launch with a bogus "no `--print` in sandbox") and silently dropped the agent's first real
  argument. Fixed by checking `$0` and dropping the `shift` — verified against a mock `sbx` binary
  (both the old and new behavior reproduced locally, see commit history).
- **`-w "$PWD"`** — the whole reason the shim exists.
- **`exec`** replaces the shell process instead of forking a child — plain POSIX `exec`-builtin semantics,
  not an sbx-specific behaviour, so it needed no separate verification — so the daemon's direct child stays
  `sbx` itself, with no extra process layer for signals or the exit status to cross.
- **Sandbox selected by env, not argv**, so one shim serves every generated entry and the provider
  entries stay uniform.

### 5.2 Generated provider entry

```json
{
  "agents": {
    "providers": {
      "sbx-myproj-claude": {
        "extends": "claude",
        "label": "myproj (sbx)",
        "description": "Claude Code in sbx sandbox \"myproj\" — serves /home/arek/Projects/myproj",
        "command": ["/home/arek/.paseo/plugins/sbx/shims/paseo-sbx-launch"],
        "enabled": true,
        "order": 1000,
        "env": {
          "PASEO_SBX_SANDBOX": "myproj",
          "PASEO_SBX_AGENT": "claude",
          "PASEO_SBX_WORKSPACES": "/home/arek/Projects/myproj"
        }
      }
    }
  }
}
```

Id must satisfy `/^[a-z][a-z0-9-]*$/` — sandbox names need sanitising, and collisions after sanitisation
need resolving. Id format is `sbx-{sandbox-name}-{agent-name}` (the user's own confirmed choice): prefix
every generated id with `sbx-` so the reconciler can identify what it owns, and suffix with the agent
name so the id namespace stays unambiguous if a future sandbox generates entries for more than one
agent. `order` is one shared constant (`GENERATED_PROVIDER_ORDER` in `reconcile.server.ts`) applied to
every generated entry, so they form a stable block below the builtins rather than displacing the user's
normal Claude entry.

### 5.3 Reconciler

The plugin owns the `sbx-*` id namespace and nothing else. Implemented in `reconcile.server.ts`.

- **Trigger.** `PluginContext` (this repo's `paseo-plugin.d.ts:308-320`, matching upstream
  `packages/plugin/src/contracts.ts:309-330`) has no separate plugin-activation server hook —
  `contribute()`'s only argument is the plugin surface builder, and a `PaseoApi` handle only reaches
  handler code via the `{ paseo }` second argument `plugin.handle` passes in. So reconciliation runs
  from inside the `sbx.list-sandboxes` RPC handler itself, on every call — piggybacking on the client's
  existing 5s poll (`main.client.tsx`) rather than a bespoke trigger.
- **Shim path & verification.** The absolute shim path is derived from `config.get()`'s own
  `plugins.sbx` entry (`{source: "directory", path}`), not hardcoded — so it's correct regardless of
  where the plugin is installed. If `plugins.sbx` is missing or not a `directory` source, reconcile
  fails soft with an error surfaced to the UI rather than guessing a path. Before use, the shim is
  checked for the executable bit (`accessSync(X_OK)`); a fresh git checkout does not always preserve
  it, so a failed check is followed by one `chmodSync(shimPath, 0o755)` attempt before falling back to
  a "reinstall the plugin" error.
- `sbx ls --json` → desired set (already fetched by the list RPC; reused, not re-run).
- Diff against `config.get()`'s `providers` field — flat on the wire (`MutableDaemonConfig.providers`;
  `agents.providers` at §3.2 is the *on-disk* config path, not the RPC response shape) — considering
  only `sbx-` prefixed ids.
- **What gets diffed.** `config.get()`'s `providers` record only echoes back `enabled`/
  `additionalModels` per entry (`MutableDaemonConfigSchema.providers`, `messages.ts`), never the full
  override — there is nothing in it to compare the desired `command`/`env`/`label` against.
  Identity is diffed against `config.get()` — which `sbx-` ids are no longer desired — to compute
  `removeProviders`. Content changes are caught separately: `reconcile.server.ts` keeps a JSON
  signature of the last desired set + `removeProviders` it actually sent in module state, and skips
  `config.patch()` when the newly computed signature is unchanged, so an unchanged sandbox list
  doesn't re-send a `config.patch` on every 5s poll.
- **Skip logic.** A sandbox reporting a non-`claude`, non-null `agent` is skipped (we already know it
  can't run Claude Code); `agent: null` is *not* skipped, since the field is best-effort (§10 Q1) and the
  shim's own `command -v` check turns a wrong guess into a clear launch-time error rather than a missing
  provider. A sandbox with no `workspaces` is skipped — there is no `$PWD` the guard in §5.1 could ever
  match. Clone-mode sandboxes (§3.4) are **not** filtered — the field to detect them is still unverified
  (§10 Q5). Non-running sandboxes are **not** filtered either: `sbx exec` auto-starts a stopped sandbox
  (`sbx_exec.yaml`), so leaving the provider in place and letting a launch attempt fail loudly with
  sbx's own error is preferred over silently making a stopped sandbox disappear from the provider list.
- **Teardown is a no-op.** `contribute()`'s returned cleanup runs with no arguments and no `paseo` handle
  in scope — `PluginContext` exposes one only inside an RPC handler's context — so there is no way to
  call `config.patch({ removeProviders })` from it. Provider entries this plugin generated are **not**
  automatically removed when the plugin is disabled or uninstalled; they linger (pointing at a shim path
  that may no longer exist) until the plugin is re-enabled and reconciles again, or a user removes them
  by hand.

**[UNVERIFIED]** The `sbx ls --json` schema is not documented anywhere in Docker's docs. Pin the fields
actually consumed and fail soft on shape drift.

### 5.4 UI contributions

All of these are available and map cleanly onto the surface from §2.1:

- `addSurface` + `addSidebarItem` — a **Sandboxes** screen: list, status, workspace path, agent, ports,
  create/stop/rm, `sbx policy log` viewer for blocked egress.
- `addWorkspacePanel({ context: "workspace" })` — which sandbox backs this workspace's cwd; `PluginWorkspaceSnapshot`
  gives `directory`, `projectRootPath`, `kind` (`contracts.ts:51`).
- `addCommandCenterItem` — "Create sbx sandbox for this workspace", "Stop sandbox", "Open sandbox shell".
- `addClientSide` + `addComposerPill` — live sandbox status next to a running agent.

### 5.5 Custom sandbox actions — implemented

User-configurable buttons on each sandbox row, config-driven: `{ label, command }`. A generalized,
user-authored alternative to hardcoding `create`/`stop`/`rm` buttons per §5.4's Sandboxes-screen bullet.

**Config**: `$PASEO_HOME/sbx-actions.json` (`{ "actions": [{ "label": ..., "command": ... }] }`),
resolved the way paseo resolves its own `PASEO_HOME` (`packages/server/src/server/paseo-home.ts`:
`env.PASEO_HOME ?? "~/.paseo"`, expand a leading `~/`, `path.resolve`) — but *not* through
`ensurePrivateDirectory()`, since this is our own file and a read RPC should not have the side effect
of creating `~/.paseo`. Actions are global (every action renders on every sandbox row, in every
status — no `when` gating). Re-read on every RPC call, no cache/watcher: the surface already polls
`sbx.list-sandboxes` every 5s, so an edited file hot-reloads within one poll. An absent file means no
actions, silently. A malformed entry is dropped and the rest kept (`SbxActionSchema.safeParse` inside
a `flatMap`, the same idiom `sandboxes.server.ts` uses for `sbx ls --json`), but — unlike that
undocumented CLI schema — a warning naming what was dropped is surfaced in the UI, since silently
discarding an action the user believes they configured is the worst failure mode to debug.

**Why not `~/.paseo/config.json`**: investigated and rejected. The on-disk `PersistedConfigSchema` is
`.strict()` (`persisted-config.ts`) — an unknown root key stops the daemon from starting entirely.
Writes via `paseo.config.patch()` are silently dropped by `pickSupportedPatchFields()`
(`daemon-config-store.ts:340`), a hand-written allowlist; the `.passthrough()` on the *mutable* wire
schema is a red herring, since it's not the on-disk one. And there is no plugin settings/storage API
at all (`public-docs/plugins/reference.md:89`: *"There is no plugin storage API."*) — the only
upstream plugin with any config (`linear`) reads an env var instead. A plugin-owned file under
`$PASEO_HOME` sidesteps all three.

**Execution**: host-side (where the daemon runs), not inside the sandbox — reachable already via
`sbx exec <sandbox> -- ...` in a user's own command string if they want that. Mirrors paseo's own
house style for user-authored command strings (`packages/server/src/utils/string-command-shell.ts` +
`execSetupCommand` in `worktree.ts`): `{ shell: "bash", args: ["-c", command] }` on POSIX,
`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>` on `win32`, run via
`execFile` (not paseo's other, argv-array/no-shell style, which is for structured integration points
like `ProviderOverrideSchema`/`McpStdioServerConfigSchema`, not user-typed strings). `BASH_ENV` is
scrubbed from the child's env for the same reason paseo scrubs it — shell startup files should not
rewrite it behind our back — and it matters doubly in *this* dev sandbox, which sets
`BASH_ENV=/etc/sandbox-persistent.sh`. `cwd` is the sandbox's first workspace, falling back to
`os.homedir()` if it has none. The sandbox name is injected as the env var `SBX_SANDBOX_NAME` only —
no textual templating (`{{name}}`/`${name}`) — matching paseo's own convention of injecting
`PASEO_WORKTREE_PATH` et al. into command strings with no substitution anywhere in the codebase.

**RPC** (`sbx.run-action`, input `{ sandboxName, actionIndex }`): the server re-reads the config and
bounds-checks the index *before* doing anything else, returning a clean "stale" outcome instead of
running the wrong command if the config shrank between render and press. The command string itself
never reaches the client — sending it would turn this into a general "run this string on the host"
endpoint, and looking it up by label instead was rejected because duplicate labels break it. Labels
(never commands) ride along on `sbx.list-sandboxes`'s existing output instead of a second RPC, so they
stay fresh on the same 5s cadence with no extra loading state.

**Feedback**: there is no streaming API reachable from plugin code (the plugin IPC protocol has five
message types and no progress/chunk message, and `DaemonClient`'s terminal RPCs are unreachable from
plugins) — so this is request/response only. Success shows a toast with stdout's first non-empty line
(collapsed, truncated), falling back to "done" if the command was silent. Failure shows an error toast
plus a `Modal` with stdout/stderr, unless both are empty, in which case the modal is suppressed and
the toast alone carries the exit code — an empty modal is pure friction. The RPC's 30s host-side
ceiling is its own outcome, not a failure: `execFile` giving up does not kill the still-running
command, so the client races its own 30s timer against the RPC and reports "still running" rather than
calling it a failure. Accepted trade-offs, eyes open: no `when` gating (a "Stop" button can appear on
an already-stopped sandbox and just fail on press), no `confirm` step even for destructive actions,
and the stale-index race is mitigated (bounds-check + clean error) rather than eliminated.

**Still unverified in this dev sandbox** (see §8): the execution path itself — shell invocation, env
injection, `cwd` resolution — needs a real host with `sbx`/`paseo` installed. Only the pure config
parsing, fail-soft dropping, and bounds-checking are unit-tested (`actions.server.test.ts`).

---

## 6. Risks and their resolutions

### 6.1 `sbx exec` as a transparent stdio pipe — **RESOLVED**

Docker's docs document neither exit-code propagation nor stdout cleanliness for `sbx exec`, and `exec`
has no `--quiet` while it auto-starts a stopped sandbox — any banner on stdout would corrupt JSON-RPC
framing. **The user tested this against a live sbx and confirms it works.**

Fallback if it ever regresses: `sbx setup ssh` installs a managed `Host *.sbx` block using
`ProxyCommand sbx ssh proxy %n`, giving `ssh <name>.sbx -- <cmd>` with standard stdio and exit-status
semantics (`data/sbx_cli/sbx_setup_ssh.yaml`). Caveat: SSH does not forward client env vars, so the shim
would need to pass them explicitly.

### 6.2 Paseo's injected MCP server is unreachable from the sandbox — **ACCEPTED / route identified**

`createAgentMcpBaseUrl` (`packages/server/src/server/bootstrap.ts:250`) bakes a daemon-loopback URL into
the session config:

```ts
const host = resolveAgentMcpClientHost(listenTarget.host);
return new URL("/mcp/agents", `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`).toString();
```

That URL is injected as an `http` MCP server named `paseo` (`.../agent/runtime-mcp-config.ts:44`). From
inside the sandbox it points at the sandbox's own loopback — a dead address. Paseo's own tools
(subagents, workspace ops) would be unavailable to a sandboxed agent.

**Not treated as a security concern** — the sandbox boundary is the point, and losing daemon reach-back
is acceptable. Routes if the tools are wanted later, in order of preference:

1. **`sbx mcp`** — sbx has first-class MCP management: `sbx mcp add <name> (--url|--command)`,
   `sbx mcp load <name> --sandbox <sb>`, plus `ls`/`rm`/`inspect`/`auth`. Registering Paseo's
   `/mcp/agents` endpoint (with its bearer token) as an sbx-managed MCP server is the cleanest path.
   **[UNVERIFIED]** — not tested, and the interaction with Paseo's own injection is unexamined.
2. An in-sandbox forwarder on the same port → `host.docker.internal:<port>`, automated as an sbx kit
   `setup.startup` step. Requires the host port in the sandbox's network policy.
3. `mcpInjectIntoAgents: false` — global and blunt; disables injection for every agent, not just sandboxed
   ones. Mentioned only for completeness.

Note the auth detail if pursuing (1): `/mcp/agents` is a self-authenticating route (`.../server/auth.ts:122`)
gated on a capability token passed as `Authorization: Bearer` (`runtime-mcp-config.ts:52`), regenerated per
daemon run.

### 6.3 Credentials — **INTENDED**

Sandboxes do not inherit `~/.claude` from the host; only project-level config crosses
(`content/manuals/ai/sandboxes/agents/claude-code.md`). Each sandbox needs either
`sbx secret set anthropic` or an in-sandbox `/login` for subscription OAuth. This is the intended
behaviour, not a defect.

One operational gotcha worth surfacing in the plugin's UI: **sandbox-scoped secrets take effect
immediately on a running sandbox; global secrets apply only at sandbox creation.** Changing a global
secret requires recreating the sandbox.

---

## 7. Reference: the sbx surface this design uses

All from `data/sbx_cli/*.yaml` and `content/manuals/ai/sandboxes/**`.

| Need | Command |
| --- | --- |
| Enumerate sandboxes | `sbx ls --json` (also `-q` for names only; **no** `--format`) |
| Run the agent | `sbx exec -w <cwd> <sandbox> claude <args…>` — starts a stopped sandbox first |
| Create (no attach) | `sbx create --name <n> claude <path> [<path>:ro …]` |
| Lifecycle | `sbx stop <n>` · `sbx run --name <n>` (there is no bare `sbx start`) · `sbx rm [-f] <n>` · `sbx prune` |
| Ports | `sbx ports <n> [--json] [--publish [[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTO]]` |
| Egress policy | `sbx policy ls --json` · `sbx policy log --json` · `sbx policy allow network <domain>` |
| Secrets | `sbx secret set anthropic` · `sbx secret ls` · `--sandbox <n>` for sandbox scope |
| MCP | `sbx mcp add <name> --url\|--command` · `sbx mcp load <name> --sandbox <n>` |
| Daemon health | `sbx daemon status --json` |

Machine-readable output exists for `ls`, `ports`, `template ls`, `daemon status`, `policy ls`,
`policy log`, `policy check network`, `kit inspect`. **None of these JSON schemas are documented.**

There is **no local REST API and no Go/TS SDK** for sbx. `sandboxd` exposes a local Unix socket / named
pipe, but its protocol is undocumented; it is referenced only as the transport behind
`sbx ssh proxy` / `sbx ssh known-hosts`, which are themselves absent from the CLI reference. The plugin
is therefore CLI-driven by necessity.

---

## 8. Development environment constraint

Neither `sbx` nor `paseo` is installed inside an sbx sandbox — both are host-side tools. The plugin can be
authored and typechecked in a sandbox, but **every integration test must run on the host**, against a real
daemon and real sandboxes.

---

## 9. Plugin scaffolding facts

- Manifest is identity-only and `.strict()`: `{ "id": "..." }` (`.../plugins/manifest.ts:6`).
- Entry is `index.ts` with **exactly one** default-exported function taking one identifier param, a block
  body, and returning a cleanup function (`compiler.ts:124`, `plugin-process.ts:86`).
- Filename boundaries are compiler-enforced: `*.client.tsx` (React/RN), `*.server.ts` (Node), `*.shared.ts`
  (Zod contracts). Cross-importing `*.server` from client code, or vice versa, **fails compilation**
  (`compiler.ts:249`).
- Install: `paseo plugin init <dir>` → `npm install` → `paseo plugin install <dir>`. Requires
  `pluginsEnabled: true` in daemon config — *never enable that on a user's behalf without asking*
  (`docs/plugins.md:71`).
- SDK types come from a generated local `paseo-plugin.d.ts` (`packages/cli/src/commands/plugin/scaffold.ts:59`);
  `@getpaseo/plugin` is marked esbuild-external and injected at runtime. It **is** published to npm at
  `0.7.0-beta.1`, though `docs/plugins.md:56` still says otherwise.
- **The plugin API is explicitly experimental** — "expect breaking changes". There is no API version in the
  manifest; compatibility is negotiated only through daemon feature flags in `server_info`
  (`plugins`, `pluginManagement`, `pluginGitManagement`, `pluginLogs`, `pluginThemes`).
- Plugin stdout/stderr may contain secrets — `docs/plugins.md:110` warns against logging credentials.
  Relevant here: never log `sbx secret` output or tokens.

---

## 10. Open questions before implementation

1. **[UNVERIFIED]** `sbx ls --json` field names and stability. Re-checked 2026-08-30 against
   `data/sbx_cli/sbx_ls.yaml` in `docker/docs` — the spec documents only the flags (`--json`, `--quiet`,
   `--help`), not an output schema. `sandboxes.shared.ts` pins the fields from the user-supplied example
   (`name`, `id`, `agent`, `status`, `ports[]`, `workspaces[]`) and `sandboxes.server.ts` drops any entry
   that doesn't match rather than failing the list. No `sbx inspect`-equivalent exists for more detail.
2. **[UNVERIFIED]** Whether Paseo opens host-side terminals for a `extends: "claude"` session that should
   have been in the sandbox (§4).
3. **[UNVERIFIED]** Whether `sbx mcp` can carry Paseo's bearer-authenticated `/mcp/agents` endpoint, if the
   native tool catalog is wanted later (§6.2).
4. ~~Sandbox-name → provider-id sanitisation and collision policy (§5.2).~~ **RESOLVED.**
   `reconcile.server.ts`'s `slugify` lowercases and collapses runs of non-`[a-z0-9]` to single dashes;
   `resolveProviderIds` prefixes with `sbx-` and resolves collisions by appending `-2`, `-3`, … in
   sandbox-**name** order (not discovery order, which `sbx ls` does not guarantee is stable), so the
   winner of a collision is deterministic across runs.
5. Detection of clone-mode sandboxes from `sbx ls --json`, to exclude them (§3.4). **Still open** — no
   field for this was found in the (undocumented, §7) `sbx ls --json` output available for verification
   from inside a sandbox; clone-mode sandboxes are not currently excluded from provider generation.
6. ~~Reconciler trigger policy: poll `sbx ls`, watch, or explicit refresh only.~~ **RESOLVED**, and not by
   choice — verified against `contracts.ts` that no other trigger point exists. See §5.3.
7. ~~In-sandbox process teardown.~~ **RESOLVED**, by the user against a live sbx. The shim's own `exec`
   (§5.1) means there is no host-side process for the daemon's kill signal to stop at — `sbx exec`'s own
   client becomes the daemon's direct child — so the open question was whether an exec'd process (and any
   children it spawned) could be left running after Paseo considers the session gone. Dropping `-i` (§5.1)
   fixed it: `-i` was keeping stdin open past client detach, so a leaked process never saw EOF and never
   exited on its own; without `-i`, stdin closes with the client and the in-sandbox process exits with it.
   **Verified working** — repeated start/kill cycles against the same sandbox no longer leak processes.
8. **[UNVERIFIED]** Custom sandbox actions execution path (§5.5). The shell invocation is mirrored
   line-for-line from `string-command-shell.ts`/`execSetupCommand` and the pure config-parsing logic
   (`actions.server.ts`) is unit-tested, but the RPC handler's actual `execFile` call — including
   `cwd` resolution against a real sandbox's `workspaces[0]`, `SBX_SANDBOX_NAME` injection, and the
   30s client-side timeout race — has not been exercised against a live daemon from this dev sandbox
   (§8). Needs a pass on the host with a real `sbx-actions.json` before this is considered confirmed.
   The reconciler's own teardown (§5.3) still only ever removes provider *config* entries; process cleanup
   is handled entirely by this stdin-EOF behavior, not by the reconciler.
