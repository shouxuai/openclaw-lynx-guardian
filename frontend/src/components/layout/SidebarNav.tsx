import { NavLink } from "react-router-dom";

import { PRIMARY_NAV_ITEMS } from "../../app/nav-config";

function NavIcon({ id }: { id: string }) {
  const commonProps = {
    "aria-hidden": true,
    className: "sidebar__linkIcon",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  switch (id) {
    case "dashboard":
      return (
        <svg {...commonProps}>
          <path d="M4.5 10.5 12 4l7.5 6.5" />
          <path d="M6.5 9.5V20h11V9.5" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case "events":
      return (
        <svg {...commonProps}>
          <path d="M4 12h3l2-4 3 8 2-4h6" />
          <path d="M5 5.5h14" />
          <path d="M5 18.5h14" />
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
    case "lynx-checks":
      return (
        <svg {...commonProps}>
          <path d="M12 6.5a5.5 5.5 0 1 1 0 11" />
          <path d="M12 3.5v2" />
          <path d="M12 18.5v2" />
          <path d="M20.5 12h-2" />
          <path d="M5.5 12h-2" />
          <path d="m17.7 6.3-1.4 1.4" />
          <path d="m7.7 16.3-1.4 1.4" />
        </svg>
      );
    case "sessions":
      return (
        <svg {...commonProps}>
          <path d="M5 7.5h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H10l-4 3v-3H5a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z" />
          <path d="M8 11.5h7" />
          <path d="M8 14.5h4.5" />
        </svg>
      );
    case "tokens":
      return (
        <svg {...commonProps}>
          <ellipse cx="12" cy="6.5" rx="5.5" ry="2.5" />
          <path d="M6.5 6.5v5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-5" />
          <path d="M6.5 11.5v5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-5" />
        </svg>
      );
    default:
      return null;
  }
}

export function SidebarNav() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <p className="sidebar__eyebrow">守护体系</p>
        <h1 className="sidebar__title">本地控制台</h1>
        <p className="sidebar__summary">
          将本地守护遥测整理为值班操作台，便于快速巡查、审批复核和事后回放。
        </p>
      </div>

      <nav aria-label="主导航" className="sidebar__nav">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            className={({ isActive }) =>
              isActive ? "sidebar__link sidebar__link--active" : "sidebar__link"
            }
            end={item.path === "/"}
            to={item.path}
          >
            <span className="sidebar__linkMark">
              <NavIcon id={item.id} />
            </span>
            <span>
              <span className="sidebar__linkLabel">{item.label}</span>
              <span className="sidebar__linkDescription">{item.description}</span>
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
