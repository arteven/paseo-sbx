import type { PluginContext } from "@getpaseo/plugin";
import { runActionHandler } from "./actions.server";
import { runActionRpc } from "./actions.shared";
import { MainSurface } from "./main.client";
import { listSandboxesHandler } from "./sandboxes.server";
import { listSandboxesRpc } from "./sandboxes.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listSandboxesRpc, listSandboxesHandler);
  plugin.handle(runActionRpc, runActionHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({ id: "main", title: "Docker Sandboxes", icon: "Box", surface: "main" });
  // No Command Center item: opening a surface from it crashes the mobile app — see CLAUDE.md.
  return () => {};
}
