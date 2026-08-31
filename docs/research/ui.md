# UI reference

How this plugin styles anything it renders, and where in Paseo's own source each decision comes
from.

This document deliberately **does not reproduce Paseo's code**. It names the file that owns each
answer so you read the version you are actually running against. Upstream changes; a paste here
would rot silently, a pointer fails loudly.

## Getting the source

```sh
git clone --depth 50 https://github.com/getpaseo/paseo.git
git -C paseo fetch --depth 1 origin tag v0.6.1 tag v0.7.0-beta.2
```

All paths below are relative to that checkout. They were last verified against `f2f9308`
(2026-08-30, after `v0.7.0-beta.2`). Line numbers are omitted on purpose — search for the named
export or component instead.

Three documents are worth reading before anything else:

| File | What it settles |
| --- | --- |
| `public-docs/plugins/reference.md` § *Theme and layout*, § *Surfaces and sidebar items*, § *Icons* | The contract Paseo promises plugin UI. Start here. |
| `docs/plugins.md` § *Contribute behavior and UI* | The internal view: filename boundaries, and what the host owns vs. what the surface owns. |
| `docs/unistyles.md`, `docs/design.md` | How the *app* styles itself. Context only — none of it is reachable from a plugin bundle. |

## What a plugin surface can actually reach

The host passes a `PluginTheme` (`packages/plugin/src/contracts.ts`) and a `layout`. That is the
whole styling API. In particular:

- **`PluginTheme` carries colours and nothing else.** No spacing, type, radius or opacity scale.
- **The app's `packages/app/src/styles/theme.ts` is not importable.** Client bundles are evaluated
  against a fixed require allowlist — see `runtimeRequire` in `packages/app/src/plugins/evaluate.ts`
  for the exact list. Anything outside it throws at evaluation time, taking the whole plugin with
  it.
- **Unistyles is not available either**, so `StyleSheet.create` with a theme callback — the app's
  own idiom, per `docs/unistyles.md` — has no plugin equivalent. Both upstream examples
  (`plugin-examples/local-plugin/main.client.tsx`,
  `plugin-examples/timeline-items/pi-tasks.client.tsx`) build plain style objects inside
  `useMemo(..., [theme])`. This plugin does the same, in `useStyles()` in `main.client.tsx`.

### Colours, and the version skew that bites

`PluginTheme["colors"]` types eleven tokens. The reference table under § *Theme and layout* in
`public-docs/plugins/reference.md` says what each one is for, and that table is the authority —
follow it rather than guessing from token names.

The catch: **the host sends whatever *its* version of `toPluginTheme`
(`packages/app/src/plugins/theme.ts`) maps, not whatever the SDK's types declare.** Check that one
function against the tag you are running:

- at `v0.6.1` it maps six — `surface0`, `foreground`, `foregroundMuted`, `accent`,
  `accentForeground`, `statusDanger`;
- at `v0.7.0-beta.2` it maps all eleven.

The missing five arrive `undefined` and fail *silently*: React Native paints an undefined
`backgroundColor` as transparent, so a card loses its fill and a `statusSuccess` dot vanishes
entirely — no warning, no error boundary. `resolvePluginColors()` in `theme.shared.ts` resolves the
palette once and derives the absent tokens from the six that are guaranteed. Read colours through
it, never from `theme.colors` directly.

Deriving a shade by appending an alpha pair to a hex token is Paseo's own technique — see
`identityTint()` in `packages/app/src/styles/identity-colors.ts`.

### Everything that is not a colour

Since the scales cannot be imported, `theme.shared.ts` re-declares the steps this plugin uses, under
the app's own names and values, from `SPACING`, `FONT_SIZE`, `FONT_WEIGHT`, `BORDER_RADIUS` and
`OPACITY` in `packages/app/src/styles/theme.ts`. Two one-off constants come from
`STATUS_INDICATOR_FILLED_DOT_SIZE` in `packages/app/src/utils/status-indicator-geometry.ts` and from
the content-column cap in `packages/app/src/screens/settings-screen.tsx`.

Keeping the app's names is the point: a plugin style that reads `spacing[4]` / `fontSize.sm` can be
diffed against the app style it copies. A literal `16` cannot. **When you need a new step, add it to
`theme.shared.ts` from the app's scale — never inline a number at the call site.**

`theme.shared.ts` is a `*.shared.ts` file so both runtimes may import it; the compiler only
special-cases the `.client` and `.server` suffixes
(`packages/server/src/server/plugins/compiler.ts`).

## The patterns this surface copies

`main.client.tsx` is one Settings-style section: a muted header line with a trailing text link, then
one bordered card of flat rows separated by hairlines. Each block of `useStyles()` is commented with
the app style it mirrors; the sources are:

| Plugin style | App source | Notes |
| --- | --- | --- |
| `content` | `packages/app/src/screens/settings-screen.tsx` | One centred column with a `maxWidth` cap. Never a grid, never a two-column layout. |
| `sectionHeader`, `sectionHeaderTitle`, `sectionHeaderLink*` | `settingsStyles` in `packages/app/src/styles/settings.ts` | Muted small title on the left, a plain text action on the right. The app's section actions are text, not buttons. |
| `card`, `row`, `rowBorder`, `rowContent`, `rowTitle`, `rowHint` | the same `settingsStyles` | A row is title + optional muted hint + one trailing control. `overflow: "hidden"` on the card is what clips the hairlines to the radius. |
| `pill`, `pillText`, `pillDot` | `packages/app/src/components/ui/status-badge.tsx` | Fully rounded, 1px border, neutral fill; **only the label and the leading dot carry the status hue**. The app fills it with `surface3`, which is outside the plugin token set, so `surface2` stands in. |
| `alert*` | `packages/app/src/components/ui/alert.tsx` | The error variant tints the border and the title and leaves the background transparent. The app never fills an alert. |
| `empty*` | `packages/app/src/components/sidebar/empty-states.tsx` | A centred column of small title + muted description. No card, no border. |
| `metaLine()` | `packages/app/src/components/sidebar/workspace-meta-row/index.tsx` | One `·`-separated line, truncated to a single line. Terse — the app never wraps a meta row. |
| `shortenPath()` | `packages/app/src/utils/shorten-path.ts` | The home-directory prefix becomes `~`. |

Three habits the app is consistent about, worth stating because they are easy to get wrong:
one flat column with hairline dividers inside a single bordered container — never one card per row;
no uppercase micro-labels, meta text is sentence-case, small, muted, normal weight; and status is
carried by a small dot and coloured text, never by a tinted background fill.

### What Paseo renders around the surface

`packages/app/src/plugins/surface-screen.tsx` owns the route, the screen header (the sidebar item's
title and icon), the host picker when the same contribution exists on several hosts, the close
action, and the render error boundary. **The surface owns only the body below the header** — so it
must not draw its own page title, or the screen shows the name twice.

### `layout.compact`

`public-docs/plugins/reference.md` advises tightening padding when `layout.compact` is true. This
surface does not, and that is deliberate: the settings screen it copies does not either.
`isCompactLayout` there drives *navigation* (root list vs. detail page), while the content column's
padding and `maxWidth` are unconditional. On a phone the cap simply never binds. If you add a style
that genuinely differs on mobile, branch it and recreate the memo on `layout.compact`.

## Icons: don't, unless you have checked the runtime

The host's `Icon` is documented under § *Icons* in `public-docs/plugins/reference.md`, and it
tolerates an unknown Lucide name by rendering nothing. That tolerance does **not** extend to the
component being absent: the SDK's runtime surface is whatever the *installed app* injects, and that
lags the generated `paseo-plugin.d.ts`. `Icon` is typed in the scaffold but is not in the require
map of Paseo < `0.7.0-beta.1`, and rendering an undefined import is React error #130 — a blank
surface, not a missing glyph.

Sidebar and Command Center `icon` strings are a different mechanism and are safe: the host resolves
and validates them itself (`packages/app/src/plugins/icons.ts`), so `icon: "Box"` works on every
version.

This surface renders **no icons at all**, which is also what
`plugin-examples/timeline-items/pi-tasks.client.tsx` does — it draws its status markers as text
characters. If you do want one, guard the import at runtime rather than trusting the type.

## The example plugins

`plugin-examples/` in the upstream checkout, one directory each:

| Example | Worth reading for |
| --- | --- |
| `local-plugin` | The closest thing to a styling baseline: `main.client.tsx` shows the memoized-plain-object idiom, `layout.compact` branching, and an accent-filled `Pressable` button. |
| `timeline-items` | `pi-tasks.client.tsx` — the smallest complete themed component, and the text-instead-of-icons precedent. |
| `catppuccin` | `addTheme`: contributing a palette rather than consuming one. |
| `linear` | No client surface; server RPC, Zod contracts and credential handling only. |

None of them is elaborate. That is the house style: RN primitives, one memoized style object,
colours from `theme.colors`, and no component library.

## Verifying without a host

`sbx` and `paseo` are not installed in this sandbox, but the *client bundle* can be compiled and
rendered here — which is how the host-only failures above get caught. See `CLAUDE.md` for the
recipe: `compilePlugin()` from `@getpaseo/server`, then evaluate the returned bundle against a stub
`require` mirroring `packages/app/src/plugins/evaluate.ts`.

Render the result through `react-test-renderer` with the RN primitives stubbed as host strings
(react-test-renderer treats a string element type as a host component, which is exactly what an RN
primitive is), once per host theme shape — six-colour and eleven-colour — and once per state:
loading, populated, empty, error. Grepping the rendered tree for `undefined` catches exactly the
silent-transparent failure described above.

## Checklist for new UI

- [ ] Colours come from `resolvePluginColors(theme)`, never `theme.colors` directly.
- [ ] Every number comes from `theme.shared.ts`; no literals at the call site.
- [ ] The pattern exists in the app first — find it, copy its structure, and cite it in a comment.
- [ ] No page title (the host header already renders one).
- [ ] No `Icon`, or a runtime-guarded one.
- [ ] Rendered on both host theme shapes, in all four states, with no `undefined` in the tree.
