# Paseo app UI conventions — reference for restyling the plugin surface

Researched against a shallow clone of `getpaseo/paseo` (commit at clone time, 2026-08-30). All
citations are `packages/app/src/...:NN` (or `plugin-examples/...:NN`, `docs/...:NN`) into that
clone — paths are correct relative to the repo root, not to this file. The clone itself is
temporary and not part of this repo.

The plugin surface (`main.client.tsx` in this repo) can only use plain `react-native` primitives
(`View`, `Text`, `ScrollView`, `Pressable`, `ActivityIndicator`) plus a theme object limited to
`surface0, surface1, surface2, border, foreground, foregroundMuted, accent, accentForeground,
statusSuccess, statusWarning, statusDanger` and `layout.compact`. Confirmed exact shape at
`packages/plugin/src/contracts.ts:7-21` and the mapping the app builds from its full theme at
`packages/app/src/plugins/theme.ts:1-19`. Nothing below asks you to import anything the plugin
cannot import — it is all "copy this number/pattern," not "import this component."

## How to look native — top checklist

1. **One column, not a wrapping card grid.** Every dense entity list in the app (sidebar
   workspaces, settings rows, provider list) is a single flat column. The app's own wide-screen
   pattern is a centered column with a max width (720px in Settings), not a multi-column grid of
   cards. See §8.
2. **Flat rows with a top hairline divider inside one bordered container, not one bordered card
   per row.** `packages/app/src/styles/settings.ts:28-45`.
3. **No uppercase micro-labels.** `textTransform: "uppercase"` appears 3 times in the entire app
   (a GitLab state badge, a technical tool-call label, one markdown heading) — it is not a
   convention. Secondary/meta text is plain sentence-case, `sm` size, `foregroundMuted`, normal
   weight. See §2 and §5.
4. **Status is a small filled dot (6px) or plain colored text/icon — never a tinted pill
   background.** The app's own `StatusBadge` pill uses a neutral `surface3` background with only
   the *text* colored by status; nothing tints a background with a status hue. See §4.
5. **Monospace text is bare inline text, not a chip.** A commit SHA, a sandbox id, etc. render as
   plain `fontFamily: mono` text in muted color — no border, no background, no pill.
   `packages/app/src/git/commits-section/commit-row.tsx:78-83`.
6. **Icons (including agent-provider icons) are single-color, tinted `foregroundMuted` or
   `foreground` — never a brand color.** See §9 (agent identity).
7. **Screen padding is 24px on desktop / 16px in compact — this is the one pattern every
   precedent (scaffold, both worked examples, and the app's own settings screen) agrees on.**
   `layout.compact ? 16 : 24`.
8. **Press feedback is opacity, not a background swap:** `pressed → opacity 0.85`,
   `disabled → opacity 0.5`. `packages/app/src/components/ui/button.tsx:133-138`.
9. **Card border radius is small (8–10px), not pill-like**, and card fill is `surface1` on a
   `surface0` page background — `surface2`/`surface3` are for chips and secondary buttons, not
   page or card backgrounds. See §3.
10. **Disclosure is navigation to a full screen with its own header, not expand-in-place inside a
    grid tile.** Plugin surfaces themselves are already the disclosed "detail" (Paseo owns the
    route and header) — a plugin should not build a second layer of card-level expand/collapse on
    top of that. See §5, §7.

---

## Precedent: plugin-examples (primary — read before app-internal screens)

`plugin-examples/` is Paseo's own author-facing precedent, referenced directly from
`docs/plugins.md:315-317`. Where it conflicts with app-internal screens (built with Unistyles,
theme tokens the plugin can't reach, translation keys, etc.), **follow the examples** — they were
written under the same restricted-token constraints a real plugin has, and app-internal code
was not.

Only two of the four examples render themed UI; `linear` contributes an attachment source (no
surface) and `catppuccin` contributes a theme palette, not a component.

### `plugin-examples/local-plugin/main.client.tsx` — a workspace panel

Full component at `plugin-examples/local-plugin/main.client.tsx:71-114`. Styling technique: a
plain object literal built inline with `useMemo`, keyed on `[theme, layout.compact]` — **not**
`StyleSheet.create` (that's an app-internal Unistyles API the plugin bundle doesn't have; plain
objects passed to RN's `style` prop are the only option and are what every example uses):

```ts
const styles = useMemo(
  () => ({
    screen: {
      flex: 1,
      padding: layout.compact ? 16 : 24,
      gap: 16,
      backgroundColor: theme.colors.surface0,
    },
    title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24 },
    detail: { color: theme.colors.foregroundMuted },
    button: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.accent },
    buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
    error: { color: theme.colors.statusDanger },
  }),
  [theme, layout.compact],
);
```
(`plugin-examples/local-plugin/main.client.tsx:76-91`)

Notes: page background is `surface0` (the plugin's screen root, matching `PluginSurfaceScreen`'s
own `theme.colors.surface0` at `packages/app/src/plugins/surface-screen.tsx:257-260`). Primary
button: `accent` fill, `accentForeground` text, `padding: 14`, `borderRadius: 10` — all literal
numbers, not references to a token scale the plugin doesn't have. Title font size itself responds
to `layout.compact` (20 vs 24), same as the screen padding does.

The composer-pill component in the same file (`OpenCounterPill`,
`plugin-examples/local-plugin/main.client.tsx:15-27`) is the one place across all examples that
renders an icon — via the **host-rendered `Icon` component**, imported straight from
`@getpaseo/plugin`:

```tsx
import { Icon, /* ... */ } from "@getpaseo/plugin";
<Icon name="Blocks" size={14} color={theme.colors.foregroundMuted} />
```
(`plugin-examples/local-plugin/main.client.tsx:2-21`)

**This is not available to us.** Per your brief, the daemon/app version this plugin targets
predates the host `Icon` export (see §"docs/plugins.md vs. code" below for the exact mechanism).
Treat every `Icon`/lucide-name usage in this example as aspirational, not reproducible.

### `plugin-examples/timeline-items/pi-tasks.client.tsx` — a rendered list, the closest thing to a status list in the examples

Full component at `plugin-examples/timeline-items/pi-tasks.client.tsx:15-66`:

```ts
const styles = useMemo(
  () => ({
    card: {
      gap: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 10,
      padding: 12,
      backgroundColor: theme.colors.surface1,
    },
    header: { flexDirection: "row" as const, justifyContent: "space-between" as const },
    title: { color: theme.colors.foreground, fontWeight: "600" as const },
    progress: { color: theme.colors.foregroundMuted },
    task: { flexDirection: "row" as const, gap: 8 },
    completed: { color: theme.colors.statusSuccess },
    inProgress: { color: theme.colors.accent },
    pending: { color: theme.colors.foregroundMuted },
    taskText: { color: theme.colors.foreground, flex: 1 },
    completedText: { color: theme.colors.foregroundMuted, flex: 1 },
  }),
  [theme],
);
```
(`plugin-examples/timeline-items/pi-tasks.client.tsx:17-41`)

Row status marker (`plugin-examples/timeline-items/pi-tasks.client.tsx:9-13,51-63`): each list item
is a `flexDirection: "row", gap: 8` line with **a plain colored glyph character as text** —
`✓` / `◐` / `○` — colored `statusSuccess` / `accent` / `foregroundMuted`. No dot `View`, no pill,
no background tint of any kind for status. This is the strongest example-level evidence for §4's
"never a tinted pill background" rule — the example deliberately reaches for the cheapest possible
RN-primitive status indicator (a colored character) rather than building a badge component.

Card anatomy: `surface1` fill, `theme.colors.border` at 1px, `borderRadius: 10`, `padding: 12`,
internal `gap: 8` — i.e. spacing values close to (but not identical to, since examples use literal
numbers, not a token scale) the app's own `spacing[3]`/`spacing[2]` and `borderRadius.lg`(8).

Header composition: `flexDirection: row, justifyContent: space-between` — title left
(`fontWeight: 600`, default `fontSize` — no explicit size given, i.e. RN's ~14 default, matching
`theme.fontSize.base`), a count/progress readout right in `foregroundMuted`. This is the example's
only "header," and it deliberately has no icon.

### What the examples avoid

- No uppercase labels anywhere in either file.
- No status pill / tinted badge background anywhere.
- No `StyleSheet.create` — always a plain memoized object (the plugin bundle has no Unistyles).
- No grid/wrap layout — `pi-tasks` is a single card; `local-plugin`'s panel is a single vertical
  `View` column.
- No monospace usage in either example (neither has an id/hash to display).
- Numbers are hand-picked literals (`16`, `24`, `8`, `10`, `12`, `14`), not references to a shared
  spacing scale — the plugin has no such scale to reference, so match the *values*, not an API.

---

## docs/plugins.md vs. code — what's real and what isn't for us

Read in full at `docs/plugins.md`. Its styling guidance (`docs/plugins.md:124-131`):

> Client files import Paseo UI from `@getpaseo/plugin/react-native`. Its `Icon` resolves a Lucide
> name using the client's installed icon set; an unknown name renders nothing so it cannot break
> the plugin surface. Its controlled modal keeps presentation metadata on
> `<Modal title="…" icon={…}>` and body UI in `<Modal.Content>`. Plugin UI runs on desktop and
> mobile across multiple themes: color every `Text` from `theme.colors.foreground` or
> `theme.colors.foregroundMuted`, and size layout from `layout.compact`.

The one explicit, repeated rule in the doc is: **every `Text` gets its color from either
`theme.colors.foreground` or `theme.colors.foregroundMuted`**, and layout sizing keys off
`layout.compact`. That is doc guidance, not just an observed pattern — worth treating as close to
a hard rule (status text using `statusSuccess`/`statusWarning`/`statusDanger` is the one
documented and code-confirmed exception, seen throughout §4/§9).

**Verifying the doc against the runtime require-map** (`packages/app/src/plugins/evaluate.ts:262-284`,
current HEAD): the app's plugin-bundle loader's `runtimeRequire` function does resolve
`@getpaseo/plugin` to an object that **includes `Icon`**:

```ts
if (name === "@getpaseo/plugin") {
  return { defineAttachmentSource, defineRpc, Icon, usePaseo, useAgent, useWorkspace, useRpc };
}
if (name === "@getpaseo/plugin/react-native" || name === "@paseo/plugin/react-native") {
  return pluginReactNativeRuntime; // { Icon, Modal, useToast } — packages/app/src/plugins/react-native/runtime.ts:1-5
}
```

And `Icon` itself (`packages/app/src/plugins/icons.ts:19-23`) really does resolve **any** exported
name from `lucide-react-native` by reflection — not a curated allowlist:

```ts
export function Icon({ name, size, color }: PluginIconProps): ReactElement | null {
  const icon = findPluginIcon(name);
  return icon ? createElement(icon, { size, color }) : null;
}
```

**So doc and current-HEAD code agree here** — this is not one of the doc's known drift spots (the
project's own notes flag `docs/plugins.md:56`, about the SDK being unpublished, as a separate,
already-known drift; that line is unrelated to `Icon`). The gap is purely a *version* gap: this
plugin's own `main.client.tsx:12-18` already documents that the host `Icon` export only exists
"in Paseo >= 0.7.0-beta.1" and defensively no-ops otherwise — which matches the coordinator's note
that the installed daemon/app predates it. **Treat every doc claim about `Icon` and
`@getpaseo/plugin/react-native`'s `Modal`/`useToast` as correct-but-unreachable** for this
plugin's current target, exactly as `main.client.tsx` already assumes. Do not "fix" the defensive
fallback — it's the correct posture until the host version bump actually lands.

The doc's "Paseo owns" list (`docs/plugins.md:165-167`) is also worth internalizing: Paseo already
owns "the route, screen header, Lucide icon validation, close action, theme DTO, layout facts, and
render error boundary." **The plugin's `MainSurface` should not be building its own second header**
— `packages/app/src/plugins/surface-screen.tsx:213-224` already renders a `ScreenHeader` with the
sidebar-contribution's icon/title above the surface, so a plugin-drawn "Docker Sandboxes" title
inside the body (current `main.client.tsx:444-448`) is genuinely redundant chrome, not just a
style mismatch.

---

## 1. Spacing scale

Full scale at `packages/app/src/styles/theme.ts:544-559`:

```ts
export const SPACING = {
  0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128,
} as const;
```

The plugin has no token module to reference this through (`theme.spacing` is not in the plugin's
theme shape), so hand-copy the *numbers* that recur:

- **Screen/content padding**: `16` compact / `24` regular — this is the one number that is
  identical across the CLI scaffold (`packages/cli/src/commands/plugin/scaffold.ts:397`), both
  worked examples, and used as `paddingHorizontal: theme.spacing[3]` (12, compact) /
  `theme.spacing[?]` in `ScreenHeader` itself (`packages/app/src/components/headers/screen-header.tsx:38`
  uses `spacing[2]`=8 compact / `spacing[3]`=12 regular for its own horizontal padding — the
  *header* is tighter than the *body*).
- **Card padding**: `12` (`spacing[3]`) — `pi-tasks` example and the app's own
  `SidebarProjectEmptyState`/settings row padding all land on 12–16.
- **Row vertical padding** (settings list row): `theme.spacing[4]` = 16 both directions
  (`packages/app/src/styles/settings.ts:39-40`).
- **Row-internal gaps** (icon-to-text, item-to-item on a meta line): `theme.spacing[1]`=4 to
  `spacing[2]`=8. The workspace meta row uses `gap: theme.spacing[1.5]`=6 between its items
  (`packages/app/src/components/sidebar/workspace-meta-row/index.tsx:278-283`) and `gap: 3`
  between an item's own icon and text (`:288-294`).
- **Section-to-section**: `theme.spacing[6]`=24 between settings sections
  (`packages/app/src/styles/settings.ts:4-6`).
- **`layout.compact` effect**: compact halves outer padding roughly 24→16 (scaffold, both
  examples) and swaps some `flexDirection`s / hides secondary chrome elsewhere in the app, but
  does **not** rescale the type or spacing *scale* itself — same `SPACING` object, same
  `FONT_SIZE` object, regardless of compact. Compact is a layout/paddings switch, not a "smaller
  design system" switch.

## 2. Typography

Scale at `packages/app/src/styles/theme.ts:561-571`:

```ts
export const FONT_SIZE = {
  code: 12, content: 15, sm: 12, base: 14, lg: 16, xl: 18, "2xl": 20, "3xl": 22, "4xl": 26,
} as const;
export const FONT_WEIGHT = { normal: "normal", medium: "500", semibold: "600", bold: "bold" } as const;
```

Concrete combos found in real components:

| Role | size | weight | color | lineHeight | citation |
|---|---|---|---|---|---|
| Screen title (`ScreenHeader`) | `base`=14 | `400` mobile / `300` desktop | `foreground` | — | `packages/app/src/components/headers/screen-title.tsx:29-38` |
| Section header (settings) | `sm`=12 | `normal` | `foregroundMuted` | — | `packages/app/src/styles/settings.ts:14-18` |
| Section header (sidebar, "Pinned") | `sm`=12 | `normal` | `foregroundMuted` | — | `packages/app/src/components/sidebar/pinned-section-header.tsx:58-62` |
| List item title (sidebar workspace row) | `base`=14 | `400` | `foreground`, `opacity: 0.76` unhovered → `1` hovered | `20` | `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx:506-520` |
| Settings row title | `base`=14 | default(normal) | `foreground` | — | `packages/app/src/styles/settings.ts:50-53` |
| Secondary/meta text (workspace meta line, host badge label, branch/project name) | `sm`=12 | default | `foregroundMuted` | `16` | `packages/app/src/components/sidebar/workspace-meta-row/index.tsx:249-254` |
| Settings row hint | `sm`=12 | default | `foregroundMuted` | — | `packages/app/src/styles/settings.ts:54-58` |
| Monospace (commit SHA) | `sm`=12 | default | `foregroundMuted` | — | `packages/app/src/git/commits-section/commit-row.tsx:78-83` |

Mono font stack (`packages/app/src/styles/theme.ts:623-627`):
```
ios: "ui-monospace"
web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
default: "monospace"
```
This is the same stack the plugin's own `main.client.tsx:25-29` already reimplements almost
verbatim (it can't import the app's constant, so hand-copying it, as the plugin already does, is
correct — just note the app's `ios` value is `"ui-monospace"`, not `"Menlo"`; a minor drift worth
fixing).

**Uppercase micro-labels**: not a convention. `textTransform: "uppercase"` appears at only 3 sites
app-wide (`packages/app/src/git/forges/gitlab.view.tsx:298`, a GitLab-specific state badge;
`packages/app/src/components/tool-call-details.tsx:898`, a technical detail label; and one
markdown-heading style in `packages/app/src/styles/markdown-styles.ts:130`). Every list/row/section
label elsewhere is plain sentence-case secondary text at `sm`/`normal` weight in `foregroundMuted`
— see the table above. The plugin's current `metaLabel`/`detailLabel` styles
(`main.client.tsx:169-176,208-215`: `fontSize: 10, letterSpacing: 0.6-0.7, textTransform:
"uppercase"`) are an outlier against this.

## 3. List item / card anatomy

The app's dominant pattern for a list of entities (settings rows, host list) is **one bordered
container holding flat rows separated by a top hairline**, not one bordered card per row:

```ts
// packages/app/src/styles/settings.ts:28-45
card: {
  backgroundColor: theme.colors.surface1,
  borderRadius: theme.borderRadius.lg,   // 8
  borderWidth: 1,
  borderColor: theme.colors.border,
  overflow: "hidden",
},
row: {
  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  paddingVertical: theme.spacing[4], paddingHorizontal: theme.spacing[4],   // 16/16
},
rowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },      // divider between rows, not per-row border
```

The sidebar's workspace list is the other dominant pattern — **flat rows with no card/border at
all**, background only on hover/selected state (`surfaceSidebarHover`/`surfaceSidebarSelected`,
`packages/app/src/styles/theme.ts:256-257,386-387`), separated purely by consistent row height and
padding, no divider lines.

Where a genuinely card-like surface *does* appear (the `pi-tasks` timeline example, sidebar empty
states), radius is small: `packages/app/src/components/sidebar/empty-states.tsx:57` uses
`theme.borderRadius.lg`=8; `plugin-examples/timeline-items/pi-tasks.client.tsx:23` uses a literal
`10`. Full radius scale (`packages/app/src/styles/theme.ts:591-600`):
```ts
export const BORDER_RADIUS = { none: 0, sm: 2, base: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 9999 };
```
`full` (9999) is reserved for pills/dots only, never for a card.

**Surface token usage rule** (from `packages/app/src/styles/theme.ts:308-330,444-461` and every
consumer file read): `surface0` = page/screen background; `surface1` = one level raised (a card,
a settings container, a menu surface); `surface2`/`surface3` = chip/pill backgrounds and hover/
selected states, never a page or card background. Border is always the flat `border` token, 1px —
`borderAccent` exists for a stronger/focused border but is not part of the plugin's reachable set.

**Divider vs. per-row card**: use `rowBorder`-style top hairlines inside one `surface1` container
(§3 above), matching both the settings screen and the `pi-tasks` single-card example's internal
`gap: 8` rows — not the plugin's current per-card grid.

## 4. Status display

Three real patterns, by context, none of which tint a background with the status hue:

1. **Sidebar workspace row (densest consumer, the one the whole status-color system in
   `theme.ts` is tuned against)**: a small filled dot, `6px` diameter
   (`STATUS_INDICATOR_FILLED_DOT_SIZE`, `packages/app/src/utils/status-indicator-geometry.ts:1-3`),
   `borderRadius: full`, solid `statusDot*` color (a separate, louder color band from
   `statusSuccess`/etc — see below), with a `1px` `surface0` ring/border so it "knocks out" of
   whatever's behind it. Or, for the *idle* case, the same dot at `foregroundExtraMuted` +
   `opacity: 0.3` rather than an empty slot. `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx:473-536`.
2. **Settings host page connection status**: the app's own `StatusBadge` pill — but note its
   background is **not** tinted by status; it's the neutral `surface3`, only the *text* (and an
   optional leading dot) take the status color:
   ```ts
   // packages/app/src/components/ui/status-badge.tsx:32-58
   pill: {
     borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.border,
     backgroundColor: theme.colors.surface3,       // neutral, not status-tinted
     paddingHorizontal: theme.spacing[2], paddingVertical: 3,
   },
   pillTextSuccess: { color: theme.colors.statusSuccess },  // only the text/dot is colored
   ```
   Used as `<StatusBadge label="Connected" variant="success" leading={<dot/>} />` at
   `packages/app/src/screens/settings/host-page.tsx:200-206`.
3. **Timeline/inline status (the plugin-examples precedent)**: no badge shape at all — a colored
   glyph character (`✓ ◐ ○`) or colored icon/text inline with the row.
   `plugin-examples/timeline-items/pi-tasks.client.tsx:9-13,51-63`.

There are **two separate color bands** for status, both present in the plugin's reachable
`statusSuccess/Warning/Danger` tokens (the quieter "text/icon" band) — a louder, dot-only
`statusDot*` band exists app-side (`packages/app/src/styles/theme.ts:190-204`) but is **not**
exposed to the plugin. For a plugin-drawn dot, the reachable `statusSuccess`/`statusWarning`/
`statusDanger` values themselves are the right (quieter) choice — do not try to brighten them.

**No RN color-mix, so how does the app tint anything?** Two techniques, both usable by the plugin
since its tokens are plain hex strings:
- **Alpha-suffix a known hex** — `identityTint()` is exactly `${hex}1a"` (10% alpha) appended to a
  precomputed hex (`packages/app/src/styles/identity-colors.ts:92-95`). A plugin can do the same
  to its own `statusSuccess`/`accent` hex: `theme.colors.statusSuccess + "1a"` for a 10%-alpha
  tint background, since every token the plugin receives is a `#rrggbb` string
  (`packages/app/src/styles/theme.ts:308-330` confirms all light/dark theme values are hex, never
  named colors).
- **Plain `rgba()` literal** — used for hover/press overlays (`interactionHighlight:
  "rgba(0, 0, 0, 0.06)"` light / `"rgba(255, 255, 255, 0.08)"` dark,
  `packages/app/src/styles/theme.ts:259,389`) — not derived from a token, just authored per theme.
  Not reachable by the plugin directly (not in its token set) but the *technique* — a fixed black/
  white alpha overlay independent of theme — is a fine substitute for hover state.

The app avoids tinting a *badge background* by status hue almost everywhere; where a tint is used
at all, it is reserved for user-chosen identity (label chips, `identityTint`, §"agent identity"),
never for reporting state. Prefer the dot/plain-text pattern over a tinted pill for the plugin.

## 5. Density & information hierarchy

The workspace sidebar row is the app's densest real list-item, and it shows exactly two lines:
title (workspace name) + one meta line (branch/project · host · PR · checks · running service ·
labels), truncated with `numberOfLines={1}` and a middle dot `·` separator between meta items
(`packages/app/src/components/sidebar/workspace-meta-row/index.tsx:97-104`). Everything past that
is disclosure — either a hover card (`WorkspaceHoverCard`,
`packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx:74-88`) or full navigation
into the workspace screen, **never** an in-row expand/accordion that grows the row's own height in
the list.

Settings rows follow the same two-tier shape: `rowTitle` + optional `rowHint`/`rowError` directly
under it (`packages/app/src/styles/settings.ts:50-63`) — no third tier, no expand affordance;
anything more goes to a separate screen/sheet.

Truncation is `numberOfLines={1}` everywhere text can overflow (title, branch name, host label,
service name — all cited above use it). Path shortening is a single regex substitution, not
middle-ellipsis: `path.replace(/^\/(?:Users|home)\/[^/]+/, "~")`
(`packages/app/src/utils/shorten-path.ts:5-10`) — no fancy path-segment elision elsewhere found.

**Disclosure model**: navigation (to a screen) or a hover card, not expand-in-place. This matters
specifically for the plugin: Paseo already gives every surface its own routed screen with a header
(`packages/app/src/plugins/surface-screen.tsx`), so a plugin list row's "disclosure" should mean
*navigating within the plugin's own surface/state*, not growing a card's height inline the way the
current `SandboxCard`'s `expanded` state does. If in-place disclosure is kept, keep it — the
`pi-tasks` example doesn't need one because its list is inherently short — but don't dress it with
a card-footer "hairline + truncated id" affordance; nothing in the app signals expand/detail with
a footer id string. `ChevronDown`/`ChevronRight` swap (`PinnedSectionHeader`,
`packages/app/src/components/sidebar/pinned-section-header.tsx:26,38-40`) is the app's actual
expand/collapse affordance where it does use in-place disclosure — a plain chevron flip, no footer
row.

## 6. Interaction affordances

- **Pressed**: `opacity: 0.85` (`packages/app/src/components/ui/button.tsx:133-134`); the
  sidebar's PR meta item uses the same idea at a slightly stronger `0.82`
  (`packages/app/src/components/sidebar/workspace-meta-row/index.tsx:242-244,318-321`).
- **Disabled**: `opacity: theme.opacity[50]` = 0.5 (`packages/app/src/components/ui/button.tsx:137`,
  `OPACITY` scale at `packages/app/src/styles/theme.ts:608-612`).
- **Hover** (desktop/web only): either a background swap to a slightly raised surface
  (`surfaceSidebarHover`) or brightening otherwise-muted text/icons to full `foreground` (the PR
  meta item swaps its icon and un-mutes its text on hover:
  `packages/app/src/components/sidebar/workspace-meta-row/index.tsx:198-221`). There is no
  dedicated "hover ring/border" convention — color/opacity change is the whole affordance.
- **hitSlop**: `4` on small inline pressables (`packages/app/src/components/sidebar/workspace-meta-row/index.tsx:207`).
- No visible custom focus ring anywhere read; RN's/OS default outline is left alone (out of scope
  for a plugin anyway — no ring token is exposed to it).
- Buttons never change border radius or size on press/hover — only opacity/background/icon color
  move; layout stays fixed, which avoids the reflow jank a hover-driven border swap in the current
  plugin (`cardHovered: { borderColor: ... }`, `main.client.tsx:127`) risks less of, but note the
  app tends to prefer opacity over border-color swaps for this exact reason.

## 7. Headers & empty/error/loading states

**Header composition** (`ScreenHeader`, `packages/app/src/components/headers/screen-header.tsx`):
fixed height (`HEADER_INNER_HEIGHT` = 36 desktop / `HEADER_INNER_HEIGHT_MOBILE` = 56,
`packages/app/src/constants/layout.ts:9-10`), `flexDirection: row, justifyContent: space-between`,
a single `1px` bottom `border`, left slot = icon badge + `ScreenTitle`, right slot = actions. This
is exactly what `PluginSurfaceScreen` already builds *around* every plugin surface
(`packages/app/src/plugins/surface-screen.tsx:213-243`) — the plugin does not need, and should not
draw, its own second title/subtitle header row inside the body.

**Empty state** (sidebar, the clearest example): centered column, `surface0` background (not
`surface1` — sits flush, no card treatment despite `borderRadius.lg`), title
(`sm`/`medium`/`foreground`) + description (`sm`/`foregroundMuted`) + one ghost-variant `Button`,
gap `spacing[3]`=12 between the three: `packages/app/src/components/sidebar/empty-states.tsx:53-70`.

**Error state**: the app's `Alert` component — **not** a tinted-background banner. Border and
icon/title take the variant color; the container background stays `"transparent"`:
```ts
// packages/app/src/components/ui/alert.tsx:87-98
container: {
  flexDirection: "row", gap: theme.spacing[3],
  borderWidth: 1, borderColor: theme.colors.border,  // or accentColor for non-default variants
  backgroundColor: "transparent",
  borderRadius: theme.borderRadius.xl,   // 12
  paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4],  // 12/16
},
```
Icon top-aligned in its own slot (`iconSlot: { paddingTop: 2 }`), title `base/medium/foreground`,
description `sm/foregroundMuted`. The plugin's current error banner
(`main.client.tsx:100-112`, `backgroundColor: colors.surface1`, `borderLeftWidth: 3` accent stripe)
diverges on both counts: the app never fills an alert's background, and never uses a colored
left-stripe accent border — it colors the *whole* border (or leaves it neutral for success) plus
icon/title.

**Loading**: plain `ActivityIndicator` sized/colored inline, no custom spinner graphic —
`packages/app/src/components/ui/loading-spinner.tsx:10-12` is a one-line wrapper around RN's own
`ActivityIndicator`. This matches the plugin's existing usage exactly (`main.client.tsx:451,468`) —
nothing to change here.

## 8. Responsive / wide-screen behaviour

The app's wide-desktop pattern is **a centered single column with a max width**, not a grid and
not edge-to-edge full-width rows:

```ts
// packages/app/src/screens/settings-screen.tsx:1663-1670
content: {
  padding: theme.spacing[4], paddingTop: theme.spacing[6],
  width: "100%", maxWidth: 720, alignSelf: "center",
},
```
Other screens use their own narrower caps for specific inline elements (`420`–`520` for
confirmation/empty bodies, `240`–`280` for tooltips/menus) — but every one of them is a **cap on a
single column**, never a multi-column reflow. `layout.compact` in `PluginSurfaceProps` is the
plugin's only signal here (no raw width), so the equivalent move for a plugin is: pick one
reasonable `maxWidth` (something in the 600–800 range, matching Settings' 720) with
`alignSelf: "center"` on the outermost content view, and drop the `flexWrap`/grid entirely in
favor of one column of rows. Compact stays full-width (no `maxWidth` applied, or a much smaller
one) exactly as `layout.compact ? 16 : 24` already does for padding.

`Unistyles` breakpoints exist app-side (`xs:0, sm:576, md:720, lg:992, xl:1200`,
`packages/app/src/styles/unistyles.ts:6-12`) but are not reachable by the plugin (no
`StyleSheet.create`, no breakpoint object literals) — `layout.compact` (a boolean keyed off
`COMPACT_FORM_FACTOR_WIDTH = 500`, `packages/app/src/constants/layout.ts:16`) is the plugin's only
lever, and it is coarse by design (two states, not five).

## 9. Agent identity (provider icons/colors) — and what the plugin can actually reach

**Where icons are drawn (app-internal, not plugin-reachable):**
`packages/app/src/components/provider-icons.ts:20-67` resolves a provider id string
(`"claude"`, `"codex"`, …) to a component in one of two ways:
- A **built-in inline SVG React component** per provider —
  `packages/app/src/components/icons/claude-icon.tsx:1-13` is representative: a hand-authored
  `<Svg><Path d="..."/></Svg>` taking `size`/`color` props, `fill={color}` (i.e. it renders
  whatever single color it's given — there is no baked-in brand color in the SVG itself).
  `BUILTIN_PROVIDER_ICONS` (`packages/app/src/components/provider-icons.ts:21-29`) maps
  `claude|codex|copilot|kiro|minimax|omp|opencode|pi` to these.
- Everything else falls through to `ACP_PROVIDER_CATALOG`'s bundled SVG XML strings, rendered via
  `react-native-svg`'s `SvgXml` (`packages/app/src/components/provider-icons.ts:35-46`), sourced
  from `packages/app/src/assets/acp-provider-icons/*.svg` (30+ files — `codex-acp.svg`,
  `qwen-code.svg`, `cursor.svg`, etc.). Final fallback is Lucide's generic `Bot`
  (`packages/app/src/components/provider-icons.ts:1,58-67`).

**Per-provider color convention: there isn't one for identity.** Every call site read colors the
provider icon with `theme.colors.foreground` or `theme.colors.foregroundMuted` — never a brand
hue:
```tsx
// packages/app/src/components/agent-list.tsx:286
<ProviderIcon size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
// packages/app/src/screens/settings/providers-section.tsx:229
<ProviderIcon size={theme.iconSize.md} color={theme.colors.foreground} />
// packages/app/src/provider-usage/card.tsx:19-20,25
const Icon = getProviderIcon(iconKey); return <Icon size={size} color={color} />;  // mutedIconColor mapping
// packages/app/src/composer/agent-controls/model-sheet.tsx:280-282
<ProviderIcon size={glyphSize} color={styles.providerIcon.color} />  // also a muted-family color
```
The "Claude" *theme variant* accent (`#d97757`, a warm orange,
`packages/app/src/styles/theme.ts:504-522`) is a **user-chosen app-wide accent palette**, unrelated
to which agent provider is actually running — it is not applied to provider icons/badges based on
identity. Sizes used: `theme.iconSize.sm`=14 (agent list row), `theme.iconSize.md`=16 (settings
provider row); `ICON_SIZE` scale is `xs:12, sm:14, md:16, lg:20`
(`packages/app/src/styles/theme.ts:577-582`).

**No monogram/letter-avatar pattern exists in the app.** Searched broadly (`Avatar`, `initials`,
`monogram`) — the only hits are GitHub PR-author avatars (real image URLs, unrelated to agent
identity). Agent identity is always the real bundled icon or nothing; the app never falls back to
a colored initial square for a provider.

**Is any of this reachable from the plugin? No — confirmed at the type level, not just by
convention:**
- `PluginAgentSnapshot.provider` is typed as bare `string`
  (`packages/plugin/src/contracts.ts:67-70`) — the raw provider id (`"claude"`), nothing else.
- The underlying protocol type is `export type AgentProvider = string`
  (`node_modules/@getpaseo/client/node_modules/@getpaseo/protocol/dist/agent-types.d.ts`, mirrored
  in the cloned repo) — no icon or color field on it anywhere.
- `PaseoApi.providers` (`packages/client/src/index.ts:400-406,490-505`) exposes
  `listModels/listModes/listFeatures/listAvailable/snapshot/waitForReady/refresh/diagnostic/subscribe`
  — all backed by `ProviderSnapshotEntry`, which carries `provider, status, enabled, source, error,
  models, modes, fetchedAt, label?` — **`label` is the one extra thing available** (a
  human-readable display name string like `"Claude"` instead of the raw id `"claude"`), still no
  `icon`/`color` field. `AgentMode.icon`/`colorTier` exist but describe a *mode* (safe/moderate/
  dangerous/planning), not provider brand identity, and their `icon` is a bare Lucide-name string
  the plugin has no way to resolve into a component without the host `Icon` export it doesn't have.
- The plugin cannot import `react-native-svg`, the app's `components/icons/*` files, or
  `data/acp-provider-catalog.ts` — none of those are on its allowed-import list, and even if they
  were, `evaluate.ts`'s `runtimeRequire` (§"docs/plugins.md vs. code") throws on any module name it
  doesn't explicitly recognize.

**Best available substitute, given only RN primitives + the plugin's theme tokens:** a plain text
label, styled exactly like the app's other muted secondary/meta text (§2's "Secondary/meta text"
row: `sm`/`foregroundMuted`, inline next to the row's other meta items, no icon slot reserved for
it) — e.g. render the raw `agent.provider` string (or, if reachable via `providers.snapshot()`,
its nicer `label`) as one more `·`-separated meta item, the same way the app renders host/branch/
service names on the workspace meta row (§5). Do **not** invent a colored square/monogram — no
such pattern exists anywhere in the app to imitate, and fabricating one risks looking like a
*status* indicator (which the app reserves for state, not identity — see §4's note that identity
tinting, where it exists at all, is reserved for user-chosen labels, not for a plugin to assign
per-provider colors nobody in the app has actually picked for the plugin to match).

---

## 10. Theme tokens are not all present at runtime (host version skew)

`PluginTheme` types eleven colors, but the host only sends what *its* version of
`packages/app/src/plugins/theme.ts` maps. Verified against the tags:

| Token | 0.6.1 (latest stable) | 0.7.0-beta.2 |
| --- | --- | --- |
| `surface0`, `foreground`, `foregroundMuted`, `accent`, `accentForeground`, `statusDanger` | yes | yes |
| `surface1`, `surface2`, `border`, `statusSuccess`, `statusWarning` | **undefined** | yes |

Symptoms on a 0.6.x host, all silent: `backgroundColor: undefined` paints transparent (cards look
flat and unseparated), `borderColor: undefined` falls back to CSS `currentColor` (borders appear but
in the wrong color), and a status dot colored `statusSuccess` disappears entirely while the
`foregroundMuted` one next to it renders — which reads as "the plugin has no status colors".

**Rule:** never index `theme.colors` directly for anything outside the six-token core. Resolve the
palette once (`resolveColors()` in `main.client.tsx`) and derive the rest from what is guaranteed:
`surface1`/`surface2`/`border` from `foreground` at 5%/8%/15% via the app's own hex-alpha-suffix
technique (§"alpha tinting"), `statusSuccess`/`statusWarning` from `accent` — so `running` still
reads as distinct from a muted `stopped`. Verify both payloads with the local render harness (see
project `CLAUDE.md`) before shipping.

---

## Copy-pasteable snippets (plugin's restricted token set only)

All three assume a component receiving `{ theme, layout }: PluginSurfaceProps` and building styles
with a memoized plain object, per every real example (§"Precedent").

**A native-looking list row** (flat row inside one bordered container, §3 + §5):
```ts
const rowStyles = {
  container: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
    backgroundColor: theme.colors.surface1, overflow: "hidden" as const,
  },
  row: {
    flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const,
    paddingVertical: 16, paddingHorizontal: 16,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  title: { color: theme.colors.foreground, fontSize: 14 },
  meta: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 },
};
// <View style={rowStyles.container}>
//   {items.map((item, i) => (
//     <View key={item.id} style={[rowStyles.row, i > 0 && rowStyles.rowDivider]}>
//       <View><Text style={rowStyles.title}>{item.name}</Text><Text style={rowStyles.meta}>{item.meta}</Text></View>
//       {/* trailing content */}
//     </View>
//   ))}
// </View>
```

**A status indicator** (dot, §4 — not a tinted pill):
```ts
function statusDotColor(status: "running" | "stopped" | "error", theme: PluginTheme) {
  if (status === "running") return theme.colors.statusSuccess;
  if (status === "error") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted; // idle/stopped — muted, not a fourth status hue
}
const dotStyle = { width: 6, height: 6, borderRadius: 3, backgroundColor: statusDotColor(status, theme) };
// <View style={dotStyle} />  — paired with plain text, not inside a pill/background
```

**A section header** (§2 — sentence-case, never uppercase):
```ts
const sectionHeaderStyle = { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "normal" as const };
// <Text style={sectionHeaderStyle}>Running sandboxes</Text>   — NOT "RUNNING SANDBOXES"
```

---

## What the plugin cannot reproduce, and the closest acceptable substitute

| App pattern | Why the plugin can't reproduce it exactly | Closest substitute with allowed tokens |
|---|---|---|
| Per-provider brand SVG icon (`components/icons/*`, `acp-provider-icons/*.svg`) | Not importable; `Icon`/`@getpaseo/plugin/react-native` unavailable on this host version | Plain `foregroundMuted` text label with the provider name (§9) |
| `statusDot*` band (brighter, separate from `statusSuccess`/etc) | Not in the plugin's theme shape (`packages/app/src/plugins/theme.ts:5-19` omits it) | Use the quieter `statusSuccess/Warning/Danger` for a dot — still correct, just less saturated than the app's own dots |
| `identityTint`/label-chip 10-hue system (`identity-colors.ts`) for e.g. per-workspace or per-tag color | The 10 hex hues and their light/dark foreground variants aren't exposed | If a tint is truly needed, alpha-suffix a reachable token (`theme.colors.accent + "1a"`) rather than inventing a hue table |
| `interactionHighlight` hover overlay token | Not in the plugin's token set | A literal `"rgba(0,0,0,0.06)"`/`"rgba(255,255,255,0.08)"` pair keyed off nothing (the plugin has no `colorScheme` field to pick between them) — or simpler, swap `surface1`→`surface2` on hover, matching the sidebar's own surface-swap hover technique |
| Unistyles responsive breakpoints (`xs/sm/md/lg/xl` object values in a style) | No `StyleSheet.create`, no breakpoint config reachable | `layout.compact` is the only lever — pick one `maxWidth` for the non-compact case (§8) instead of multiple breakpoint tiers |
| `theme.spacing`/`theme.fontSize`/`theme.borderRadius` token objects | Not in `PluginTheme` (`packages/plugin/src/contracts.ts:7-21`) | Hand-copy the literal numbers this doc lists (16/24 padding, 8–10 radius, 12/14 font sizes, etc.) — exactly what every `plugin-examples/*` file already does |
| Host `Icon` (Lucide-by-name) and `Modal`/`useToast` from `@getpaseo/plugin/react-native` | Confirmed real in current HEAD (`evaluate.ts`, `docs/plugins.md`) but unavailable on the target host version | Keep the existing defensive `ICONS_AVAILABLE` fallback to text (`main.client.tsx:12-23`) — it's already the correct posture |

---

## Top 5 things the current plugin surface most likely gets wrong

1. **Wrapping grid of bordered cards instead of a single column.** Every precedent — the app's own
   Settings screen (`maxWidth: 720, alignSelf: "center"`, one column), the sidebar list, and both
   rendered plugin examples (`pi-tasks` is one card, `local-plugin`'s panel is one vertical
   column) — is a single column. Nothing in the app or the examples uses `flexWrap`/a card grid
   for a list of entities. See §3, §8.
2. **Uppercase micro-labels (`WORKSPACE`, `AGENT`, `PORTS`) in a fixed 62px column.** This is
   close to unique in the codebase (3 hits app-wide, none of them list-row labels) and absent from
   both plugin examples. The app's actual convention for this exact "label the meta line" problem
   is plain sentence-case `foregroundMuted` text or, per the examples, no label at all — an icon
   (or, without icons, just the value) carries the meaning. See §2, §5.
3. **Monospace port values rendered as bordered chips.** The app never puts a chip/pill around
   monospace data — a commit SHA is bare `fontFamily: mono` text in `foregroundMuted`, no border,
   no background. Chips/pills in the app are reserved for user-identity labels (tinted) and status
   badges (neutral `surface3`), not for plain data values. See §5, §1(#5).
4. **Status pill with a dot on a `surface2` background.** The app's own `StatusBadge` — the
   closest built-in equivalent — keeps its pill background neutral (`surface3`) and colors only
   the text/dot; nothing in the app tints a badge's *background* by status hue. The plugin-examples
   precedent goes further and drops the pill shape entirely in favor of a bare colored glyph. See
   §4.
5. **Expand-in-place disclosure with a hairline footer showing a truncated id.** The app's
   disclosure model is navigation or a hover card, not a growing in-list card; where it does use
   in-place expand/collapse (`PinnedSectionHeader`), the only affordance is a chevron flip — no
   footer row, no exposed id string. A truncated id in a card footer has no counterpart anywhere
   read in the app. See §5.

(Also worth a quick fix, lower priority: the plugin's own `MONO` stack uses `Menlo` for iOS where
the app's constant uses `"ui-monospace"` — see §2 — and the plugin currently draws its own
"Docker Sandboxes" title/subtitle header inside the body, which duplicates the header Paseo's
`ScreenHeader` already renders around every surface — see "docs/plugins.md vs. code".)
