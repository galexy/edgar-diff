#!/usr/bin/env python3
"""Claude Code status line showing context window and 5h usage gauges.

Reads JSON session data from stdin (provided by Claude Code).
"""

import json
import sys

BAR_WIDTH = 10
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"


def bar(pct: int) -> str:
    filled = min(pct * BAR_WIDTH // 100, BAR_WIDTH)
    return "▓" * filled + "░" * (BAR_WIDTH - filled)


def colorize(pct: int, text: str) -> str:
    if pct >= 80:
        return f"{RED}{text}{RESET}"
    if pct >= 50:
        return f"{YELLOW}{text}{RESET}"
    return f"{GREEN}{text}{RESET}"


def format_duration(ms: int) -> str:
    minutes = ms // 60000
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h{mins:02d}m"


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        print("no data", end="")
        return

    ctx = data.get("context_window", {})
    cost = data.get("cost", {})

    # Context window gauge
    ctx_pct = int(ctx.get("used_percentage") or 0)
    ctx_bar = bar(ctx_pct)
    ctx_gauge = colorize(ctx_pct, f"{ctx_bar} {ctx_pct}%")

    # Session cost and duration
    total_cost = cost.get("total_cost_usd", 0)
    duration_ms = cost.get("total_duration_ms", 0)
    duration = format_duration(duration_ms)

    model = data.get("model", {}).get("display_name", "?")
    agent = data.get("agent", {}).get("name", "")
    session_id = data.get("session_id", "")[:8]

    if agent:
        role = f"🤖{agent}"
    elif data.get("worktree"):
        role = "👑lead"
    else:
        role = "👤main"

    prefix = f"{role} {DIM}{session_id}{RESET} | "

    parts = [
        f"{prefix}{model} {ctx_gauge}",
        f"💰{DIM}${total_cost:.2f}{RESET}",
        f"⏱{DIM}{duration}{RESET}",
    ]

    worktree = data.get("worktree")
    if worktree:
        name = worktree.get("name", "")
        if name:
            parts.append(f"🌳{YELLOW}{name}{RESET}")

    added = cost.get("total_lines_added", 0)
    removed = cost.get("total_lines_removed", 0)
    parts.append(f"{GREEN}+{added}{RESET}/{RED}-{removed}{RESET}")

    print(" | ".join(parts), end="")


if __name__ == "__main__":
    main()
