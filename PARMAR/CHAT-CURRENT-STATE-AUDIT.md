# PARMAR Chat — Current-State Audit

**Audit date:** 2026-11-27
**Scope:** Existing web Chat UI, its server routes and service integrations, conversation/history behavior, research, memory, and the separate VOKKI voice surface. This is an audit and design phase; no application behavior was changed.

## Executive findings

PARMAR already has a meaningful safety-oriented Chat foundation: a single-page Chat workspace, one-shot `/api/chat` requests, request/stale-response guards, plain-text-safe message rendering, local-demo history, authenticated profile-scoped conversation repositories and read APIs, a configurable provider abstraction, response-safety validation, explicit research requests, validated research source cards, and a distinct VOKKI voice interface.

The current interface is not yet a production-grade conversational client:

1. The default provider is `local-demo`, a deterministic explanation rather than a conversational model. The unauthenticated HTTP Chat path explicitly selects `local-demo` and does not pass a client-selected provider.
2. Authenticated `/api/chat` requests are intentionally stopped by the unconditional `RuntimeNoGo` atomic-authorization-fence requirement. Therefore, a provider configured on the server is not sufficient to make the current browser Chat work as an authenticated AI conversation.
3. The Chat UI uses a single completed JSON response. Its progressive reveal is a post-response presentation effect, not token streaming.
4. Message text is rendered with `textContent`; Markdown, code highlighting, inline citations, edit/regenerate/delete actions, and stop-generation controls are absent.
5. The attachment button is disabled. A bounded image data type/decoder exists in `chat/context.py`, but the HTTP Chat handler, browser composer, and vendor provider request serializers do not connect it. Documents/PDFs are not supported.
6. Conversation search filters already-loaded records. The API has list/load routes but no HTTP create/rename/archive/delete route; repository deletion exists but is not exposed here.
7. Voice is in the separate VOKKI workspace, not the Chat composer. It uses explicit, one-shot on-device speech recognition where the browser can confirm local processing and a language pack; read-aloud uses browser speech synthesis and only verified released responses.

**Audit verdict:** Strong reusable safety and service primitives; major client/product capabilities are missing or gated. Do not treat the provider registry, image type, or buttons in other workspaces as proof that a Chat capability is available in this client.

## Scope and evidence

Reviewed implementation and focused tests:

- `interface/static/index.html`
- `interface/static/app.js`
- `interface/static/chat-presentation.js`
- `interface/static/styles.css`
- `interface/static/voki-interface.js`
- `interface/static/voki-speech.js`
- `interface/futuristic_app.py`
- `chat/context.py`, `chat/models.py`, `chat/orchestration.py`, `chat/providers.py`, `chat/readiness.py`, `chat/response_safety.py`, `chat/router.py`, `chat/service.py`
- `conversations.py`
- `research/models.py`, `research/providers.py`, `research/service.py`
- `memories.py`, `safety/runtime_no_go.py`
- Chat, history, provider, research, UI-state, and VOKKI tests listed in the Feature Matrix.

### Validation run

Commands were run from the repository root:

| Command | Result |
|---|---:|
| `python -m pytest -q PARMAR/tests/test_chat_service.py PARMAR/tests/test_chat_orchestration.py PARMAR/tests/test_chat_http_provider.py PARMAR/tests/test_vendor_chat_providers.py PARMAR/tests/test_conversations.py PARMAR/tests/test_conversation_http.py PARMAR/tests/test_research.py PARMAR/tests/test_provider_readiness.py` | **293 passed** |
| `python -m pytest -q PARMAR/tests/test_ui_state.py` | **33 passed** |
| `node --test PARMAR/tests/test_voki_interface.js PARMAR/tests/test_voki_state.js PARMAR/tests/test_chat_presentation.cjs PARMAR/tests/test_chat_research_ui.cjs` | **97 passed** |
| Readiness recheck: `python -m pytest -q PARMAR/tests/test_ui_state.py PARMAR/tests/test_conversation_http.py` | **65 passed** |

These are automated unit/contract tests, many using injected providers or mocks. They do **not** prove live provider credentials, external authorization, backend deployment readiness, mobile visual quality, or a functioning authenticated Chat request. The test suites directly confirm the authenticated-chat no-go behavior.

No browser screenshot or live external-provider request was performed during this audit. The existing visual-test suite is not evidence that the present Chat workspace has been visually accepted at desktop, tablet, and mobile dimensions.

## End-to-end architecture and flow

### Entry points and navigation

- The application serves one static SPA from `interface/static/index.html`; `app.js` binds section navigation and uses Home as the default destination.
- Chat entry points include the sidebar Chats navigation, Home “Ask Anything” and recent/continue actions, research “Research in Chat” actions, and VOKKI’s explicit open/activation handoff.
- `selectSection()` controls the main workspace. New Chat invalidates pending work and clears the active conversation selection; it does not create an authenticated server record until a message is sent.
- The Chat view has its own conversation list/search and a separate main transcript/composer. There is also shared history UI on other views.

### Browser request and response path

1. `submitChatMessage()` reads the text composer, enforces profile prerequisites for authenticated sessions, and calls the single-flight request guard.
2. The user message and a transport-only waiting row are rendered in the browser.
3. The browser sends JSON to `POST /api/chat`, including response preferences, optional research opt-in, and for Local Demo only, bounded recent turns from its browser conversation.
4. The handler validates input and, for authenticated requests, establishes identity/profile ownership and reaches the atomic-fence no-go before request analysis/provider execution. Anonymous requests continue through PARMAR request analysis and `ChatService` with Local Demo selected.
5. The client exposes candidate answer text only when the authoritative release contract is coherent. Non-release outcomes are converted to explicit safe status text. Research sources are independently validated and withheld unless the response is released.
6. In Local Demo, browser conversation state is stored in browser `localStorage`; it is not uploaded or merged. Authenticated history is fetched from the server and selected using an opaque conversation ID stored in `sessionStorage`.

The browser has request sequencing and conversation/authentication generation checks to ignore stale results, but it does not abort the underlying HTTP request. A route/conversation change prevents stale results from being adopted; it is not a server-side cancellation mechanism.

### Backend request path and current availability

- `PARMARRequestHandler.do_POST()` routes `/api/chat` to `ChatService`, after request validation and safety analysis.
- If the request is anonymous, the handler sets the selected provider to `local-demo`, regardless of provider registry entries.
- If the request is authenticated, the handler validates the trusted session and active profile, then invokes `_deny_unfenced_protected_operation(... AUTHENTICATED_CHAT ...)` before it creates or looks up a conversation.
- `safety/runtime_no_go.py::require_atomic_authorization_fence()` unconditionally raises `RuntimeNoGo` for protected operations until an atomic fence implementation is supplied. The handler returns HTTP 503. It does not proceed to model generation.
- This means the current browser has no usable path to a conversational AI provider: anonymous requests are Local Demo; authenticated provider requests are no-go. The configured OpenAI/Gemini/Claude/generic HTTP adapters and orchestrator can be exercised directly in tests and by server services, but are not proof of available browser Chat.
- **Side-effect ordering verified:** The current handler reaches the authenticated-chat no-go guard before `create_for_message()` or `get_owned()`. The HTTP tests assert that denied requests do not call the Chat service and leave the owned conversation list empty. No pre-fence conversation creation/quota-consumption defect was found. Preserve this ordering when the handler is changed.

### Conversation persistence and history

- `conversations.py` defines in-memory and SQLite conversation/message repositories, server-established ownership, optional profile scoping, title generation from the first user message, message and character quotas, bounded reads, and ownership-checked repository delete.
- `GET /api/conversations` and `GET /api/conversations/{id}` are authenticated and active-profile scoped. History reads are no-store. There is no `POST`, `PATCH`, or `DELETE` conversation HTTP route in `PARMARRequestHandler`.
- The client filters the set already in state; it does not query a server search endpoint. Search matches title/first message and loaded message text.
- Local Demo conversations are serialized to browser `localStorage`. Authenticated conversation IDs use `sessionStorage` as a selector only; content is reloaded from the server.
- If an authenticated request passes the fence, the handler is structured to persist the user turn after service execution and the assistant turn only when authoritatively released. In the current no-go path, conversation lookup/creation, provider execution, and message persistence are not reached. The current GET history contract exposes role, content, timestamps, and optional research metadata, not editable version history or model/tool traces.
- Repository-level `delete_owned()` exists and is tested, but the absence of an HTTP route means it is not a Chat user capability.

### Message presentation and controls

- Messages are composed as DOM nodes; ordinary message text uses `textContent`, avoiding HTML interpretation.
- `chat-presentation.js` provides authoritative-release checking, research option construction, validated research rendering, and an optional progressive reveal.
- The progressive reveal begins after the complete successful response is already received and accepted. It is cancellable and reduced-motion-aware, but it is not streaming and should not be described as streaming.
- The only per-message action is Copy. No Markdown parser, syntax highlighter, edit, regenerate, delete, share, branch, or “stop generation” implementation was found.
- PARMAR research results are structured cards with validated HTTPS source links; sources are not rendered as inline answer citations.
- The waiting row says it is transport status only. It does not simulate provider tokens.

### Provider/model integration

- `chat/providers.py` implements Local Demo, generic HTTP JSON, OpenAI, Gemini, and Claude adapters with bounded JSON transport and provider/model configuration from server environment variables.
- Provider selection is allowlisted and explicit; unknown/misconfigured selections fail closed rather than silently falling back. Provider errors are normalized.
- `GET /api/providers` is a read-only configuration/authorization inventory and explicitly reports `reachability: NOT_CHECKED`.
- The Settings page describes provider inventory as read-only. The Chat composer has no provider or model selector. Browser preferences do not change server provider configuration.
- `ProviderModelRegistry` and verified multi-model orchestration exist on the backend, but there is no corresponding user-facing model-selection flow in Chat. Model registry/readiness metadata is not evidence of live reachability or permission.
- External generation is subject to server-side authorization/free-policy decisions, request review, response validation, and no-go fences. Redesign must not make a client selection an authorization grant.

### Attachments and multimodal input

- The composer explicitly says “Files unavailable” and the button is disabled; `index.html` has no active file input or upload path.
- `chat/context.py` defines validation for up to four PNG/JPEG/WebP images (per-image and aggregate byte limits, signature checks). However, the current `/api/chat` handler does not parse an `images` field, and vendor payload serializers construct text-only requests. The image type is an orphaned utility, not working image chat.
- No document/PDF parsing, upload store, retention/deletion workflow, malware/content processing, or provider-transfer consent flow exists.
- No generic attachment capability should be surfaced until the complete end-to-end privacy and provider contract is approved and tested.

### Voice and VOKKI

- Chat links to a separate VOKKI workspace; there is no microphone control in the PARMAR Chat composer.
- `voki-interface.js` submits text/transcripts to `/api/chat` using `assistant_surface: "voki"`, synchronizes with the shared conversation-selection/history events, and has stale-request and single-flight guards.
- `voki-speech.js` uses one-shot browser `SpeechRecognition` only when `processLocally` and browser availability confirm on-device processing. It requests capture only after an explicit Talk action, reports permission/recognition errors, supports cancellation, and has no cloud-recognition fallback.
- Read-aloud uses browser `speechSynthesis`; it starts only for an authoritatively released response and remains disabled until explicitly enabled. Pause, mute, hidden/inactive page, and duplicate-event guards are present.
- Voice capability remains platform-dependent. Browser speech APIs do not imply a functioning microphone, installed language pack, or provider response. The VOKKI workspace follows the same current Local Demo/authenticated no-go constraints as Chat.

### Research and citations

- Research is a visible checkbox and explicit request flag; default ordinary Chat does not request it.
- `SearchService` requires a configured search provider, explicit external authorization, a valid query, and an execution authorization check. It validates and normalizes HTTPS source data and treats retrieved content as untrusted context.
- Search results are only surfaced with a released response, and persistence allows research metadata only in supported result states. The client rejects malformed, unsafe, duplicate, or unreleased results.
- Tests establish contract behavior with local fixtures; they do not prove a live search provider is configured or reachable.

### Memory and conversation context

- Anonymous Local Demo history is bounded recent conversational context in browser memory/local storage; saved Local Demo memory preferences explicitly are not included in Chat requests.
- The post-fence authenticated Chat path is written to load recent turns from the owned server conversation and ask the service for consented, owned memory context; it is currently unreachable through the browser because the atomic fence rejects the request first. Context is bounded, sensitive-value filtered, and marked untrusted so it cannot change safety/approval decisions.
- Memory retrieval requires the authenticated Chat authorization fence. Memory write/consent/delete/clear actions are also protected operations; their handler currently fails closed at the unconditional fence. The UI can display status but cannot make the no-go gate disappear.
- Client Chat code intentionally does not send its memory array as a request context.

### Errors and responsive behavior

- Duplicate sends are blocked by a single-flight request state. New Chat, selecting another conversation, profile/auth changes, and VOKKI conversation changes invalidate stale client request generations.
- A failed browser Chat request restores the prompt and displays a generic failure status; a user can resubmit manually. No provider retry policy or explicit generation cancellation exists.
- Server history loading and selection have loading/error states with retry buttons. Provider readiness is explicit that it does not probe reachability.
- CSS includes responsive rules for desktop, tablet, and mobile; at narrower widths the Chat history panel is hidden and the shared navigation/history mechanisms remain available. Styles are layered through a large stylesheet with repeated/late overrides.
- Responsive CSS and static assertions are not equivalent to real screenshot/device verification. This audit did not render Chat screenshots.

## Findings to resolve before implementation

1. **P0 — Authenticated Chat has no production execution path.** Implement/approve the atomic authorization fence before enabling it; do not remove or bypass `RuntimeNoGo`.
2. **P1 — Browser default presents a Chat UI despite Local Demo not being conversational.** Keep Local Demo disclosed and make the unavailable/gated state obvious; never imply that the configured-provider list is a working selector.
3. **P1 — “Streaming” is absent.** Product and acceptance language must distinguish the existing post-release reveal from provider streaming. Any later stream must preserve the response-safety release boundary.
4. **P1 — Attachment primitives are disconnected.** Do not enable the disabled control until server route, provider modalities, consent, validation, storage/retention, deletion, and tests are complete.
5. **P1 — History management is read-only in the browser.** Rename/archive/delete/folder concepts need authorized server contracts and ownership tests; do not fake these controls locally for server conversations.
6. **P2 — Error affordance is generic.** Preserve clear failure states and prompt recovery; consider typed safe errors and visible retry without duplicate sends or automatic provider fallback.
7. **P2 — Current Chat visual acceptance is unverified.** Add real browser screenshots and keyboard/viewport interaction tests before declaring redesign complete.

## Documents in this audit package

- `CHAT-FEATURE-MATRIX.md` — evidence-based working/partial/missing inventory.
- `CHAT-REDESIGN-SPEC.md` — proposed product experience and visual direction.
- `CHAT-IMPLEMENTATION-PLAN.md` — sequenced implementation dependencies and acceptance tests.
- `CHAT-REGRESSION-RISK-REGISTER.md` — prioritized risks, mitigations, and release gates.
