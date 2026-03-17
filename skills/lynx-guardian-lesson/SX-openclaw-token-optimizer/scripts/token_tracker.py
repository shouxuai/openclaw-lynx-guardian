#!/usr/bin/env python3
"""
Token usage tracker with budget alerts.
Monitors API usage and warns when approaching limits.
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

STATE_FILE = Path.home() / ".openclaw/workspace/memory/token-tracker-state.json"

def load_state():
    """Load tracking state from file."""
    if STATE_FILE.exists():
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {
        "daily_usage": {},
        "alerts_sent": [],
        "last_reset": datetime.now().isoformat()
    }

def save_state(state):
    """Save tracking state to file."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def get_usage_from_session_status():
    """Parse session status to extract token usage.
    Returns dict with input_tokens, output_tokens, and cost.
    """
    # This would integrate with OpenClaw's session_status tool
    # For now, returns placeholder structure
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_cost": 0.0,
        "model": "anthropic/claude-sonnet-4-5"
    }

def check_budget(daily_limit_usd=5.0, warn_threshold=0.8):
    """Check if usage is approaching daily budget.
    
    Args:
        daily_limit_usd: Daily spending limit in USD
        warn_threshold: Fraction of limit to trigger warning (default 80%)
    
    Returns:
        dict with status, usage, limit, and alert message if applicable
    """
    state = load_state()
    today = datetime.now().date().isoformat()
    
    # Reset if new day
    if today not in state["daily_usage"]:
        state["daily_usage"] = {today: {"cost": 0.0, "tokens": 0}}
        state["alerts_sent"] = []
    
    usage = state["daily_usage"][today]
    percent_used = (usage["cost"] / daily_limit_usd) * 100
    
    result = {
        "date": today,
        "cost": usage["cost"],
        "tokens": usage["tokens"],
        "limit": daily_limit_usd,
        "percent_used": percent_used,
        "status": "ok"
    }
    
    # Check thresholds
    if percent_used >= 100:
        result["status"] = "exceeded"
        result["alert"] = f"⚠️ Daily budget exceeded! ${usage['cost']:.2f} / ${daily_limit_usd:.2f}"
    elif percent_used >= (warn_threshold * 100):
        result["status"] = "warning"
        result["alert"] = f"⚠️ Approaching daily limit: ${usage['cost']:.2f} / ${daily_limit_usd:.2f} ({percent_used:.0f}%)"
    
    return result

def suggest_cheaper_model(current_model, task_type="general"):
    """Suggest cheaper alternative models based on task type.
    
    Args:
        current_model: Currently configured model
        task_type: Type of task (general, simple, complex)
    
    Returns:
        dict with suggestion and cost savings
    """
    # Cost per 1M tokens (input/output average)
    model_costs = {
        "anthropic/claude-opus-4": 15.0,
        "anthropic/claude-sonnet-4-5": 3.0,
        "anthropic/claude-haiku-4": 0.25,
        "google/gemini-2.0-flash-exp": 0.075,
        "openai/gpt-4o": 2.5,
        "openai/gpt-4o-mini": 0.15
    }
    
    suggestions = {
        "simple": [
            ("anthropic/claude-haiku-4", "12x cheaper, great for file reads, routine checks"),
            ("google/gemini-2.0-flash-exp", "40x cheaper via OpenRouter, good for simple tasks")
        ],
        "general": [
            ("anthropic/claude-sonnet-4-5", "Balanced performance and cost"),
            ("google/gemini-2.0-flash-exp", "Much cheaper, decent quality")
        ],
        "complex": [
            ("anthropic/claude-opus-4", "Best reasoning, use sparingly"),
            ("anthropic/claude-sonnet-4-5", "Good balance for most complex tasks")
        ]
    }
    
    return {
        "current": current_model,
        "current_cost": model_costs.get(current_model, "unknown"),
        "suggestions": suggestions.get(task_type, suggestions["general"])
    }

def main():
    """CLI interface for token tracker."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: token_tracker.py [check|suggest|reset]")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "check":
        result = check_budget()
        print(json.dumps(result, indent=2))
    
    elif command == "suggest":
        task = sys.argv[2] if len(sys.argv) > 2 else "general"
        current = sys.argv[3] if len(sys.argv) > 3 else "anthropic/claude-sonnet-4-5"
        result = suggest_cheaper_model(current, task)
        print(json.dumps(result, indent=2))
    
    elif command == "reset":
        state = load_state()
        state["daily_usage"] = {}
        state["alerts_sent"] = []
        save_state(state)
        print("Token tracker state reset.")
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == "__main__":
    main()
