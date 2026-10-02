# PARMAR Chat Providers

The chat path is PARMAR analysis and enforcement -> `ChatContext` -> provider readiness -> external authorization (for non-local providers) -> `AIOrchestrator` capability matching -> `ChatRouter` / selected adapter -> untrusted response -> PARMAR response handling. Safety decisions remain PARMAR's authority; provider text cannot approve, execute actions, alter policy, or modify memory.

PARMAR is an orchestration layer, not the owner of third-party AI systems. Provider/model configuration depends on actual server-side settings; readiness inspection does not test reachability. No universal “best AI” ranking is used. `SINGLE_PROVIDER` remains the default. The opt-in `VERIFIED_MULTI_MODEL` execution method accepts two to three registered, independent candidates and runs them sequentially once each with copies of the same sanitized task/context. “Verified” means only deterministic PARMAR-side exact/normalized text agreement; it is not proof of correctness. Disagreement returns candidates without selecting a winner. Partial success is not verified, and failures are normalized. Non-local multi-model execution requires both the explicit authorization policy and `PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED`; this phase uses injected fake providers only and makes no real inference calls.

`GET /api/providers` exposes safe configuration/readiness metadata only. Configuration presence does not mean reachability and does not authorize external use. The server-side external authorization allow-list defaults to deny and is separate from PARMAR safety approval. External verified multi-model execution requires both explicit mode authorization and the global feature guard. Legacy `/api/chat` requests remain single-provider; only an explicit `orchestration_mode: "VERIFIED_MULTI_MODEL"` opts in. Client payloads cannot set endpoint URLs, model IDs, credentials, or adapters.

Implemented adapters are `LocalDemoProvider`, generic `HTTPChatProvider`, `OpenAIChatProvider`, `GeminiChatProvider`, and `ClaudeChatProvider`. The local demo is the deterministic default and makes no network request. Adapters are implemented and fake-transport tested, but this repository contains no provider credentials and no external provider is configured.

Set `PARMAR_CHAT_PROVIDER` to `local-demo`, `http-json`, `openai`, `gemini`, or `claude`. Empty/unset means `local-demo`; unknown or incomplete explicit configuration fails safely and never falls back to another provider.

For `http-json`, set `PARMAR_CHAT_ENDPOINT`, `PARMAR_CHAT_MODEL`, and `PARMAR_CHAT_API_KEY`. For `openai`, set `PARMAR_OPENAI_MODEL` and `PARMAR_OPENAI_API_KEY`; `PARMAR_OPENAI_ENDPOINT` is optional. For `gemini`, set `PARMAR_GEMINI_MODEL` and `PARMAR_GEMINI_API_KEY`; `PARMAR_GEMINI_ENDPOINT` is optional. For `claude`, set `PARMAR_CLAUDE_MODEL` and `PARMAR_CLAUDE_API_KEY`; `PARMAR_CLAUDE_ENDPOINT` is optional. `PARMAR_CHAT_TIMEOUT_SECONDS` is shared (default 30, maximum 120).

Credentials are read from environment variables, sent only in provider authentication headers, and excluded from prompt/context/response handling. Real provider access requires the user's own credentials and may incur charges. No SDK dependencies were added.
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
