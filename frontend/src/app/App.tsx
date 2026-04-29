import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ConsoleLayout } from "../components/layout/ConsoleLayout";
import { normalizeWebviewLocation, WEBVIEW_BASE_PATH } from "./route-paths";
import { AppRoutes } from "./router";

export type ConsoleThemeMode = "light" | "mixed" | "dark";

function ensureWebviewLocation(): void {
  const normalizedLocation = normalizeWebviewLocation(window.location);
  if (normalizedLocation === null) {
    return;
  }

  window.history.replaceState(window.history.state, "", normalizedLocation);
}

export function App() {
  ensureWebviewLocation();
  const [themeMode, setThemeMode] = useState<ConsoleThemeMode>("mixed");
  const isDarkTheme = themeMode === "dark";

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDarkTheme ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          borderRadius: 6,
          colorBgBase: isDarkTheme ? "#1b1c1d" : "#f6f8fa",
          colorBorder: isDarkTheme ? "#424e5e" : "#d7dee5",
          colorPrimary: isDarkTheme ? "#74abf2" : "#0b63f6",
          colorText: isDarkTheme ? "#f6f8fa" : "#1b1c1d",
          fontFamily: "inherit",
        },
      }}
    >
      <BrowserRouter basename={WEBVIEW_BASE_PATH}>
        <ConsoleLayout
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
        >
          <AppRoutes />
        </ConsoleLayout>
      </BrowserRouter>
    </ConfigProvider>
  );
}
