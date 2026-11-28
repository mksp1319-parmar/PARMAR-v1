# PARMAR Chat — Redesign Specification

**Status:** Phase 1 proposal for review; not an implementation commitment.  
**Product principle:** A calm, premium PARMAR conversation workspace for thinking, research, and safe assistance—not a generic dashboard and not a clone of another assistant.

## 1. Design goals

- Keep the conversation as the primary surface, with a persistent but quiet history rail on wide screens.
- Make the current provider state, research state, and PARMAR human-review boundary truthful and legible.
- Favor excellent reading: restrained line length, clear hierarchy, comfortable paragraph rhythm, and useful structured output.
- Keep actions near the relevant conversation or message; avoid dashboard cards and multiple competing toolbars.
- Keep all capabilities unavailable until the complete backend path, policy, privacy, and recovery behavior are real.
- Maintain the existing PARMAR dark surface, subtle copper/amber highlights, and editorial typography. Use color for focus, status, and hierarchy, not decoration.
- Preserve Home as startup, existing navigation, account/profile ownership, VOKKI identity and module boundaries, AETHER, and all approval/security controls.

## 2. Information architecture

### Desktop (wide viewport)

Use the existing application shell and Chat route:

1. **PARMAR global navigation** remains the primary product-level navigation.
2. **Chat history rail** sits inside the Chat workspace, not as a second global app sidebar.
3. **Conversation canvas** takes the remaining width, with a compact top bar, transcript, and composer.
4. Keep a stable reading column (target roughly 700–800 CSS px maximum for message content) while the workspace itself can use the full available width.
5. Avoid nesting a second dashboard or adding cards around every message.

### Tablet

- Keep conversation visible and usable; make the history rail collapsible to a compact drawer/sheet.
- Provide an obvious, keyboard-accessible history toggle with `aria-expanded` and focus restoration.
- Preserve enough transcript width for code and tables; allow horizontal overflow only inside code/table blocks where appropriate.
- Keep the composer fixed to the conversation surface without covering the last message.

### Mobile

- Use one focused conversation view and an explicit history drawer/sheet.
- Respect safe-area insets, dynamic viewport height, and virtual keyboard resizing. Do not rely only on `100vh`.
- Keep send/stop and attachment/voice actions reachable with touch targets; collapse secondary composer tools into a clearly labeled menu when needed.
- Ensure opening/closing history and changing conversations does not lose a draft silently.
- Test short-height devices and keyboard-open states, not only a nominal phone viewport.

## 3. Left conversation sidebar

### Content and controls

1. **New Chat** — starts a clean client state. It creates server state only at the API boundary that safely creates a conversation; no hidden empty records on denied or abandoned requests.
2. **Search conversations** — search the records available to the active account/profile. If results are server-paginated, indicate result scope and loading/failure state; never imply a full search when only loaded rows were searched.
3. **Recent history** — group by Today, Yesterday, previous week, and earlier; show a concise title and selected state.
4. **Projects/folders** — proposed later capability only. Do not show empty or mock folders. Require an approved owner-scoped data model and migration before UI.
5. **Conversation menu** — rename, archive, delete. Every action must be backed by a server-owned, owner/profile-scoped route, confirmation where destructive, CSRF/session checks, explicit failure, and a corresponding undo/recovery strategy if product requirements call for it.
6. **Collapse behavior** — wide-screen rail collapse; tablet/mobile sheet. Existing global sidebar collapse should remain independent from Chat-history collapse.

### Empty and unavailable states

- New account: concise explanation and useful, non-claiming prompt ideas; do not populate fake conversations.
- Search: distinguish no match from unavailable/unloaded history.
- Provider disabled: distinguish “no conversational provider available” from an empty conversation.
- Auth/profile unavailable: explain what is needed; do not imply data has been deleted.

## 4. Main conversation

### Transcript and typography

- User and PARMAR turns should be visually distinct without oversized chat bubbles; prioritize readable text and natural line wrapping.
- Use a calm serif or high-quality editorial face selectively for long assistant prose, with a highly legible sans-serif UI. Maintain PARMAR’s existing identity and copper accents.
- Use a restrained max-width for prose; let code/table containers use their own responsive layout.
- Show timestamps only when useful (for example on hover/focus or in accessible detail) to avoid visual noise.
- Preserve safe DOM construction. Never insert provider output as raw HTML.

### Markdown, code, tables, structured output

- Add a maintained, locally bundled Markdown renderer only after choosing an explicit safe configuration. Disallow raw HTML by default; sanitize any permitted HTML with an established sanitizer.
- Add syntax highlighting only to fenced code blocks; ship local assets and avoid runtime CDN dependencies.
- Add code copy and horizontal-scroll affordances; do not transform arbitrary inline text into executable controls.
- Render tables with semantic headers and mobile-accessible overflow.
- Keep PARMAR-owned research, approval, and safety status components separate from model-authored Markdown so untrusted content cannot impersonate trusted UI.
- Test XSS payloads, malformed Markdown, very large code blocks, screen-reader structure, and copy fidelity.

### Streaming and lifecycle

- Existing progressive reveal is not streaming. Do not relabel it.
- Define a transport protocol and safety contract before implementing streaming. Since provider content is currently withheld until PARMAR’s response validator reaches `PASS`, do not display unvalidated provider tokens. A safe first release may remain buffered, then reveal only after the authoritative release; true incremental delivery requires a reviewed incremental validation policy and clearly marked provisional content that cannot be mistaken for approved/released output.
- Show truthful states: sending, provider working (only if backend can report it), PARMAR validating, released, withheld, failed, cancelled.
- A stop button is real only if the browser can cancel transport and the backend/provider request or work queue supports cancellation. Otherwise do not present stop as successful.
- Prevent late chunks from switching conversations or authentication scope; test on the server and client.

### Message actions

Proposed actions by message role:

- **User:** Copy; Edit-and-resubmit only if the product specifies whether it creates a new branch or changes the existing transcript.
- **PARMAR:** Copy; Regenerate only through a new safety-authorized request, and only after clarifying conversation history semantics and provider/model disclosure.
- **Both:** Delete only if conversation retention and audit semantics explicitly allow it. A UI deletion must not be a false promise if server copies, research metadata, or audit records remain.

Do not add unsupported controls or silently mutate the displayed history.

### Sources and citations

- Reuse validated `ResearchResult` source contracts and source cards.
- Add inline references only when the provider supplies a stable mapping and the application can validate it. Do not invent citation indices or imply source entailment.
- Maintain the current rule: no research sources appear for blocked, failed, unreleased, invalid, or approval-required results.
- Keep sources as untrusted external content and open HTTPS links with safe `rel` attributes.

## 5. Composer specification

### Baseline composer

- Multiline input, auto-growth with a sensible maximum, Enter/Shift+Enter preference already supported, IME-safe submit, accessible label, character/storage limit feedback.
- Persistent draft per conversation only if persistence semantics are disclosed and tested; otherwise preserve draft during in-session rail navigation and clear it intentionally on New Chat.
- Send becomes disabled while the same request is in flight; request submission remains single-flight.
- When enabled and truthful, replace Send with Stop; do not emulate cancellation only in the browser.
- Keep research opt-in visible and off by default; show provider/configuration restrictions without pretending the search will work.

### Tool menu and multimodal controls

The following are proposed, not currently available:

- **Attach**: disabled until image/document APIs, data ownership, limits, malware/content processing, retention, deletion, provider modalities, explicit transfer consent, and per-provider capabilities exist.
- **Voice input**: keep on-device-only behavior and disclosures. Voice is presently VOKKI-only; moving it into Chat requires product approval and shared state/event ownership, not a copied recognizer.
- **Research**: reuse existing explicit `research: true` behavior and authorization. Show request and outcome state.
- **Model selector**: show only server-advertised configured and authorized choices, but do not use readiness inventory as permission. A user selection is a request preference, never an authorization grant. Do not expose hidden/ineligible choices.

## 6. AI capabilities and architecture

### Preserve the current boundaries

- **Browser SPA:** `interface/static/app.js` remains the owner of navigation and active browser interaction. Extract small Chat-focused modules only where they reduce coupling; do not add a competing client-side conversation store.
- **Backend transport:** `interface/futuristic_app.py` stays the HTTP boundary and applies authentication, profile ownership, CSRF, request validation, and no-go fences.
- **Policy and response release:** `chat/service.py`, `chat/response_safety.py`, `interface/voki_contract.py`, and existing approval/enforcement controls stay authoritative. A UI selector or stream event cannot change a server decision.
- **Conversation storage:** `conversations.py` repositories remain owner/profile-scoped; the API must enforce the same ownership on every new operation.
- **Provider integration:** `chat/providers.py`, `chat/router.py`, `chat/readiness.py`, and `chat/orchestration.py` remain server-side. Do not move credentials or provider routing to browser storage.
- **Research:** reuse `research/` contracts and the existing safe `chat-presentation.js` source renderer.
- **VOKKI:** use existing conversation-selection synchronization and released-response voice adapter; preserve canonical identity assets and its separate interface.
- **Memory:** consented memory remains owned, bounded, and untrusted context; it cannot affect authorization, approval, or policy.

### Proposed frontend modules (subject to approval)

Keep the current app shell; introduce only narrow modules if the phase plan requires them:

1. `chat-state.js` (or an equivalent module): active conversation ID, generation counters, draft state, and request status, with one authoritative source.
2. `chat-api.js`: typed/validated wrappers around existing and approved new endpoints; does not decide authorization.
3. `chat-renderer.js`: safe transcript/Markdown renderer and message action binding.
4. `chat-composer.js`: input, draft, attachment menu, research setting, and send/stop state; no backend policy.

Do not create all four automatically. Prefer extending `app.js`/`chat-presentation.js` if that is simpler and clear.

## 7. AI capability behavior

### Provider/model

- Accurate default label: Local Demo is deterministic and is not an AI model.
- Until the authenticated atomic fence is implemented, present protected AI generation as unavailable rather than routing around the gate.
- Provider selection must use server allowlists and current authorization, and must fail closed with no silent paid-provider or alternate-provider fallback.
- Display configuration/readiness separately from real request outcome. `NOT_CHECKED` must never be shown as “connected.”

### Context and memory

- Show which context class is in use (current conversation, selected profile, saved memory if consented) and offer a way to clear/reset context where the product and retention contract allow.
- Use only server-owned conversation turns and consented owned memories for authenticated AI context.
- Keep Local Demo history browser-local and do not silently upload or merge it.
- Keep memory untrusted and bounded; do not allow it to control safety, approvals, or provider authorization.

### Error recovery

- Distinguish auth/permission, policy/approval, provider unavailable, provider timeout/rate limit, response withheld, storage failure, and cancellation where the backend safely exposes these states.
- Preserve the draft on failure. Retry must be an explicit new request with duplicate guard and a fresh safety check.
- Never display a stale candidate after navigation, conversation switch, profile switch, logout, denial, or response validation failure.

## 8. Visual direction

- **Canvas:** deep charcoal/near-black, subtle warm glass, restrained copper/amber focus and selection. Avoid neon/cyberpunk gradients and excessive luminous borders.
- **Hierarchy:** strong conversation heading and tiny provider/status context; transcript dominates; controls remain secondary.
- **Spacing:** generous paragraph rhythm and vertical separation, compact metadata, modest radii. Avoid a card per message.
- **Focus:** visible high-contrast rings; no focus removal without replacement.
- **Motion:** minimal, short, optional, and disabled under `prefers-reduced-motion`. Never use animation to imply provider activity that the server did not report.
- **Icons and labels:** pair uncommon icons with accessible names and tooltips; do not rely on color alone for safety states.
- **Identity:** PARMAR remains the speaker/brand in Chat. VOKKI stays optional and visually/capability-distinct.

## 9. Security, privacy, and regression constraints

1. Resolve the real authenticated Chat atomic fence before enabling server Chat; never weaken `RuntimeNoGo`, approvals, external authorization, CSRF, profile ownership, or response safety.
2. Preserve the verified no-go-before-conversation-lookup/create ordering; existing HTTP tests show that a denied authenticated request does not create an empty conversation or consume its quota. If a future approved path is implemented, define and test the behavior for authorization revocation, provider failure, and storage failure after first-message conversation creation.
3. Never render provider/research output as trusted HTML; maintain the current safe text behavior until a hardened renderer is tested.
4. Do not add browser-held API keys or direct browser-to-provider network calls.
5. Do not enable attachments based on `ChatImage` validation alone; verify actual provider support and privacy lifecycle end-to-end.
6. Preserve Local Demo isolation; no hidden cross-device upload.
7. Preserve VOKKI speech's explicit permission/on-device-only contract and no-cloud fallback.
8. Preserve human approval authority; no message action or convenience control can approve an action.
9. Protect conversation management endpoints with trusted account/profile ownership, CSRF, request revalidation, and quota/error handling.
10. Keep AETHER and unrelated application modules unchanged.

## 10. Acceptance criteria

### Functional

- Home remains the default startup destination.
- Chat works only with a real, authorized server path and clearly labels Local Demo.
- New Chat, history loading, search scope, and selection are truthful across profiles/auth transitions.
- User can copy content; any implemented edit/regenerate/delete/archive/rename action changes server/client state coherently and reports failure.
- Research remains opt-in, returns only validated sources, and never shows withheld output as released.
- Provider/model choice (if approved) is server-allowlisted and cannot bypass external authorization or no-go gates.
- Memory is used only with valid consent and authenticated ownership; memory disable/unavailable means no fallback.
- VOKKI shared conversation synchronization and voice release guarantees remain intact.

### Safety / reliability

- No candidate content is exposed before the response-safety release contract permits it.
- Duplicate send, stale response, conversation switch, profile switch, auth invalidation, network interruption, and denied/withheld cases do not leak or append stale text.
- No false stop, streaming, attachment, source, permission, or provider-ready status is shown.
- No XSS through Markdown, code, tables, source metadata, or user content.
- Protected operations remain unavailable when authorization state cannot be revalidated.

### Visual / accessibility

- Screenshot review at minimum: desktop 1440×1000, tablet 768×1024, mobile 390×844, plus short-height/mobile keyboard-open variant.
- No horizontal page overflow; transcript, composer, sidebar drawer, code and tables remain operable.
- Test keyboard-only navigation, focus order/restoration, screen-reader status updates, reduced motion, high zoom, touch targets, and safe areas.
- Verify contrast and semantic heading/list/table/code structure.

## 11. Out of scope for this Phase 1

- Application implementation, database migration, enabling account binding, relaxing no-go controls, adding an identity provider, configuring or testing real provider credentials, enabling uploads, adding external network dependencies, changing AETHER, or changing VOKKI identity assets.
- A definitive choice of streaming policy, attachment retention, projects/folders schema, or edit/regenerate transcript semantics. Those choices require product/security/privacy review before Phase 2 execution.
