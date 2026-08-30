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
command: ["sbx","exec","-i","-w","<cwd>","<sandbox>","claude"]
       → sbx exec -i -w <cwd> <sandbox> claude <paseo's own claude args>
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
│ plugin subprocess            │            │                             │
│  ├ RPC handlers ──spawn──────┼── sbx ls --json / create / stop / rm     │
│  └ reconciler                │            │                             │
│        │ config.patch({providers})        │                             │
│        ▼                     │            │                             │
│ agents.providers             │            │                             │
│   sbx-myproj-claude          │            │                             │
│     command: [shim, ...]     │            │                             │
│     env: PASEO_SBX_SANDBOX   │            │                             │
└────────────┬─────────────────┘            │                             │
             │ spawn(shim, <claude args>)   │                             │
             ▼                              │                             │
    paseo-sbx-launch  ──sbx exec -i -w $PWD─┼──► claude <args>            │
                                            │      cwd = /home/arek/…     │
                                            │      (same path, virtiofs)  │
                                            └─────────────────────────────┘
```

### 5.1 The launcher shim — required, not optional

`sbx exec` runs the command with the sandbox's default working directory; the host-side `cwd` of the
`sbx` client process is not propagated. The in-sandbox cwd must be set with `-w`. Since `command` is a
**static array** written into config, it cannot interpolate the per-session cwd — hence a shim.

```sh
#!/usr/bin/env sh
# paseo-sbx-launch — argv[0] of every generated provider entry.
# $PASEO_SBX_SANDBOX / $PASEO_SBX_AGENT come from the provider entry's `env`.
set -eu
exec sbx exec -i -w "$PWD" "$PASEO_SBX_SANDBOX" "$PASEO_SBX_AGENT" "$@"
```

Rationale for each piece:

- **`-i`, no `-t`.** `sbx exec` flags mirror `docker exec` verbatim (`data/sbx_cli/sbx_exec.yaml`:
  *"Flags match the behavior of `docker exec`"*). A TTY would corrupt JSON framing through echo and CRLF
  translation. **Confirmed working by the user against a live sbx.**
- **`-w "$PWD"`** — the whole reason the shim exists.
- **`exec`** so signals and the exit status pass through without an extra process layer.
- **Sandbox selected by env, not argv**, so one shim serves every generated entry and the provider
  entries stay uniform.

### 5.2 Generated provider entry

```json
{
  "agents": {
    "providers": {
      "sbx-myproj-claude": {
        "extends": "claude",
        "label": "Claude · sbx:myproj",
        "description": "Claude Code inside Docker sandbox \"myproj\" (/home/arek/Projects/myproj)",
        "command": ["/home/arek/.paseo/plugins/sbx/paseo-sbx-launch"],
        "env": { "PASEO_SBX_SANDBOX": "myproj", "PASEO_SBX_AGENT": "claude" },
        "order": 100
      }
    }
  }
}
```

Id must satisfy `/^[a-z][a-z0-9-]*$/` — sandbox names need sanitising, and collisions after sanitisation
need resolving. Prefix every generated id with `sbx-` so the reconciler can identify what it owns.

### 5.3 Reconciler

The plugin owns the `sbx-*` id namespace and nothing else.

- On plugin start, and on demand: `sbx ls --json` → desired set.
- Diff against `config.get()`'s `agents.providers`, considering only `sbx-` prefixed ids.
- `config.patch({ providers: { … } })` to add, update, or disable.
- Filter out clone-mode sandboxes (§3.4) and non-running ones (or keep them and let `sbx exec` auto-start —
  it does start a stopped sandbox, per `sbx_exec.yaml`).
- Tear down in the contribution's returned cleanup, which Paseo awaits on reload/disable/remove
  (`docs/plugins.md:159`).

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
| Run the agent | `sbx exec -i -w <cwd> <sandbox> claude <args…>` — starts a stopped sandbox first |
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
4. Sandbox-name → provider-id sanitisation and collision policy (§5.2).
5. Detection of clone-mode sandboxes from `sbx ls --json`, to exclude them (§3.4).
6. Reconciler trigger policy: poll `sbx ls`, watch, or explicit refresh only.
