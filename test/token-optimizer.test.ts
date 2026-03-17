import { describe, it, expect } from "vitest";
import {
  formatContextRecommendation,
  formatModelRouting,
  formatBudgetStatus,
  buildOptimizationHints,
  isTokenOptimizerAvailable,
} from "../src/token-optimizer-runner.js";
import type {
  ContextRecommendation,
  ModelRouting,
  BudgetStatus,
} from "../src/token-optimizer-runner.js";

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
    it("should build hints with all optimizations", () => {
      const context: ContextRecommendation = {
        complexity: "simple",
        context_level: "minimal",
        reasoning: "Greeting",
        recommended_files: ["SOUL.md", "IDENTITY.md"],
        file_count: 2,
        savings_percent: 80,
        skip_patterns: ["docs/**/*.md"],
      };
      const routing: ModelRouting = {
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
      const budget: BudgetStatus = {
        date: "2026-03-17",
        cost: 4.50,
        tokens: 90000,
        limit: 5.00,
        percent_used: 90,
        status: "warning",
        alert: "Approaching daily limit",
      };

      const hints = buildOptimizationHints(context, routing, budget);
      expect(hints).toContain("[Token Optimizer] Context:");
      expect(hints).toContain("[Token Optimizer] Model:");
      expect(hints).toContain("[Token Optimizer] Budget:");
      expect(hints).toContain("SOUL.md");
      expect(hints).toContain("haiku");
    });

    it("should return empty string when no optimizations needed", () => {
      const context: ContextRecommendation = {
        complexity: "complex",
        context_level: "full",
        reasoning: "Complex task",
        recommended_files: ["SOUL.md", "IDENTITY.md", "MEMORY.md"],
        file_count: 3,
        savings_percent: 30,
        skip_patterns: [],
      };
      const routing: ModelRouting = {
        provider: "anthropic",
        current_model: "anthropic/claude-sonnet-4-5",
        recommended_model: "anthropic/claude-sonnet-4-5",
        tier: "balanced",
        tier_display: "Balanced",
        confidence: 0.5,
        reasoning: "Default",
        cost_savings_percent: 0,
        should_switch: false,
        all_providers: {},
      };
      const budget: BudgetStatus = {
        date: "2026-03-17",
        cost: 1.00,
        tokens: 20000,
        limit: 5.00,
        percent_used: 20,
        status: "ok",
      };

      const hints = buildOptimizationHints(context, routing, budget);
      expect(hints).toBe("");
    });

    it("should handle null inputs gracefully", () => {
      const hints = buildOptimizationHints(null, null, null);
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
