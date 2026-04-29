import { useState } from "react";
import type { PropsWithChildren } from "react";

import type { ConsoleThemeMode } from "../../app/App";
import { SidebarNav } from "./SidebarNav";
import { TopBar } from "./TopBar";

interface ConsoleLayoutProps extends PropsWithChildren {
  themeMode: ConsoleThemeMode;
  onThemeModeChange: (themeMode: ConsoleThemeMode) => void;
}

export function ConsoleLayout({ children, themeMode, onThemeModeChange }: ConsoleLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className="console-shell"
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      data-theme={themeMode}
    >
      <SidebarNav
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => {
          setSidebarCollapsed((current) => !current);
        }}
      />
      <main className="console-main">
        <TopBar
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
        />
        <div className="console-content">{children}</div>
      </main>
    </div>
  );
}
