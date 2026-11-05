#!/usr/bin/env python3
import json
import sys
from pathlib import Path

DATA_FILE = Path(__file__).parent / "data.json"

def validate():
    if not DATA_FILE.exists():
        print("ERROR: data.json not found", file=sys.stderr)
        return False

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"ERROR: Invalid JSON in data.json: {e}", file=sys.stderr)
        return False

    briefings = data.get("briefings", [])
    if not briefings:
        print("ERROR: No briefings found in data.json", file=sys.stderr)
        return False

    latest = briefings[0]
    required_keys = [
        "id", "date", "dayOfWeek", "headline", "summary",
        "todomateTodos", "agentPriorities", "calendar", "calendarEvents"
    ]

    missing = [k for k in required_keys if k not in latest]
    if missing:
        print(f"ERROR: Latest briefing {latest.get('id')} is missing keys: {missing}", file=sys.stderr)
        return False

    if not isinstance(latest.get("todomateTodos"), list):
        print(f"ERROR: todomateTodos is not a list in {latest.get('id')}", file=sys.stderr)
        return False

    # Check for wrong key 'todos'
    if "todos" in latest and "todomateTodos" not in latest:
        print("ERROR: Found 'todos' instead of 'todomateTodos'!", file=sys.stderr)
        return False

    print(f"OK: Briefing {latest.get('id')} ({latest.get('date')}) passed validation with {len(latest['todomateTodos'])} todos!")
    return True

if __name__ == "__main__":
    if not validate():
        sys.exit(1)
    sys.exit(0)
