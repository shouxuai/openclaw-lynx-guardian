import { useLocation } from "react-router-dom";

import { PRIMARY_NAV_ITEMS } from "../../app/nav-config";

function resolvePageTitle(pathname: string): string {
  const match = PRIMARY_NAV_ITEMS
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => item.path === "/" ? pathname === "/" : pathname.startsWith(item.path));

  return match?.pageTitle ?? "Lynx Guardian";
}

export function TopBar() {
  const location = useLocation();
  const title = resolvePageTitle(location.pathname);

  return (
    <header className="topbar">
      <div className="topbar__titleGroup">
        <h2 className="topbar__title">{title}</h2>
        {title === "工具调用审计" ? <span className="topbar__divider">|</span> : null}
        {title === "工具调用审计" ? <span className="topbar__eyebrow">TOOL CALLS MONITOR</span> : null}
      </div>

      <div className="topbar__actions">
        <button aria-label="通知" className="topbar__iconButton" type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </button>
        <button aria-label="账户" className="topbar__iconButton" type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </button>
      </div>
    </header>
  );
}
