import { Route, Routes } from "react-router-dom";

import { ApprovalsPage } from "../pages/ApprovalsPage";
import { DashboardPage } from "../pages/DashboardPage";
import { EventsPage } from "../pages/EventsPage";
import { LynxChecksPage } from "../pages/LynxChecksPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SessionsPage } from "../pages/SessionsPage";
import { TokensPage } from "../pages/TokensPage";
import { ToolCallsPage } from "../pages/ToolCallsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/events" element={<EventsPage />} />
      <Route path="/tool-calls" element={<ToolCallsPage />} />
      <Route path="/approvals" element={<ApprovalsPage />} />
      <Route path="/lynx-checks" element={<LynxChecksPage />} />
      <Route path="/sessions" element={<SessionsPage />} />
      <Route path="/tokens" element={<TokensPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
