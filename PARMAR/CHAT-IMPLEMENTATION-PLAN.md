# PARMAR Chat — Implementation Plan

**Status:** Proposed sequence for approval. This readiness review is documentation-only. No application changes are authorized by it.

## Delivery rule

Implement in small, reviewable increments. Keep the existing backend provider, conversation, research, memory, safety, and VOKKI boundaries. No new UI control is considered complete until its end-to-end route is authorized, tested, and truthful. Do not stage or commit as part of this plan unless separately requested.

## Hard prerequisites and decisions

### P0 — Release-blocking authorization fence

`PARMAR/safety/runtime_no_go.py::require_atomic_authorization_fence()` unconditionally rejects `AUTHENTICATED_CHAT`. Do not bypass it. A security-approved atomic fence must be designed and implemented by the responsible authority before enabling authenticated provider requests. It must bind current server-established session, user, active profile, conversation, action policy, external-provider authorization, and effect in one non-racy decision/effect boundary.

The current `interface/futuristic_app.py` handler checks the no-go fence before conversation creation/lookup. Contract tests confirm denied requests do not call the Chat service or create an owned conversation. Preserve this invariant; the audit found no current ordering defect.

**Exact implementation gap:** `require_atomic_authorization_fence()` has no allowed-operation implementation; it raises `RuntimeNoGo` for every known protected operation. The HTTP handler's trusted-session/profile checks and subsequent `_execution_authorization_check` are separate revalidations, not a shared authorization/effect transaction. The current session/evidence, identity/profile, approval, memory, conversation/message, and audit data use separate stores; no common transaction or linearizable coordinator covers those facts and the protected local write. External provider/search dispatch additionally needs a reviewed downstream fencing or idempotency contract, with explicit in-flight, cancellation, retry, and reconciliation semantics. A second check before an effect does not close the check-to-effect race.

**Approval evidence:** the repository's [consolidated approval packet](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md) records SEC-07 as **BLOCKED** for Security and Operations and states that no fence design or execution evidence has been submitted for approval. The [shared-authority migration design](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md) is explicitly a proposal, not an implementation or demonstrated guarantee. No product, privacy, security, or operations approval to clear the Chat no-go is evidenced here. Account-binding approval or a UI change cannot substitute for a Chat-specific protected-effect approval.

**Required approvals and decisions (none are evidenced as granted by the audited repository):**

| Gate owner | Required decision before implementation | Evidence required to pass |
|---|---|---|
| Security / authorization authority | Approve the threat model and atomic authorization/effect boundary, including the trusted session and identity source, active-profile and conversation ownership, request/action policy, approval outcome, provider egress authorization, revocation/concurrency semantics, and which state changes are authorized. Define fail-closed behavior for unavailable or stale authorization. | Written design/security approval plus tests proving allowed operations and denial under stale/revoked session, profile switch, ownership mismatch, policy denial, approval required/denied, provider denial, and storage failure. Denials must result in zero provider calls, writes, or other protected effects. |
| Product owner | Approve first-release provider/model choices and cost/free-policy behavior; user-facing unavailable/configuration/authorization states; whether Local Demo remains; and the scope/semantics of edit, regenerate, history management, streaming, and VOKKI integration. | A recorded product decision for each feature enabled in the release; no UI control without a corresponding supported behavior. |
| Privacy / data-governance owner | Approve data categories sent to external providers/research, consent and opt-out language, memory scope/use, attachment data handling if in scope, retention/deletion including backups/audit data, and user-facing disclosure. | A data-flow/retention decision and approved consent wording for each external or persisted data path. |
| Operations / provider owner (when external providers are enabled) | Approve provider allowlist, server-side credential management, pricing/budget/rate limits, availability/readiness semantics, monitoring, and incident handling. | Deployment configuration and operational controls verified without exposing credentials; configured, authorized, reachable, and successful are reported distinctly. |

These are role-based prerequisites, not claims that approvals already exist. The repository contains the unconditional no-go but no approval artifact that permits removing it.

**Gate:** Keep the current no-go until the security prerequisite is approved and implemented. An implementation must prove the allowed path and fail-closed cases above, retain the existing pre-conversation no-go ordering, and show zero writes/provider invocations for denied requests. Product/privacy/operations approvals are additional feature-specific gates. Do not enable authenticated generation on the basis of UI work or provider configuration alone.

### Dependency map and work allowed before the fence

- **Stage 0 → Stage 1:** establish the regression baseline and obtain the security design approval before implementing the protected execution boundary.
- **Stage 2 (Chat shell):** may be developed after Stage 0 and product approval, in parallel with Stage 1, only for navigation/presentation and truthful unavailable/Local Demo states. It must not expose authenticated generation, memory, provider selection, or other protected actions.
- **Stage 3 (renderer):** depends on the authoritative response/release contract and a reviewed parser/sanitizer decision. It must not render unvalidated candidate output as released.
- **Stage 4 (history mutations) and Stages 5, 7, 8 (provider, research, memory):** depend on the approved authorization fence; additionally require the product/provider or privacy decisions described above.
- **Stage 6 (streaming/cancellation):** optional; depends on Stage 1 plus explicit safety approval of incremental release and demonstrated backend/provider cancellation semantics.
- **Stage 9 (attachments):** optional and independent of UI-shell work; requires its own privacy/security/data-retention approval and complete validated upload-to-provider path before any control is exposed.
- **Stage 10:** closes integration/regression after the chosen features are complete; it does not waive any earlier gate.

### Product decisions before related features

1. Does editing a user message create a new branch/new conversation or mutate prior history?
2. Does regeneration retain prior assistant output, supersede it, or create a new version?
3. What is the retention/deletion meaning for messages, research metadata, audit records, and backups?
4. Are projects/folders in scope for the first release? If yes, what owner/profile scope and migration model?
5. Are image/document attachments required in the first release? Define supported MIME types, byte/pixel/page limits, retention, deletion, malware/content checks, provider transfer disclosure/consent, and local/offline behavior.
6. Is true streaming required? If so, define how provider output can be incrementally assessed without exposing unvalidated content or misrepresenting provisional output as released.
7. Should VOKKI voice remain in its separate workspace? The recommended default is preserve the current separation.
8. Which provider/model options are product-authorized for the UI, and what UX should be shown for no-go, not configured, not authorized, rate-limited, or reachability unknown?

## Ordered implementation sequence

### 0. Baseline and behavioral contract

**Reuse:** `CHAT-CURRENT-STATE-AUDIT.md`, existing test suites and contracts.
**Tasks:**

- Confirm branch/worktree status and preserve unrelated changes.
- Keep exact baseline commands/results: 293 focused Python Chat/backend tests, 33 UI-state tests, and 97 Chat/VOKKI JavaScript tests from the audit. The readiness recheck separately ran UI-state plus conversation HTTP tests: 65 passed.
- Add characterization tests only where behavior is currently ambiguous and relevant to a planned change; do not rewrite tests to fit a visual redesign.
- Record current `RuntimeNoGo` behavior and preserve the invariant that authenticated requests are denied before conversation lookup/creation or provider invocation.

**Acceptance:** the three recorded baseline commands pass with 293 + 33 + 97 tests; the no-go contract test confirms a 503, zero Chat-service calls, and no new owned conversation; the worktree remains free of unrelated/destructive edits.

**Exit:** baseline evidence is recorded, ambiguities are characterized, and product decisions required by the next stage are identified. This stage does not authorize application behavior changes.

### 1. Safe authenticated Chat execution boundary (P0 dependency)

**Reuse:** `safety/runtime_no_go.py`, `interface/futuristic_app.py` revalidation helpers, `chat/service.py`, existing auth/profile/session/approval types.
**Tasks:** obtain security approval for the atomic authorization/effect design; write adversarial API tests before implementation; implement only after approval. Preserve the existing no-go-before-conversation ordering. No front-end path may claim this step by sending a different provider field.

**Acceptance tests (each must pass; any denial must have zero effect):**

- valid owner/profile can send only after all checks;
- no owner/profile/session mismatch can read, write, or infer another user's conversation;
- session revocation and active-profile change between authorization and effect deny with no provider call or persistence;
- approval-required, approval-denied, policy-blocked, and provider-unauthorized requests never call the provider;
- no conversation/message creation or quota consumption on denied/failed preflight;
- CSRF and same-origin protections remain enforced;
- memory and research protected operations are gated under the same authoritative contract.

**Exit:** written security sign-off and all acceptance cases pass, including assertions for provider call count and persisted state. Until then, keep authenticated Chat unavailable and do not implement a bypass or success-shaped fallback.

### 2. Chat shell and responsive interaction foundation

**Reuse:** `index.html` Chat section, `app.js` navigation and state, existing global sidebar/history controls, current `styles.css` tokens and layout.
**Tasks:**

- Introduce the proposed history rail/drawer with no duplicate state owner.
- Add explicit new-chat/history toggle controls and preserve draft on in-session navigation.
- Replace/organize only Chat-specific CSS; do not rewrite unrelated modules or global product navigation.
- Add Chat-specific Playwright routes/fixtures that use test doubles only in tests and never present them as production data.

**Acceptance:** empty and long history; search match/no-match; load failure/retry; no duplicate state owner; zero horizontal overflow at 1440×1000, 768×1024, and 390×844; keyboard-open and short-height layouts; keyboard-only navigation, 200% zoom, and reduced-motion behavior all pass.

**Exit:** screenshot acceptance and functional accessibility checks pass at specified viewports.

### 3. Message renderer and reading experience

**Reuse:** current DOM renderer, release contract, research source renderer, safe response and stored-history sanitizers.

**Tasks:**

- Retain plain text until a safe renderer choice is reviewed.
- If Markdown is approved, pin/bundle vetted parser and sanitizer locally; disable raw HTML by default.
- Add semantic fenced code and tables, safe external link policy, and message actions only when backed by real behavior.
- Keep trusted PARMAR safety/approval/research status in application-owned DOM, visually distinct from model-authored content.
- Make progressive reveal optional and describe it as reveal, never stream.

**Acceptance:** XSS/HTML injection and unsafe-link cases are rejected/safely rendered; malformed/long Markdown and mobile tables remain usable; copy/export matches the released text exactly; semantic/accessibility checks pass; withheld/unreleased content is never rendered as an assistant answer.

**Exit:** parser/sanitizer security review plus visual and accessibility acceptance.

### 4. Conversation APIs and history management

**Reuse:** `conversations.py` repository protocols, SQLite implementation, server ownership/profile scope, existing GET routes, CSRF and revalidation helpers.

**Tasks:**

- Decide whether to add server-side history search/pagination or clearly scope filtering to loaded results.
- Add rename/archive/delete endpoints only after product retention/undo rules and owner/profile contracts are approved.
- Expose repository delete only through a protected HTTP route with strict verb/payload validation; repository method alone is not a feature.
- Define local-demo semantics separately; do not upload browser-local history.
- Ensure title generation, truncation, secrets redaction, quota checks, and deletion outcomes stay truthful.

**Acceptance:** same-owner operations pass; cross-owner/profile, invalid payload, CSRF, stale-session, quota, and storage-failure cases fail closed; pagination/archive/deletion semantics match the approved contract; Local Demo data never syncs.

**Exit:** API contract and migration/recovery review complete.

### 5. Provider/model state and truthful availability

**Reuse:** `chat/providers.py`, `chat/router.py`, `chat/readiness.py`, `chat/orchestration.py`, existing Settings inventory and API security boundaries.

**Tasks:**

- Do not add client provider switching until authenticated Chat fence step passes.
- Decide whether model selection is an explicit per-request preference or a server-controlled configuration; keep credentials server-side.
- Populate choices from a narrow server allowlist and current authorization outcome. Keep configured, authorized, eligible, and reachable as separate states.
- Preserve no-fallback behavior; make failure recovery explicit.
- Distinguish deterministic Local Demo from conversational model in composer and response state.

**Acceptance:** unknown IDs, incomplete configuration, unauthorized provider, paid/unknown-pricing policy, timeout/auth/rate-limit/malformed response, and stale selection are handled truthfully; no silent fallback occurs; inventory never implies reachability.

**Exit:** product/provider policy approval and end-to-end authorization tests.

### 6. Streaming and cancellation (only if approved)

**Reuse:** current request-generation invalidation and server provider/service layers; do not retrofit the CSS reveal as transport.

**Tasks:**

- Specify event protocol, request IDs, backpressure, disconnect behavior, provider cancellation, final result contract, and retry semantics.
- Obtain safety approval for incremental validation. Until then, stream only transport progress and keep answer content buffered until response-safety release.
- Add true stop only after end-to-end cancellation can be verified; otherwise retain single request and no stop button.

**Acceptance:** disconnect before/during/after provider work, duplicate stop, reconnect, late chunk, profile switch, revocation, partial provider failure, withheld final response, and unconfirmed cancellation never expose an unvalidated answer or claim a cancellation that did not occur.

**Exit:** no unvalidated candidate is displayed as final/released; cancellation state is backed by server evidence.

### 7. Research integration and citation presentation

**Reuse:** `research/`, `chat-presentation.js`, existing explicit checkbox, validated source contract.

**Tasks:**

- Keep research opt-in and configured provider only.
- Present success/unavailable/failed/blocked/no-results distinctly.
- Add inline citation mapping only if actual provider results map to answer claims and are validated; otherwise retain clearly labeled source list.
- Keep sources hidden for withheld response and avoid claims of source verification beyond contract checks.

**Acceptance:** external research runs only after explicit opt-in and authorization; absent/failed providers, invalid/duplicate/malicious sources, sensitive URL parameters, and withheld responses are represented safely; history restore does not rerun search; links are safe.

**Exit:** no unconfigured or unapproved search execution; sources are truthful and secure.

### 8. Memory and context controls

**Reuse:** `memories.py`, `chat/context.py` sanitizers, existing consent UI and authenticated-memory disclosure.

**Tasks:**

- Only after the protected operation fence works, expose context/memory use with explicit scope and opt-out.
- Preserve server ownership, explicit consent, bounded retrieval, untrusted status, no browser fallback on server failure, and no Local Demo upload.
- Make per-conversation context visible/clearable according to approved retention semantics.

**Acceptance:** absent/revoked consent, disabled memory, storage failure, identity/profile mismatch, secret-like values, prompt injection in memory, stale conversation context, and Local Demo requests are tested; memory cannot alter approval/policy decisions or fall back to browser data.

**Exit:** privacy/security review confirms user-visible promise matches server storage and provider egress.

### 9. Attachments (separate approval gate)

**Reuse:** `ChatImage` validation only if expanded through full API; no implication that current helper is complete.

**Tasks:** separately define images vs documents; implement browser selection/preview/removal, server validation, dimensions/page and decompression limits, malware/content scanning if required, ownership/retention/deletion, per-provider modality support, explicit external-transfer disclosure/consent, and audit/error paths. Keep controls absent/disabled until end-to-end.

**Acceptance:** MIME spoof/signature mismatch, invalid encoding, per-item/aggregate size limits, malformed/decompression-bomb inputs, unsupported providers, interrupted/retried/deleted uploads, owner isolation, denied egress, revoked consent, and absence of hidden uploads are tested.

**Exit:** no attached content reaches a provider without explicit, current authorization and verified capability.

### 10. VOKKI and full regression closure

**Reuse:** `voki-interface.js`, `voki-speech.js`, VOKKI event contract, existing canonical identity and voice tests.

**Tasks:** keep VOKKI identity and workspace distinct; preserve only shared conversation APIs/events; add cross-workspace tests for active conversation/draft/lifecycle and verify voice output still follows released response state.

**Acceptance:** the three baseline groups pass (293 + 33 + 97); account/profile ownership, approval/memory/research, Local Demo isolation, and AETHER navigation/smoke regressions pass; screenshots are inspected at 1440×1000, 768×1024, and 390×844 plus keyboard-open/short-height states. Re-run the affected acceptance checks after every material fix.

**Exit:** all relevant suites pass, screenshots reviewed at 1440×1000, 768×1024, and 390×844 plus keyboard-open/short-height layout, with test evidence and remaining limits reported.

## Cross-cutting acceptance checklist

- [ ] Home remains default startup.
- [ ] No changes to account binding policy, security gates, or human approval authority.
- [ ] No provider secret leaves the server.
- [ ] No false provider-ready/reachability, streaming, cancellation, upload, document, or memory claim.
- [ ] Authenticated and Local Demo persistence remain explicitly distinct.
- [ ] All new endpoints are owner/profile scoped, CSRF checked, payload-validated, quota-checked, and fail closed.
- [ ] Candidate content is not rendered as released before authoritative response validation.
- [ ] Chat/VOKKI sharing remains a single underlying conversation state and does not duplicate transcripts.
- [ ] AETHER and unrelated modules unchanged.
- [ ] Desktop, tablet, mobile, keyboard, accessibility, and screenshot evidence attached to release review.

## Release posture

Until Step 1 receives approval and passes, the redesign may improve navigation/presentation only if it preserves explicit Local Demo status and does not suggest that authenticated model generation is available. Model selection, live authenticated Chat, authenticated memory use in Chat, provider streaming, and protected history mutations remain blocked dependencies.

## Readiness decision

- **Stage 0 (baseline and behavioral contract): GO** for verification/characterization work. The historical baseline is documented; the readiness recheck passed 65 UI-state and conversation-HTTP tests. Re-run the complete recorded baseline before implementation.
- **Stage 1 (safe authenticated Chat execution boundary): NO-GO.** The runtime fence still unconditionally rejects authenticated Chat, and no security approval artifact for replacing that no-go is present in the repository. Do not begin code that enables protected provider execution until the security decision and evidence in the P0 gate are available.
- **Safe work now:** documentation, test characterization that preserves current denial, and (after product approval) a presentation-only shell that truthfully communicates Local Demo/unavailable states. No protected operations or claims of conversational AI may be introduced.
