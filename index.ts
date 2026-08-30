import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";

export default function contribute(plugin: PluginContext) {
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({ id: "main", title: "Docker Sandboxes", icon: "Box", surface: "main" });
  plugin.addCommandCenterItem({
    id: "open-docker-sandboxes",
    title: "Docker Sandboxes",
    icon: "Box",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  return () => {};
}
