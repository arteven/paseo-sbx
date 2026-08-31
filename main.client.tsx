import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { SbxSandbox } from "./sandboxes.shared";
import { listSandboxesRpc } from "./sandboxes.shared";
import type { PluginColors } from "./theme.shared";
import {
  borderRadius,
  CONTENT_MAX_WIDTH,
  fontSize,
  fontWeight,
  opacity,
  resolvePluginColors,
  spacing,
  STATUS_DOT_SIZE,
} from "./theme.shared";

// The surface is one Settings-style section: a muted header line with a trailing link, then one
// bordered card of flat rows divided by hairlines. Every style below is the app's own, named
// after the style it copies — see docs/research/ui.md for the source of each.
const POLL_INTERVAL_MS = 5000;

type SbxPort = SbxSandbox["ports"][number];
type StatusVariant = "success" | "error" | "muted";

function statusVariant(status: string): StatusVariant {
  const value = status.toLowerCase();
  if (value === "running") return "success";
  if (value.includes("error") || value.includes("fail")) return "error";
  return "muted";
}

/** The app's own path shortening (packages/app/src/utils/shorten-path.ts). */
function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

// sbx publishes each mapping once per host address family (127.0.0.1 and ::1), which reads as a
// duplicate on a one-line summary.
function dedupePorts(ports: readonly SbxPort[]): SbxPort[] {
  const unique = new Map<string, SbxPort>();
  for (const port of ports) {
    const key = `${port.host_port}:${port.sandbox_port}/${port.protocol}`;
    if (!unique.has(key)) unique.set(key, port);
  }
  return [...unique.values()];
}

// One `·`-separated meta line, the same shape as the sidebar's workspace meta row
// (packages/app/src/components/sidebar/workspace-meta-row/index.tsx): terse, one line, truncated.
function metaLine(sandbox: SbxSandbox): string {
  const items: string[] = [];
  const [workspace, ...rest] = sandbox.workspaces;
  if (workspace) items.push(shortenPath(workspace) + (rest.length > 0 ? ` +${rest.length}` : ""));
  if (sandbox.agent) items.push(sandbox.agent);
  const ports = dedupePorts(sandbox.ports);
  if (ports.length === 1) items.push(`${ports[0].host_port} → ${ports[0].sandbox_port}`);
  else if (ports.length > 1) items.push(`${ports.length} ports`);
  return items.join(" · ");
}

function useStyles(theme: PluginTheme) {
  return useMemo(() => {
    const colors = resolvePluginColors(theme);
    return {
      colors,

      // settings-screen.tsx's content column: one centred column with a cap, never a grid. The
      // app does not branch these numbers on compact — `isCompactLayout` there drives navigation,
      // not spacing — so this surface does not read `layout.compact` either. On a phone the cap
      // simply never binds.
      screen: { flex: 1, backgroundColor: colors.surface0 },
      content: {
        padding: spacing[4],
        paddingTop: spacing[6],
        width: "100%" as const,
        maxWidth: CONTENT_MAX_WIDTH,
        alignSelf: "center" as const,
      },

      // settingsStyles.sectionHeader / .sectionHeaderTitle / .sectionHeaderLink*.
      sectionHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: spacing[3],
        marginLeft: spacing[1],
      },
      sectionHeaderTitle: {
        color: colors.foregroundMuted,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.normal,
      },
      sectionHeaderLink: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: spacing[1],
      },
      sectionHeaderLinkText: { color: colors.foregroundMuted, fontSize: fontSize.sm },

      // settingsStyles.card / .row / .rowBorder / .rowContent / .rowTitle / .rowHint.
      card: {
        backgroundColor: colors.surface1,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden" as const,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingVertical: spacing[4],
        paddingHorizontal: spacing[4],
      },
      rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
      rowContent: { flex: 1, marginRight: spacing[3] },
      rowTitle: { color: colors.foreground, fontSize: fontSize.base },
      rowHint: { color: colors.foregroundMuted, fontSize: fontSize.sm, marginTop: spacing[1] },

      // ui/status-badge.tsx. The fill stays neutral; only the label and the dot carry the status
      // hue. The app fills the pill with `surface3`, which is outside the plugin's token set, so
      // `surface2` — the next surface down, and the app's own chip background — stands in.
      pill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        borderRadius: borderRadius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        paddingHorizontal: spacing[2],
        paddingVertical: 3,
      },
      pillText: { fontSize: fontSize.sm, fontWeight: fontWeight.normal },
      pillDot: {
        width: STATUS_DOT_SIZE,
        height: STATUS_DOT_SIZE,
        borderRadius: borderRadius.full,
      },

      // ui/alert.tsx, error variant: the border and title take the variant colour and the
      // background stays transparent — the app never fills an alert.
      alert: {
        gap: spacing[1],
        borderWidth: 1,
        borderColor: colors.statusDanger,
        backgroundColor: "transparent",
        borderRadius: borderRadius.xl,
        paddingVertical: spacing[3],
        paddingHorizontal: spacing[4],
        marginBottom: spacing[4],
      },
      alertTitle: {
        color: colors.statusDanger,
        fontSize: fontSize.base,
        fontWeight: fontWeight.medium,
      },
      alertDescription: { color: colors.foregroundMuted, fontSize: fontSize.sm },

      // sidebar/empty-states.tsx: a centred column, no card treatment.
      empty: { alignItems: "center" as const, paddingVertical: spacing[12], gap: spacing[3] },
      emptyTitle: {
        color: colors.foreground,
        fontSize: fontSize.sm,
        fontWeight: fontWeight.medium,
        textAlign: "center" as const,
      },
      emptyDescription: {
        color: colors.foregroundMuted,
        fontSize: fontSize.sm,
        textAlign: "center" as const,
      },
    };
  }, [theme]);
}

type Styles = ReturnType<typeof useStyles>;

function statusHue(variant: StatusVariant, colors: PluginColors): string {
  if (variant === "success") return colors.statusSuccess;
  if (variant === "error") return colors.statusDanger;
  return colors.foregroundMuted;
}

function StatusBadge({ label, styles }: { label: string; styles: Styles }) {
  const hue = statusHue(statusVariant(label), styles.colors);
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: hue }]} />
      <Text style={[styles.pillText, { color: hue }]}>{label}</Text>
    </View>
  );
}

function SandboxRow({
  sandbox,
  divider,
  styles,
}: {
  sandbox: SbxSandbox;
  divider: boolean;
  styles: Styles;
}) {
  const meta = metaLine(sandbox);
  return (
    <View style={[styles.row, divider ? styles.rowBorder : null]}>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {sandbox.name}
        </Text>
        {meta ? (
          <Text style={styles.rowHint} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <StatusBadge label={sandbox.status} styles={styles} />
    </View>
  );
}

export function MainSurface({ theme }: PluginSurfaceProps) {
  const listSandboxes = useRpc(listSandboxesRpc);
  const [sandboxes, setSandboxes] = useState<SbxSandbox[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const styles = useStyles(theme);

  // Deliberately a promise chain, not async/await. The plugin compiler builds client bundles with
  // esbuild's `supported: { "async-await": false }`, which lowers await into a `function*` driven by
  // a __async helper. That is only half of what Metro does for app code, and the generator syntax
  // that survives is a parse error on the Hermes build shipped in the mobile app — which makes
  // evaluate.ts throw, and registry.ts drop *every* contribution, sidebar item included, with the
  // error going nowhere but console.warn. No async in *.client.tsx; see docs/research/ui.md.
  const refresh = useCallback(() => {
    listSandboxes({}).then(
      (result) => {
        setSandboxes(result.sandboxes);
        setError(result.error);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  }, [listSandboxes]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // Paseo already renders a ScreenHeader with the sidebar item's icon and title above this
  // surface (packages/app/src/plugins/surface-screen.tsx), so the body opens on the section
  // header — never a second "Docker Sandboxes" title.
  const summary = useMemo(() => {
    if (sandboxes === null) return "Loading…";
    if (sandboxes.length === 0) return "No sandboxes";
    const running = sandboxes.filter((sandbox) => sandbox.status.toLowerCase() === "running");
    return `${sandboxes.length} sandbox${sandboxes.length === 1 ? "" : "es"} · ${running.length} running`;
  }, [sandboxes]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>{summary}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          hitSlop={4}
          style={({ pressed }) => [
            styles.sectionHeaderLink,
            pressed ? { opacity: opacity.pressed } : null,
          ]}
        >
          <Text style={styles.sectionHeaderLinkText}>Refresh</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.alert} accessibilityRole="alert">
          <Text style={styles.alertTitle}>Could not read sandboxes</Text>
          <Text style={styles.alertDescription}>{error}</Text>
        </View>
      ) : null}

      {sandboxes === null && !error ? (
        <View style={styles.empty}>
          <ActivityIndicator color={styles.colors.foregroundMuted} />
        </View>
      ) : null}

      {sandboxes !== null && sandboxes.length === 0 && !error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No sandboxes yet</Text>
          <Text style={styles.emptyDescription}>
            Create one on the host with sbx create and it appears here.
          </Text>
        </View>
      ) : null}

      {sandboxes !== null && sandboxes.length > 0 ? (
        <View style={styles.card}>
          {sandboxes.map((sandbox, index) => (
            <SandboxRow key={sandbox.id} sandbox={sandbox} divider={index > 0} styles={styles} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
