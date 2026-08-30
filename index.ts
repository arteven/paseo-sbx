import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";
import { listSandboxesHandler } from "./sandboxes.server";
import { listSandboxesRpc } from "./sandboxes.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listSandboxesRpc, listSandboxesHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({ id: "main", title: "Docker Sandboxes", icon: "Box", surface: "main" });
  plugin.addCommandCenterItem({
    id: "open-docker-sandboxes",
    title: "Docker Sandboxes",
    icon: "Box",
    context: "global",
    onSelect({ openSurface }) {
      // The mobile Command Center is a @gorhom bottom-sheet modal whose select() closes the sheet
      // and runs this callback in the same commit (command-center.tsx:311-316). Navigating there
      // unmounts the sheet's provider while BottomSheetTextInput/BottomSheetFlatList are still
      // rendering, and useBottomSheetInternal throws. Let the close commit land first.
      setTimeout(() => openSurface("main"), 0);
    },
  });
  return () => {};
}
