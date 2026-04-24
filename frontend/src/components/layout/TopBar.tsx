import { useState } from "react";

const TIME_RANGE_OPTIONS = ["今天", "近24小时", "近7天", "近30天"] as const;

export function TopBar() {
  const [activeRange, setActiveRange] = useState<(typeof TIME_RANGE_OPTIONS)[number]>("近24小时");

  return (
    <header className="topbar">
      <div className="topbar__range">
        <span className="topbar__label">时间范围</span>
        <div aria-label="时间范围" className="topbar__rangeGroup" role="group">
          {TIME_RANGE_OPTIONS.map((option) => {
            const isActive = option === activeRange;

            return (
              <button
                key={option}
                aria-pressed={isActive}
                className={isActive ? "topbar__rangeButton topbar__rangeButton--active" : "topbar__rangeButton"}
                onClick={() => setActiveRange(option)}
                type="button"
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="topbar__actions">
        <a
          className="topbar__githubButton"
          href="https://github.com/xuzhenggang/openclaw-lynx-guardian"
          rel="noreferrer"
          target="_blank"
        >
          <svg
            aria-hidden="true"
            className="topbar__githubIcon"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 .5C5.65.5.5 5.73.5 12.17c0 5.15 3.29 9.52 7.86 11.06.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.57-3.88-1.57-.52-1.35-1.28-1.7-1.28-1.7-1.05-.73.08-.72.08-.72 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.71 1.28 3.37.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.78 0-1.28.45-2.32 1.19-3.14-.12-.3-.52-1.52.11-3.16 0 0 .97-.32 3.18 1.2a10.8 10.8 0 0 1 5.8 0c2.2-1.52 3.17-1.2 3.17-1.2.63 1.64.23 2.86.11 3.16.74.82 1.19 1.86 1.19 3.14 0 4.49-2.69 5.47-5.25 5.76.41.36.77 1.08.77 2.18 0 1.57-.01 2.84-.01 3.22 0 .31.21.68.8.56 4.56-1.54 7.85-5.91 7.85-11.06C23.5 5.73 18.35.5 12 .5Z"
              fill="currentColor"
            />
          </svg>
          GitHub 地址
        </a>

        <div className="topbar__user">
          <div aria-label="当前用户头像" className="topbar__avatar" role="img">
            守
          </div>
          <p className="topbar__userName">Lynx Guardian</p>
        </div>
      </div>
    </header>
  );
}
