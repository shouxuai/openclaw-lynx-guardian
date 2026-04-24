import type { PropsWithChildren } from "react";

import { SidebarNav } from "./SidebarNav";
import { TopBar } from "./TopBar";

export function ConsoleLayout({ children }: PropsWithChildren) {
  return (
    <div className="console-shell">
      <SidebarNav />
      <main className="console-main">
        <TopBar />
        <div className="console-content">{children}</div>
      </main>
    </div>
  );
}
