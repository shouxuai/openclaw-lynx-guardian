import type { DashboardOverviewDto } from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface DashboardOverviewQuery {
  fromMs?: number;
  toMs?: number;
}

export function getDashboardOverview(query: DashboardOverviewQuery = {}): Promise<DashboardOverviewDto> {
  return fetchJson<DashboardOverviewDto>(`/dashboard/overview${buildQueryString(query)}`);
}
