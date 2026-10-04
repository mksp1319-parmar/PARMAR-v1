# PARMAR Chat Providers

The chat path is PARMAR analysis and enforcement -> `ChatContext` -> provider readiness -> external authorization (for non-local providers) -> `AIOrchestrator` capability matching -> `ChatRouter` / selected adapter -> untrusted response -> PARMAR response handling. Safety decisions remain PARMAR's authority; provider text cannot approve, execute actions, alter policy, or modify memory.

PARMAR is an orchestration layer, not the owner of third-party AI systems. Provider/model configuration depends on actual server-side settings; readiness inspection does not test reachability. No universal “best AI” ranking is used. `SINGLE_PROVIDER` remains the default. The opt-in `VERIFIED_MULTI_MODEL` execution method accepts two to three registered, independent candidates and runs them sequentially once each with copies of the same sanitized task/context. “Verified” means only deterministic PARMAR-side exact/normalized text agreement; it is not proof of correctness. Disagreement returns candidates without selecting a winner. Partial success is not verified, and failures are normalized. Non-local multi-model execution requires both the explicit authorization policy and `PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED`; this phase uses injected fake providers only and makes no real inference calls.

`GET /api/providers` exposes safe configuration/readiness metadata only. Configuration presence does not mean reachability and does not authorize external use. The server-side external authorization allow-list defaults to deny and is separate from PARMAR safety approval. External verified multi-model execution requires both explicit mode authorization and the global feature guard. Legacy `/api/chat` requests remain single-provider; only an explicit `orchestration_mode: "VERIFIED_MULTI_MODEL"` opts in. Client payloads cannot set endpoint URLs, model IDs, credentials, or adapters.

Implemented adapters are `LocalDemoProvider`, generic `HTTPChatProvider`, `OpenAIChatProvider`, `GeminiChatProvider`, and `ClaudeChatProvider`. The local demo is the deterministic default and makes no network request. Adapters are implemented and fake-transport tested, but this repository contains no provider credentials and no external provider is configured.

Set `PARMAR_CHAT_PROVIDER` to `local-demo`, `http-json`, `openai`, `gemini`, or `claude`. Empty/unset means `local-demo`; unknown or incomplete explicit configuration fails safely and never falls back to another provider.

For `http-json`, set `PARMAR_CHAT_ENDPOINT`, `PARMAR_CHAT_MODEL`, and `PARMAR_CHAT_API_KEY`. For `openai`, set `PARMAR_OPENAI_MODEL` and `PARMAR_OPENAI_API_KEY`; `PARMAR_OPENAI_ENDPOINT` is optional. For `gemini`, set `PARMAR_GEMINI_MODEL` and `PARMAR_GEMINI_API_KEY`; `PARMAR_GEMINI_ENDPOINT` is optional. For `claude`, set `PARMAR_CLAUDE_MODEL` and `PARMAR_CLAUDE_API_KEY`; `PARMAR_CLAUDE_ENDPOINT` is optional. `PARMAR_CHAT_TIMEOUT_SECONDS` is shared (default 30, maximum 120).

Credentials are read from environment variables, sent only in provider authentication headers, and excluded from prompt/context/response handling. Real provider access requires the user's own credentials and may incur charges. No SDK dependencies were added.
External single-provider authorization is separate from provider configuration and pricing eligibility. It defaults to deny and is configured only on the server with `PARMAR_EXTERNAL_CHAT_ENABLED`, `PARMAR_EXTERNAL_CHAT_ALLOWED_PROVIDERS`, `PARMAR_EXTERNAL_CHAT_ALLOWED_CAPABILITIES`, and `PARMAR_EXTERNAL_CHAT_ALLOW_SINGLE_PROVIDER`. Boolean values must be explicitly `true` or `false`; provider and capability allow-lists are comma-separated. Missing or malformed settings deny external use. Supported external provider IDs are `http-json`, `openai`, `gemini`, and `claude`; supported capability IDs are `text_generation`, `reasoning`, `code_generation`, `summarization`, `translation`, `structured_output`, `verification`, and `image_analysis`. The local demo is not controlled by external authorization. Verified multi-model authorization remains separately gated and disabled by default.

These authorization settings do not override `ProviderFreePolicy`. OpenAI remains unavailable under the current `PAID_ONLY` record, even when credentials and external authorization are configured. It may only become eligible after its exact model/access is made eligible by a separately reviewed policy record; this configuration does not mark any provider, model, or quota as eligible. Readiness performs no provider request and does not establish reachability.

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

## Authenticated session boundary (Phase 3 Slice 2)

The HTTP layer supports opaque, server-side sessions through an in-memory repository boundary. No login provider or public session-creation route is configured. A future trusted authentication handler must call the internal session-issuance or rotation helper only after validating the user. Session timeout settings are explicit: set both `PARMAR_SESSION_IDLE_SECONDS` and `PARMAR_SESSION_ABSOLUTE_SECONDS`; if neither is set, authenticated sessions are disabled. The included repository is process-local and sessions are lost on restart, so it is not a production persistence adapter.

Authenticated cookies use `__Host-parmar_session; Path=/; Secure; HttpOnly; SameSite=Lax`. The `Secure` attribute is mandatory: the current `http://127.0.0.1` development server cannot use authenticated browser sessions over plain HTTP. Local-demo remains anonymous and continues to work without cookies or CSRF tokens. Authenticated POST requests require the session-bound `X-CSRF-Token`; `GET /api/session` returns that CSRF value but never the session token. Pending approvals require the exact authenticated user and session that created them.

## Conversation ownership boundary (Phase 3 Slice 3)

Authenticated `/api/chat` requests use process-local conversation and message repository protocols. The server generates conversation IDs and associates each record with the user resolved from the active session; a client-supplied ID is only a selector and must belong to that user. Authenticated context is loaded from the server-owned conversation, and client-supplied `recent_messages` are ignored. Authenticated chat responses include the server-owned `conversation_id` for a future authenticated UI migration. Only sanitized user/assistant message text is stored, after the existing chat safety flow returns its visible response.

The current repositories are in-memory only and lose conversations on restart. Local-demo remains anonymous and does not create server-owned conversations. Its existing browser-local history behavior is unchanged; no local history import or migration is performed. Conversation ownership does not change approval binding or any PARMAR safety/enforcement authority.

## Authenticated conversation UI (Phase 3 Slice 4)

The browser checks `GET /api/session` before enabling requests. Authenticated chat sends the server-confirmed conversation ID and the in-memory CSRF value; it does not send browser `recent_messages`. Authenticated chat presentation is held only in memory and is never saved to the local-demo conversation or audit storage. Logout calls `POST /api/logout`, clears authenticated UI and approval state, and leaves local-demo data intact. Session-ending notifications between tabs trigger a fresh server session check; a notification by itself never authenticates a tab.

The current server API does not expose conversation-list or conversation-read routes. Therefore the sidebar shows only server-confirmed conversations created during the current page session; older server conversations cannot yet be listed or reloaded into the transcript. No localStorage conversations are uploaded or merged.

## Explicit memory ownership, consent, and retrieval (Phase 3 Slices 5–6)

Authenticated users can manage notes through `GET` and CSRF-protected `POST /api/memory` operations. Consent is held server-side per user; saving and updating require consent, while deletion remains available after consent is revoked. Memory IDs, ownership, timestamps, and provenance are server-generated. Records are held in a thread-safe process-local repository and are lost on restart.

The Memory page uses server-owned records and consent for authenticated sessions. Local-demo notes remain browser-local and are not imported. Clear credential-like content is deterministically rejected; this is a bounded safeguard, not complete secret detection.

For authenticated chat, the server retrieves only consented memories owned by the session Principal. Matching is deterministic keyword overlap, not semantic search; it scans at most 25 records, up to 32 query terms from the first 1,000 request characters. At most 5 memories, each no longer than 400 characters and at most 1,200 total memory characters, enter `ChatContext`. Missing or revoked consent yields no memories. Provider context marks retrieved memory as untrusted user-owned data. It is not authority and cannot override the current request, policy, risk, approval, provider authorization, tools, or response-safety checks. Anonymous/local-demo chat does not retrieve authenticated memory. There is no automatic memory creation, embeddings, vector search, or external memory service.

## Phase 4 security hardening

Role-based provider adapters keep retrieved memory out of system guidance and pass it as a separate, labeled user-role context message before the current request. The generic HTTP adapter has no role hierarchy; it passes memory in a distinct `untrusted_context` field next to the structured PARMAR context. This separation is a boundary in PARMAR's request format, not a guarantee about how an arbitrary provider interprets content.

Authenticated conversation storage rejects writes beyond these fixed bounds: 50 conversations per user, 10,000 conversations repository-wide, 100 messages per conversation, 4,000 characters per message, 50,000 characters per conversation, and 50,000,000 stored message characters repository-wide. The chat route rejects oversized user input before provider invocation and checks that a user message plus a maximum-size response can fit. Repository appends are atomic and reject over-limit writes; no automatic history eviction is performed. A provider response too large for the remaining storage budget is not persisted or returned by that request.

Phone-awareness HTTP simulation is anonymous local-demo only; authenticated sessions are denied access to its process-local shared state. It uses simulated payloads and does not access real device APIs. The anonymous demo state remains shared within the process.

The Memory page distinguishes server-side storage from external disclosure: when a non-local provider is selected, it says that matched notes may be included only if that provider is authorized for the request. This is informational and does not grant provider authorization.

## Vokki assistant layer

VOKKI is PARMAR's human-facing communication layer, not a safety or approval authority, proof of execution, or a separate action executor. Backend responses expose one versioned `voki_contract` with separate `lifecycle`, `request_review`, `enforcement`, `approval`, `provider`, `response_safety`, and `response_disposition` fields, plus message, request ID, timestamp, and source. Unknown fields remain `UNKNOWN`; the legacy request-review status `SAFE` does not mean a provider response passed response-safety validation.

The request lifecycle reaches `ENFORCEMENT_ALLOWED` only when the authoritative gate grants permission. Chat then records `PROVIDER` → `RESPONSE_SAFETY` → `RELEASED` or `WITHHELD`. Only a provider output with response-safety `PASS` is released. `PASS` reports only that the configured validator's checks passed; it is not factual correctness or proof of real-world safety. `REVIEW`, `BLOCK`, `UNCERTAIN`, and `NOT_CHECKED` outputs are withheld; provider failure/no output is reported separately and is not presented as a response-safety failure. `execution_allowed` is permission only and never proof that a real-world action occurred.

Both `/api/analyze` and `/api/chat` create pending approvals through the same server-side store when an authenticated session may create one. Decisions are bound to the original server-held review and owner/session, expire, are one-use, and rerun `CentralEnforcementGate`; approval never bypasses enforcement or triggers real-world execution.

Browser interaction and speech remain client-only: HTTP waiting, text-input focus, CSS animation, and browser speech do not alter the backend lifecycle. Browser speech tracks `IDLE`, `QUEUED`, `SPEAKING`, `ENDED`, `ERROR`, and `CANCELLED`; `SPEAKING` is set only by actual browser speech-start activity. Voice uses browser speech synthesis only; there is no microphone capture, speech-recognition provider, or generated voice service. Genuine VOKKI volume control is not supported and no volume control is represented as available.
