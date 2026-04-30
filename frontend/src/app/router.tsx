import { Route, Routes } from "react-router-dom";

import { ApprovalsPage } from "../pages/ApprovalsPage";
import { ChainsPage } from "../pages/ChainsPage";
import { DashboardPage } from "../pages/DashboardPage";
import { DecisionsPage } from "../pages/DecisionsPage";
import { EventsPage } from "../pages/EventsPage";
import { GrantsPage } from "../pages/GrantsPage";
import { LynxChecksPage } from "../pages/LynxChecksPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PoliciesPage } from "../pages/PoliciesPage";
import { QaRecordsPage } from "../pages/QaRecordsPage";
import { SessionsPage } from "../pages/SessionsPage";
import { SkillsPage } from "../pages/SkillsPage";
import { TokensPage } from "../pages/TokensPage";
import { ToolCallsPage } from "../pages/ToolCallsPage";
import { ROUTE_PATHS } from "./route-paths";

export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.dashboard} element={<DashboardPage />} />
      <Route path={ROUTE_PATHS.qaRecords} element={<QaRecordsPage />} />
      <Route path={ROUTE_PATHS.events} element={<EventsPage />} />
      <Route path={ROUTE_PATHS.decisions} element={<DecisionsPage />} />
      <Route path={ROUTE_PATHS.toolCalls} element={<ToolCallsPage />} />
      <Route path={ROUTE_PATHS.approvals} element={<ApprovalsPage />} />
      <Route path={ROUTE_PATHS.policies} element={<PoliciesPage />} />
      <Route path={ROUTE_PATHS.chains} element={<ChainsPage />} />
      <Route path={ROUTE_PATHS.grants} element={<GrantsPage />} />
      <Route path={ROUTE_PATHS.lynxChecks} element={<LynxChecksPage />} />
      <Route path={ROUTE_PATHS.sessions} element={<SessionsPage />} />
      <Route path={ROUTE_PATHS.skills} element={<SkillsPage />} />
      <Route path={ROUTE_PATHS.tokens} element={<TokensPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
