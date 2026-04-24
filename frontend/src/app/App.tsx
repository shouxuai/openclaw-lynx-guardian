import { BrowserRouter } from "react-router-dom";

import { ConsoleLayout } from "../components/layout/ConsoleLayout";
import { AppRoutes } from "./router";

function resolveRouterBasename(): string {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/+$/, "");
  return baseUrl.length > 0 ? baseUrl : "/";
}

export function App() {
  return (
    <BrowserRouter basename={resolveRouterBasename()}>
      <ConsoleLayout>
        <AppRoutes />
      </ConsoleLayout>
    </BrowserRouter>
  );
}
