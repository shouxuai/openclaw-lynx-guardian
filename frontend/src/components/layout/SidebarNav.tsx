import { useState } from "react";
import { NavLink } from "react-router-dom";

import { PRIMARY_NAV_GROUPS } from "../../app/nav-config";

function NavIcon({ id }: { id: string }) {
  const commonProps = {
    "aria-hidden": true,
    className: "sidebar__linkIcon",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };

  switch (id) {
    case "dashboard":
      return (
        <svg {...commonProps}>
          <path d="M4 4h6v6H4z" />
          <path d="M14 4h6v6h-6z" />
          <path d="M4 14h6v6H4z" />
          <path d="M14 14h6v6h-6z" />
        </svg>
      );
    case "qa-records":
      return (
        <svg {...commonProps}>
          <path d="M5 5h14v10H8l-3 3V5Z" />
          <path d="M8 9h8" />
          <path d="M8 12h5" />
        </svg>
      );
    case "events":
      return (
        <svg {...commonProps}>
          <path d="M5 4h14v16H5z" />
          <path d="M8 8h8" />
          <path d="M8 12h6" />
          <path d="M8 16h8" />
          <path d="M4 8h2" />
          <path d="M4 16h2" />
        </svg>
      );
    case "decisions":
      return (
        <svg {...commonProps}>
          <path d="M12 3 20 8v8l-8 5-8-5V8l8-5Z" />
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
          <path d="M8.8 10.5h6.4" />
        </svg>
      );
    case "tool-calls":
      return (
        <svg {...commonProps}>
          <path d="m14.5 5.5 4 4" />
          <path d="m13 7 4 4" />
          <path d="M11.5 8.5 6 14l4 4 5.5-5.5" />
          <path d="m5.5 18.5-1.5 1.5" />
        </svg>
      );
    case "approvals":
      return (
        <svg {...commonProps}>
          <path d="M12 3.5 5.5 6v5.5c0 4.1 2.6 7.7 6.5 9 3.9-1.3 6.5-4.9 6.5-9V6L12 3.5Z" />
          <path d="m9.2 12 1.9 1.9 3.7-4" />
        </svg>
      );
    case "policies":
      return (
        <svg {...commonProps}>
          <path d="M5 5h14" />
          <path d="M5 12h14" />
          <path d="M5 19h14" />
          <circle cx="9" cy="5" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="11" cy="19" r="2" />
        </svg>
      );
    case "chains":
      return (
        <svg {...commonProps}>
          <path d="M7 7h10" />
          <path d="M7 17h10" />
          <circle cx="5" cy="7" r="2" />
          <circle cx="19" cy="17" r="2" />
          <path d="M7 7c5 0 5 10 10 10" />
        </svg>
      );
    case "grants":
      return (
        <svg {...commonProps}>
          <circle cx="8" cy="15" r="3" />
          <path d="m10.2 12.8 7-7" />
          <path d="M15 6h4v4" />
          <path d="M6.5 17.5 5 19" />
        </svg>
      );
    case "lynx-checks":
      return (
        <svg {...commonProps}>
          <path d="M7 5h10a2 2 0 0 1 2 2v12H5V7a2 2 0 0 1 2-2Z" />
          <path d="m8.8 13 2 2 4.4-5" />
          <path d="M9 3h6v4H9z" />
        </svg>
      );
    case "skills":
      return (
        <svg {...commonProps}>
          <path d="M12 3 4.5 7.2 12 11.4l7.5-4.2L12 3Z" />
          <path d="M4.5 12 12 16.2 19.5 12" />
          <path d="M4.5 16.8 12 21l7.5-4.2" />
        </svg>
      );
    case "sessions":
      return (
        <svg {...commonProps}>
          <path d="M8 5.5a4 4 0 0 1 8 0" />
          <path d="M5 21a7 7 0 0 1 14 0" />
          <path d="M12 9.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
          <path d="M4 10h3" />
          <path d="M17 10h3" />
        </svg>
      );
    case "tokens":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 12h7" />
          <path d="M12 8.5v7" />
        </svg>
      );
    default:
      return null;
  }
}

function SidebarChevron() {
  return (
    <svg
      aria-hidden="true"
      className="sidebar__groupToggleIcon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface SidebarNavProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function SidebarCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="sidebar__collapseIcon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
      <path d={collapsed ? "m10 9 3 3-3 3" : "m14 9-3 3 3 3"} />
    </svg>
  );
}

export function SidebarNav({ collapsed, onToggleCollapsed }: SidebarNavProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PRIMARY_NAV_GROUPS.map((group) => [group.id, true])),
  );
  const collapseLabel = collapsed ? "展开侧边栏" : "收起侧边栏";

  return (
    <aside className="sidebar" data-collapsed={collapsed ? "true" : "false"}>
      <div className="sidebar__brand">
        <h1 className="sidebar__title">{collapsed ? "OC" : "OpenClaw"}</h1>
        {!collapsed ? <p className="sidebar__eyebrow">GUARDIAN CONSOLE</p> : null}
      </div>

      <nav aria-label="主导航" className="sidebar__nav">
        {PRIMARY_NAV_GROUPS.map((group) => (
          <section className="sidebar__group" key={group.id}>
            {!collapsed ? (
              <button
                aria-controls={`sidebar-group-${group.id}`}
                aria-expanded={openGroups[group.id] ? "true" : "false"}
                className="sidebar__groupToggle"
                onClick={() => {
                  setOpenGroups((current) => ({
                    ...current,
                    [group.id]: !current[group.id],
                  }));
                }}
                type="button"
              >
                <span>{group.label}</span>
                <SidebarChevron />
              </button>
            ) : null}
            <div
              className="sidebar__groupItems"
              hidden={!collapsed && !openGroups[group.id]}
              id={`sidebar-group-${group.id}`}
            >
              {group.items.map((item) => (
                <NavLink
                  aria-label={collapsed ? item.label : undefined}
                  key={item.id}
                  className={({ isActive }) =>
                    isActive ? "sidebar__link sidebar__link--active" : "sidebar__link"
                  }
                  end={item.path === "/"}
                  to={item.path}
                >
                  <NavIcon id={item.id} />
                  <span className="sidebar__linkLabel">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button
          aria-label={collapseLabel}
          className="sidebar__collapseItem"
          onClick={onToggleCollapsed}
          title={collapsed ? collapseLabel : undefined}
          type="button"
        >
          <SidebarCollapseIcon collapsed={collapsed} />
          <span className="sidebar__linkLabel">{collapseLabel}</span>
        </button>
      </div>
    </aside>
  );
}
