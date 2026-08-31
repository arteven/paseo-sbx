import type { PluginTheme } from "@getpaseo/plugin";

/**
 * The app's design tokens, re-declared for the plugin bundle.
 *
 * `PluginTheme` carries colours and nothing else — no spacing, type, radius or opacity scale
 * (`packages/plugin/src/contracts.ts`), and the plugin bundle cannot import the app's
 * `packages/app/src/styles/theme.ts`. So the scales below are re-declared under the app's own
 * names and values; keeping the names means plugin styles read like app styles
 * (`spacing[4]`, `fontSize.sm`, `borderRadius.lg`) instead of like magic numbers.
 *
 * Values mirror `SPACING`, `FONT_SIZE`, `FONT_WEIGHT`, `BORDER_RADIUS` and `OPACITY` in
 * `packages/app/src/styles/theme.ts`. Only the steps this plugin uses are kept —
 * see `docs/research/ui.md` for where each one is spent in the app.
 */
export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 12: 48 } as const;
export const fontSize = { sm: 12, base: 14 } as const;
export const fontWeight = { normal: "normal", medium: "500" } as const;
export const borderRadius = { lg: 8, xl: 12, full: 9999 } as const;
export const opacity = { pressed: 0.85 } as const;

/** `STATUS_INDICATOR_FILLED_DOT_SIZE` (packages/app/src/utils/status-indicator-geometry.ts). */
export const STATUS_DOT_SIZE = 6;

/** Settings screen's content column (packages/app/src/screens/settings-screen.tsx). */
export const CONTENT_MAX_WIDTH = 720;

export type PluginColors = PluginTheme["colors"];

/**
 * Appending an alpha pair to a hex token is the app's own tinting technique — `identityTint()`
 * in `packages/app/src/styles/identity-colors.ts` appends `"1a"`. Every colour the host sends is
 * a `#rrggbb` string, so this is safe; anything else is passed through untouched.
 */
function alpha(color: string, suffix: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${suffix}` : color;
}

/**
 * `PluginTheme` types eleven colours but the host only sends what *its* version of
 * `packages/app/src/plugins/theme.ts` maps. Paseo 0.6.1 sends six of them; `surface1`,
 * `surface2`, `border`, `statusSuccess` and `statusWarning` arrive `undefined` and fail
 * silently — an undefined `backgroundColor` paints transparent, so the card looks like it has no
 * fill, and a status dot coloured `statusSuccess` disappears entirely. Resolve the palette once
 * here and derive whatever is missing from the six that are guaranteed.
 */
export function resolvePluginColors(theme: PluginTheme): PluginColors {
  const sent = theme.colors as Partial<PluginColors>;
  const foreground = sent.foreground ?? "#000000";
  const accent = sent.accent ?? foreground;
  return {
    surface0: sent.surface0 ?? "transparent",
    surface1: sent.surface1 ?? alpha(foreground, "0d"),
    surface2: sent.surface2 ?? alpha(foreground, "14"),
    border: sent.border ?? alpha(foreground, "26"),
    foreground,
    foregroundMuted: sent.foregroundMuted ?? foreground,
    accent,
    accentForeground: sent.accentForeground ?? foreground,
    statusSuccess: sent.statusSuccess ?? accent,
    statusWarning: sent.statusWarning ?? accent,
    statusDanger: sent.statusDanger ?? accent,
  };
}
