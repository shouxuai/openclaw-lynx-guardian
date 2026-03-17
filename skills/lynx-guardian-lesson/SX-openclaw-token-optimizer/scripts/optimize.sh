#!/bin/bash
# optimize.sh - Quick CLI wrapper for token optimization tools
#
# Usage:
#   ./optimize.sh route "your prompt here"    # Route to appropriate model
#   ./optimize.sh context                      # Generate optimized AGENTS.md
#   ./optimize.sh recommend "prompt"           # Recommend context files
#   ./optimize.sh budget                       # Check token budget
#   ./optimize.sh heartbeat                    # Install optimized heartbeat
#
# Examples:
#   ./optimize.sh route "thanks!"              # → cheap tier (Haiku)
#   ./optimize.sh route "design an API"        # → smart tier (Opus)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$1" in
    route|model)
        shift
        python3 "$SCRIPT_DIR/model_router.py" "$@"
        ;;
    context|agents)
        python3 "$SCRIPT_DIR/context_optimizer.py" generate-agents
        ;;
    recommend|ctx)
        shift
        python3 "$SCRIPT_DIR/context_optimizer.py" recommend "$@"
        ;;
    budget|tokens|check)
        python3 "$SCRIPT_DIR/token_tracker.py" check
        ;;
    heartbeat|hb)
        DEST="${HOME}/.openclaw/workspace/HEARTBEAT.md"
        cp "$SCRIPT_DIR/../assets/HEARTBEAT.template.md" "$DEST"
        echo "✅ Installed optimized heartbeat to: $DEST"
        ;;
    providers)
        python3 "$SCRIPT_DIR/model_router.py" providers
        ;;
    detect)
        python3 "$SCRIPT_DIR/model_router.py" detect
        ;;
    help|--help|-h|"")
        echo "Token Optimizer CLI"
        echo ""
        echo "Usage: ./optimize.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  route <prompt>      Route prompt to appropriate model tier"
        echo "  context             Generate optimized AGENTS.md"
        echo "  recommend <prompt>  Recommend context files for prompt"
        echo "  budget              Check current token budget"
        echo "  heartbeat           Install optimized heartbeat"
        echo "  providers           List available providers"
        echo "  detect              Show auto-detected provider"
        echo ""
        echo "Examples:"
        echo "  ./optimize.sh route 'thanks!'           # → cheap tier"
        echo "  ./optimize.sh route 'design an API'     # → smart tier"
        echo "  ./optimize.sh budget                    # → current usage"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Run './optimize.sh help' for usage"
        exit 1
        ;;
esac
