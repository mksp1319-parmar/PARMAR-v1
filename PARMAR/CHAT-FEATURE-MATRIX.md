# PARMAR Chat — Feature Matrix

**Evidence date:** 2026-11-27
**Interpretation:** “Working” means the implementation path exists and is covered by relevant tests under its stated conditions. It does not imply live provider configuration, production authorization, or all-device visual acceptance. “Partial” means useful code exists but a dependency, capability, or live path is missing. “Missing” means no connected Chat capability was found.

## WORKING

| Feature | Evidence / existing paths | Conditions and boundaries |
|---|---|---|
| Chat entry and Home default | `interface/static/index.html`; `interface/static/app.js::initialize`, `selectSection`, `bindEvents` | SPA navigation, Home startup, explicit Chat entry and new-chat actions are implemented. |
| Multiline text composer and keyboard behavior | `index.html#chat-input`; `app.js::resizeChatInput`, `chatEnterSends`, `bindEvents`; `tests/test_ui_state.py` | Enter/Shift+Enter behavior follows the saved browser preference; IME composition is respected. |
| Duplicate-request guard and stale-result rejection | `app.js::beginRequest`, `invalidatePendingRequest`, `submitChatMessage`; `voki-interface.js` generation guards | One request at a time; stale client responses are discarded. The underlying fetch is not aborted. |
| Safe plain-text message rendering | `app.js::renderSessionMessages` | Uses DOM construction and `textContent`, not Markdown or provider-supplied HTML. |
| Response release gate in UI | `chat-presentation.js::isAuthoritativelyReleased`; `app.js::safeChatReply`, `appendMessageToSession` | Candidate answer text is shown only when release/provider/response-safety contract agrees. Suppressed output is not treated as an answer. |
| Copy message action | `app.js::createCopyButton` | Clipboard copy has an explicit unavailable outcome. It is the only implemented message action. |
| Local Demo history persistence | `app.js::persistedSessionList`, `STORAGE_KEYS.localDemoSessions` | Browser `localStorage` only. It is not uploaded or merged with server history. Storage failure is reported. |
| Owned server conversation read APIs | `interface/futuristic_app.py::do_GET`; `conversations.py` repositories | Authenticated, profile-scoped list/load with ownership checks and bounded history. |
| Provider adapters and fail-closed routing | `chat/providers.py`, `chat/router.py`, `chat/orchestration.py` | Configured backend adapters exist and are tested with fixtures. Unknown/misconfigured provider selection does not silently fall back. |
| Provider configuration inventory | `GET /api/providers`; `chat/readiness.py::ProviderConfigurationRegistry` | Read-only and explicitly `NOT_CHECKED` for reachability; not a selector or connection test. |
| Research request opt-in and safe source presentation | `index.html#research-mode`; `chat/research` modules; `chat-presentation.js`; research tests | Research runs only when explicitly requested and server config/authorization/execution checks allow it. Source cards require valid source contract and released response. |
| VOKKI voice output after response release | `voki-interface.js`; `voki-speech.js`; `tests/test_voki_interface.js` | Browser speech synthesis, explicit opt-in, released-response-only, mute/pause/inactive/dedup guards. Not part of the Chat composer. |
| VOKKI local voice input | `voki-speech.js::VOKKIRecognitionAdapter`; `voki-interface.js` | Explicit Talk action, one-shot local recognition only when the browser confirms local processing/language availability, transcript routed through Chat API, denial/error/cancel states. |
| Safety, approval, privacy and owner boundaries in backend services | `chat/service.py`, `safety/runtime_no_go.py`, `interface/futuristic_app.py`, `tests/test_chat_service.py`, `tests/test_conversation_http.py`, `tests/test_http_security.py` | Must remain authoritative. Current no-go constraints disable protected live operations rather than bypassing them. |

## PARTIAL

| Feature | What exists | Gap / qualification |
|---|---|---|
| Contextual Chat | Anonymous browser sends up to the recent bounded turns; authenticated server handler reads recent owned turns; `ChatService` sanitizes and bounds context. | Authenticated Chat is no-go gated. Anonymous path is forced Local Demo, which is not a conversational model. No user-visible context scope/clear control is part of the Chat surface. |
| Actual AI provider generation | Local Demo, generic JSON, OpenAI, Gemini, Claude adapters and orchestration are implemented. | `provider_from_environment()` defaults to Local Demo. Anonymous `/api/chat` forces Local Demo; authenticated `/api/chat` hits `RuntimeNoGo`. Browser has no provider/model selector. Live generation through the current Chat UI is therefore not verified/available. |
| Offline conversational model | Deterministic Local Demo is available without a network request. | No local conversational inference engine/model is identified in the audited implementation. Do not describe Local Demo as offline AI or add an external dependency without separate approval. |
| Conversation persistence and cross-device history | SQLite/in-memory repositories, user/profile ownership, list/load APIs, browser-local Local Demo persistence. | Authenticated Chat is blocked. No HTTP create/rename/archive/delete routes; Local Demo remains device/browser-local. Do not describe the whole product as cross-device history. |
| Conversation search | Search input filters loaded conversation title and loaded message text. | No server-side query/pagination; it cannot search unloaded server records. |
| Research and citations | Configurable backend search service, validated source records, source cards/HTTPS links, persisted supported research metadata. | Requires an actual configured/authorized search provider; live connectivity not verified. Sources are not inline citations in answer text; source panels are not evidence of factual entailment. |
| Memory and personalization | Explicit consent/data model and owned-memory retrieval; Local Demo preferences and saved local notes; request preference fields and sanitized context. | Local Demo saved notes are not used in Chat. Authenticated memory writes/retrieval depend on protected fences; live Chat is no-go gated. The Chat composer does not surface memory context decisions. |
| VOKKI as Chat companion | Distinct interface uses `/api/chat`, shared conversation selection and authoritative release contracts. | It is a separate workspace rather than an in-composer Chat mode. Its API response path inherits Local Demo/no-go availability constraints. |
| Loading and recovery | Transport waiting state, single-flight guard, history loading/error messages, manual history retry, prompt restoration after failed send. | No provider retry action, no typed distinction in the main UI for most failures, and no stop/cancel-generation control. Generic catch path can mask diagnostic detail from the user. |
| Responsive Chat layout | CSS has desktop grid and narrower breakpoints; history panel hides on small screens while app navigation remains. | This audit did not inspect real Chat screenshots at desktop/tablet/mobile sizes. Existing static tests do not establish visual quality, safe-area/keyboard fit, or interaction usability. |
| Structured research content | DOM-based source entries with title, domain, metadata, snippet and link. | No general Markdown, tables, code blocks, syntax highlighting, math, or rich response renderer. |

## MISSING

| Capability | Evidence |
|---|---|
| User-visible provider/model selector in Chat | No Chat selector or sent provider/model choice; Settings inventories configuration read-only. |
| True provider streaming and stream cancellation | One JSON request/response; `startProgressiveReveal()` reveals already-received text only. No stream transport, token events, stop button, or server cancellation contract. |
| Markdown renderer and syntax-highlighted code blocks | Message renderer assigns the entire text to `textContent`; no Markdown/highlighting library or code renderer is loaded. |
| Edit, regenerate, delete-message, or branch actions | Copy is the only per-message action. No corresponding message mutation API was found. |
| Conversation rename, archive, or user-facing delete | Repository `delete_owned()` exists but is not exposed by HTTP; no archive/rename state or controls. |
| Projects/folders for organizing conversations | No Chat project/folder entity, association, route, or UI. |
| Functional file/image attachment in Chat | Composer is disabled as “Files unavailable”; `ChatImage` utilities are not connected to request parsing/providers. |
| Documents/PDF analysis | No upload route, parser, provider contract, or persistence/retention controls. |
| Voice controls in Chat composer | Voice controls live only in the VOKKI workspace; Chat has a link to open VOKKI. |
| Inline source citations / evidence mapping | Validated research source list exists; no inline citation anchors or claim-to-source mapping in answer text. |
| Remote/global history search | Client filtering is limited to loaded history; no query endpoint or pagination was found. |
| Verified cross-device Local Demo persistence | Local Demo sessions are deliberately browser-local; no sync route exists. |

## Existing capabilities to reuse

1. Preserve `interface/static/app.js` navigation, request sequencing, auth/profile scoping, Local Demo state, and response release checks; do not introduce a competing conversation state store.
2. Preserve `interface/futuristic_app.py` route/auth/security conventions and `conversations.py` repository ownership/quota contracts. Add only missing endpoints after authorization design is approved.
3. Reuse `chat/service.py`, `chat/router.py`, `chat/providers.py`, `chat/readiness.py`, `chat/orchestration.py`, and `chat/response_safety.py`; a new front-end selector must never directly configure or authorize a provider.
4. Reuse `research/service.py`, `research/models.py`, and `chat-presentation.js` for explicit research and validated sources.
5. Reuse VOKKI’s conversation-selection events and release-safe voice adapters where product-approved; do not fold VOKKI into Chat by duplicating its state or identity.
6. Keep memory ownership, consent, untrusted-context handling, and privacy disclosure in `memories.py`, `chat/service.py`, and existing UI state. Do not infer consent from a UI checkbox or saved preference alone.
