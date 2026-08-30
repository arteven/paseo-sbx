import type { PluginIconProps, PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { Icon as HostIcon, useRpc } from "@getpaseo/plugin";
import type { ComponentType } from "react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { SbxSandbox } from "./sandboxes.shared";
import { listSandboxesRpc } from "./sandboxes.shared";

// Layout numbers are hand-copied from docs/research/ui.md — the plugin theme carries no spacing or
// type scale, and every plugin example in the Paseo repo hardcodes the same values.
const POLL_INTERVAL_MS = 5000;
const CONTENT_MAX_WIDTH = 720;
const MAX_META_PORTS = 2;

const MONO = Platform.select({
  ios: "ui-monospace",
  android: "monospace",
  default: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// The host-rendered `Icon` only exists in Paseo >= 0.7.0-beta.1; on an older host the SDK module has
// no such export and rendering it throws React error #130. Resolve it defensively and fall back to
// a text glyph, the way plugin-examples/timeline-items draws its own status markers.
const iconComponent = HostIcon as ComponentType<PluginIconProps> | undefined;
const ICONS_AVAILABLE =
  typeof iconComponent === "function" ||
  (typeof iconComponent === "object" && iconComponent !== null);

function Glyph(props: PluginIconProps) {
  if (!iconComponent) return null;
  return <HostIcon {...props} />;
}

// Lucide's ChevronDown when the host provides icons; otherwise the same shape drawn from two
// borders, which beats a "▾" text glyph — that sits off the baseline and ignores the icon scale.
function Chevron({ up, color }: { up: boolean; color: string }) {
  if (ICONS_AVAILABLE) return <Glyph name={up ? "ChevronUp" : "ChevronDown"} size={14} color={color} />;
  return (
    <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRightWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: up ? "225deg" : "45deg" }, { translateY: up ? 1 : -1 }],
        }}
      />
    </View>
  );
}

type SbxPort = SbxSandbox["ports"][number];
type Colors = PluginTheme["colors"];

// Appending alpha to a hex token is the app's own tinting technique (identityTint() in
// packages/app/src/styles/identity-colors.ts appends "1a"); every theme value is a #rrggbb string.
function alpha(color: string, suffix: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${suffix}` : color;
}

// Paseo < 0.7.0-beta only sends surface0/foreground/foregroundMuted/accent/accentForeground/
// statusDanger (packages/app/src/plugins/theme.ts); the rest arrive undefined, which paints
// transparent fills and invisible status dots. Derive the missing ones instead of trusting the type.
function resolveColors(theme: PluginTheme): Colors {
  const c = theme.colors as Partial<Colors>;
  const foreground = c.foreground ?? "#000000";
  const accent = c.accent ?? foreground;
  return {
    surface0: c.surface0 ?? "transparent",
    surface1: c.surface1 ?? alpha(foreground, "0d"),
    surface2: c.surface2 ?? alpha(foreground, "14"),
    border: c.border ?? alpha(foreground, "26"),
    foreground,
    foregroundMuted: c.foregroundMuted ?? foreground,
    accent,
    accentForeground: c.accentForeground ?? foreground,
    statusSuccess: c.statusSuccess ?? accent,
    statusWarning: c.statusWarning ?? accent,
    statusDanger: c.statusDanger ?? accent,
  };
}

function statusColor(status: string, colors: Colors): string {
  const value = status.toLowerCase();
  if (value === "running") return colors.statusSuccess;
  if (value.includes("error") || value.includes("fail")) return colors.statusDanger;
  if (value === "stopped" || value === "exited" || value === "created")
    return colors.foregroundMuted;
  return colors.statusWarning;
}

// Same substitution the app uses (packages/app/src/utils/shorten-path.ts).
function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function formatHost(hostIp: string): string {
  return hostIp.includes(":") ? `[${hostIp}]` : hostIp;
}

function formatPort(port: SbxPort): string {
  return `${formatHost(port.host_ip)}:${port.host_port} → ${port.sandbox_port}/${port.protocol}`;
}

// sbx publishes each mapping once per host address family (127.0.0.1 and ::1), which is noise on a
// one-line summary — collapse it there and keep the full list for the expanded detail.
function dedupePorts(ports: readonly SbxPort[]): SbxPort[] {
  const unique = new Map<string, SbxPort>();
  for (const port of ports) {
    const key = `${port.host_port}:${port.sandbox_port}/${port.protocol}`;
    if (!unique.has(key)) unique.set(key, port);
  }
  return [...unique.values()];
}

function metaLine(sandbox: SbxSandbox): string {
  const items: string[] = [];
  if (sandbox.workspaces.length > 0) items.push(shortenPath(sandbox.workspaces[0]));
  if (sandbox.workspaces.length > 1) items.push(`+${sandbox.workspaces.length - 1} more`);
  if (sandbox.agent) items.push(sandbox.agent);
  const ports = dedupePorts(sandbox.ports);
  for (const port of ports.slice(0, MAX_META_PORTS)) {
    items.push(`${port.host_port} → ${port.sandbox_port}`);
  }
  if (ports.length > MAX_META_PORTS) items.push(`+${ports.length - MAX_META_PORTS}`);
  return items.join(" · ");
}

type Styles = ReturnType<typeof useStyles>;

function useStyles(theme: PluginTheme) {
  return useMemo(() => {
    const colors = resolveColors(theme);
    return {
      // Settings screen container, verbatim (packages/app/src/screens/settings-screen.tsx).
      screen: { flex: 1, backgroundColor: colors.surface0 },
      content: {
        padding: 16,
        paddingTop: 24,
        width: "100%" as const,
        maxWidth: CONTENT_MAX_WIDTH,
        alignSelf: "center" as const,
      },

      // SettingsSection header: muted label, 4px left inset, optional trailing link.
      sectionHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        marginBottom: 12,
        marginLeft: 4,
      },
      sectionTitle: { color: colors.foregroundMuted, fontSize: 12 },
      sectionLink: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
      sectionLinkText: { color: colors.foregroundMuted, fontSize: 12 },

      // settingsStyles.card / .row / .rowBorder / .rowContent / .rowTitle / .rowHint.
      card: {
        backgroundColor: colors.surface1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden" as const,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingVertical: 16,
        paddingHorizontal: 16,
      },
      rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
      rowHovered: { backgroundColor: colors.surface2 },
      rowContent: { flex: 1, marginRight: 12 },
      rowTitle: { color: colors.foreground, fontSize: 14 },
      rowHint: { color: colors.foregroundMuted, fontSize: 12, marginTop: 4 },
      rowTrailing: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },

      // StatusBadge (packages/app/src/components/ui/status-badge.tsx): neutral pill, only the
      // text and the leading dot carry the status hue — never the fill. surface3 is outside the
      // plugin's token set, so surface2 stands in for it.
      pill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        borderRadius: 9999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        paddingHorizontal: 8,
        paddingVertical: 3,
      },
      pillText: { fontSize: 12 },
      dot: { width: 6, height: 6, borderRadius: 3 },
      // DropdownTrigger nudges its chevron down a pixel to sit on the text baseline.
      chevron: { transform: [{ translateY: 1 }] },

      details: { marginTop: 12, gap: 8 },
      detailRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 12 },
      detailLabel: { color: colors.foregroundMuted, fontSize: 12, width: 88 },
      detailValues: { flex: 1, gap: 2 },
      detailValue: { color: colors.foreground, fontSize: 12, lineHeight: 17 },
      detailMono: { fontFamily: MONO },

      alert: {
        flexDirection: "row" as const,
        gap: 12,
        borderWidth: 1,
        borderColor: colors.statusDanger,
        backgroundColor: "transparent",
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginBottom: 24,
      },
      alertBody: { flex: 1 },
      alertTitle: { color: colors.statusDanger, fontSize: 14, fontWeight: "500" as const },
      alertText: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },

      centered: { alignItems: "center" as const, paddingVertical: 48, gap: 12 },
      emptyTitle: { color: colors.foreground, fontSize: 14 },
      emptyText: { color: colors.foregroundMuted, fontSize: 12 },
      emptyCommand: { color: colors.foregroundMuted, fontSize: 12, fontFamily: MONO },
    };
  }, [theme]);
}

function DetailRow({
  label,
  values,
  mono,
  styles,
}: {
  label: string;
  values: readonly string[];
  mono?: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValues}>
        {values.map((value) => (
          <Text key={value} style={[styles.detailValue, mono ? styles.detailMono : null]} selectable>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}

function SandboxRow({
  sandbox,
  divider,
  styles,
  colors,
}: {
  sandbox: SbxSandbox;
  divider: boolean;
  styles: Styles;
  colors: Colors;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const meta = metaLine(sandbox);
  // The summary line already carries a shortened path; only repeat workspaces when it hides something.
  const showWorkspaces =
    sandbox.workspaces.length > 1 ||
    (sandbox.workspaces.length === 1 && shortenPath(sandbox.workspaces[0]) !== sandbox.workspaces[0]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => setExpanded((value) => !value)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.row,
        divider ? styles.rowBorder : null,
        hovered ? styles.rowHovered : null,
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {sandbox.name}
        </Text>

        {meta.length > 0 && (
          <Text style={styles.rowHint} numberOfLines={1}>
            {meta}
          </Text>
        )}

        {expanded && (
          <View style={styles.details}>
            <DetailRow label="Sandbox id" values={[sandbox.id]} mono styles={styles} />
            {showWorkspaces && (
              <DetailRow
                label={sandbox.workspaces.length === 1 ? "Workspace" : "Workspaces"}
                values={sandbox.workspaces}
                styles={styles}
              />
            )}
            {sandbox.ports.length > 0 && (
              <DetailRow
                label={sandbox.ports.length === 1 ? "Port" : "Ports"}
                values={sandbox.ports.map(formatPort)}
                mono
                styles={styles}
              />
            )}
          </View>
        )}
      </View>

      <View style={styles.rowTrailing}>
        <View style={styles.pill}>
          <View style={[styles.dot, { backgroundColor: statusColor(sandbox.status, colors) }]} />
          <Text style={[styles.pillText, { color: statusColor(sandbox.status, colors) }]}>
            {sandbox.status}
          </Text>
        </View>
        <View style={styles.chevron}>
          <Chevron up={expanded} color={colors.foregroundMuted} />
        </View>
      </View>
    </Pressable>
  );
}

export function MainSurface({ theme }: PluginSurfaceProps) {
  const listSandboxes = useRpc(listSandboxesRpc);
  const [sandboxes, setSandboxes] = useState<SbxSandbox[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const styles = useStyles(theme);
  const colors = useMemo(() => resolveColors(theme), [theme]);

  const refresh = useCallback(async () => {
    try {
      const result = await listSandboxes({});
      setSandboxes(result.sandboxes);
      setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listSandboxes]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refresh]);

  // Paseo already renders a ScreenHeader with the sidebar item's title above this surface, so the
  // toolbar carries only the count and the refresh action — never a second "Docker Sandboxes" title.
  const summary = useMemo(() => {
    if (sandboxes === null) return "Loading…";
    if (sandboxes.length === 0) return "No sandboxes";
    const running = sandboxes.filter((sandbox) => sandbox.status.toLowerCase() === "running").length;
    return `${sandboxes.length} sandbox${sandboxes.length === 1 ? "" : "es"} · ${running} running`;
  }, [sandboxes]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{summary}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          hitSlop={4}
          style={({ pressed }) => [styles.sectionLink, pressed ? { opacity: 0.85 } : null]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.foregroundMuted} />
          ) : (
            <Glyph name="RefreshCw" size={12} color={colors.foregroundMuted} />
          )}
          <Text style={styles.sectionLinkText}>Refresh</Text>
        </Pressable>
      </View>

      {error && (
        <View style={styles.alert}>
          <Glyph name="TriangleAlert" size={14} color={colors.statusDanger} />
          <View style={styles.alertBody}>
            <Text style={styles.alertTitle}>Could not read sandboxes</Text>
            <Text style={styles.alertText}>{error}</Text>
          </View>
        </View>
      )}

      {sandboxes === null && !error && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {sandboxes !== null && sandboxes.length === 0 && !error && (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No sandboxes yet</Text>
          <Text style={styles.emptyText}>Create one on the host and it appears here.</Text>
          <Text style={styles.emptyCommand}>sbx create &lt;name&gt;</Text>
        </View>
      )}

      {sandboxes !== null && sandboxes.length > 0 && (
        <View style={styles.card}>
          {sandboxes.map((sandbox, index) => (
            <SandboxRow
              key={sandbox.id}
              sandbox={sandbox}
              divider={index > 0}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
