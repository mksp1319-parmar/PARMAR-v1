# PARMAR V1

PARMAR — Predictive AI-Risk Mediation & Autonomous Reasoning

This workspace contains the working PARMAR V1 project under the [PARMAR](PARMAR) directory.

## What is included

- Human-centered AI safety pipeline
- Intent analysis and risk evaluation
- Conflict detection and mediation
- Independent privacy, autonomy, and emergency safety gates
- Central runtime enforcement gate that enforces approval as a runtime state
- Structured decision records requiring human approval
- Terminal interface and scenario simulation
- Privacy-safe phone awareness module for simulated events only
- Test suite covering the major modules and phone-awareness policy

## Runtime enforcement architecture

The system now includes a dedicated runtime enforcement layer before any action boundary is considered. The enforcement gate receives the complete PARMAR decision and checks all required conditions together:

- risk level
- privacy result
- autonomy result
- emergency gate result
- required human approval
- current human approval state

This gate does not execute an action. It only decides whether execution would be permitted and returns a structured result such as:

```python
{
    "status": "READY_FOR_ACTION",
    "state": "APPROVED",
    "execution_allowed": True,
    "human_approval_required": True,
    "human_approval": "APPROVED",
    "reason": "The action has explicit human approval and passed the safety review gate.",
    "decision_id": "..."
}
```

The enforcement gate is separate from the dashboard UI. Even if the UI is bypassed or a caller tries to skip the approval flow, the enforcement gate still evaluates the runtime decision and blocks progression unless the approval requirements are met.

The action boundary is deliberately constrained to a permission check only. It does not execute a real-world action or access any actual device data.

## Phone awareness module

The new phone-awareness layer is designed for privacy-safe, local-only awareness signals. It does not access real device APIs, password stores, private messages, photos, contacts, microphone, camera, or location data unless a future feature explicitly adds it and the user grants permission.

Permissions are explicit and revocable. PARMAR never silently takes a consequential action on behalf of the user.

## Run the project

```bash
cd /workspaces/PARMAR-v1
PYTHONPATH=/workspaces/PARMAR-v1 python -m pytest PARMAR/tests/test_pipeline.py PARMAR/tests/test_phone_awareness.py
PYTHONPATH=/workspaces/PARMAR-v1 python PARMAR/main.py
PYTHONPATH=/workspaces/PARMAR-v1 python PARMAR/main.py --demo-phone
```

The app will prompt for a request and show the complete PARMAR evaluation flow with mandatory human approval for riskier actions.
