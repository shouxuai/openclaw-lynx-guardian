import type { DecisionRequest, DecisionResponse } from "../../shared/src/decision.js";
import type { LocalConsoleRuntimeConfig } from "../runtime/local-console-config.js";

export type GoDecisionEndpoint = "input" | "tool" | "output" | "install";

export interface GoControlPlaneClientOptions {
  baseUrl?: string;
  config?: Pick<LocalConsoleRuntimeConfig, "baseUrl">;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
}

export class GoControlPlaneClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoControlPlaneClientOptions) {
    this.baseUrl = (options.baseUrl ?? options.config?.baseUrl ?? "").replace(/\/+$/, "");
    this.getToken = options.getToken ?? (() => "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!this.baseUrl) {
      throw new Error("GoControlPlaneClient requires a local console base URL.");
    }
    if (!this.fetchImpl) {
      throw new Error("GoControlPlaneClient requires fetch.");
    }
  }

  decideInput(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("input", request, signal);
  }

  decideTool(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("tool", request, signal);
  }

  decideOutput(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("output", request, signal);
  }

  decideInstall(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("install", request, signal);
  }

  resolveApproval<TResponse = unknown>(
    approvalId: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    return this.postJson<TResponse>(
      `/lynx/internal/v1/approvals/${encodeURIComponent(approvalId)}/resolve`,
      body,
      signal,
    );
  }

  startLynxCheckTask<TResponse = unknown>(body: unknown, signal?: AbortSignal): Promise<TResponse> {
    return this.postJson<TResponse>("/lynx/internal/v1/tasks/lynx-check/start", body, signal);
  }

  appendLynxCheckTaskEvent<TResponse = unknown>(
    requestId: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    return this.postJson<TResponse>(
      `/lynx/internal/v1/tasks/lynx-check/${encodeURIComponent(requestId)}/event`,
      body,
      signal,
    );
  }

  syncSkillInventory<TResponse = unknown>(body: unknown, signal?: AbortSignal): Promise<TResponse> {
    return this.postJson<TResponse>("/lynx/internal/v1/skills/inventory/sync", body, signal);
  }

  private async postDecision(
    endpoint: GoDecisionEndpoint,
    request: DecisionRequest,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    return this.postJson<DecisionResponse>(`/lynx/internal/v1/decision/${endpoint}`, request, signal);
  }

  async postJson<TResponse>(path: string, body: unknown, signal?: AbortSignal): Promise<TResponse> {
    const token = this.getToken().trim();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Go control-plane API responded with HTTP ${response.status}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as TResponse;
  }
}
