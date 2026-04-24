import { BrowserRouter } from "react-router-dom";

import { ConsoleLayout } from "../components/layout/ConsoleLayout";
import { normalizeWebviewLocation, WEBVIEW_BASE_PATH } from "./route-paths";
import { AppRoutes } from "./router";

function ensureWebviewLocation(): void {
  const normalizedLocation = normalizeWebviewLocation(window.location);
  if (normalizedLocation === null) {
    return;
  }

  window.history.replaceState(window.history.state, "", normalizedLocation);
}

export function App() {
  ensureWebviewLocation();

  return (
    <BrowserRouter basename={WEBVIEW_BASE_PATH}>
      <ConsoleLayout>
        <AppRoutes />
      </ConsoleLayout>
    </BrowserRouter>
  );
}
