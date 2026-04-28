import type { DecisionRequest, DecisionResponse } from "../../shared/src/decision.js";
import type { LocalConsoleRuntimeConfig } from "./local-console-config.js";
import { buildLocalConsoleDecisionUrl, type LocalConsoleDecisionEndpoint } from "./local-console-client.js";

export interface DecisionClientOptions {
  baseUrl?: string;
  config?: Pick<LocalConsoleRuntimeConfig, "baseUrl">;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
}

export class DecisionClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DecisionClientOptions) {
    this.baseUrl = (options.baseUrl ?? options.config?.baseUrl ?? "").replace(/\/+$/, "");
    this.getToken = options.getToken ?? (() => "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!this.baseUrl) {
      throw new Error("DecisionClient requires a local console base URL.");
    }
    if (!this.fetchImpl) {
      throw new Error("DecisionClient requires fetch.");
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

  private async postDecision(
    endpoint: LocalConsoleDecisionEndpoint,
    request: DecisionRequest,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    const token = this.getToken().trim();
    const response = await this.fetchImpl(buildLocalConsoleDecisionUrl(this.baseUrl, endpoint), {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      throw new Error(`decision API responded with HTTP ${response.status}`);
    }
    return response.json() as Promise<DecisionResponse>;
  }
}
