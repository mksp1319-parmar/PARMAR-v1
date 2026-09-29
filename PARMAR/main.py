"""Main PARMAR entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from PARMAR.interface.dashboard import TerminalDashboard
from PARMAR.interface.futuristic_app import main as run_futuristic_ui
from PARMAR.phone.phone_awareness import PhoneAwarenessModule


def run_pipeline(request_text: str) -> dict:
    dashboard = TerminalDashboard()
    return dashboard.run_pipeline(
        request_text,
        human_interests=["privacy", "autonomy", "safety"],
        rules=[
            "No external sharing of personal data without approval",
            "No destructive action without explicit human sign-off",
            "Human agency must remain intact",
        ],
    )


def run_demo_phone() -> dict:
    module = PhoneAwarenessModule()
    module.grant_permission("phone_awareness")
    return module.demo_phone_event()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PARMAR V1")
    parser.add_argument("--demo-phone", action="store_true", help="Run a safe simulated phone awareness demo")
    parser.add_argument("--ui", action="store_true", help="Launch the futuristic PARMAR UI foundation")
    args = parser.parse_args()
    if args.demo_phone:
        print(run_demo_phone())
    elif args.ui:
        run_futuristic_ui()
    else:
        TerminalDashboard().run()
