# PARMAR Chat Providers

The chat path is PARMAR analysis and enforcement -> `ChatContext` -> provider readiness -> external authorization (for non-local providers) -> `AIOrchestrator` capability matching -> `ChatRouter` / selected adapter -> untrusted response -> PARMAR response handling. Safety decisions remain PARMAR's authority; provider text cannot approve, execute actions, alter policy, or modify memory.

PARMAR is an orchestration layer, not the owner of third-party AI systems. Provider/model configuration depends on actual server-side settings; readiness inspection does not test reachability. No universal “best AI” ranking is used. `SINGLE_PROVIDER` remains the default. The opt-in `VERIFIED_MULTI_MODEL` execution method accepts two to three registered, independent candidates and runs them sequentially once each with copies of the same sanitized task/context. “Verified” means only deterministic PARMAR-side exact/normalized text agreement; it is not proof of correctness. Disagreement returns candidates without selecting a winner. Partial success is not verified, and failures are normalized. Non-local multi-model execution requires both the explicit authorization policy and `PARMAR_VERIFIED_MULTI_MODEL_EXTERNAL_ENABLED`; this phase uses injected fake providers only and makes no real inference calls.

`GET /api/providers` exposes safe configuration/readiness metadata only. Configuration presence does not mean reachability and does not authorize external use. The server-side external authorization allow-list defaults to deny and is separate from PARMAR safety approval. External verified multi-model execution requires both explicit mode authorization and the global feature guard. Legacy `/api/chat` requests remain single-provider; only an explicit `orchestration_mode: "VERIFIED_MULTI_MODEL"` opts in. Client payloads cannot set endpoint URLs, model IDs, credentials, or adapters.

Implemented adapters are `LocalDemoProvider`, generic `HTTPChatProvider`, `OpenAIChatProvider`, `GeminiChatProvider`, and `ClaudeChatProvider`. The local demo is the deterministic default and makes no network request. External provider requests are complete/non-streaming and the default HTTP transport does not follow redirects. Adapters are fake-transport tested, but this repository contains no provider credentials and no external provider is configured.

Set `PARMAR_CHAT_PROVIDER` to `local-demo`, `http-json`, `openai`, `gemini`, or `claude`. Empty/unset means `local-demo`; unknown or incomplete explicit configuration fails safely and never falls back to another provider.

For `http-json`, set `PARMAR_CHAT_ENDPOINT`, `PARMAR_CHAT_MODEL`, and `PARMAR_CHAT_API_KEY`. For `openai`, set `PARMAR_OPENAI_MODEL` and `PARMAR_OPENAI_API_KEY`; `PARMAR_OPENAI_ENDPOINT` is optional. For `gemini`, set `PARMAR_GEMINI_MODEL` and `PARMAR_GEMINI_API_KEY`; `PARMAR_GEMINI_ENDPOINT` is optional. For `claude`, set `PARMAR_CLAUDE_MODEL` and `PARMAR_CLAUDE_API_KEY`; `PARMAR_CLAUDE_ENDPOINT` is optional. `PARMAR_CHAT_TIMEOUT_SECONDS` is shared (default 30, maximum 120).

Credentials are read from environment variables, sent only in provider authentication headers, and excluded from prompt/context/response handling. Real provider access requires the user's own credentials and may incur charges. No SDK dependencies were added.
External single-provider authorization is separate from provider configuration and pricing eligibility. It defaults to deny and is configured only on the server with `PARMAR_EXTERNAL_CHAT_ENABLED`, `PARMAR_EXTERNAL_CHAT_ALLOWED_PROVIDERS`, `PARMAR_EXTERNAL_CHAT_ALLOWED_CAPABILITIES`, and `PARMAR_EXTERNAL_CHAT_ALLOW_SINGLE_PROVIDER`. Boolean values must be explicitly `true` or `false`; provider and capability allow-lists are comma-separated. Missing or malformed settings deny external use. Supported external provider IDs are `http-json`, `openai`, `gemini`, `claude`, and `http-json-search`; supported capability IDs include `web_search` in addition to `text_generation`, `reasoning`, `code_generation`, `summarization`, `translation`, `structured_output`, `verification`, and `image_analysis`. The local demo is not controlled by external authorization. Verified multi-model authorization remains separately gated and disabled by default.

These authorization settings do not override `ProviderFreePolicy`. Gemini's exact `gemini-3.7-flash` model is allow-listed because Google's official model catalog lists it and the pricing page lists Standard Free Tier input and output as free of charge. Other Gemini model IDs remain blocked. OpenAI and Claude remain unavailable under their `PAID_ONLY` records, even when credentials and external authorization are configured. Free Tier availability and rate limits are project-specific; this policy does not verify the configured Google project's billing tier, remaining quota, key validity, or reachability. Use a Google Free Tier project and monitor its rate limits. Readiness performs no provider request and does not establish reachability.

## Real research/search foundation (Phase 4A)

`POST /api/chat` accepts the optional boolean `"research": true` to request a PARMAR-governed search before Chat response generation. The existing Research-in-Chat control in the Chat composer, and the corresponding explicit VOKKI option, request this mode; ordinary Chat remains unchanged when research is not selected. A pending approval stores only the research-mode boolean, not retrieved sources, and cannot search until the existing approval continuation establishes the authoritative approved enforcement boundary.

Search is a separate capability, not a Chat or VOKKI provider. No search provider is selected by default. Configure `PARMAR_SEARCH_PROVIDER=http-json` and `PARMAR_SEARCH_ENDPOINT` to select the generic JSON search adapter. The endpoint accepts a JSON `POST` of `{"query":"...","limit":20}` and must return `{"results":[{"title":"...","url":"https://...","source_id":"...","snippet":"...","metadata":{"author":"...","attribution":"...","content_type":"...","published_at":"..."}}]}`. `title`, HTTPS `url`, and `source_id` are required. PARMAR derives and validates the domain from the URL; only the listed attribution metadata is retained. Unknown provider fields are discarded. Duplicate destinations are returned once.

Set `PARMAR_SEARCH_API_KEY` only if required by the selected endpoint; it is sent as a bearer header, never in the query or request body. `PARMAR_SEARCH_TIMEOUT_SECONDS` defaults to 15 and is capped at 30. Search response bodies are capped at 512 KB. Only HTTPS endpoints are accepted, except explicitly configured loopback HTTP endpoints for local adapters; DNS results are checked and pinned to public addresses (or loopback addresses for the local exception), environment proxies are disabled for search, and redirects are not followed. Provider configuration alone does not authorize search: the server must also explicitly allow both `http-json-search` and `web_search` in the external authorization allow-lists and set the existing external authorization booleans. There is no silent fallback to another adapter. Missing configuration, failed requests, malformed provider responses, no results, and blocked requests have distinct versioned research states. Search output is untrusted data and never changes PARMAR policy, approval, or enforcement authority.

The research contract is version `1.0` and includes status plus validated source title, normalized usable URL, derived domain, provider/source identifiers, optional snippet, and allow-listed attribution metadata. Validated research status and sources are atomically stored only with the exact assistant message whose existing response-release contract is `RELEASED` and response-safety status is `PASS`; history returns those sources with that message. Pending, blocked, failed, or withheld results do not expose or persist source metadata. Conversation deletion through the repository cascades to associated research metadata. This local SQLite data is not encrypted at rest.

Sources are attribution, not proof that every generated claim is factually supported by them. Retrieved content is untrusted context and never changes request review, risk classification, enforcement, ActionBoundary, approval, provider authorization, or response-safety authority. Research is never automatically copied into durable Memory.

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
- it does not access microphones, cameras, or location data without explicit permission and a feature that requires it; VOKKI voice input, when supported, starts only after a Talk press and uses browser-enforced on-device speech recognition
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

The HTTP layer supports opaque, server-side sessions through a persistent SQLite repository. Session timeout settings are explicit: set both `PARMAR_SESSION_IDLE_SECONDS` and `PARMAR_SESSION_ABSOLUTE_SECONDS`; if neither is set, authenticated sessions are disabled. Production authentication is not implemented or claimed by this repository. The internal issuance helper is for trusted server-side callers only.

Session rows live by default at `~/.local/share/parmar/sessions.sqlite3`; set `PARMAR_SESSION_DB_PATH` to use another local path. When session timeouts are configured, `PARMAR_SESSION_STORE_KEY` must contain at least 32 bytes of stable, high-entropy server secret material and must be supplied through the server environment; it is not stored in the database or sent to browsers. The repository stores server-generated session/user IDs, authentication source, lifecycle timestamps/status, a SHA-256 hash of the high-entropy opaque cookie token, and a keyed integrity tag for each record; it never stores the plaintext token. SQLite uses a versioned schema, local-only access, restrictive directory/file permissions, and transactional expiry, revocation, and rotation. Corrupt, incompatible, missing-after-initialization, inaccessible, integrity-invalid, or wrong-key storage fails closed with a generic HTTP 503; it never falls back to an in-memory authenticated repository. No external services or network calls are used.

Authenticated cookies use `__Host-parmar_session; Path=/; Secure; HttpOnly; SameSite=Lax`. The `Secure` attribute is mandatory: the current `http://127.0.0.1` development server cannot use authenticated browser sessions over plain HTTP. Local-demo remains anonymous and continues to work without cookies or CSRF tokens. Authenticated POST requests require the session-bound `X-CSRF-Token`; `GET /api/session` returns a fresh CSRF value after a server restart but never the session token. Pending approvals require the exact authenticated user and session that created them.

### Local development authentication (Phase 5A)

An optional `POST /api/auth/development` bridge is available only for local development. It is disabled by default. It establishes exactly one fixed server-defined development principal and labels the browser session **Development Session — Unverified Identity**. This is explicitly **not identity verification**, does not accept a username or user ID, and must never be used as production authentication.

To enable it, explicitly set `PARMAR_ENVIRONMENT=development` and `PARMAR_DEVELOPMENT_AUTH_ENABLED=true`. The listener must bind to a numeric IPv4 loopback address (`PARMAR_UI_HOST=127.0.0.1`); enabling the bridge with a non-loopback bind, without configured persistent sessions/approvals, or without HTTPS fails closed. Configure both session timeouts plus `PARMAR_SESSION_STORE_KEY` (at least 32 bytes); configure `PARMAR_APPROVAL_STORE_KEY` or reuse that session key. Set `PARMAR_UI_TLS_CERTFILE` and `PARMAR_UI_TLS_KEYFILE` to a local TLS certificate/key and `PARMAR_UI_ORIGIN` to the exact HTTPS origin, including port (the UI port is 8080; for example `https://127.0.0.1:8080`). The certificate must be valid for that IP and trusted by the browser. Do not work around certificate errors or remove the cookie's `Secure` attribute. Keep the private key and session/approval store keys server-side only.

The browser's development-session request is an empty JSON object and is accepted only over HTTPS with the configured exact `Origin` and `Sec-Fetch-Site: same-origin`. The opaque session token is delivered only as the existing Secure, HttpOnly, SameSite cookie. The browser then obtains authoritative session state and its CSRF token from `GET /api/session`; CSRF remains in runtime memory. Logout revokes only the active server session. Chat, VOKKI, conversation ownership, persistent approval binding, CentralEnforcementGate, ActionBoundary, and response-safety checks are unchanged.

Production use requires a separately designed integration with a real trusted identity provider that establishes identity server-side before invoking the existing session issuance helper. Phase 5A does not implement OAuth/OIDC/SAML, production login, or identity verification.

## Restart-safe pending approvals (Phase 3 Slice 5)

Authenticated pending human reviews use a separate local SQLite store at `~/.local/share/parmar/approvals.sqlite3`; `PARMAR_APPROVAL_DB_PATH` overrides the path. Configure `PARMAR_APPROVAL_STORE_KEY`, or reuse the existing `PARMAR_SESSION_STORE_KEY`, with at least 32 bytes of stable, high-entropy server-side secret material. The chosen key is used only to derive a domain-separated HMAC integrity key and is never stored in the database or exposed to the browser. If approval integrity is not configured, or the store is unavailable, corrupt, incompatible, or fails its integrity checks, approval creation/inspection/continuation fails closed with a generic HTTP 503; there is no in-memory fallback.

The store persists the token hash, server-resolved user and session IDs, original request fingerprint, exact review response and summary, typed Chat context needed for an approved continuation, UTC expiration, and one-use state. The plaintext approval token is returned once to the authenticated page and is never stored. Each record is HMAC-protected; storage uses a versioned SQLite schema, mode-0700 data directory, mode-0600 database, and atomic consume/reject transitions. Pending records expire after five minutes using UTC time; restart cannot extend their lifetime. Consumed, rejected, and expired records remain terminal. Review/dashboard state is reconstructed only from integrity-checked server-stored fields; the client cannot supply replacement review data. Redemption still requires the active authenticated owner and exact session, CSRF validation, fresh enforcement and action-boundary evaluation, then the existing provider and response-safety pipeline. Logout/revocation makes the session-bound approval inaccessible. No approval is automatically granted and no provider runs before valid human approval.

Idle and absolute expiry timestamps are stored server-side and checked on every resolution; activity extends only the idle expiry and never past the absolute expiry. Logout/revocation and session rotation persist across process restarts. The browser keeps the opaque session token only in the HttpOnly cookie, not in JavaScript-accessible storage. The local development bridge is not a login or reauthentication mechanism and does not establish verified identity.

## Conversation ownership boundary (Phase 3 Slice 3)

Authenticated `/api/chat` requests use provider-neutral conversation and message repository protocols. The server generates conversation IDs and associates each record with the user resolved from the active session; a client-supplied ID is only a selector and must belong to that user. Authenticated context is loaded from the server-owned conversation, and client-supplied `recent_messages` are ignored. Authenticated chat responses include the server-owned `conversation_id`. User turns are stored as requests; assistant turns are stored only when the existing VOKKI contract confirms lifecycle `RELEASED`, provider `COMPLETED`, response-safety `PASS`, and disposition `RELEASED`.

The default conversation repository is a local SQLite file at `~/.local/share/parmar/conversations.sqlite3`; set `PARMAR_CONVERSATION_DB_PATH` to choose another local path. The database and its parent directory are created locally with restrictive file permissions. It uses only Python's standard-library SQLite support and makes no network calls. Repository operations are transactional and keep the existing repository interface. A missing, corrupt, incompatible, or inaccessible store fails closed with a generic HTTP 503; there is no in-memory fallback. Local-demo remains anonymous and does not create server-owned conversations. Its existing browser-local history behavior is unchanged; no local history import or migration is performed. Conversation ownership does not change approval binding or any PARMAR safety/enforcement authority.

## Authenticated conversation UI (Phase 3 Slice 4)

The browser checks `GET /api/session` before enabling requests. Authenticated chat sends the server-confirmed conversation ID and the in-memory CSRF value; it does not send browser `recent_messages`. `GET /api/conversations` lists meaningful, non-empty conversations for the authenticated user, and `GET /api/conversations/{conversation_id}` loads that owner's messages. Titles use the first sanitized user message, whitespace-collapsed and truncated to 56 characters; empty conversations are omitted. Authenticated history refreshes after authentication and chat activity. The active conversation ID alone may be retained in per-tab `sessionStorage` as a selector; it is accepted only if the authenticated user's server-owned list contains it, and messages are always loaded from the server. No session token, CSRF token, user identity, or chat content is stored there. Authenticated chat presentation is never saved to local-demo storage or audit history. Logout clears authenticated UI and the saved selector while leaving local-demo data intact. Session-ending notifications between tabs trigger a fresh server session check; a notification by itself never authenticates a tab.

New Chat clears the active selector and creates no server-side conversation until the user sends a message. Stale or other-owner IDs are discarded and cannot authorize reads. A valid browser cookie restores its server-side session after a page reload or process restart while the persisted session remains unexpired and storage is available. Conversations and sessions use separate local SQLite files and persist across server restarts. No local-demo history is uploaded or merged.

## Explicit memory ownership, consent, and retrieval (Phase 3 Slices 5–6)

Authenticated users can manage notes through `GET` and CSRF-protected `POST /api/memory` operations. Consent is held durably per user and defaults to false; saving, updating, and retrieval require current consent, while listing and deletion remain available after consent is revoked. Memory IDs, ownership, timestamps, and provenance are server-generated. Records and consent use a local SQLite database at `~/.local/share/parmar/memories.sqlite3` by default; set `PARMAR_MEMORY_DB_PATH` to select another local path. The database and parent directory are created with restrictive local file permissions. This storage is **not encrypted at rest**. Notes remain until explicitly deleted or cleared; the repository accepts at most 25 records per user and 400 characters per record. A missing, corrupt, incompatible, or inaccessible store fails closed; authenticated memory does not fall back to volatile storage.

The Memory page uses server-owned records and consent for authenticated sessions. Local-demo notes remain browser-local and are not imported. Clear credential-like content is deterministically rejected; this is a bounded safeguard, not complete secret detection.

For authenticated Chat and VOKKI, the server retrieves only currently consented memories owned by the session Principal, after request review and the existing enforcement and ActionBoundary checks. Matching is deterministic keyword overlap, not semantic search; it scans at most 25 records, up to 32 query terms from the first 1,000 request characters. At most 5 memories, each no longer than 400 characters and at most 1,200 total memory characters, enter `ChatContext`. Missing or revoked consent yields no memories. Memory is untrusted user-owned context, never authority: it cannot change risk classification, grant permissions or approval, bypass CentralEnforcementGate, ActionBoundary, provider authorization, research authorization, or response-safety checks. Approval records do not store memory content; approved continuations retrieve again after the approval and fresh enforcement checks, and use no memory if consent has since been revoked. Provider/model output never creates memory automatically. Anonymous/local-demo memory remains browser-local and separate; it is never imported into authenticated storage or Chat context. There is no automatic memory creation, embeddings, vector search, or external memory service.

## Phase 4 security hardening

Role-based provider adapters keep retrieved memory out of system guidance and pass it as a separate, labeled user-role context message before the current request. The generic HTTP adapter has no role hierarchy; it passes memory in a distinct `untrusted_context` field next to the structured PARMAR context. This separation is a boundary in PARMAR's request format, not a guarantee about how an arbitrary provider interprets content.

Authenticated conversation storage rejects writes beyond these fixed bounds: 50 conversations per user, 10,000 conversations repository-wide, 100 messages per conversation, 4,000 characters per message, 50,000 characters per conversation, and 50,000,000 stored message characters repository-wide. The chat route rejects oversized user input before provider invocation and checks that a user message plus a maximum-size response can fit. Repository appends are atomic and reject over-limit writes; no automatic history eviction is performed. A provider response too large for the remaining storage budget is not persisted or returned by that request.

Phone-awareness HTTP simulation is anonymous local-demo only; authenticated sessions are denied access to its process-local shared state. It uses simulated payloads and does not access real device APIs. The anonymous demo state remains shared within the process.

The Memory page distinguishes server-side storage from external disclosure: when a non-local provider is selected, it says that matched notes may be included only if that provider is authorized for the request. This is informational and does not grant provider authorization.

## Vokki assistant layer

VOKKI is PARMAR's human-facing communication layer, not a safety or approval authority, proof of execution, or a separate action executor. Backend responses expose one versioned `voki_contract` with separate `lifecycle`, `request_review`, `enforcement`, `approval`, `provider`, `response_safety`, and `response_disposition` fields, plus message, request ID, timestamp, and source. Unknown fields remain `UNKNOWN`; the legacy request-review status `SAFE` does not mean a provider response passed response-safety validation.

The request lifecycle reaches `ENFORCEMENT_ALLOWED` only when the authoritative gate grants permission. Chat then records `PROVIDER` → `RESPONSE_SAFETY` → `RELEASED` or `WITHHELD`. Only a provider output with response-safety `PASS` is released. `PASS` reports only that the configured validator's checks passed; it is not factual correctness or proof of real-world safety. `REVIEW`, `BLOCK`, `UNCERTAIN`, and `NOT_CHECKED` outputs are withheld; provider failure/no output is reported separately and is not presented as a response-safety failure. `execution_allowed` is permission only and never proof that a real-world action occurred.

Both `/api/analyze` and `/api/chat` create pending approvals through the same server-side store when an authenticated session may create one. Decisions are bound to the original server-held review and owner/session, expire, are one-use, and rerun `CentralEnforcementGate`; approval never bypasses enforcement or triggers real-world execution.

Browser waiting and speech do not alter the backend lifecycle. VOKKI speech output uses browser speech synthesis and speaks only contract-confirmed released responses. Voice input uses the browser Web Speech API only when on-device recognition is explicitly supported and the selected language pack is already installed. `processLocally` is required and checked; no language packs are downloaded by PARMAR and no cloud transcription fallback is used. The browser requests microphone access only after the user presses Talk, and recognition is single-utterance, cancellable, and stopped when VOKKI is hidden or the page leaves. Raw audio is not sent to a recognition service; the resulting transcript is submitted through the existing `/api/chat` flow like typed text. This experimental browser capability is unavailable on unsupported browsers or languages. Genuine VOKKI volume control is not supported and no volume control is represented as available.
