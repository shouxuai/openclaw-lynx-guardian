#!/usr/bin/env python3
"""
Smart model router - routes tasks to appropriate models based on complexity.
Supports multiple providers: Anthropic, OpenAI, Google, OpenRouter.
Helps reduce token costs by using cheaper models for simpler tasks.

Version: 1.1.0
"""
import re
import os
import json

# ============================================================================
# PROVIDER CONFIGURATION
# ============================================================================

# Detect primary provider from environment (default: anthropic)
def detect_provider():
    """Detect which provider to use based on available API keys."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    elif os.environ.get("OPENAI_API_KEY"):
        return "openai"
    elif os.environ.get("GOOGLE_API_KEY"):
        return "google"
    elif os.environ.get("OPENROUTER_API_KEY"):
        return "openrouter"
    # Default to anthropic
    return "anthropic"

# Model tiers per provider
PROVIDER_MODELS = {
    "anthropic": {
        "cheap": "anthropic/claude-haiku-4",
        "balanced": "anthropic/claude-sonnet-4-5",
        "smart": "anthropic/claude-opus-4",
        "costs": {  # $/MTok (input)
            "cheap": 0.25,
            "balanced": 3.00,
            "smart": 15.00
        }
    },
    "openai": {
        "cheap": "openai/gpt-4.1-nano",
        "balanced": "openai/gpt-4.1-mini",
        "smart": "openai/gpt-4.1",
        "premium": "openai/gpt-5",
        "costs": {
            "cheap": 0.10,
            "balanced": 0.40,
            "smart": 2.00,
            "premium": 10.00
        }
    },
    "google": {
        "cheap": "google/gemini-2.0-flash",
        "balanced": "google/gemini-2.5-flash",
        "smart": "google/gemini-2.5-pro",
        "costs": {
            "cheap": 0.075,
            "balanced": 0.15,
            "smart": 1.25
        }
    },
    "openrouter": {
        "cheap": "google/gemini-2.0-flash",
        "balanced": "anthropic/claude-sonnet-4-5",
        "smart": "anthropic/claude-opus-4",
        "costs": {
            "cheap": 0.075,
            "balanced": 3.00,
            "smart": 15.00
        }
    }
}

# Tier mapping for cross-provider compatibility
TIER_ALIASES = {
    "haiku": "cheap",
    "sonnet": "balanced",
    "opus": "smart",
    "nano": "cheap",
    "mini": "balanced",
    "flash": "cheap",
    "pro": "smart"
}

# ============================================================================
# TASK CLASSIFICATION PATTERNS
# ============================================================================

# Communication patterns that should ALWAYS use cheap tier (never balanced/smart)
COMMUNICATION_PATTERNS = [
    r'^(hi|hey|hello|yo|sup)\b',
    r'^(thanks|thank you|thx)\b',
    r'^(ok|okay|sure|got it|understood)\b',
    r'^(yes|yeah|yep|yup|no|nope)\b',
    r'^(good|great|nice|cool|awesome)\b',
    r"^(what|how)'s (up|it going)",
    r'^\w{1,15}$',  # Single short word
    r'^(lol|haha|lmao)\b',
]

# Background/routine tasks that should ALWAYS use cheap tier
BACKGROUND_TASK_PATTERNS = [
    # Heartbeat checks
    r'heartbeat',
    r'check\s+(email|calendar|weather|monitoring)',
    r'monitor\s+',
    r'poll\s+',
    
    # Cronjob/scheduled tasks
    r'cron',
    r'scheduled\s+task',
    r'periodic\s+check',
    r'reminder',
    
    # Document parsing/extraction
    r'parse\s+(document|file|log|csv|json|xml)',
    r'extract\s+(text|data|content)\s+from',
    r'read\s+(log|logs)',
    r'scan\s+(file|document)',
    r'process\s+(csv|json|xml|yaml)',
]

# Model routing rules with tier-based approach
ROUTING_RULES = {
    "cheap": {
        "patterns": [
            r"read\s+file",
            r"list\s+files",
            r"show\s+(me\s+)?the\s+contents?",
            r"what's\s+in",
            r"cat\s+",
            r"get\s+status",
            r"check\s+(if|whether)",
            r"is\s+\w+\s+(running|active|enabled)"
        ],
        "keywords": ["read", "list", "show", "status", "check", "get"],
        "cost_multiplier": 0.083  # vs balanced
    },
    "balanced": {
        "patterns": [
            r"write\s+\w+",
            r"create\s+\w+",
            r"edit\s+\w+",
            r"fix\s+\w+",
            r"debug\s+\w+",
            r"explain\s+\w+",
            r"how\s+(do|can)\s+i"
        ],
        "keywords": ["write", "create", "edit", "update", "fix", "debug", "explain"],
        "cost_multiplier": 1.0
    },
    "smart": {
        "patterns": [
            r"complex\s+\w+",
            r"design\s+\w+",
            r"architect\w+",
            r"analyze\s+deeply",
            r"comprehensive\s+\w+"
        ],
        "keywords": ["design", "architect", "complex", "comprehensive", "deep"],
        "cost_multiplier": 5.0
    }
}

# Legacy tier names for backwards compatibility
LEGACY_TIER_MAP = {
    "haiku": "cheap",
    "sonnet": "balanced",
    "opus": "smart"
}

# ============================================================================
# CORE FUNCTIONS
# ============================================================================

def classify_task(prompt):
    """Classify task complexity based on prompt text.
    
    Args:
        prompt: User's message/request
    
    Returns:
        tuple of (tier, confidence, reasoning)
        tier is one of: cheap, balanced, smart
    """
    prompt_lower = prompt.lower()
    
    # FIRST: Check if this is simple communication (ALWAYS cheap)
    for pattern in COMMUNICATION_PATTERNS:
        if re.search(pattern, prompt_lower):
            return ("cheap", 1.0, "Simple communication - use cheapest model")
    
    # SECOND: Check if this is a background/routine task (ALWAYS cheap)
    for pattern in BACKGROUND_TASK_PATTERNS:
        if re.search(pattern, prompt_lower):
            return ("cheap", 1.0, "Background task (heartbeat/cron/parsing) - use cheapest model")
    
    # Score each tier
    scores = {}
    for tier, rules in ROUTING_RULES.items():
        score = 0
        matches = []
        
        # Pattern matching
        for pattern in rules["patterns"]:
            if re.search(pattern, prompt_lower):
                score += 2
                matches.append(f"pattern:{pattern}")
        
        # Keyword matching
        for keyword in rules["keywords"]:
            if keyword in prompt_lower:
                score += 1
                matches.append(f"keyword:{keyword}")
        
        scores[tier] = {
            "score": score,
            "matches": matches
        }
    
    # Determine best tier
    best_tier = max(scores.items(), key=lambda x: x[1]["score"])
    
    if best_tier[1]["score"] == 0:
        # Default to balanced if unclear
        return ("balanced", 0.5, "No clear indicators, defaulting to balanced model")
    
    confidence = min(best_tier[1]["score"] / 5.0, 1.0)  # Cap at 1.0
    reasoning = f"Matched: {', '.join(best_tier[1]['matches'][:3])}"
    
    return (best_tier[0], confidence, reasoning)

def normalize_tier(tier):
    """Normalize tier name to standard format (cheap/balanced/smart)."""
    tier_lower = tier.lower()
    
    # Check legacy mappings
    if tier_lower in LEGACY_TIER_MAP:
        return LEGACY_TIER_MAP[tier_lower]
    
    # Check aliases
    if tier_lower in TIER_ALIASES:
        return TIER_ALIASES[tier_lower]
    
    # Already standard or unknown
    if tier_lower in ["cheap", "balanced", "smart", "premium"]:
        return tier_lower
    
    return "balanced"  # Default

def get_model_for_tier(tier, provider=None):
    """Get the specific model name for a tier and provider.
    
    Args:
        tier: cheap, balanced, smart, or premium
        provider: anthropic, openai, google, openrouter (or None to auto-detect)
    
    Returns:
        Model identifier string
    """
    if provider is None:
        provider = detect_provider()
    
    provider_config = PROVIDER_MODELS.get(provider, PROVIDER_MODELS["anthropic"])
    
    # Normalize tier
    tier = normalize_tier(tier)
    
    # Get model (fallback to balanced if tier not available)
    return provider_config.get(tier, provider_config.get("balanced"))

def route_task(prompt, current_model=None, force_tier=None, provider=None):
    """Route a task to appropriate model.
    
    Args:
        prompt: User's message/request
        current_model: Current model being used (optional)
        force_tier: Override classification (cheap/balanced/smart or haiku/sonnet/opus)
        provider: Force specific provider (anthropic/openai/google/openrouter)
    
    Returns:
        dict with routing decision
    """
    # Auto-detect provider if not specified
    if provider is None:
        provider = detect_provider()
    
    # Set default current model
    if current_model is None:
        current_model = get_model_for_tier("balanced", provider)
    
    if force_tier:
        tier = normalize_tier(force_tier)
        confidence = 1.0
        reasoning = "User-specified tier"
    else:
        tier, confidence, reasoning = classify_task(prompt)
    
    recommended_model = get_model_for_tier(tier, provider)
    
    # Calculate cost savings
    provider_config = PROVIDER_MODELS.get(provider, PROVIDER_MODELS["anthropic"])
    base_cost = provider_config["costs"].get("balanced", 1.0)
    tier_cost = provider_config["costs"].get(tier, base_cost)
    cost_savings = (1.0 - (tier_cost / base_cost)) * 100
    
    return {
        "provider": provider,
        "current_model": current_model,
        "recommended_model": recommended_model,
        "tier": tier,
        "tier_display": {
            "cheap": "Cheap (Haiku/Nano/Flash)",
            "balanced": "Balanced (Sonnet/Mini/Flash)",
            "smart": "Smart (Opus/GPT-4.1/Pro)",
            "premium": "Premium (GPT-5)"
        }.get(tier, tier),
        "confidence": confidence,
        "reasoning": reasoning,
        "cost_savings_percent": max(0, cost_savings),
        "should_switch": recommended_model != current_model,
        "all_providers": {
            p: get_model_for_tier(tier, p) for p in PROVIDER_MODELS.keys()
        }
    }

def get_model_comparison():
    """Get a comparison of all models across providers.
    
    Returns:
        dict with provider -> tier -> model mapping
    """
    result = {}
    for provider, config in PROVIDER_MODELS.items():
        result[provider] = {
            tier: {
                "model": model,
                "cost_per_mtok": config["costs"].get(tier, "N/A")
            }
            for tier, model in config.items()
            if tier != "costs"
        }
    return result

# ============================================================================
# CLI INTERFACE
# ============================================================================

def main():
    """CLI interface for model router."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: model_router.py <command> [args]")
        print("")
        print("Commands:")
        print("  route '<prompt>' [current_model] [force_tier] [provider]")
        print("  compare                 — Show all models across providers")
        print("  providers               — List available providers")
        print("  detect                  — Show auto-detected provider")
        print("")
        print("Examples:")
        print("  model_router.py route 'thanks!'")
        print("  model_router.py route 'design an architecture' --provider openai")
        print("  model_router.py compare")
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Known commands
    known_commands = ["route", "compare", "providers", "detect"]
    
    if command == "route" or command not in known_commands:
        # Route a prompt (either explicit "route" command or shorthand)
        if command == "route":
            if len(sys.argv) < 3:
                print("Usage: model_router.py route '<prompt>'")
                sys.exit(1)
            prompt = sys.argv[2]
            start_idx = 3
        else:
            # Shorthand: first arg is the prompt
            prompt = command
            start_idx = 2
        
        # Parse remaining args
        current_model = None
        force_tier = None
        provider = None
        
        i = start_idx
        while i < len(sys.argv):
            arg = sys.argv[i]
            if arg.startswith("--provider="):
                provider = arg.split("=")[1]
            elif arg.startswith("--tier="):
                force_tier = arg.split("=")[1]
            elif arg == "--provider" and i+1 < len(sys.argv):
                provider = sys.argv[i+1]
                i += 1
            elif arg == "--tier" and i+1 < len(sys.argv):
                force_tier = sys.argv[i+1]
                i += 1
            elif arg.startswith("--"):
                pass  # Skip unknown flags
            elif current_model is None and "/" in arg:
                current_model = arg
            elif force_tier is None:
                force_tier = arg
            i += 1
        
        result = route_task(prompt, current_model, force_tier, provider)
        print(json.dumps(result, indent=2))
    
    elif command == "compare":
        result = get_model_comparison()
        print(json.dumps(result, indent=2))
    
    elif command == "providers":
        print("Available providers:")
        for provider in PROVIDER_MODELS.keys():
            detected = " (detected)" if provider == detect_provider() else ""
            print(f"  - {provider}{detected}")
    
    elif command == "detect":
        provider = detect_provider()
        print(f"Auto-detected provider: {provider}")
        print(f"Models: {json.dumps(PROVIDER_MODELS[provider], indent=2)}")
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == "__main__":
    main()
