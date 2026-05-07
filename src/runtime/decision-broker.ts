import { createHash } from "crypto";

import type { DecisionRequest, DecisionResponse } from "../../shared/src/decision.js";
import type { DecisionContext } from "./decision-context.js";
import { decisionRequestFromContext } from "./decision-context.js";
import { evaluateLocalL4FastPath } from "../local-guard/local-l4-fast-path.js";

export interface DecisionClientLike {
  decideInput(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>;
  decideTool(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>;
  decideOutput(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>;
  decideInstall(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>;
}

export class DecisionBroker {
  private readonly cache = new Map<string, DecisionResponse>();
  private readonly pending = new Map<string, Promise<DecisionResponse>>();

  constructor(private readonly client: DecisionClientLike) {}

  prefetchInputDecision(context: DecisionContext): void {
    void this.resolveDecision(context, "input", 0, false);
  }

  waitInputDecision(context: DecisionContext, timeoutMs: number): Promise<DecisionResponse> {
    return this.resolveDecision({ ...context, stage: "input" }, "input", timeoutMs, true);
  }

  waitToolDecision(context: DecisionContext, timeoutMs: number): Promise<DecisionResponse> {
    return this.resolveDecision({ ...context, stage: "tool_call" }, "tool", timeoutMs, true);
  }

  prefetchOutputDecision(context: DecisionContext): void {
    void this.resolveDecision(context, "output", 0, false);
  }

  waitOutboundDecision(context: DecisionContext, timeoutMs: number): Promise<DecisionResponse> {
    return this.resolveDecision({ ...context, stage: "outbound_message" }, "output", timeoutMs, true);
  }

  waitInstallDecision(context: DecisionContext, timeoutMs: number): Promise<DecisionResponse> {
    return this.resolveDecision({ ...context, stage: "install" }, "install", timeoutMs, true);
  }

  getCachedDecision(key: string): DecisionResponse | undefined {
    return this.cache.get(key);
  }

  recordLocalL4Decision(context: DecisionContext, decision: DecisionResponse): void {
    this.cache.set(this.cacheKey(context), decision);
  }

  cacheKey(context: DecisionContext): string {
    const hash = createHash("sha256")
      .update(JSON.stringify({
        stage: context.stage,
        sessionKey: context.sessionKey ?? "",
        content: normalizeForKey(context.content),
        toolName: normalizeForKey(context.toolName),
        targetUri: normalizeForKey(context.targetUri),
      }))
      .digest("hex")
      .slice(0, 24);
    return `${context.stage}:${context.sessionKey ?? "none"}:${hash}`;
  }

  private async resolveDecision(
    context: DecisionContext,
    endpoint: "input" | "tool" | "output" | "install",
    timeoutMs: number,
    wait: boolean,
  ): Promise<DecisionResponse> {
    const key = this.cacheKey(context);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.callClient(context, endpoint).then((decision) => {
        this.cache.set(key, decision);
        return decision;
      }).finally(() => {
        this.pending.delete(key);
      });
      this.pending.set(key, pending);
    }

    if (!wait) {
      return pending.catch(() => this.degradedDecision(context, false));
    }
    if (timeoutMs <= 0) {
      return pending;
    }
    return Promise.race([
      pending,
      timeoutPromise(timeoutMs).then(() => this.degradedDecision(context, true)),
    ]);
  }

  private async callClient(
    context: DecisionContext,
    endpoint: "input" | "tool" | "output" | "install",
  ): Promise<DecisionResponse> {
    const request = decisionRequestFromContext(context);
    try {
      switch (endpoint) {
        case "tool":
          return await this.client.decideTool(request);
        case "output":
          return await this.client.decideOutput(request);
        case "install":
          return await this.client.decideInstall(request);
        case "input":
        default:
          return await this.client.decideInput(request);
      }
    } catch (error) {
      if (isAbortLike(error)) {
        return this.degradedDecision(context, true);
      }
      return this.degradedDecision(context, false, error instanceof Error ? error.message : String(error));
    }
  }

  private degradedDecision(context: DecisionContext, backendTimeout: boolean, reason?: string): DecisionResponse {
    const local = evaluateLocalL4FastPath({ ...context, backendAvailable: false });
    if (local.matched && local.decision) {
      this.recordLocalL4Decision(context, local.decision);
      return local.decision;
    }

    const dangerousTool = context.stage === "tool_call" && containsAny(
      `${context.toolName ?? ""} ${context.targetUri ?? ""} ${context.content ?? ""}`.toLowerCase(),
      "shell",
      "exec",
      "powershell",
      "bash",
      "rm -rf",
      "delete",
      "删除",
    );
    const action = dangerousTool ? "require_approval" : "warn";
    const riskLevel = dangerousTool ? "L3" : "L2";
    return {
      decisionId: `degraded-${Date.now()}`,
      stage: context.stage,
      block: false,
      action,
      riskLevel,
      score: dangerousTool ? 70 : 40,
      winningArbiter: "fallback",
      arbiters: [],
      matchedModules: ["backend_degraded"],
      requiresApproval: dangerousTool,
      audit: {
        eventSeverity: "warn",
        policyDecision: action,
        enforcementAction: action,
        color: dangerousTool ? "orange" : "yellow",
      },
      degraded: {
        backendTimeout,
        reason: reason ?? (backendTimeout ? "decision backend timed out" : "decision backend unavailable"),
      },
    };
  }
}

function normalizeForKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function containsAny(value: string, ...needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

function timeoutPromise(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
