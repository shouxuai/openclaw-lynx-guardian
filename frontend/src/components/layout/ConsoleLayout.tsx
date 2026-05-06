import { useState } from "react";
import type { PropsWithChildren } from "react";

import type { ConsoleThemeMode } from "../../app/App";
import { SidebarNav } from "./SidebarNav";
import { TopBar } from "./TopBar";

interface ConsoleLayoutProps extends PropsWithChildren {
  themeMode: ConsoleThemeMode;
  onThemeModeChange: (themeMode: ConsoleThemeMode) => void;
}

export function ConsoleLayout({
  children,
  themeMode,
  onThemeModeChange,
}: ConsoleLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div
      className="console-shell"
      data-mobile-nav={mobileNavOpen ? "open" : "closed"}
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      data-theme={themeMode}
    >
      <SidebarNav
        collapsed={sidebarCollapsed}
        onNavigate={() => {
          setMobileNavOpen(false);
        }}
        onToggleCollapsed={() => {
          setSidebarCollapsed((current) => !current);
        }}
      />
      <button
        aria-label="关闭导航"
        className="mobile-nav-scrim"
        onClick={() => {
          setMobileNavOpen(false);
        }}
        type="button"
      />
      <main className="console-main">
        <TopBar
          themeMode={themeMode}
          onOpenMobileNav={() => {
            setMobileNavOpen(true);
          }}
          onThemeModeChange={onThemeModeChange}
        />
        <div className="console-content">{children}</div>
      </main>
    </div>
  );
}
