# PARMAR V1

PARMAR — Predictive AI–Risk Mediation & Autonomous Reasoning

PARMAR V1 is a human-controlled AI safety and guidance system. It is designed to evaluate requests, explain risk, enforce independent safety checks, and require explicit human approval before any consequential action is allowed to proceed.

## Architecture

The system separates responsibilities so the front-end, safety engine, simulator, and VOKI layer each do different jobs:

- Front-end: responsive governance dashboard and local interface
- Safety engine: privacy, autonomy, emergency, and enforcement decisions
- Simulation layer: local scenario tests without real-world effects
- VOKI layer: presentation/state architecture only
- Chat architecture: provider-agnostic, local-demo first, with safety middleware always enforced

## Human-controlled safety model

The core flow remains:

HUMAN OVERSIGHT -> PARMAR -> AI / RULES / SIMULATOR -> INDEPENDENT SAFETY CHECKS -> HUMAN DECISION -> FINAL AUTHORIZATION

This means PARMAR does not act as an unrestricted autonomous agent. It explains, evaluates, blocks, and requires explicit approval.

## UI and VOKI

The interface is a serious governance dashboard with:

- futuristic dark styling
- animated PARMAR core
- live pipeline
- risk center
- approval center
- explainability panel
- scenario simulator
- audit panel
- phone-awareness simulation
- language-select architecture for English, Hindi, and Hinglish

VOKI is visual/state-only and never controls authorization or execution.

## Phone awareness

Phone awareness is strictly simulated and local. It does not access real device microphones, cameras, contacts, location, photos, or messages. It only works with fake or simulated data and respects permission state.

## Safety enforcement

The enforcement gate is fail-closed:

- missing safety input blocks execution
- malformed safety results block execution
- missing approval blocks execution
- unsafe actions are not treated as safe

This is enforced before any action boundary is considered.

## Local run

```bash
cd /workspaces/PARMAR-v1
PYTHONPATH=/workspaces/PARMAR-v1 python PARMAR/main.py --ui
PYTHONPATH=/workspaces/PARMAR-v1 python PARMAR/main.py --demo-phone
PYTHONPATH=/workspaces/PARMAR-v1 pytest -q PARMAR/tests
```

## Limitations

- no real-world action execution
- no live surveillance access
- no unrestricted network requests or shell execution
- no credential storage
- no autonomous device control

## What is real vs simulated

Real:
- intent analysis
- risk evaluation
- conflict detection
- mediation
- privacy/autonomy/emergency checks
- enforcement gate
- local dashboard
- audit logging

Simulated:
- phone awareness events
- local AI demo provider
- UI scenarios
- VOKI presentation state

