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
## Provider architecture

Provider flow:

PARMAR analysis and enforcement -> `ChatContext` -> provider readiness -> external authorization (for non-local providers) -> `AIOrchestrator` capability matching -> `ChatRouter` / selected adapter -> untrusted candidate -> PARMAR response validation

PARMAR is an orchestration layer, not the owner of third-party AI systems. `ProviderModelRegistry` records provider/model capability metadata such as modalities, locality, configuration availability, authorization, health, and optional cost/latency/context metadata. Availability is based on provider configuration or an explicitly registered adapter; unconfigured systems are not advertised as available. New compatible adapters can register capabilities without changing the deterministic routing algorithm.

Routing uses explicit provider selection when available; otherwise it prefers the configured provider and keeps `local-demo` as the default when no provider is configured. An unavailable explicit or configured provider fails closed rather than silently switching. There is no universal “best AI” ranking. External providers are considered only when configured and authorized.

`SINGLE_PROVIDER` remains the default chat mode. The opt-in service execution method supports `VERIFIED_MULTI_MODEL` with at least two and at most three registered, eligible candidates. Candidates run sequentially in provider/model order, once each, with the same sanitized task and independent copies of the approved `ChatContext`; adapters are responsible for their configured per-call timeout. The executor has no retries, recursion, or provider-created sub-agents and rejects candidates that share an adapter instance. Candidate outputs are bounded and validated against the existing `ChatResponse` contract. PARMAR classifies exact/normalized text agreement, disagreement, partial success, total failure, or validation failure. Disagreement never selects a winner, and agreement is not proof of correctness.

`VERIFIED_MULTI_MODEL` has no frontend control; `/api/chat` accepts it only when explicitly supplied. Non-local multi-model execution requires both explicit authorization and `PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED=true`, and remains disabled by default. Future real-provider activation requires reviewed external execution policy, bounded adapter timeouts, and additional tests. This phase tests execution only with injected fakes; it makes no real inference calls.

`LocalDemoProvider` is the deterministic default and makes no network request. `HTTPChatProvider` implements the generic PARMAR JSON contract. `OpenAIChatProvider`, `GeminiChatProvider`, and `ClaudeChatProvider` implement their providers' JSON APIs behind the same `generate(prompt, context=...)` contract. All adapters are registered, but no external provider is configured by this repository.

Select providers with `PARMAR_CHAT_PROVIDER`: `local-demo`, `http-json`, `openai`, `gemini`, or `claude`. An unset or empty value selects `local-demo`. An unknown provider or incomplete/invalid configuration fails as `PROVIDER_UNAVAILABLE`; it does not silently select another provider. A configured external adapter still requires separate server-side authorization before a provider request.

Configuration variables:

| Provider | Required variables | Optional endpoint |
| --- | --- | --- |
| `http-json` | `PARMAR_CHAT_ENDPOINT`, `PARMAR_CHAT_MODEL`, `PARMAR_CHAT_API_KEY` | Endpoint is required |
| `openai` | `PARMAR_OPENAI_MODEL`, `PARMAR_OPENAI_API_KEY` | `PARMAR_OPENAI_ENDPOINT` defaults to `https://api.openai.com/v1/chat/completions` |
| `gemini` | `PARMAR_GEMINI_MODEL`, `PARMAR_GEMINI_API_KEY` | `PARMAR_GEMINI_ENDPOINT` defaults to Google's `v1beta` API base |
| `claude` | `PARMAR_CLAUDE_MODEL`, `PARMAR_CLAUDE_API_KEY` | `PARMAR_CLAUDE_ENDPOINT` defaults to `https://api.anthropic.com/v1/messages` |

`PARMAR_CHAT_TIMEOUT_SECONDS` configures a shared request timeout (default 30, maximum 120). Vendor adapters use provider-specific authentication headers. Credentials are read only from environment variables; they are not put in prompts, `ChatContext`, logs, or API responses. The official Free Tier model allow-list includes only Gemini `gemini-3.7-flash`; use an API key from a Free Tier project, since this application cannot inspect the provider project's billing tier or remaining quota. Other external provider access requires the user's own provider credentials and may incur provider charges.

`GET /api/providers` returns allow-listed configuration metadata only: provider ID/type, safe model ID where possible, capability/modality metadata, whether required configuration is present, credential-presence boolean, authorization status, and orchestration eligibility. It never returns endpoint values, credentials, headers, or environment values. `NOT_CHECKED` reachability means no ping, DNS lookup, or provider request was made. “Configured” does not mean reachable.

Provider configuration is not external authorization. The injectable server-side `ExternalAuthorization` policy defaults to deny and must separately allow the provider, capability, and execution mode. Local demo remains the default and needs no external authorization. For `/api/chat`, legacy `{message, language}` requests remain single-provider; multi-model mode is requested only with `"orchestration_mode": "VERIFIED_MULTI_MODEL"`. The client cannot configure credentials, endpoints, models, or adapters. External verified multi-model execution requires both the authorization policy and `PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED`; it remains disabled by default. No frontend provider selector or credential input exists.

Environment variables are the existing configuration source. `.env` files are ignored by Git but are not automatically loaded by PARMAR; use a protected runtime environment. Never send credentials through the chat client or expose them in logs, screenshots, source code, or commits.

Each adapter forwards the existing structured PARMAR context. The provider response is untrusted: it cannot approve requests, grant permissions, execute tools, modify memory, or change safety decisions. PARMAR analysis and enforcement remain authoritative and run before orchestration or routing. Credentials remain in provider adapters and never enter `ChatContext`, prompts, frontend responses, or audit logs.

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
- no unrestricted network requests or shell execution; external chat calls require explicit provider selection and configuration
- no credential persistence; external credentials are read from environment variables only
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
