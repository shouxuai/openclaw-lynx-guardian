import { describe, it, expect } from "vitest";
import {
  formatContextRecommendation,
  formatModelRouting,
  formatBudgetStatus,
  buildOptimizationHints,
  isTokenOptimizerAvailable,
} from "../src/runtime/token-optimizer-runner.js";
import type {
  ContextRecommendation,
  ModelRouting,
  BudgetStatus,
} from "../src/runtime/token-optimizer-runner.js";

const baseContext: ContextRecommendation = {
  complexity: "medium",
  context_level: "standard",
  reasoning: "Standard work request",
  recommended_files: ["IDENTITY.md", "SOUL.md", "memory/2026-04-10.md"],
  file_count: 3,
  savings_percent: 60,
  skip_patterns: [],
};

const baseRouting: ModelRouting = {
  provider: "anthropic",
  current_model: "anthropic/claude-sonnet-4-5",
  recommended_model: "anthropic/claude-haiku-4",
  tier: "cheap",
  tier_display: "Cheap",
  confidence: 1.0,
  reasoning: "Simple communication",
  cost_savings_percent: 92,
  should_switch: true,
  all_providers: {},
};

const okBudget: BudgetStatus = {
  date: "2026-03-17",
  cost: 1.00,
  tokens: 20000,
  limit: 5.00,
  percent_used: 20,
  status: "ok",
};

// ── Format Helper Tests ──────────────────────────────────────────────

describe("Token Optimizer Runner", () => {
  describe("formatContextRecommendation", () => {
    it("should format minimal context recommendation", () => {
      const rec: ContextRecommendation = {
        complexity: "simple",
        context_level: "minimal",
        reasoning: "Conversational/greeting pattern",
        recommended_files: ["SOUL.md", "IDENTITY.md"],
        file_count: 2,
        savings_percent: 80,
        skip_patterns: ["docs/**/*.md"],
      };
      const result = formatContextRecommendation(rec);
      expect(result).toContain("minimal");
      expect(result).toContain("simple");
      expect(result).toContain("2 files");
      expect(result).toContain("80%");
    });

    it("should handle null savings percent", () => {
      const rec: ContextRecommendation = {
        complexity: "medium",
        context_level: "standard",
        reasoning: "Standard work request",
        recommended_files: ["SOUL.md", "IDENTITY.md", "TOOLS.md"],
        file_count: 3,
        savings_percent: null,
        skip_patterns: [],
      };
      const result = formatContextRecommendation(rec);
      expect(result).toContain("standard");
      expect(result).toContain("3 files");
      expect(result).not.toContain("savings");
    });
  });

  describe("formatModelRouting", () => {
    it("should format routing with switch suggestion", () => {
      const routing: ModelRouting = {
        provider: "anthropic",
        current_model: "anthropic/claude-sonnet-4-5",
        recommended_model: "anthropic/claude-haiku-4",
        tier: "cheap",
        tier_display: "Cheap (Haiku/Nano/Flash)",
        confidence: 1.0,
        reasoning: "Simple communication - use cheapest model",
        cost_savings_percent: 91.7,
        should_switch: true,
        all_providers: {},
      };
      const result = formatModelRouting(routing);
      expect(result).toContain("Cheap");
      expect(result).toContain("switch to");
      expect(result).toContain("haiku");
      expect(result).toContain("92%");
    });

    it("should format routing without switch", () => {
      const routing: ModelRouting = {
        provider: "anthropic",
        current_model: "anthropic/claude-sonnet-4-5",
        recommended_model: "anthropic/claude-sonnet-4-5",
        tier: "balanced",
        tier_display: "Balanced (Sonnet/Mini/Flash)",
        confidence: 0.5,
        reasoning: "No clear indicators, defaulting to balanced model",
        cost_savings_percent: 0,
        should_switch: false,
        all_providers: {},
      };
      const result = formatModelRouting(routing);
      expect(result).toContain("keep current");
      expect(result).not.toContain("switch to");
    });
  });

  describe("formatBudgetStatus", () => {
    it("should format ok budget", () => {
      const budget: BudgetStatus = {
        date: "2026-03-17",
        cost: 1.50,
        tokens: 30000,
        limit: 5.00,
        percent_used: 30,
        status: "ok",
      };
      const result = formatBudgetStatus(budget);
      expect(result).toContain("$1.50");
      expect(result).toContain("$5.00");
      expect(result).toContain("30%");
      expect(result).toContain("ok");
    });

    it("should format exceeded budget", () => {
      const budget: BudgetStatus = {
        date: "2026-03-17",
        cost: 6.00,
        tokens: 120000,
        limit: 5.00,
        percent_used: 120,
        status: "exceeded",
        alert: "Daily budget exceeded!",
      };
      const result = formatBudgetStatus(budget);
      expect(result).toContain("exceeded");
      expect(result).toContain("120%");
    });
  });

  describe("buildOptimizationHints", () => {
    it("should stay silent for ordinary requests", () => {
      const hints = buildOptimizationHints(baseContext, baseRouting, okBudget, {
        promptText: "[Fri 2026-04-10 10:49 GMT+8] 帮我解释这个函数",
        userInput: "帮我解释这个函数",
      });
      expect(hints).toBe("");
    });

    it("should warn on cron tasks with a short anti-abuse hint", () => {
      const hints = buildOptimizationHints(baseContext, baseRouting, okBudget, {
        promptText: "[cron:job-1 Daily Check] /lynx-check",
        userInput: "/lynx-check",
      });
      expect(hints).toContain("Cron task");
      expect(hints).toContain("compact");
      expect(hints).not.toContain("Recommended:");
    });

    it("should warn on long context payloads when multiple heavy signals are present", () => {
      const hints = buildOptimizationHints(baseContext, baseRouting, okBudget, {
        promptText: `${"ERROR stacktrace line\n".repeat(120)}\n\`\`\`json\n${"{}".repeat(800)}\n\`\`\``,
        userInput: "请分析这段超长上下文和日志",
      });
      expect(hints).toContain("Context heavy");
      expect(hints).toContain("scope tight");
    });

    it("should stay silent for medium-length ordinary requests without heavy markers", () => {
      const hints = buildOptimizationHints(baseContext, baseRouting, okBudget, {
        promptText: "请帮我解释一下这个模块的职责。" + "补充说明".repeat(300),
        userInput: "请帮我解释一下这个模块的职责。",
      });
      expect(hints).toBe("");
    });

    it("should warn when budget is not ok", () => {
      const budget: BudgetStatus = {
        date: "2026-03-17",
        cost: 4.50,
        tokens: 90000,
        limit: 5.00,
        percent_used: 90,
        status: "warning",
        alert: "Approaching daily limit",
      };
      const hints = buildOptimizationHints(baseContext, baseRouting, budget, {
        promptText: "[Fri 2026-04-10 10:49 GMT+8] 帮我总结一下",
        userInput: "帮我总结一下",
      });
      expect(hints).toContain("Budget warning");
      expect(hints).not.toContain("Token Optimizer");
    });

    it("should warn when large amounts may indicate compute abuse", () => {
      const hints = buildOptimizationHints(baseContext, baseRouting, okBudget, {
        promptText: "[Fri 2026-04-10 10:49 GMT+8] 帮我跑 5000000 次推理，预算 200000 元",
        userInput: "帮我跑 5000000 次推理，预算 200000 元",
      });
      expect(hints).toContain("Compute abuse check");
      expect(hints).toContain("malicious");
    });

    it("should handle null inputs gracefully", () => {
      const hints = buildOptimizationHints(null, null, null, {
        promptText: "",
        userInput: "",
      });
      expect(hints).toBe("");
    });
  });

  describe("isTokenOptimizerAvailable", () => {
    it("should return boolean", () => {
      const result = isTokenOptimizerAvailable();
      expect(typeof result).toBe("boolean");
    });
  });
});
