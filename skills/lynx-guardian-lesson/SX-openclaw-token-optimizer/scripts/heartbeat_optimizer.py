#!/usr/bin/env python3
"""
Heartbeat optimizer - Manages efficient heartbeat intervals and batched checks.
Reduces API calls by tracking check timestamps and batching operations.

v1.4.0: Added cache-ttl alignment — recommends 55min intervals to keep
Anthropic's 1h prompt cache warm between heartbeats (avoids cache re-write penalty).
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

STATE_FILE = Path.home() / ".openclaw/workspace/memory/heartbeat-state.json"

# Optimal interval to keep Anthropic's 1h prompt cache warm.
# Set just under 1h so the cache never expires between heartbeats.
# Anthropic API key users should use this as their default heartbeat interval.
CACHE_TTL_OPTIMAL_INTERVAL = 3300  # 55 minutes in seconds
CACHE_TTL_WINDOW = 3600            # Anthropic default cache TTL = 1 hour

DEFAULT_INTERVALS = {
    "email": 3600,      # 1 hour
    "calendar": 7200,   # 2 hours
    "weather": 14400,   # 4 hours
    "social": 7200,     # 2 hours
    "monitoring": 1800  # 30 minutes
}

QUIET_HOURS = {
    "start": 23,  # 11 PM
    "end": 8      # 8 AM
}

def load_state():
    """Load heartbeat tracking state."""
    if STATE_FILE.exists():
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    return {
        "lastChecks": {},
        "intervals": DEFAULT_INTERVALS.copy(),
        "skipCount": 0
    }

def save_state(state):
    """Save heartbeat tracking state."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def is_quiet_hours(hour=None):
    """Check if current time is during quiet hours."""
    if hour is None:
        hour = datetime.now().hour
    
    start = QUIET_HOURS["start"]
    end = QUIET_HOURS["end"]
    
    if start > end:  # Wraps midnight
        return hour >= start or hour < end
    else:
        return start <= hour < end

def should_check(check_type, force=False):
    """Determine if a check should run based on interval.
    
    Args:
        check_type: Type of check (email, calendar, etc.)
        force: Force check regardless of interval
    
    Returns:
        dict with decision and reasoning
    """
    if force:
        return {
            "should_check": True,
            "reason": "Forced check",
            "next_check": None
        }
    
    # Skip all checks during quiet hours
    if is_quiet_hours():
        return {
            "should_check": False,
            "reason": "Quiet hours (23:00-08:00)",
            "next_check": "08:00"
        }
    
    state = load_state()
    now = datetime.now()
    
    # Get last check time
    last_check_ts = state["lastChecks"].get(check_type)
    if not last_check_ts:
        # Never checked before
        return {
            "should_check": True,
            "reason": "First check",
            "next_check": None
        }
    
    last_check = datetime.fromisoformat(last_check_ts)
    interval = state["intervals"].get(check_type, DEFAULT_INTERVALS.get(check_type, 3600))
    next_check = last_check + timedelta(seconds=interval)
    
    if now >= next_check:
        return {
            "should_check": True,
            "reason": f"Interval elapsed ({interval}s)",
            "next_check": None
        }
    else:
        remaining = (next_check - now).total_seconds()
        return {
            "should_check": False,
            "reason": f"Too soon ({int(remaining / 60)}min remaining)",
            "next_check": next_check.strftime("%H:%M")
        }

def record_check(check_type):
    """Record that a check was performed."""
    state = load_state()
    state["lastChecks"][check_type] = datetime.now().isoformat()
    save_state(state)

def plan_heartbeat(checks=None):
    """Plan which checks should run in next heartbeat.
    
    Args:
        checks: List of check types to consider (default: all)
    
    Returns:
        dict with planned checks and skip decision
    """
    if checks is None:
        checks = list(DEFAULT_INTERVALS.keys())
    
    planned = []
    skipped = []
    
    for check in checks:
        decision = should_check(check)
        if decision["should_check"]:
            planned.append({
                "type": check,
                "reason": decision["reason"]
            })
        else:
            skipped.append({
                "type": check,
                "reason": decision["reason"],
                "next_check": decision["next_check"]
            })
    
    result = {
        "planned": planned,
        "skipped": skipped,
        "should_run": len(planned) > 0,
        "can_skip": len(planned) == 0
    }

    # Add cache TTL alignment recommendation
    result["cache_ttl_tip"] = (
        "Tip: Set your OpenClaw heartbeat interval to 55min (3300s) "
        "to keep the Anthropic 1h prompt cache warm. "
        "Run: heartbeat_optimizer.py cache-ttl for details."
    )

    return result

def get_cache_ttl_recommendation(cache_ttl_seconds=None):
    """Calculate optimal heartbeat interval for Anthropic cache TTL warmup.
    
    Anthropic prompt caching has a 1h TTL by default on API key profiles.
    Setting heartbeat interval just under the TTL prevents the cache from
    expiring between heartbeats — avoiding the cache re-write penalty.
    
    Args:
        cache_ttl_seconds: Your cache TTL in seconds (default: 3600 = 1h)
    
    Returns:
        dict with recommended interval and explanation
    """
    if cache_ttl_seconds is None:
        cache_ttl_seconds = CACHE_TTL_WINDOW
    
    # Use 92% of TTL as the safe warmup interval (5min buffer)
    buffer_seconds = 300  # 5 minute buffer
    recommended = cache_ttl_seconds - buffer_seconds
    
    return {
        "cache_ttl_seconds": cache_ttl_seconds,
        "cache_ttl_human": f"{cache_ttl_seconds // 60}min",
        "recommended_interval_seconds": recommended,
        "recommended_interval_human": f"{recommended // 60}min",
        "buffer_seconds": buffer_seconds,
        "explanation": (
            f"With a {cache_ttl_seconds // 60}min Anthropic cache TTL, set your heartbeat "
            f"to {recommended // 60}min ({recommended}s). This keeps the prompt cache warm "
            f"between heartbeats — preventing the cache re-write penalty when the TTL expires."
        ),
        "how_to_configure": (
            "In openclaw.json: agents.defaults.heartbeat.every = \"55m\"\n"
            "Or use the config patch from assets/config-patches.json (heartbeat_optimization)"
        ),
        "cost_impact": (
            "Cache writes cost ~3.75x more than cache reads (Anthropic pricing). "
            "Without warmup: every heartbeat after an idle hour triggers a full cache re-write. "
            "With warmup: cache reads only — significantly cheaper for long-running agents."
        ),
        "note": (
            "This applies to Anthropic API key users only. "
            "OAuth profiles use a 1h heartbeat by default (OpenClaw smart default). "
            "API key profiles default to 30min heartbeat — consider bumping to 55min."
        )
    }

def update_interval(check_type, new_interval_seconds):
    """Update check interval for a specific check type.
    
    Args:
        check_type: Type of check
        new_interval_seconds: New interval in seconds
    """
    state = load_state()
    state["intervals"][check_type] = new_interval_seconds
    save_state(state)
    return {
        "check_type": check_type,
        "old_interval": DEFAULT_INTERVALS.get(check_type),
        "new_interval": new_interval_seconds
    }

def main():
    """CLI interface for heartbeat optimizer."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: heartbeat_optimizer.py [plan|check|record|interval|cache-ttl|reset]")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "plan":
        # Plan next heartbeat
        checks = sys.argv[2:] if len(sys.argv) > 2 else None
        result = plan_heartbeat(checks)
        print(json.dumps(result, indent=2))
    
    elif command == "check":
        # Check if specific type should run
        if len(sys.argv) < 3:
            print("Usage: heartbeat_optimizer.py check <type>")
            sys.exit(1)
        check_type = sys.argv[2]
        force = len(sys.argv) > 3 and sys.argv[3] == "--force"
        result = should_check(check_type, force)
        print(json.dumps(result, indent=2))
    
    elif command == "record":
        # Record that a check was performed
        if len(sys.argv) < 3:
            print("Usage: heartbeat_optimizer.py record <type>")
            sys.exit(1)
        check_type = sys.argv[2]
        record_check(check_type)
        print(f"Recorded check: {check_type}")
    
    elif command == "interval":
        # Update interval
        if len(sys.argv) < 4:
            print("Usage: heartbeat_optimizer.py interval <type> <seconds>")
            sys.exit(1)
        check_type = sys.argv[2]
        interval = int(sys.argv[3])
        result = update_interval(check_type, interval)
        print(json.dumps(result, indent=2))
    
    elif command == "cache-ttl":
        # Show cache TTL alignment recommendation
        cache_ttl = int(sys.argv[2]) if len(sys.argv) > 2 else None
        result = get_cache_ttl_recommendation(cache_ttl)
        print(json.dumps(result, indent=2))
    
    elif command == "reset":
        # Reset state
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        print("Heartbeat state reset.")
    
    else:
        print(f"Unknown command: {command}")
        print("Available: plan | check <type> | record <type> | interval <type> <seconds> | cache-ttl [ttl_seconds] | reset")
        sys.exit(1)

if __name__ == "__main__":
    main()
