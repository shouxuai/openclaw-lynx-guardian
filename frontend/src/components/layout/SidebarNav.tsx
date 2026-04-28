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
    case "events":
      return (
        <svg {...commonProps}>
          <path d="M7 3h10v4H7z" />
          <path d="M5 7h14v14H5z" />
          <path d="M8 12h8" />
          <path d="M8 16h6" />
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
          <path d="M7 5h10a2 2 0 0 1 2 2v12H5V7a2 2 0 0 1 2-2Z" />
          <path d="m8.8 13 2 2 4.4-5" />
          <path d="M9 3h6v4H9z" />
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

export function SidebarNav() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <h1 className="sidebar__title">OpenClaw</h1>
        <p className="sidebar__eyebrow">GUARDIAN CONSOLE</p>
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
            <NavIcon id={item.id} />
            <span className="sidebar__linkLabel">{item.label}</span>
          </NavLink>
        ))}
      </nav>

    </aside>
  );
}
