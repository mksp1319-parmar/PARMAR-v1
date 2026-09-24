# PARMAR V1

PARMAR — Predictive AI-Risk Mediation & Autonomous Reasoning

PARMAR is a human-centered AI safety and decision-support system. It analyzes a proposal, evaluates risk and conflict, applies independent safety checks, and requires explicit human approval before any consequential action.

## Core design

- Intent analysis identifies the likely goal and action.
- Risk engine scores the proposal across multiple risk categories.
- Conflict detector compares the proposed action against human interests and rules.
- Mediation engine proposes safer alternatives and explanations.
- Independent safety checks block privacy or autonomy violations.
- Emergency gate stops or escalates high-risk proposals.
- Decision engine writes a structured proposal that requires human approval.

## Privacy-safe phone awareness module

The phone-awareness component is intentionally conservative and local-first.

What it does:
- evaluates simulated phone-related awareness events
- checks for explicit permission state
- minimizes data collection to benign metadata only
- flags privacy-sensitive signals such as microphone, camera, message, contact, and location access
- requires explicit human approval for higher-risk events
- logs a sanitized audit record

What it does not do:
- it does not read real private messages, photos, contacts, or chat content
- it does not access microphones, cameras, or location data without explicit permission and a future feature that requires it
- it does not attempt to bypass device, OS, browser, or app security controls
- it does not run hidden background monitoring

## Human oversight rule

HUMAN OVERSIGHT IS MANDATORY.
PARMAR never independently executes a consequential action or overrides a human decision.

## Demo and testing

From the workspace root:

```bash
cd /workspaces/PARMAR-v1
PYTHONPATH=/workspaces/PARMAR-v1 python -m pytest PARMAR/tests/test_pipeline.py PARMAR/tests/test_phone_awareness.py
PYTHONPATH=/workspaces/PARMAR-v1 python PARMAR/main.py
PYTHONPATH=/workspaces/PARMAR-v1 python PARMAR/main.py --demo-phone
```

The terminal interface accepts input requests and prints the complete PARMAR review pipeline. The phone demo uses fake data only and is safe to run in a local environment.
