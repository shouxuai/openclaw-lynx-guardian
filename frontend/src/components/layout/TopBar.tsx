import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import type { ConsoleThemeMode } from "../../app/App";
import { PRIMARY_NAV_ITEMS } from "../../app/nav-config";

function resolvePageTitle(pathname: string): string {
  const match = PRIMARY_NAV_ITEMS
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => item.path === "/" ? pathname === "/" : pathname.startsWith(item.path));

  return match?.pageTitle ?? "Lynx Guardian";
}

interface TopBarProps {
  themeMode: ConsoleThemeMode;
  onThemeModeChange: (themeMode: ConsoleThemeMode) => void;
}

const THEME_OPTIONS: Array<{ mode: ConsoleThemeMode; label: string }> = [
  { mode: "light", label: "浅色" },
  { mode: "mixed", label: "混合" },
  { mode: "dark", label: "深色" },
];

function ThemeIcon({ mode }: { mode: ConsoleThemeMode }) {
  if (mode === "dark") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );
  }

  if (mode === "mixed") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 5h16" />
        <path d="M4 12h16" />
        <path d="M4 19h16" />
        <path d="M8 5v14" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3a6 6 0 0 0 9 7.2A8 8 0 1 1 12 3Z" />
    </svg>
  );
}

export function TopBar({
  themeMode,
  onThemeModeChange,
}: TopBarProps) {
  const location = useLocation();
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const title = resolvePageTitle(location.pathname);
  const activeTheme = THEME_OPTIONS.find((option) => option.mode === themeMode) ?? THEME_OPTIONS[0];

  useEffect(() => {
    if (!themeMenuOpen) {
      return undefined;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!themeMenuRef.current?.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setThemeMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [themeMenuOpen]);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="topbar__titleGroup">
          <h2 className="topbar__title">{title}</h2>
          {title === "工具调用审计" ? <span className="topbar__divider">|</span> : null}
          {title === "工具调用审计" ? <span className="topbar__eyebrow">TOOL CALLS MONITOR</span> : null}
        </div>
      </div>

      <div className="topbar__actions">
        <div className="topbar__themeDropdown" ref={themeMenuRef}>
          <button
            aria-expanded={themeMenuOpen}
            aria-haspopup="listbox"
            aria-label={`主题模式：${activeTheme.label}`}
            className="topbar__themeButton"
            onClick={() => {
              setThemeMenuOpen((current) => !current);
            }}
            type="button"
          >
            <span className="topbar__themeIcon">
            <ThemeIcon mode={themeMode} />
          </span>
            <span className="topbar__themeLabel">{activeTheme.label}</span>
            <span className="topbar__themeChevron" />
          </button>
          {themeMenuOpen ? (
            <div aria-label="主题模式选项" className="topbar__themeMenu" role="listbox">
              {THEME_OPTIONS.map((option) => (
                <button
                  aria-selected={option.mode === themeMode}
                  className={
                    option.mode === themeMode
                      ? "topbar__themeOption topbar__themeOption--selected"
                      : "topbar__themeOption"
                  }
                  key={option.mode}
                  onClick={() => {
                    onThemeModeChange(option.mode);
                    setThemeMenuOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="topbar__themeIcon">
                    <ThemeIcon mode={option.mode} />
                  </span>
                  <span className="topbar__themeOptionLabel">{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
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
