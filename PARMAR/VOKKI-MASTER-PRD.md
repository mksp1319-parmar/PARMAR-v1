# VOKKI Master Product Requirements Document

## Complete Product Architecture and Development Roadmap

| Document field | Value |
|---|---|
| Version | 1.0 draft for product, security, and technical review |
| Date | 2026-11-11 |
| Product | VOKKI, within the PARMAR ecosystem |
| Mode | Documentation and planning; no implementation authorized by this document |
| Evidence basis | Available product vision, Parts 8–16 summaries, and current repository inspection |
| Outstanding evidence | Detailed Part 1–7 reports are not present in the repository/session evidence. The final source-and-test-inventory Part 13 report is [VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md](./VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md); production verification and test execution remain outstanding. |
| Parallel development | [PARALLEL-DEVELOPMENT-MASTER-PLAN.md](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md) coordinates the active AETHER and VOKKI tracks under PARMAR Core governance. |

> **Decision status:** The user supplied and confirmed the approved D-01–D-13 product directions, plus **Dedicated Workspace + PARMAR-wide Presence**, on 2026-11-11. Their exact wording is reconciled in §11. Task 23 documentation integration was verified against this request. This confirms documentation traceability only; it does not imply a separate acceptance artifact, implementation, technical/vendor selection, production security acceptance, or release approval. Numeric budgets remain proposals until the relevant product/platform owners approve measurement criteria.

## 1. Executive product vision

VOKKI is PARMAR's primary human-facing digital intelligence interface: a capable, context-aware assistant people can see, hear, speak with, and work alongside. Its long-term experience combines professional and natural interaction, a consistent photorealistic digital-human identity, expressive but clearly AI-generated behavior, voice and text, proactive assistance, workspace capabilities, and real task execution.

VOKKI is not a generic chatbot, decorative avatar, voice-only assistant, simple dashboard, or uncontrolled autonomous agent. Its visual and conversational presentation must never imply that it is a real person, conscious, or experiencing genuine emotions. It must not claim actions, observations, memory, or access it does not have.

### Product boundary and non-negotiable invariants

1. **PARMAR Core is the independent governance authority.** PARMAR owns request analysis, policy, permissions, model coordination, independent checks, approval decisions, action authorization, result verification, and authoritative audit.
2. **VOKKI is the product/interface layer.** It captures user intent with consent, shows the real PARMAR state, and presents only PARMAR-released results.
3. **No bypass paths.** Provider output, memory, research, plugins, documents, device context, or connector output is untrusted input. None can modify PARMAR policy or grant approval.
4. **Approval is not execution.** A user decision authorizes only the exact, bounded action identified in a server-side approval record. The system must separately execute, verify, and report any action. Approval alone never means the action succeeded.
5. **Explicit data boundaries.** Users can understand what remains local, what is stored, what is transmitted to a provider, and how to stop, review, export, or delete it.
6. **Capability honesty.** UI, platform claims, and readiness states must distinguish implemented, configured, reachable, authorized, and verified. A control or metadata record is not proof of working functionality.
7. **AETHER is separate.** AETHER is not a VOKKI dependency, browser integration, or source of VOKKI permissions/data. Preserve its work and keep `REMOTE_BROWSING_ENABLED=false` until independent security gates and authorization pass.

### Confirmed product architecture decision — Dedicated Workspace + PARMAR-wide Presence

**Decision source:** explicit user direction in the PARMAR implementation request, 2026-11-11. **Status:** approved product direction; technical implementation and release gates remain separate.

- VOKKI is a standalone PARMAR product with a dedicated workspace and a permanent entry in PARMAR's primary navigation.
- VOKKI presence is discoverable across PARMAR sections, including Home, Chat, Research, Memory, and the PARMAR AETHER surface. Presence is an entry/presentation surface; it does not mean hidden listening, background execution, or an always-on provider connection.
- VOKKI has its own product/persona identity, voice, intelligence, memory, and interaction state. This does not decide the authentication principal, account provider, tenant model, memory retention, voice mode, model/provider, or technical service ownership; those remain governed by their applicable decisions and gates.
- Full-screen and floating presence are product directions where the platform supports them. Unsupported platforms must expose the limitation honestly; floating presence must not bypass PARMAR authorization, user activation, or accessibility/security gates.
- VOKKI may optionally integrate with AETHER, but neither product depends on the other. AETHER remains an independent browser, and VOKKI must not be implemented as an AETHER module. Optional integration requires a separately approved contract.
- AETHER desktop and Android remain independently engineered; Android retains its offline/local-only contract. VOKKI presence inside the PARMAR AETHER surface is not permission to add VOKKI services, network access, or dependencies to the standalone AETHER applications.

The user supplied the exact approved D-01–D-13 directions on 2026-11-11.
Section 11 maps each direction to the draft register and records the
remaining implementation-specific questions and safe gates. Task 23
documentation integration was verified in this review against the approved
directions and this PRD; no separate repository acceptance artifact was found.
This verifies documentation traceability only. Product approval does not
select vendors/models or waive technical, privacy, security, runtime, or
release gates.

### Product outcomes

- Users can converse by text and, where supported and explicitly enabled, voice.
- Users can select a stable VOKKI identity and configure approved appearance/presentation choices without changing personality, voice, or memory.
- PARMAR governance is visible and understandable; users know when the system is listening, processing, waiting for approval, unable to verify, or finished.
- Users can enter the dedicated VOKKI workspace from the primary navigation and discover VOKKI presence from PARMAR sections without creating an AETHER dependency.
- Automatic memory is an approved product direction, subject to explicit memory controls, user review/edit/delete/export/reset, valid authorization and consent; it does not authorize model training.
- Research, files, tools, and connectors extend usefulness without weakening policy or approval boundaries.
- Platform support is stated feature-by-feature and backed by platform-specific acceptance evidence.

## 2. Evidence, terminology, and current baseline

### Status labels

- **IMPLEMENTED:** repository source implements the behavior; runtime acceptance is still a separate question.
- **PARTIAL:** some behavior exists but does not meet the full product requirement or lacks acceptance evidence.
- **SIMULATED:** deterministic/fake behavior that does not access the purported live capability.
- **DOCUMENTED ONLY:** requirements or design are documented but product implementation is absent.
- **MISSING:** no implementation evidence found.
- **UNVERIFIED:** implementation or documentation exists but the claimed runtime/platform outcome has not been established.

Readiness classifications used in this document:

- **APPROVED REQUIREMENT:** a non-negotiable product/security principle from the supplied vision; not equivalent to approval of its implementation.
- **NEEDS USER DECISION:** a material product/privacy/platform choice remains open.
- **NEEDS TECHNICAL EVALUATION:** an evidence-producing proof of concept or engineering analysis is needed.
- **BLOCKED BY DEPENDENCY:** cannot be implemented safely or accepted until a prerequisite is complete.
- **OUT OF INITIAL RELEASE SCOPE:** reserved for a later phase unless separately approved.

### Repository evidence snapshot

The current checkout is `main` at `69527f6b39d0521746eb91cd96b5fa44fc48348c`, with a clean worktree before authoring this document. Current evidence includes:

- A web VOKKI surface in [interface/static/index.html](./interface/static/index.html) and its browser controller [interface/static/voki-interface.js](./interface/static/voki-interface.js).
- A dedicated VOKKI workspace, permanent primary-navigation entry, and PARMAR-wide floating workspace launcher are product requirements. The launcher reports only the PARMAR lifecycle state already received by the VOKKI interface; it does not initiate a request or access audio/video. This implementation is source-level evidence, not accessibility or runtime acceptance.
- PARMAR request handling, provider routing, response safety, sessions, approvals, and persistence in [chat/](./chat/), [interface/futuristic_app.py](./interface/futuristic_app.py), [conversations.py](./conversations.py), [memories.py](./memories.py), [sessions.py](./sessions.py), and [interface/approvals.py](./interface/approvals.py).
- A static default portrait and CSS presence treatment, not a 3D/photorealistic renderer: [interface/static/voki-avatar.js](./interface/static/voki-avatar.js), [interface/static/assets/voki/default-avatar.png](./interface/static/assets/voki/default-avatar.png), [interface/static/styles.css](./interface/static/styles.css).
- Browser-based speech adapters and an optional session-scoped, local camera still flow: [interface/static/voki-speech.js](./interface/static/voki-speech.js), [interface/static/voki-identity.js](./interface/static/voki-identity.js).
- A deterministic Local Demo default and configured-provider adapters, documented in [README.md](./README.md). Local Demo is not a conversational model; provider adapters in source do not demonstrate configured credentials or reachable production inference.
- Android VOKKI information only and an iOS status document that says NOT STARTED: [android/app/src/main/kotlin/org/parmar/aether/ui/ParmarVokkiScreen.kt](./android/app/src/main/kotlin/org/parmar/aether/ui/ParmarVokkiScreen.kt), [ios/IMPLEMENTATION-AND-VERIFICATION.md](./ios/IMPLEMENTATION-AND-VERIFICATION.md).
- AETHER desktop/Android work, distinct from VOKKI. Remote browsing is disabled in [desktop/security.cjs](./desktop/security.cjs); see [AETHER-SECURITY-GATES.md](./AETHER-SECURITY-GATES.md).

Parts 1–7 detailed reports were not available as repository artifacts or in the carried-forward evidence. Their broad product vision is represented in the user's supplied requirements and the product vision above; this document does not invent their audit evidence. Parts 8–12 and 14–16 findings are reconciled against current source where referenced. The [Part 13 final report](./VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md) consolidates source inspection and test inventory only; no tests were run and production guarantees remain unverified.

## 3. Complete functional requirements

### 3.1 Identity, onboarding, accounts, and profiles

**Purpose:** establish an understandable, verified user identity and isolate data and authority by user and workspace.

**User-facing behavior**

- Offer transparent onboarding that explains VOKKI's AI identity, capabilities, limitations, data flow, and available controls before sensitive features are used.
- Support sign-in, sign-out, session expiry, account recovery, and a visible account/session state.
- Support one personal profile initially; family/team profiles, shared workspaces, profile switching, and owner/admin/member roles require explicit product approval.
- Never imply development/demo identity is a verified account.

**Functional/technical requirements**

- Identity must be established server-side through an approved production identity provider; the client may not supply a user ID, role, owner, or permission.
- Resolve each request to a server-issued session and identity; bind approvals, memory, conversation, workspace, and audit ownership to that identity and workspace.
- Specify role-based authorization separately from authentication and PARMAR policy.
- Profile switching must invalidate client state and prevent old in-flight responses or local content from crossing profiles.
- Provide account recovery, session revocation, key rotation, and administrator recovery procedures without weakening approval controls.

**Data/security requirements**

- Minimize identity attributes; do not put credentials or session tokens in prompts, client storage, logs, or analytics.
- Define retention/deletion behavior for identity associations, sessions, audit, memories, conversations, files, and local identity references.
- Cross-user and cross-workspace access must be denied by default.

**Failure behavior:** invalid, expired, unavailable, or inconsistent identity fails closed for protected data and action paths. Do not silently downgrade an authenticated user to a different account. Explain reauthentication and recovery.

**Dependencies:** identity-provider selection, account/workspace policy, server deployment model, privacy and retention decisions.

**Candidate acceptance criteria**

- ID-01: every protected operation obtains its principal from trusted server-side identity resolution; client-supplied identity/role changes have no effect.
- ID-02: with two test users and two workspaces, all conversation, memory, file, task, approval, and audit queries return only authorized records; test read, write, update, delete, export, and switching paths.
- ID-03: logout/revocation invalidates the session and all pending approvals bound to it; stale browser state is cleared and delayed responses cannot populate the next profile.
- ID-04: recovery scenarios are documented, threat-reviewed, exercised, and do not disclose whether unrelated users/accounts exist.

**Platform scope:** web first; each native client must use platform-secure session storage and undergo equivalent identity/isolation acceptance. **Status:** PARTIAL; production identity and account recovery are missing. **Readiness:** NEEDS USER DECISION / BLOCKED BY DEPENDENCY.

### 3.2 Digital-human identity and rendering

**Purpose:** provide a consistent, premium, realistic VOKKI presence that remains clearly an AI.

**User-facing behavior**

- Preserve one canonical default VOKKI identity. Optional variants and adjustable traits must not randomly change voice, personality, or memory.
- Provide an explicit **Reset to canonical VOKKI** action. Reset restores the preserved default identity and its default appearance settings without deleting user data, changing voice/personality/memory, or changing the active PARMAR session. The default identity cannot be overwritten by a user-selected variant.
- Preserve three visual-quality directions in the long-term vision: high-quality 3D human, photorealistic digital human (the premium target), and cinematic human-quality rendering. These are vision requirements, not a decision to implement or ship all three tiers; the selectable tiers, order, renderer, and platform/device coverage require technical evaluation and user approval.
- Support full-screen App Mode and functional Floating Mode where the platform allows it. Floating Mode provides quick access to chat and supported voice controls, can expand into full-screen App Mode, and preserves identity, preferences, and conversation context. Unsupported platform/background behavior must not be promised.
- Use realistic eyes, skin, gaze, blink, face, lip, head, upper-body, and hand motion; expressions reflect interaction context, remain subtle, and have a user-adjustable intensity.
- Clearly disclose AI-generated presence and expressions; never claim genuine emotion or human identity.
- Provide full user-controlled environment and appearance customization as an approved product direction: plain walls and built-in premium backgrounds; user-uploaded backgrounds; background positioning/cropping; wall and wall-panel styles; subtle LED lighting and lighting intensity; background and lighting colors; professional/casual outfits; and face close-up, head-and-shoulders, waist-up, and full-body framing. Each control and uploaded asset remains subject to rights, safety, consent, storage, and platform gates. Situation-based outfit suggestions remain separately gated, user-controlled and dismissible; they never automatically change clothing. The environment remains subordinate to VOKKI.
- Provide graceful static/low-quality rendering fallback and user-controlled reduced motion.

**Technical requirements**

- Separate canonical identity/configuration, asset delivery, rendering, animation rigs, expression controller, camera/framing, and platform-specific renderer adapters.
- Version and validate assets, define loading/error fallbacks, and record asset provenance/license/redistribution rights.
- For uploaded backgrounds, define supported formats, size/dimension limits, storage/retention, malware/content handling, and whether images remain local or are uploaded; do not transmit them to a provider without separate disclosure and consent.
- Derive expressions from explicit PARMAR/UI interaction state and approved intent signals, not unreviewed claims of emotion.
- Device-adaptive quality must use a declared profile and allow user override; no silent degradation that changes identity.

**Data/security requirements:** user appearance selections are explicit preferences; avoid sensitive biometric inference. Camera reference data is a separate feature and must not silently alter canonical identity or be sent to a provider.

**Failure behavior:** missing/unsupported GPU, failed asset, renderer crash, thermal/battery constraint, or reduced-motion preference falls back to a safe static presentation with truthful status; core chat and PARMAR controls remain usable.

**Dependencies:** product-approved quality tier, hardware matrix, identity/art direction, asset licensing, animation/voice contracts.

**Candidate acceptance criteria**

- DH-01: selected identity hash/preset remains identical across supported screen sizes, app/floating modes, and profile/device restoration.
- DH-01a: reset restores the immutable canonical identity/default appearance on every supported client and does not change account, conversation, voice, personality, or memory.
- DH-01b: for every approved environment control, saved settings restore consistently; an uploaded asset passes the approved type/size checks and is not transmitted or retained outside its declared scope.
- DH-02: exercise all defined lifecycle states and expression transitions; no transition invents lifecycle/approval state or persists a false emotional claim.
- DH-03: reduced-motion mode disables nonessential animation; static fallback preserves complete controls and readable state.
- DH-04: measure startup, frame time, memory, GPU, and battery on approved low/medium/high reference devices; approve specific thresholds before release.
- DH-05: each shipped asset has recorded provenance, license, permitted commercial use, and redistribution approval.
- DH-06: before renderer selection or a quality-tier claim, compare the high-quality 3D, photorealistic, and cinematic directions on the approved device/platform matrix; record visual quality, accessibility/fallback, performance, licensing, cost, and hardware evidence. The user approves which tier(s), if any, are selected. No renderer or tier is preselected by this requirement.
- DH-07: if situation-based outfit suggestions are approved, each suggestion explains its context, requires user selection before applying, can be dismissed/disabled, and cannot alter identity, voice, personality, or memory.
- DH-08: on every platform claiming Floating Mode, verify functional chat and supported voice quick access, expansion to App Mode, preserved active conversation/identity/settings across transitions, and keyboard, screen-reader, focus, reduced-motion, and permission behavior. If platform restrictions prevent a requirement, the feature is unavailable there and the limitation is disclosed.

**Platform scope:** web renderer first; native rendering adapter per approved platform. **Status:** MISSING beyond static image/CSS states. **Readiness:** NEEDS TECHNICAL EVALUATION; advanced rendering OUT OF INITIAL RELEASE SCOPE unless chosen.

### 3.3 Voice, speech, presence, and interaction

**Purpose:** enable accessible, natural text/voice interaction with explicit control and truthful capture state.

**User-facing behavior**

- Offer text as a full alternative. Voice input is push-to-talk initially unless user approves a wake-word/continuous-listening product.
- In supported desktop/mobile environments, Floating Mode remains interactive (not decorative): it offers quick access to chat and supported voice controls and expands to full App Mode without losing active interaction context. Each platform's support and OS restrictions are explicit.
- Show clear permission, listening, processing, speaking, muted, cancelled, and error states. Provide immediate stop/cancel and captions/transcripts.
- Read only PARMAR-released responses aloud. Do not speak approvals, withheld output, hidden content, or unverified action success.
- Provide user-selectable supported voice, language, speed, and pronunciation settings only when the runtime supports them.
- Initial voice direction is multilingual push-to-talk. Wake-word/background listening, additional voice modes, camera-based interaction, and barge-in remain separately consented and platform-qualified; no hidden or background capture is permitted.

**Technical requirements**

- Use independent input recognition, output synthesis, voice selection, transcript policy, and platform permission adapters.
- Define barge-in, turn-taking, partial transcript, timeout, network-loss, and cancellation contracts; propagate cancellation to server/provider work when possible.
- Synchronize speech chunks to viseme/animation events only if a renderer supports it; text boundary events do not prove phoneme synchronization.
- Browser-native APIs must be labeled as browser-dependent and must not be presented as dedicated VOKKI voice infrastructure.

**Data/security requirements**

- Default to no recording retention. Specify separately whether transcript, raw audio, derived transcript, and provider context are retained.
- Raw audio processing and transcript/provider transfer must be disclosed independently. External provider consent must cover transcript and any attached memory/history.
- Show capture indicator throughout actual capture; revoke stream/recognizer on stop, permission revocation, navigation, backgrounding according to policy, logout, and app shutdown.

**Failure behavior:** absent permission, unsupported browser, unavailable local language pack, recognition/synthesis failure, or interruption returns to text interaction and reports the limitation. No hidden cloud fallback.

**Dependencies:** voice/privacy scope, platform API review, approved locales, provider consent, rendering synchronization contract.

**Candidate acceptance criteria**

- VO-01: microphone acquisition only follows explicit user activation and OS/browser permission; visible status appears before/with capture and remains until confirmed stopped.
- VO-02: on cancellation, navigation, logout, or permission revoke, all media tracks/recognizer resources stop within a product-approved deadline; tests verify actual device indicator release.
- VO-03: no raw audio is transmitted or stored unless a separately approved consent flow says so; inspect network and storage under each supported voice mode.
- VO-04: only responses satisfying PARMAR's authoritative release contract may enter synthesis.
- VO-05: test interruption, silence, partial transcript, language mismatch, offline state, timeout, and screen-reader/caption alternatives on each claimed platform.
- VO-06: on each platform claiming Floating Mode, verify functional chat/voice access, expansion to App Mode, preservation of identity/preferences/conversation context, and accessible keyboard/focus/screen-reader/reduced-motion behavior. No floating or background behavior is claimed where the OS does not support it.
- VO-07: wake-word or background listening remains disabled unless separately approved; verify explicit opt-in, permission, persistent activation/listening indication, immediate user-controlled deactivation, stop behavior on permission/lifecycle changes, and no capture while disabled on every supported platform.

**Platform scope:** browser-specific voice on web; Android/iOS native support only after separate permission and device acceptance. **Status:** PARTIAL. **Readiness:** multilingual push-to-talk is the approved initial direction; implementation requires privacy review and per-platform acceptance. Wake-word/background listening remains separately gated.

### 3.4 AI providers and intelligent orchestration

**Purpose:** provide useful intelligence without allowing model choice or output to bypass PARMAR.

**User-facing behavior**

- Distinguish Local Demo from model inference. Show selected provider/configuration and whether it is reachable only if actually checked.
- Offer Guide, Execute, and Orchestrate modes only after their authority and action semantics are defined. Mode labels must not imply unimplemented tools.
- Explain uncertainty, provider outage, blocked requests, non-release, limitations, and external data processing.

**Technical requirements**

- Keep a provider-neutral adapter contract for inference, status, cancellation, streaming, context limits, error classes, modality, locality, and cost/usage accounting.
- Keep authorization, task decomposition, tool scope, retries, cost limits, provider selection, and release decisions in PARMAR-controlled services.
- No silent fallback. Any retry/switch must be explicit, bounded, safe for the request, visible to the user, and auditable.
- Treat provider outputs as untrusted; validate structured results against schemas and PARMAR policy before display, persistence, speech, or action.
- Enforce per-provider timeout, request/response size, rate/cost budget, idempotency, concurrency limit, and cancellation propagation.
- Multi-model agreement is corroboration at most, not correctness proof.

**Data/security requirements:** credentials remain server-side in approved secret storage; minimize context and redact sensitive fields; record provider/data-category metadata without retaining secrets or unnecessary user content. Before every external transfer, verify the current user's consent for the provider, purpose, and data categories in that request; configuration-level provider authorization is not user consent.

**Consent revocation behavior:** before transmission, revocation blocks queued/unstarted requests and removes the revoked data from any request that can still be safely rebuilt. For an in-flight request not yet transmitted, cancel it and prevent egress. For a request whose transmission has begun or completed, cancel further processing where possible, disclose the provider and data categories already sent, and do not claim the transmitted data can be recalled or deleted unless the provider's deletion capability and completion are independently verified. Revocation blocks all subsequent requests, retries, and fallback transfers until the user grants consent again.

**Failure behavior:** unavailable/malformed/timeout/rate-limited/provider-policy-denied responses are distinct states; no success-shaped fallback, no uncontrolled retry, and no action based on a partial response.

**Dependencies:** provider/locality decision, user data-consent design, deployment secret store, reliability/cost budgets, PARMAR tool contract.

**Candidate acceptance criteria**

- AI-01: denied, unconfigured, or unauthorized provider makes zero external requests.
- AI-02: every provider request has a recorded request ID, provider/model, context classification, authorization result, duration, and outcome; secrets and raw prompts are excluded unless separately approved.
- AI-03: malformed schema, policy failure, validation timeout, provider exception, or cancellation cannot produce a released or executable output.
- AI-04: configured timeouts and size limits are enforced; retry count, cost cap, and concurrency limit are measurable and approved.
- AI-05: duplicate client retries with the same idempotency key do not produce duplicate side effects.
- AI-06: consent is checked immediately before each external egress. Revocation before transmission prevents the request; revocation during transfer cancels remaining transfer/work where possible and records which data categories were already transmitted without claiming recall or deletion.
- AI-07: after a consent-revocation event is acknowledged, instrumented transport tests show zero subsequent egress for that provider/purpose/data scope across new requests, retries, queues, and fallback paths until fresh consent is recorded. Any request already transmitted is separately disclosed to the user.

**Platform scope:** shared PARMAR backend; clients use the same release/authorization contract. **Status:** PARTIAL, default inference absent. **Readiness:** NEEDS USER DECISION and TECHNICAL EVALUATION.

### 3.5 Memory, personalization, and learning

**Purpose:** preserve useful user-approved context with reviewable control and correct isolation.

**User-facing behavior**

- Automatic memory capture is an approved product direction, but capture/retrieval must remain off until explicit, understandable memory consent is established. Explain what may be saved, why it may be retrieved, and where it is stored.
- Let users view, add, edit, delete individual entries, clear all, export, and decide whether revoking consent also deletes stored records.
- Distinguish conversation history from durable memory and client preferences.
- Automatic capture must provide user review and edit/delete/export/reset controls and visible provenance. Model training or behavioral learning from user data remains disabled unless separately approved.

**Technical requirements**

- Separate consent, memory records, retrieval, provenance, relevance ranking, retention, export/deletion, and provider-context assembly.
- Apply owner/workspace filters at repository boundaries. Retrieval is bounded, deterministic where practical, relevance-tested, and labeled untrusted.
- Record provenance: automatic capture, explicit save, user edit, or imported item; distinguish unreviewed suggestions from user-confirmed memory.
- Define versioning, migration, backups, restore, sync conflicts, and deletion propagation.

**Data/security requirements:** no sensitive categories without specific consent/policy; encrypt storage and backups under an approved key lifecycle; define deletion evidence and limitations.

**Failure behavior:** storage unavailable or consent unknown fails closed for retrieval/write. Do not quietly switch to browser-local or another user's data.

**Dependencies:** production identity, user/workspace model, consent semantics, data lifecycle and sync decisions.

**Candidate acceptance criteria**

- MEM-01: zero memory retrieved or written before consent; revocation blocks subsequent provider-context inclusion immediately.
- MEM-01a: revocation takes effect synchronously for new reads/writes. Requests not yet transmitted with memory must have that context removed; in-flight requests must be cancelled before egress where possible. If data has already been transmitted, the UI must state that it cannot be recalled, identify the provider/data class, and initiate any supported provider-side deletion request. No subsequent request may include the revoked memory.
- MEM-02: two-user/workspace isolation tests cover list, create, retrieve, update, delete, clear, export, and restore.
- MEM-03: delete/clear/export reports exact record counts and explicitly scoped data classes. Proposed policy for owner approval: block access/use immediately, delete active primary records within 24 hours, and expire or cryptographically erase backups/replicas within 35 days. Report the completion state and any provider-side deletion limitation; never represent a deletion request as confirmed deletion.
- MEM-04: relevance evaluation uses a reviewed labeled test set with an approved precision/recall threshold; no claim of “learning” without tested behavior.
- MEM-05: automatically captured candidates, user-reviewed/confirmed memories, explicit saves, edits and imports are distinguishable by provenance; users can review and correct automatic capture.
- MEM-06: revocation tests distinguish unsent, in-flight-before-egress, and already-transmitted context; show the correct stop/disclosure state and make no unsupported provider-deletion claim.

**Platform scope:** shared service with web controls first; local/offline cache only after policy and encryption design. **Status:** PARTIAL. **Readiness:** approved automatic-memory direction; capture remains BLOCKED BY identity, consent, data lifecycle and review-control implementation.

### 3.6 Research and knowledge verification

**Purpose:** gather information with provenance and clearly bounded confidence.

**User-facing behavior**

- Research is opt-in or clearly disclosed if proactive; display source and retrieval status, distinguishing sources from verified claims.
- Show when no sources, stale/contradictory sources, or provider failures prevent a supported answer.
- Never label model-generated synthesis as source-verified without claim-to-source evidence.

**Technical requirements**

- Use a separate research adapter and authorization scope, source normalization, URL safety, freshness and duplicate handling, prompt-injection isolation, claim/citation mapping, and result validation.
- Preserve exact provenance and association to the response; make source content untrusted.
- Define whether search providers fetch snippets only or page content and the resulting privacy/SSRF/retention controls.

**Data/security requirements:** sources and user query are transmitted only under approved search consent; redact secrets; do not fetch arbitrary URLs without SSRF controls and bounded network policy.

**Failure behavior:** invalid source, provider failure, no results, conflicting evidence, or validation failure is explicit; don't fabricate citations or imply completed research.

**Dependencies:** search provider/retention decision, provider-consent framework, claim verification design.

**Candidate acceptance criteria**

- RE-01: every source displayed has a validated HTTPS URL, normalized domain, provider/source identity, retrieval timestamp, and exact response association.
- RE-02: injected instruction text in snippets never changes system policy, permissions, provider routing, or tools.
- RE-03: a claim may be labeled “verified” only if it is decomposed into an auditable factual claim, has a citation to an exact retrieved source span, and a documented evaluator classifies that span as directly supporting the claim. Citation presence alone is insufficient. Unsupported, contradicted, stale, or evaluator-indeterminate claims are labeled accordingly or withheld; evaluator failure fails closed.
- RE-03a: before using the “verified” label, establish a human-reviewed, versioned evaluation set covering supported claim domains and supporting, contradicting, and insufficient evidence. Proposed evaluation target, pending technical and product approval: at least 200 claim/source cases, ≥95% precision for claims labeled verified, and ≥90% recall on supported claims, reported with sample size and confidence intervals. No evaluation result is implied by this requirement.
- RE-04: no result or error state is represented as successful research.

**Platform scope:** shared PARMAR service; web first. **Status:** PARTIAL. **Readiness:** NEEDS TECHNICAL EVALUATION.

### 3.7 Workspace, projects, and documents

**Purpose:** make VOKKI useful alongside user work while preserving ownership and provenance.

**User-facing behavior**

- Provide user-selected projects/workspaces, file/document organization, search, summaries, and task status.
- Show exactly which files/context will be used before sending them to AI or tools.
- Support create/rename/archive/delete, version/history as approved, and accessible navigation.

**Technical requirements**

- Define document adapters, MIME/type allowlists, size/page/token limits, parsing/sandboxing, indexing, access control, version identifiers, and provenance.
- Keep project/workspace ACL enforcement server-side; model outputs cannot broaden access.
- Do not add a generic “read local device” capability; use explicit file selection and platform grants.

**Media-understanding requirements:** document understanding is the baseline workspace direction; image, audio, and video understanding are separate optional capabilities, not implied by file selection, camera/microphone permission, or model capability metadata. Before enabling any media type, define its supported formats and limits, explicit user selection and permission, local versus cloud processing, provider/purpose/data-category disclosure and consent, derived-output and source retention, export/deletion/backup behavior, and PARMAR validation/release path. No media is transferred to a provider merely because a camera, microphone, or file permission exists.

| Media type | Gate and processing requirements | Failure behavior and acceptance evidence |
|---|---|---|
| Documents | Explicit file selection; allowlisted formats/limits; safe parsing; disclose extracted text/metadata and any provider transfer; apply the document data lifecycle. | Reject or quarantine unsupported/corrupt/encrypted/oversized input; verify source/version provenance, parser limits, consent, egress, storage, export, and deletion. |
| Images | Explicit image selection/capture permission for the operation; define image formats/size, local/cloud processing, whether OCR/description is derived, and separate transfer/retention consent. | Unsupported or unsafe images remain unprocessed; verify no unapproved capture/egress, provenance of derived claims, and deletion of image and derivatives. |
| Audio | Separate microphone permission and capture indicator; define live versus uploaded audio, local/cloud recognition/analysis, raw audio versus transcript lifecycle, and provider consent. Speech interaction criteria in §3.3 also apply. | Permission denial or unsupported processing falls back to text; verify capture stop, raw-audio/transcript egress and retention separately, and no hidden cloud fallback. |
| Video | Explicit per-capture permission and visible active indicator; define still/frame sampling, duration/size limits, local/cloud analysis, audio-track handling, and separate lifecycle for source video, frames, and derived output. | Unsupported video remains disabled; verify capture stop, frame/audio boundaries, egress, retention/deletion, and that no continuous monitoring occurs without separate approval. |

Each media capability is independently enabled only after its data, platform, security, and acceptance gates pass. Unsupported types remain disabled and are identified as unsupported rather than silently converted or partially analyzed.

**Data/security requirements:** encryption, retention, malware/untrusted-file treatment, file deletion/backup policy, and sensitive-data minimization.

**Failure behavior:** unsupported, corrupt, too-large, encrypted, or untrusted files are rejected/quarantined with an actionable explanation; no partial analysis represented as complete.

**Dependencies:** identity/workspace decisions, connector contract, file threat model, storage/retention architecture.

**Candidate acceptance criteria**

- WS-01: file processing only uses explicitly selected files and authorized workspace IDs.
- WS-02: test file type/size boundaries, malformed content, prompt injection, cross-workspace access, deletion, and parser timeout/resource caps.
- WS-03: every generated answer identifies source file/version and processing scope where applicable.
- WS-04: for every enabled media type (documents, images, audio, and/or video), separately test permission/selection, supported and rejected inputs, local/cloud processing disclosure, provider consent and zero-egress denial, failure behavior, provenance, source/derivative retention, export, deletion, and backup handling. A passing test for one type does not enable another.

**Platform scope:** web file picker first; native document providers later. **Status:** MISSING as a governed project/document workspace. **Readiness:** NEEDS USER DECISION; broader workspaces OUT OF INITIAL RELEASE SCOPE.

### 3.8 Guide, Execute, and Orchestrate modes

**Purpose:** make assistance level explicit and prevent accidental autonomy.

**User-facing behavior**

- **Guide:** explain, draft, analyze, and suggest; no external side effect.
- **Execute:** perform a user-authorized, narrowly scoped task only through an approved executor, with previews and approval when required.
- **Orchestrate:** coordinate bounded multi-step work with visible task plan/state and PARMAR gates at each consequential boundary.
- Mode changes, capability limits, and required approvals are visible before action.

**Technical requirements**

- Define a task state machine: proposed → policy checked → awaiting approval (if required) → authorized → running → verifying → succeeded/failed/unknown/cancelled.
- Persist action parameters and approval binding server-side; enforce least privilege, step limits, deadlines, idempotency, cancellation, and recovery.
- Separate planning from execution; no model-generated tool call directly invokes an adapter.

**Data/security requirements:** task and approval records are owner/workspace-bound, integrity protected, redacted, and retained per policy.

**Failure behavior:** partial/unknown execution is reported as unknown, never success; retries require idempotency/safe-to-repeat analysis or renewed approval.

**Dependencies:** PARMAR action boundary and executor, connector registry, approval UX, audit, task persistence.

**Candidate acceptance criteria**

- TASK-01: Guide has no side effects; instrumented test executors prove zero calls.
- TASK-02: every Execute/Orchestrate side effect has a PARMAR decision, scoped permission, exact approval binding when required, and auditable executor result.
- TASK-03: cancellation and crash recovery distinguish confirmed stopped from uncertain external outcome.
- TASK-04: repeated approvals, replay, altered parameters, wrong owner, expired task, and provider prompt injection cannot expand authority.

**Platform scope:** PARMAR backend shared; web approval surface first. **Status:** MISSING for general execution. **Readiness:** BLOCKED BY DEPENDENCY.

### 3.9 Tools, plugins, and integrations

**Purpose:** safely extend capabilities through explicit, reviewable connectors.

**User-facing behavior**

- Show installed/available/authorized/active/healthy states separately.
- Explain requested scopes, data accessed, action preview, revocation, and result.
- Users explicitly enable each connector and each elevated scope.

**Technical requirements**

- Distinguish metadata registry from executable adapter. Require signed/versioned manifests, provenance, compatibility review, sandboxing/isolation, permission scopes, secret vault, network policy, timeouts, quotas, revocation, and audit.
- Tool invocation passes through a PARMAR broker; model output is only a proposal.
- Version the connector contract; test permissions and failure behavior independently from provider routing.

**Data/security requirements:** per-connector credentials and least privilege; no secrets to the model; minimize returned content; no cross-user connector state.

**Failure behavior:** unknown, incompatible, revoked, unavailable, or unhealthy connector is denied and clearly reported. Partial side effects are reconciled rather than retried blindly.

**Dependencies:** task/action contract, identity/workspace ACL, secret/key management, threat model.

**Candidate acceptance criteria**

- INT-01: metadata-only records cannot execute; only reviewed adapter implementing the approved contract can be invoked.
- INT-02: each tool call is checked against user, workspace, capability, data scope, PARMAR policy, and approval before execution.
- INT-03: test SSRF, prompt injection, malicious tool output, credential disclosure, replay, timeout, cancellation, and revocation.

**Platform scope:** server-side tool broker; client adapters only for native capabilities. **Status:** metadata/scaffolding partial; real general connectors missing. **Readiness:** BLOCKED BY task/security design.

### 3.10 Device, screen, and application awareness

**Purpose:** provide only explicitly granted, narrowly scoped context from device/application state.

**User-facing behavior**

- Ask separately for microphone, camera, screen/application capture, files, notifications, and device signals.
- Show active capture, scope, destination, stop control, and retention.
- Screen/app awareness is opt-in per session and per capture; no hidden continuous monitoring.

**Technical requirements**

- Use native permission adapters and OS APIs; never interpret a UI toggle as OS permission.
- Scope grants by source, content, duration, purpose, and destination; revoke on logout, session end, and app lifecycle according to product decision.
- Redact sensitive screen regions where feasible; avoid collecting unrelated notifications or background content.

**Data/security requirements:** default no capture/retention; explicit capture and transmission policies; encryption and deletion rules.

**Failure behavior:** permission denied/revoked or API unavailable leaves awareness off and core interaction usable; no fallback to another sensor or hidden polling.

**Dependencies:** platform scope, privacy/legal review, native API and permission review.

**Candidate acceptance criteria**

- DEV-01: each permission can be tested independently for deny, grant, revoke, restart, logout, and background transitions.
- DEV-02: observed network/storage traces prove only explicitly selected content leaves/is retained.
- DEV-03: no user-visible “permission enabled” state unless OS and application state both confirm it.

**Platform scope:** none beyond existing browser camera still until approvals; platform-specific implementation required. **Status:** phone-awareness simulation only; broader capability MISSING. **Readiness:** NEEDS USER DECISION.

### 3.11 Notifications and proactive intelligence

**Purpose:** deliver timely, useful assistance without surprise, surveillance, or coercion.

**User-facing behavior**

- Proactive suggestions are explainable, dismissible, rate-limited, and user-controlled.
- Configure notification channels, quiet hours, do-not-disturb, urgency, and per-source settings.
- Distinguish page-visible speech from OS notifications and background activity.

**Technical requirements**

- Separate event generation, policy/consent checks, schedule, delivery adapter, acknowledgement, deduplication, and audit.
- No notification or proactive action may approve a task or imply it completed.
- Background execution follows OS limits; do not promise unsupported wake or delivery behavior.

**Data/security requirements:** event minimization, permission, delivery-token protection, retention and deletion.

**Failure behavior:** revoked permission or unavailable platform service disables that channel; do not silently substitute audio or another channel.

**Dependencies:** user consent, platform scope, quiet-hours policy, event taxonomy.

**Candidate acceptance criteria**

- NOTIF-01: no proactive channel operates before opt-in; toggles reflect confirmed platform capability and permission.
- NOTIF-02: duplicate event delivery within the approved deduplication window is suppressed; quiet-hours test matrix is deterministic.
- NOTIF-03: notification content is redacted according to lock-screen/privacy settings; no hidden capture occurs.

**Platform scope:** web visible-page behavior only currently; native push/OS notifications require separate design. **Status:** PARTIAL/MISSING. **Readiness:** NEEDS USER DECISION.

### 3.12 Offline and hybrid AI

**Purpose:** provide clear, safe capability under network loss and optionally support local inference.

**User-facing behavior**

- Clearly show online, offline, local, cloud, and queued states.
- Define which features operate offline; do not imply Local Demo is offline AI.
- Never present an unconfirmed external action as completed after network loss.

**Technical requirements**

- Evaluate local AI runtime types separately: an embedded/on-device runtime in the VOKKI process; a local device service/daemon; an operating-system-provided inference service; and a network-reachable service, which must not be described as on-device. Document process and trust boundaries, model/data locality, and required connectivity for each candidate.
- Establish a local model/runtime only after measuring model and runtime size, startup and inference behavior, memory/CPU/GPU/NPU use, battery/thermal impact, and quality on the approved low/mid/high hardware matrix. Record exact device/OS/accelerator, model/version/quantization, runtime/version, workload, and network state.
- Evaluate model-weight and runtime-code licenses separately, including commercial use, redistribution, attribution, modification, and any restrictions on bundling or hosted use. Record who owns model/runtime selection, signing, vulnerability monitoring, patch testing, update distribution, rollback, and end-of-support response; do not assume vendor or community updates provide product coverage.
- Define local/cloud routing, consent, data locality, synchronization, conflict resolution, pending-operation idempotency, and deletion propagation.
- Keep governed action execution disabled when authorization/outcome cannot be confirmed.

**Data/security requirements:** encrypt local cache and queued tasks; scope by profile; handle device loss, backup, and key revocation.

**Failure behavior:** preserve unsent drafts locally only if approved; distinguish not sent, sent/unknown, and completed. Never automatically replay a potentially side-effecting operation without idempotency checks.

**Dependencies:** user offline/sync decision, local runtime evaluation, local key/security design, task lifecycle.

**Candidate acceptance criteria**

- OFF-01: test network loss at each request stage, app restart, duplicate replay, provider timeout, and conflict; UI reports confirmed/unknown outcomes accurately.
- OFF-02: offline mode makes zero external requests and can be verified by network observation.
- OFF-03: sync is identity/workspace scoped and handles revocation/deletion across devices according to approved policy.
- OFF-04: each local-AI candidate has a reproducible device/model/runtime profile, license and distribution review, update owner and rollback procedure; no device-support or offline claim is made outside the tested matrix.

**Platform scope:** none claimed initially; per-platform local model/runtime and storage acceptance required. **Status:** MISSING. **Readiness:** NEEDS USER DECISION / TECHNICAL EVALUATION.

### 3.13 Privacy, security, and user control

**Purpose:** make privacy and security properties explicit, enforceable, and verifiable.

**Functional/technical requirements**

- Production authentication; authorization; user/workspace isolation; session expiry/revocation; CSRF and abuse controls.
- Data inventory and classification; encryption in transit and at rest; secret/key management, rotation, and recovery.
- Consent receipt, access, edit, export, delete, retention, backup/restore, and incident notification processes.
- Provider data-sharing inventory and per-user consent.
- Verified transport security at ingress and egress, including TLS termination and trusted-proxy boundaries, certificate validation, and fail-closed deployment configuration.
- Redacted audit events with decision/action linkage, tamper evidence, retention controls, and access review.
- Emergency pause/stop that halts new tasks and propagates cancellation; safe shutdown and restart recovery.
- Threat model for prompt injection, malicious files, provider/tool outputs, compromised connectors, account takeover, abuse, and denial of service.

**Current source-level security findings**

1. **Production route authorization:** `PARMAR_UI_HOST` can bind beyond loopback; the default resolver is anonymous Local Demo, persistent sessions are optional, and some routes support anonymous requests. Origin checks are not authentication and anonymous POSTs do not require CSRF tokens. Do not expose production user-data/provider/action routes without verified authentication and authorization on every such route. Source: [futuristic_app.py](./interface/futuristic_app.py) lines 71–78, 206–228, 430–474, 658–835, 850–905, 1289–1320, 1636–1665; [identity.py](./identity.py) lines 67–80.
2. **Camera still retention:** changing authenticated session scope clears preview/active UI state and stops capture, but does not delete the persisted IndexedDB record for the old scope. Specify logout/account-deletion cleanup and verify storage removal. Source: [voki-identity.js](./interface/static/voki-identity.js) lines 37–105, 193–220, 272–342, 421–440.
3. **External processing consent:** external provider authorization is server configuration, not per-user consent; enabled provider calls can transmit prompt/context. Require explicit provider/data-category disclosure and consent before transfer. Source: [readiness.py](./chat/readiness.py) lines 274–360; [chat/service.py](./chat/service.py) lines 330–445.
4. **Memory lifecycle:** memory is owner-scoped and consent-gated, but revoking consent does not erase existing records; no complete export/account-deletion, backup expiry, or in-flight/revocation policy is established. Source: [memories.py](./memories.py) lines 455–500, 604–620; [futuristic_app.py](./interface/futuristic_app.py) lines 967–1065.
5. **Encryption and operational audit:** local SQLite file permissions and session/approval integrity tags do not establish encryption at rest. The listener's TLS is optional at this server layer. Local JSONL audit code does not establish tamper-evident audit storage or monitoring. Source: [memories.py](./memories.py) lines 346–395; [sessions.py](./sessions.py) lines 239–297; [futuristic_app.py](./interface/futuristic_app.py) lines 1636–1658; [decision_logs.py](./audit/decision_logs.py) lines 11–100.
6. **Action boundary and emergency stop:** approval continuation resumes provider generation; no general external executor, independent action-result verification, or production global pause was established. Source: [futuristic_app.py](./interface/futuristic_app.py) lines 1150–1288; [service.py](./chat/service.py) lines 271–333; [emergency_gate.py](./safety/emergency_gate.py) lines 1–66.

These are source inspection findings, not exploitation results or runtime test outcomes. See the Part 13 report's finding register for impact, mitigations, test inventory, and evidence limitations.

**Failure behavior:** security control unavailable, malformed configuration, integrity failure, or uncertain authorization fails closed. No silent storage downgrade, no success-shaped fallback, and no uncontrolled recovery.

**Dependencies:** identity/provider/deployment decisions, data inventory, threat model, operational ownership.

**Data-class lifecycle requirements:** before persisting a data class or enabling account closure, assign a named owner and purpose, enumerate primary/local/derived/provider/audit copies, and approve its storage location, access scope, transfer, retention duration/trigger, export format, deletion behavior, backup/replica expiry, legal-hold exception, and evidence of completion. No retention or deletion timeline is assumed by this PRD; unresolved values block the affected persistent capability.

| Data class | Required lifecycle coverage |
|---|---|
| Identity, sessions, and profile associations | Account closure, session revocation, identity association export where applicable, deletion/retention basis, recovery records, and backup expiry. |
| Conversations, transcripts, and research/source metadata | Per-user export, retention/expiry, deletion/cascade behavior, derived summaries and indexes, and backup/replica expiry. |
| Memory and personalization preferences | Consent/revocation, individual and bulk export/deletion, retrieval stop, derived copies, and approved backup expiry; see §3.5. |
| Files, documents, and derived indexes/summaries | Source and derivative inventory, workspace-scoped export, deletion/retention, parser/index caches, and backup expiry. |
| Uploaded and built-in background selections/assets | Distinguish user-uploaded source from built-in licensed assets; define local/server copies, export, deletion, retention, derivative/cached copies, and backups. |
| Camera stills and other captured media | Distinguish raw capture, approved still/frame, transcript, and derived analysis; define local/device/server/provider copies and cleanup on logout, profile switch, expiry, consent revocation, and account closure. |
| Tasks, approvals, action outcomes, and audit records | Define user-visible export, security/audit retention, access controls, legal holds, redaction, deletion/retention authority, and backup expiry without deleting records required by an approved legal/security obligation. |
| Provider-transmitted data | Record provider and data categories sent; define provider retention/deletion terms and user-facing limits. Do not promise recall or deletion without verified provider capability and completion evidence. |

**Account-closure requirements:** authenticate and confirm the request; revoke sessions and pending approvals; stop or mark in-flight tasks and provider transfers according to their actual state; enumerate owned data classes and copies; execute approved deletion/retention rules; propagate eligible deletion to replicas/backups within the still-to-be-approved timelines; and provide a per-class completion report distinguishing deleted, pending, retained under an approved basis, inaccessible, and provider-transmitted/unrecallable data. Clear local caches/media and report any device copy that cannot be remotely removed. A deletion request is not proof of deletion.

**Candidate acceptance criteria**

- SEC-01: a production deployment bound to any non-loopback interface must fail closed unless every exposed route that can access or mutate user data or invoke a provider, tool, or action enforces verified server-side authentication and authorization. A route not covered by the approved route inventory and automated host/configuration matrix must be denied. Public health/static routes, if any, must be explicitly enumerated and incapable of exposing or reaching user-data operations. Development/demo anonymous identity must never be accepted as production authentication.
- SEC-02: verify transport encryption and at-rest encryption independently; document algorithms, key owners, rotation, backup protection, and failure handling.
- SEC-03: security and privacy tests cover cross-user access, CSRF, replay, prompt injection, malformed files, provider/tool output, rate/size abuse, key rotation, deletion, and incident response.
- SEC-04: audit records correlate request → policy → approval → action → verification, omit secrets, and are protected against unauthorized modification.
- SEC-05: emergency stop blocks new work and cancels in-flight cancellable tasks; non-cancellable outcomes are explicitly reported as uncertain.
- SEC-06: before any production or provider-enabled release, document and verify the ingress path, TLS termination point, certificate lifecycle/validation, and every trusted reverse proxy/hop. Ignore forwarded identity/scheme/client-address headers unless supplied by an explicitly trusted proxy over an authenticated boundary; reject spoofed or malformed forwarded headers. Provider egress must use authenticated TLS with certificate and hostname validation; invalid, expired, or unverifiable certificates fail closed with zero request-body egress. Deployment configuration must fail closed if required TLS/proxy/egress controls or their approved inventories are absent. Record deployment/network evidence; configuration or source alone is not proof of deployment.
- SEC-07: for every enabled persistent data class, test an owner-scoped inventory, representative export, deletion or approved retention outcome, derived/local-copy handling, backup/replica expiry handling, and account-closure result. Evidence reports per-class record counts and states (deleted, pending, retained under approved basis, inaccessible, or provider-transmitted/unrecallable); timelines remain pending approval until explicitly set.
- SEC-08: account-closure acceptance verifies session and pending-approval revocation, actual state of in-flight tasks/transfers, removal of eligible local caches/media, and a per-data-class completion report. No record may remain accessible to the closed account except under an explicitly approved retention/legal-hold basis; provider-transmitted data is not reported deleted without verified provider capability and completion evidence.

**Platform scope:** shared PARMAR services and each client boundary. **Status:** PARTIAL; production posture unverified. **Readiness:** APPROVED REQUIREMENT; release BLOCKED BY DEPENDENCY.

### 3.14 PARMAR governance and human approval

**Purpose:** keep policy, authorization, verification, and approval independent from VOKKI and AI providers.

**User-facing behavior**

- Present risk, rationale, requested permissions, proposed action, data use, approval state, and consequences in plain language.
- Approval is per exact task/parameters/scope/destination/expiry. User may reject, request information, or edit and trigger a new review.
- Show whether a result was proposed, approved, executed, verified, failed, or remains uncertain.

**Technical requirements**

- PARMAR owns canonical policy decisions and provides a versioned decision contract.
- Approval records are server-side, owner/session-bound, expiring, one-use, integrity protected, and immutable with respect to the reviewed parameters.
- Recheck PARMAR enforcement at execution boundary. For multi-step work, re-evaluate each consequential step and changed parameters.
- Independent verification is a distinct step. It must use evidence obtained through a separately authorized observation path that is not solely the executor's or originating provider's assertion. For external side effects, prefer an authoritative read-back from the affected system or a separately trusted evidence source, bound to the exact action and parameters. A second model call, repeated provider response, plan, approval, or executor “success” status alone is not independent verification. If independent evidence is unavailable or inconclusive, report the outcome as unverified/unknown and do not claim completion.
- VOKKI cannot set safety status, approval status, provider authorization, permission grants, or execution results.

**Data/security requirements:** audit decision IDs and scope; redact sensitive content; maintain clear retention and legal hold policy.

**Failure behavior:** missing/invalid decision, stale approval, identity change, policy service failure, or audit failure blocks action. If execution outcome cannot be confirmed, report unknown and prevent blind retries.

**Dependencies:** action executor, task state machine, identity/workspace model, audit/retention design.

**Candidate acceptance criteria**

- GOV-01: provider outputs and client payloads cannot alter enforcement or approval state.
- GOV-02: tampered, expired, replayed, wrong-user/session, and parameter-mismatched approvals are denied.
- GOV-03: no executor side effect occurs before final PARMAR authorization and any required approval.
- GOV-04: only outcomes supported by an independent, separately authorized observation are reported as verified complete; tests inject executor timeout/crash after side effect and remove or falsify the read-back evidence.

**Platform scope:** all VOKKI clients use the same PARMAR contract; clients only display/submit user decisions. **Status:** PARTIAL for conversation approval; action execution absent. **Readiness:** APPROVED REQUIREMENT; execution BLOCKED BY DEPENDENCY.

### 3.15 Accessibility and multilingual support

**Purpose:** make all core interaction, consent, governance, and recovery flows usable across abilities and supported languages.

**Requirements**

- Keyboard-only navigation, focus order, visible focus, screen-reader names/status, semantic controls, contrast, zoom/reflow, and reduced-motion behavior.
- Captions/transcripts and text alternatives for voice; no color-only state; accessible approval and error messages.
- Define supported UI, speech recognition/synthesis, input, and response locales independently. Do not equate language prompt settings with localized UI or quality.
- Localization includes consent, errors, safety, approvals, notifications, dates/numbers, right-to-left where selected, and translated accessibility labels.

**Failure behavior:** unsupported speech locale falls back to text and reports why; missing translation must not change policy meaning or hide a permission/approval condition.

**Dependencies:** standards and locale decisions, UI architecture, platform coverage.

**Candidate acceptance criteria**

- A11Y-01: every critical flow is completable by keyboard and screen reader on each claimed platform.
- A11Y-02: WCAG 2.2 AA is the approved target. Preserve a criterion-by-criterion conformance record for each claimed platform; automated checks supplement, but do not replace, manual assistive-technology review. Record tools, versions, devices, results, and remediations; no unresolved blocker in a critical flow may be waived implicitly.
- A11Y-03: reduced-motion preference is honored across avatar, transitions, notifications, and speech cues.
- LANG-01: product owner approves separate UI, speech-input, speech-output, and response locale lists before release. For each approved UI locale, all critical consent, safety, permission, approval, error, and recovery strings are translated and reviewed; pseudo-localization and truncation tests pass. RTL coverage is an explicit locale-dependent decision. Speech locales are tested on the named devices/runtimes and unsupported locales fail visibly to text.
- A11Y-04: provide an evidence package for each claimed platform covering keyboard-only completion, screen-reader completion of critical flows, zoom/reflow, contrast, captions/text alternatives, reduced motion, automated findings, and manual review. Acceptance evidence must identify the approved standard/version and tested platform/device/assistive-technology versions.

**Platform scope:** web first; per-platform acceptance required. **Status:** PARTIAL/UNVERIFIED. **Readiness:** WCAG 2.2 AA target and multilingual support are approved; locale matrices, platform quality metrics and conformance evidence remain to be defined and accepted.

### 3.16 Web, desktop, Android, and iOS experiences

**Purpose:** deliver consistent user intent and PARMAR authority across supported clients without pretending every feature is portable.

**Requirements**

- Establish a support matrix by OS/version/device, feature, permission, storage owner, online/offline mode, and validation status.
- Shared API and contracts are platform-neutral; UI, media, storage, notifications, secure storage, and lifecycle are native adapters.
- Identity, preferences, memory, and conversation sync only under an approved account/sync contract.
- Do not claim desktop/mobile VOKKI from AETHER screens, packages, or documentation.

**Platform direction**

- Web is the proposed first VOKKI client, based on existing source.
- Desktop VOKKI is a later client decision; AETHER is independent and remains remote-browsing-disabled.
- Android VOKKI is not implemented; its existing VOKKI screen is informational within an AETHER offline shell.
- iOS is not started.

**Candidate acceptance criteria**

- PLAT-01: each release publishes a feature matrix with IMPLEMENTED/PARTIAL/UNAVAILABLE and evidence per OS/version.
- PLAT-02: shared contract fixtures pass against each adapter claiming release; platform-specific device/browser tests cover permission, lifecycle, secure storage, navigation, interruption, offline, and accessibility. Passing one client does not certify another.
- PLAT-03: no AETHER capability or data is consumed by VOKKI without a separate approved protocol, security review, authorization, and independent gate completion.

**Dependencies:** initial scope, identity/API contracts, platform runtime/security evaluations. **Readiness:** web first proposed; all other platforms NEEDS USER DECISION / OUT OF INITIAL RELEASE SCOPE.

### 3.17 Performance, reliability, and production operations

**Purpose:** provide predictable responsiveness, safe failure, recoverability, and accountable operations.

**Requirements**

- Measure startup, interaction, provider time-to-first-byte/completion, server overhead, queue delay, memory/CPU/GPU/battery, and storage growth.
- Set SLOs only after reference devices, workload, and percentile methodology are approved.
- Bounded concurrency, timeouts, retries, cost limits, backpressure, idempotency, cancellation, durable task state, and graceful degradation.
- Structured, privacy-safe logs and metrics; request/task correlation; health/readiness distinguish configured from reachable.
- Document backup/restore, migration, incident response, key rotation, update, rollback, and service ownership.

**Failure behavior:** explicit unavailable/degraded state; no hidden provider switching, duplicate side effects, partial-result claims, or UI stall presented as success.

**Candidate acceptance criteria (proposed, unmeasured)**

- OPS-01: before measurement, approve the workload, named device/OS/browser matrix, network profile, sample count, warm/cold-cache rules, percentile method, exclusions, and instrumentation. Define startup as process/navigation start to the first interactive, usable VOKKI control; define local interaction latency from input event to visible acknowledged state; define PARMAR overhead by correlated server stages excluding provider time and queue wait; report provider time-to-first-byte and completion separately. Report p50/p95/p99 with sample counts and confidence intervals, plus CPU/GPU/memory/battery and error rates under the same workload. Publish raw methodology and results; do not compare unlike profiles.
- OPS-02: load test at approved concurrency with bounded resource use and no cross-user leakage or lost acknowledged writes.
- OPS-03: provider outage, database unavailable/corrupt, process restart, task cancellation, network interruption, backup restore, and rollback exercises meet approved recovery objectives.
- OPS-04: all errors carry a correlation ID; logs exclude secrets and avoid raw user content by default.
- OPS-05: availability is calculated from a product-approved eligible-request/service-window definition, with numerator, denominator, maintenance exclusions, dependency attribution, and synthetic/user-observed split published; provider outages are separately identified and are not silently excluded from user-visible end-to-end availability.

**Platform scope:** separate metrics and acceptance for web service and every native client. **Status:** PARTIAL/UNVERIFIED. **Readiness:** NEEDS TECHNICAL EVALUATION and BLOCKED BY production operations decisions.

## 4. Non-functional requirements and proposed service budgets

These targets are **proposals**, not measured results or approved commitments. Before using any target as a release gate, approve the workload/device matrix, observation window, cache state, sample size, percentile calculation, confidence interval/reporting, exclusions, and measurement tooling. Record each platform and quality tier separately; do not infer native results from web tests.

| Area | Candidate initial target | Measurement/acceptance method |
|---|---|---|
| Web usability | Candidate first interactive render p75 ≤2.5 s on an approved reference profile; local control response p95 ≤100 ms | Define start/end events; report cold and warm cache separately, named browser/device/network, sample count and confidence interval |
| PARMAR overhead | Candidate p95 ≤300 ms excluding external provider time and queue wait | Correlated server-stage timing; define workload, errors/timeouts, sampling, and percentile method |
| Provider latency | No numeric target selected; report time-to-first-byte and completion separately | Per provider/model/region, payload class, network, streaming mode, success/error/timeout, with sample counts and percentiles |
| Future digital human | Candidate 60 FPS high tier and ≥30 FPS supported low tier; mid-tier and lower-budget decisions remain open | Frame-time distribution (not average FPS alone), device/OS/GPU, scene, resolution, thermal steady state, battery/resource profile, fallback |
| Reliability | Candidate 99.5% monthly first-party service availability; not approved | Define eligible requests, success criteria, denominator, maintenance exclusions, dependency attribution, window and telemetry |
| Cancellation | No deadline selected | Measure user stop request to confirmed microphone/resource stop and, separately, task cancellation acknowledgement/confirmed external stop; publish percentiles and uncertain outcomes |
| Recovery | RPO/RTO and replay limits are undecided | Specify data classes, acknowledged-write semantics, workload, failure injection, restore point, and proof of no unsafe duplicate actions |
| Accessibility | No conformance target approved | Name standard/version, critical flows, platforms, assistive-technology/device matrix, automated/manual evidence and defect threshold |

No current repository benchmark proves any of these targets. Do not use the former suggested values as commitments without approval.

## 5. Target architecture

### 5.1 System architecture and trust boundaries

```text
┌──────────────────────────── Human user ────────────────────────────┐
│ Explicit input, identity, permissions, consent, approval, stop      │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────────┐
│ VOKKI clients: web / desktop / Android / iOS (each separately gated)│
│ UI, digital-human renderer, speech I/O, local preferences/cache     │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ versioned, authenticated API
┌─────────────────────────────▼──────────────────────────────────────┐
│ PARMAR Core — authority boundary                                   │
│ Identity context → policy/review → capability authorization        │
│ task plan → approval → provider/tool broker → independent checks    │
│ response/action release → audit                                     │
└──────────┬──────────────────┬───────────────────┬───────────────────┘
           │                  │                   │
           ▼                  ▼                   ▼
  Provider adapters     Memory/research       Tool/connector broker
  local/cloud, policy   owner-scoped stores   least-privilege sandbox
           │                  │                   │
           └──────────────────┴───────────────────┘
                              │
                 untrusted outputs and outcomes
                              ▼
                  PARMAR validation and release
                              │
                  VOKKI presentation/action state

AETHER: independent project and security boundary; not in this data path.
```

### 5.2 Component responsibilities

- **VOKKI presentation client:** accessible conversation, voice/renderer states, user consent, settings, approval display, and truthful error/recovery.
- **Identity/session service:** verified principal, session issuance/revocation, roles/workspaces, consent records; separate from PARMAR safety decisions.
- **PARMAR request gateway:** validates input, authenticates identity, applies abuse limits, issues correlation IDs, enforces API contracts.
- **PARMAR policy and lifecycle:** review, risk, enforcement, required permissions, approval requirement, action-boundary decision, state transitions.
- **Orchestration service:** bounded plan, provider/connector selection, capability check, cost/deadline, retry/cancellation; no model can directly call tools.
- **Provider broker:** secret access, provider adapter, user/data-consent check, timeout/size/rate controls, external-call audit.
- **Memory and workspace services:** owner/workspace partitioning, explicit consent, retention, delete/export, retrieval, provenance.
- **Research service:** separate authorization, safe retrieval, source normalization, untrusted-context wrapper, claim-citation validation.
- **Task/execution service:** durable task state, approval-bound parameters, idempotency, connector calls, independent result verification, recovery.
- **Audit/observability:** minimal structured, tamper-evident events with correlation and redaction, operational metrics without unnecessary content retention.
- **Platform adapters:** permission, secure storage, lifecycle, notifications, audio/video, renderer, offline queue, and accessibility integration.

### 5.3 Authority and release contracts

1. User input is untrusted and bounded.
2. Authenticated identity is server-established; client-provided IDs and roles are ignored.
3. PARMAR analyzes request and derives risk, policy, permission, and approval requirements.
4. PARMAR authorizes a specific provider/capability/data scope before a call.
5. Provider, memory, research, document, and tool outputs are untrusted; they cannot modify policy or approval.
6. Response validator and independent checks decide release. Independent verification requires separately authorized evidence, not merely a repeated provider answer or executor self-report. VOKKI renders only the authoritative release contract.
7. For actions, a separate executor receives only approved parameters. PARMAR obtains independent evidence of the resulting state before reporting success; otherwise the result remains unverified/unknown.
8. Every stage emits bounded audit metadata; sensitive content retention is a separate decision.

### 5.4 AI, memory, and data architecture

- Provider-neutral contract and capability registry; server-side secrets; no silent fallback.
- Memory and conversations remain distinct data classes. User consent gates memory; owner/workspace authorization gates all reads/writes; context limits are explicit.
- Research sources, memory, and files are labeled untrusted and injected as data, never instructions.
- Data classes: identity/session; consent; preferences; conversation; memory; files/project data; source metadata; task/approval/action; audit/diagnostics; media. Each needs a purpose, owner, storage, transfer, retention, encryption, export, deletion, and backup policy before implementation.
- Local cache, queue, and offline inference require separate data owner, key, retention, sync, conflict, and revocation rules; not assumed by this architecture.

### 5.5 Digital-human and voice architecture

```text
PARMAR lifecycle + released response
        ├── interaction-state mapper ──→ expression controller
        │                                  └─→ renderer/rig/identity preset
        ├── approved speech text ──→ TTS adapter ──→ audio output
        │                                  └─→ timing/viseme events (if supported)
        └── explicit user activation ──→ permission adapter
                                           └─→ ASR → transcript → PARMAR request
```

The identity catalog, renderer, animation controller, speech adapters, audio lifecycle, and platform permission layer must be separate modules. PARMAR lifecycle is authoritative; facial expression cannot imply a different safety state. Speech must not bypass release checks.

### 5.6 Platform and AETHER boundary

Use shared API/schema contracts and independently implemented native adapters. Share business rules only where their security semantics are equivalent and testable. Maintain a platform feature matrix and prohibit parity claims without device evidence.

AETHER is a separate project. It is not a VOKKI browser, renderer, identity service, or tool execution provider. The PARMAR AETHER section may expose the PARMAR-wide VOKKI presence entry, but the standalone AETHER applications remain independent and have no VOKKI dependency. Any direct integration is optional and requires a separately reviewed contract. Preserve all AETHER files and decisions. `REMOTE_BROWSING_ENABLED=false` remains unchanged until AETHER's independent security gates and a separate explicit authorization are satisfied.

## 6. Technology evaluation and recommendations

No final vendor/stack selection is made here. Candidates require a dated evaluation for current version, commercial licensing, update/patch ownership, platform requirements, privacy, and total cost. The repository has no evidence establishing external licensing or pricing terms.

| Area | Existing/recommended candidate path | Compare on | Required proof of concept / decision |
|---|---|---|---|
| Frontend/shared app | Reuse current HTML/CSS/JavaScript VOKKI foundation initially; evaluate a typed shared component architecture only if the roadmap needs it | Accessibility, bundle/startup, security boundary, maintainability, web/native reuse, localization | Ship one governed flow and measure maintainability/performance; user approves any framework migration |
| Backend/API | Reuse PARMAR service contracts; evaluate a production ASGI/API framework versus current standard-library `ThreadingHTTPServer` before scale-out | Authentication middleware, async I/O, validation, cancellation, OpenAPI, observability, deployment complexity | Prototype bounded chat/approval API with equivalent policy tests; no rewrite without measured need |
| AI orchestration/providers | Reuse provider protocol/adapters; keep routing and policy in PARMAR. Evaluate provider SDKs only where they materially add streaming/schema support | Data residency, quality, latency, context limits, retention, availability, cost, terms, cancellation | Fake-transport contract suite plus approved real-provider pilot; no user data until consent/security approval |
| Local AI runtimes | Compare embedded/on-device libraries, device-local services/daemons, OS inference APIs, and network-reachable services; llama.cpp/Ollama-class options are examples for evaluation, not decisions | Runtime/process and trust boundary; on-device vs LAN/cloud locality; hardware/OS/accelerator matrix; model/runtime size, startup, quality, memory/CPU/GPU/NPU, battery/thermal behavior; model-weight and runtime-code licensing, commercial use, redistribution/attribution; supply chain; signing; patch/update/rollback ownership and end-of-support response | POC on approved low/mid/high hardware with exact device/model/runtime versions and reproducible workloads; separately review model and runtime licenses; name the party accountable for security updates and distribution before selecting or claiming offline/on-device AI |
| Digital-human renderer | Evaluate WebGL/WebGPU engines (for example Three.js/Babylon.js) and licensed real-time human platforms; native engines (Unity/Unreal-class) only if platform/product case warrants | Photorealism, rig/viseme support, startup/download, GPU/battery, accessibility fallback, license/runtime royalties, platform support | Render/animation POC with canonical identity, reduced-motion fallback, and license/commercial review |
| Voice recognition/synthesis | Browser APIs for constrained web push-to-talk; evaluate OS on-device speech APIs and dedicated local/cloud services per platform | On-device guarantee, language packs, latency, quality, privacy, consent, background restrictions, cost, accessibility | Verify on actual supported devices; egress/storage observation; compare transcript quality/latency; decide cloud use explicitly |
| Animation/lip sync | Renderer-native blendshapes/rig plus timestamped viseme pipeline; evaluate audio-driven vs phoneme-timed methods | Synchronization, naturalness, interruption, compute, supported rigs, licensing | POC against known utterances and streaming interruption; no face/video claim without rig and measured sync |
| Memory/database | Reuse SQLite for local/single-node prototype; evaluate managed relational database for multi-user service, plus separate encrypted object storage if files are approved | Isolation, concurrency, backup/restore, migrations, encryption/key management, data residency, operational ownership | Load/restore/isolation POC; choose based on deployment topology and approved RPO/RTO |
| Research | Reuse PARMAR search contract/normalizer; evaluate providers only after data terms and source quality review | Coverage, freshness, provenance, retention, SSRF risk, price, latency, regional availability | Search/citation POC with injection, malicious URL, conflict, freshness, and claim-support test set |
| Connectors/tools | Build a PARMAR-owned broker and narrow connector SDK; evaluate existing connector/MCP protocols as transport/metadata, not authority | Scope model, sandbox, permission lifecycle, secret isolation, audit, idempotency, protocol maturity, supply-chain risk | Fake tool first; threat-reviewed single low-risk connector; prove denied-by-default and exact approval binding |
| Authentication/security | Integrate a vetted OIDC-capable identity provider if approved; keep server-established identity contract and session controls | Account recovery, MFA/passkeys, tenancy, privacy, deployment, cost, lockout, portability | Identity threat model and isolated test tenants; vendor and jurisdiction approval required |
| Sync/offline storage | Defer sync decision; evaluate encrypted local database and conflict-safe sync only if product requires it | Key recovery, deletion propagation, conflicts, offline action safety, backup, platform support | Offline POC with revocation, conflict, crash, and no-duplicate-action tests |
| Testing | Reuse current unit/integration suites; add contract, API, browser/device, security, and load layers | Determinism, coverage of denial paths, test environment privacy, platform reliability | CI evidence matrix and release gate definitions; source tests alone are insufficient |
| Monitoring/operations | Evaluate OpenTelemetry-compatible traces/metrics/logging and hosted/self-managed options | Data minimization, access controls, retention, cost, residency, alert quality, outage dependency | Privacy review and synthetic request tracing with secret/content redaction |
| Deployment/updates | Select managed service/container/platform-native delivery after support scope | Signing, patch cadence, rollback, key custody, supply chain, availability, regional hosting | Signed artifact, SBOM/provenance, restore/rollback and incident exercise |

### Recommendation posture

- **Reuse now:** current VOKKI web UI, PARMAR service/provider contracts, response-release gate, owner-scoped repositories, and approval store as a governed prototype foundation.
- **Evaluate before replacing:** HTTP server, SQLite, client architecture, and provider adapter strategy. No evidence warrants a blanket rewrite.
- **Do not select prematurely:** digital-human vendor, local AI runtime, commercial voice provider, production identity provider, sync backend, or deployment vendor.
- **Decision rule:** record a comparison, POC evidence, licensing/security review, owner, and rollback plan before adopting any technology that handles user data or changes authority boundaries.

## 7. Dependency map

```text
User decisions: launch platforms, account/workspace model, data consent,
voice mode, action scope, offline/sync, accessibility locales, quality tier
       │
       ├── Phase 0: platform-neutral contracts, threat model, route inventory,
       │            platform-adapter contract, data inventory, security baseline
       │       ├── Phase 1: identity/session foundation and web shell
       │       ├── Phase 2: provider egress only after identity, per-user
       │       │            consent, route authorization, secrets, and egress gates
       │       ├── Phase 5: memory after consent, ownership, retention/deletion
       │       ├── Phase 6: research after egress/source-validation gates
       │       └── Phase 7: real execution only after action contract,
       │                    scoped approval, executor isolation and verification
       │
       ├── Phase 0 platform contract ──→ independent Web/Desktop/Android/iOS
       │                                  adapter and release gates
       │
       ├── Phase 3 digital-human POC after identity, hardware, asset and license decisions
       ├── Phase 4 voice after provider/release and permission/privacy gates
       ├── Phase 8 device integration after Phase 7 authority and Phase 0 adapter contract
       ├── Phase 9 offline/hybrid after local runtime, identity, data and task decisions
       └── Phase 10 common operational hardening + per-platform acceptance
                                      └── independent release gate per client

AETHER remains outside this graph.
```

Unresolved choices do not activate a feature by default. The affected capability stays disabled, and any dependent phase or release gate remains blocked until its decision and required evidence are approved.

## 8. Full development roadmap

The phases below preserve the requested 0–12 headings but reorder prerequisite work inside the plan: production identity, data lifecycle, and PARMAR action contracts must be established before integrations or real execution. The entire architecture is designed in Phase 0; delivery remains incremental. Each phase requires explicit scope approval and a written completion record; none is permission to modify AETHER.

### Phase 0 — Architecture, requirements, and technical validation

- **Objective:** close decisions and establish verifiable interfaces before feature expansion.
- **Deliverables/tasks:** reconcile approved D-01–D-13 and Dedicated Workspace + PARMAR-wide Presence into traceable requirements; resolve remaining identity-provider/recovery, provider/model, data-lifecycle, voice/platform, action/executor, runtime, asset, operations and measurement details; publish data map, threat model, architecture decision records, API contracts, support matrix, budget template; evaluate existing web/API/SQLite reuse; define controlled POCs.
- **Dependencies:** product, security, privacy, accessibility, legal, and operations owners.
- **Security:** address conditional bind exposure; keep external providers deny-by-default; preserve AETHER boundary.
- **Testing strategy:** contract fixtures and threat-model scenarios; no production data.
- **Acceptance/completion evidence:** exact approved directions are traced to the PRD; Task 23 documentation integration is verified; remaining technical choices have named owners; threat model with residual risks; versioned PARMAR authority and error contracts; evidence plan and explicit no-go conditions.
- **Exit:** resolve or explicitly defer remaining implementation decisions needed for Phase 1. A deferred choice disables its dependent capability; it cannot be enabled by an inferred or permissive default. External provider egress and real connector execution remain disabled until their respective security prerequisites pass.

### Phase 1 — Shared VOKKI foundation and identity

- **Objective:** build a reliable, accessible web VOKKI shell with canonical identity and production identity foundations.
- **Deliverables/tasks:** shared UI state contracts; identity onboarding/session lifecycle; account recovery design/integration; profile boundaries; canonical identity catalog; consent settings; API client/correlation IDs; secure preference/data ownership.
- **Dependencies:** Phase 0; production identity and tenancy decision.
- **Security:** server-established user identity, CSRF/session controls, access denial, camera-still lifecycle decision.
- **Testing:** identity/session unit and API tests; isolation across the identity, session, and preference records introduced in this phase; keyboard/screen-reader smoke paths; stale-response/profile-switch tests. Add equivalent cross-user/workspace tests when memory, files, tasks, approvals, or audit stores are introduced in their owning phases.
- **Acceptance:** applicable ID-01, ID-03, and ID-04 criteria pass for the implemented identity/session scope; ID-02 coverage expands with each later data class. PLAT-01 records the actual web feature status without requiring later-phase stores to exist. All user-facing identity, demo, and limitation states are truthful.
- **Completion evidence:** identity/session acceptance, test reports, data inventory update, threat review.
- **Exit:** production identity and user isolation pass, or release remains explicitly non-production demo.

### Phase 2 — Core PARMAR-governed AI experience

- **Objective:** provide useful, truthful conversation with clear provider status and PARMAR release enforcement.
- **Deliverables/tasks:** provider decision/configuration; per-user data-sharing consent; bounded routing, timeouts, cost/rate policies; streaming evaluation; provider health semantics; retry/cancellation/idempotency design; error presentation.
- **Dependencies:** Phase 0–1; approved provider, data-flow, cost, and retention policies.
- **Security:** before any external provider egress, require the Phase 0/1 security baseline: production identity and authorization for every exposed user-data route; approved route inventory; per-user, purpose-specific provider/data consent; server-held secrets; minimized context; tested egress denial; response validation; and no silent fallback. If any gate is missing, external egress stays disabled. A non-sensitive test deployment is still subject to the same route and egress controls.
- **Transport gate:** before provider-enabled deployment, verify ingress TLS from client to the approved termination point, TLS termination and trusted reverse-proxy/hop boundaries, sanitized/validated forwarded headers, and authenticated TLS certificate/hostname validation for provider egress. Invalid certificates, untrusted proxy configuration, or missing deployment evidence fail closed. No existing deployment is presumed to satisfy this gate.
- **Testing:** provider fake-transport contract; denied-provider zero-egress tests; consent revocation before/during/after transmission and zero-future-egress checks; invalid-certificate and untrusted-proxy denial; malformed output, timeout, rate limit, cancellation, response-withholding and UI release E2E.
- **Acceptance:** AI-01–07, GOV-01; only PARMAR-released responses are rendered/spoken/persisted.
- **Completion evidence:** approved provider deployment record, egress/data-flow report, test and cost telemetry.
- **Exit:** configured inference is demonstrated on an approved test deployment only after all egress gates pass; Local Demo remains honestly labeled. This phase does not grant authorization for real connector execution.

### Phase 3 — Digital-human rendering

- **Objective:** evaluate and incrementally deliver a stable, performant, AI-transparent visual identity.
- **Deliverables/tasks:** identity/art direction and asset licensing; compare the high-quality 3D, photorealistic-premium, and cinematic directions without preselecting a renderer; canonical identity schema and reset; lifecycle/expression mapping; approved environment controls for background upload/selection/positioning, wall/panel style, lighting/colors, outfit and framing; situation-based outfit suggestions only if separately approved; static graceful fallback; adaptive quality and reduced-motion behavior.
- **Dependencies:** Phase 0 identity decision; renderer, asset, hardware, and license evaluation. Can overlap Phase 2 POC only without production integration.
- **Security:** no biometric inference; camera references separate; provenance and supply-chain review for assets/runtime.
- **Testing:** identity consistency, lifecycle state, low-end hardware, accessibility, rendering failure, asset/license, frame/resource profiling, and user-control tests for any approved situation-based outfit suggestion.
- **Acceptance:** DH-01–08 using product-approved quality/device thresholds; do not claim a quality tier or optional customization that has not passed its own gate.
- **Completion evidence:** reproducible device profiles, visual/accessibility review, rights clearance.
- **Exit:** no quality tier is claimed without device evidence; fallback is complete.

### Phase 4 — Voice and natural interaction

- **Objective:** offer explicit, accessible speech interaction integrated with PARMAR.
- **Deliverables/tasks:** implement the approved multilingual push-to-talk initial direction after privacy/security acceptance; evaluate additional voice modes separately; platform speech adapters; on-device/cloud disclosure; transcript consent; captions; output voice controls; cancellation/barge-in; viseme timing only if renderer supports.
- **Dependencies:** Phase 0 privacy/voice decision; Phase 1 identity; Phase 2 release/provider consent; Phase 3 timing interface for lip sync.
- **Security:** native permission gates, visible indicator, no hidden fallback, stop on lifecycle changes, audio/transcript retention decisions.
- **Testing:** VO-01–07 on actual supported browsers/devices; audio egress/storage verification; interruption, floating-mode continuity/accessibility, and separately gated wake-word lifecycle tests.
- **Acceptance:** text alternative always works; capture is user-started, observable, stoppable, and accurately disclosed.
- **Completion evidence:** device/browser matrix, permission behavior, network/storage observation, latency/quality report.
- **Exit:** no voice capability claim beyond tested runtimes.

### Phase 5 — Memory and personalization

- **Objective:** make useful long-term context user-controlled and isolated.
- **Deliverables/tasks:** decide revocation/deletion semantics; retention/export/account deletion; provenance and review UX; retrieval quality; storage/key management; encrypted backup/restore; sync only if approved.
- **Dependencies:** Phase 1 production identity/workspace, Phase 0 data map and consent.
- **Security:** owner/workspace authorization, sensitive-data policy, at-rest/backup keys, retention and deletion propagation.
- **Testing:** MEM-01–05, two-user access matrix, corrupt/unavailable storage, deletion/export/restore, retrieval evaluation.
- **Acceptance:** approved automatic memory capture is consent-gated, reviewable, editable, deletable, exportable and resettable; model training remains disabled absent a separate approved contract; consent and storage status match actual operations.
- **Completion evidence:** data lifecycle audit, isolation test report, recovery and deletion evidence.
- **Exit:** no memory release until user controls and recovery are proven.

### Phase 6 — Research and knowledge capabilities

- **Objective:** deliver transparent research and appropriately bounded knowledge claims.
- **Deliverables/tasks:** research provider selection; query and source consent; provenance model; injection isolation; freshness/conflict handling; claim/citation support contract; user-facing labels.
- **Dependencies:** Phase 2 provider/data consent; Phase 5 data boundaries; Phase 0 research decision.
- **Security:** search egress/SSRF protection; no arbitrary URL fetch; source content untrusted; separate search capability authorization.
- **Testing:** RE-01–04 with malicious snippets, URLs, source conflicts, no results, stale sources, failed providers, unsupported claims.
- **Acceptance:** source attribution never represented as claim verification absent evidence.
- **Completion evidence:** source validation and citation quality report; egress/privacy review.
- **Exit:** research status and claims have explicit, testable semantics.

### Phase 7 — Workspace and task execution

- **Objective:** move from conversation to governed work without uncontrolled autonomy.
- **Deliverables/tasks:** workspace/project/document ownership; safe parsing/indexing; Guide/Execute/Orchestrate contracts; task state machine; executor broker; one low-risk connector pilot; approval-bound exact parameters; idempotency/cancellation/recovery; independent outcome verification.
- **Dependencies:** Phases 0–2 and production identity; Phase 5 for persistent data; Phase 6 for research where used. A real connector additionally requires a passed connector-specific security review and the Phase 0 action/authority contract.
- **Security:** no real connector execution until production route authentication/authorization, least privilege, tool isolation, exact approval binding, prompt-injection controls, secret isolation, action audit, cancellation/uncertain-outcome handling, and independent verification are tested and approved. Simulated executors do not authorize a real side effect.
- **Testing:** WS-01–03, TASK-01–04, INT-01–03; simulated executors before real connectors; side-effect boundary and crash-after-side-effect exercises.
- **Acceptance:** no tool can execute directly from model output; action success only after verified outcome.
- **Completion evidence:** connector-specific threat review, permission matrix, deterministic integration and recovery results.
- **Exit:** each enabled connector has explicit owner, scope, revocation, operational support, rollback, and its own security/acceptance evidence; otherwise real execution stays disabled.

### Phase 8 — Integrations and device awareness

- **Objective:** add selected device/app signals only where they improve user outcomes and have safe permission models.
- **Deliverables/tasks:** decide integration catalog; implement one platform-specific adapter; granular consent, revocation, scope and indicators; device event audit.
- **Dependencies:** Phase 7 authority/broker; Phase 0 platform-adapter contract; approved integration, platform and privacy scope. Phase 8 does not depend on Phase 11 implementation.
- **Security:** no hidden collection; no AETHER dependency; preserve AETHER gates and data boundary.
- **Testing:** DEV-01–03 per permission and lifecycle, egress/storage traces, revocation and abuse.
- **Acceptance:** only approved signals collected; unavailable signals fail visibly.
- **Completion evidence:** device-level permission/egress evidence and independent security review.
- **Exit:** no capability marketed based on a simulation or UI toggle.

### Phase 9 — Offline and hybrid intelligence

- **Objective:** support honest and safe degraded/offline capability if approved.
- **Deliverables/tasks:** evaluate runtime type, model/runtime licensing and hardware using OFF-04; online/local routing contract; encrypted queue/cache; sync/conflict and deletion; uncertainty/duplicate action policy.
- **Dependencies:** Phase 0 offline/sync decision; Phases 1, 2, 5, and 7; relevant platform POC.
- **Security:** offline authorization policy, local key protection, no unsafe queued execution, supply-chain update.
- **Testing:** OFF-01–03, airplane mode, restart, key revocation, sync conflict, queued duplicate, task uncertain outcomes.
- **Acceptance:** offline state and functionality match the approved matrix; zero network for offline-only promises.
- **Completion evidence:** device/runtime network observation, model license and performance report, recovery tests.
- **Exit:** no Local Demo rebranding as offline AI.

### Phase 10 — Privacy, security, and reliability hardening

- **Objective:** close security/data lifecycle and operational gaps across released functionality.
- **Deliverables/tasks:** encryption/key lifecycle; export/delete/retention; backups/restore; logging/metrics; rate limits/admission; incident response; supply-chain/updates; emergency stop; external security review.
- **Dependencies:** production identity and deployment plan; hardening evidence is gathered per released module and platform, not deferred as the first security control.
- **Security:** Phase 10 is defense-in-depth and operational hardening, not a prerequisite substitute or first security gate. Production identity/route authorization and verified ingress/provider-egress transport security must precede external provider egress; connector-specific controls must precede real execution. Reconcile camera lifecycle and per-user provider consent; close all applicable findings in the Part 13 final report before production release.
- **Testing:** SEC criteria; threat-led tests; restore/incident drills; abuse/load, dependency and update acceptance.
- **Acceptance:** P0 security findings resolved or formally risk-accepted by accountable approver; no unresolved release-blocking finding hidden as “partial.”
- **Completion evidence:** security review, privacy assessment, restore report, incident exercise, approved residual-risk register.
- **Exit:** production security review and operations sign-off.

### Phase 11 — Platform-specific experiences

- **Objective:** deliver independently scoped Web, Desktop, Android, and iOS clients only where approved, with no cross-platform release dependency or unsupported parity claim.
- **Deliverables/tasks:** implement and validate each approved client adapter against the Phase 0 platform contract; maintain per-platform OS/version/device/feature matrix; evaluate native voice/renderer/notifications/storage and distribution only for selected platforms.
- **Dependencies:** Phase 0 shared API/schema and platform-adapter contracts; Phase 1 identity foundation; only the capability phases included in that platform's approved release scope; platform-specific security, distribution, licensing, support, accessibility and performance decisions.
- **Security:** do not reuse AETHER as VOKKI; no AETHER data/authority integration. Preserve all current AETHER work and `REMOTE_BROWSING_ENABLED=false`.
- **Testing:** platform acceptance for identity, sessions, accessibility, permissions, offline, storage, lifecycle, updates, and crash recovery.
- **Acceptance:** PLAT-01–03 independently for each platform seeking release. Passing Web does not certify Desktop, Android, or iOS; native-platform completion does not gate an otherwise approved Web release.
- **Completion evidence:** release artifacts, support matrix, test/device logs, app store/signing review.
- **Exit:** each client has an independent release record, approved support matrix, named owner, and evidence. A platform not selected or not passing remains unavailable without blocking other clients.

### Phase 12 — Production hardening and independent client releases

- **Objective:** deploy and maintain a trusted, observable, recoverable product.
- **Deliverables/tasks:** production environment; rollout/feature flags; SLOs; alerts and runbooks; support/legal/privacy material; signing/SBOM/provenance; backup and restore; rollback and incident process.
- **Dependencies:** Phase 10 controls applicable to the named release plus that platform's Phase 11 acceptance. Each platform can pass or remain blocked independently; a failure on one platform does not imply parity or automatically block another platform that satisfies its own approved gate.
- **Security:** access reviews, key rotation, vulnerability response, incident communication, least-privilege operations, independent release approval.
- **Testing:** production-like deployment, synthetic user journeys, restore/rollback, outage and incident drills, accessibility and privacy acceptance.
- **Acceptance:** approved SLOs met for the release's named platform and evidence window; no known P0; P1 risk accepted by the accountable owner; release claims map to verified capabilities. The web release gate is independent of later native releases.
- **Completion evidence:** signed release checklist, build provenance, deployment/restore/rollback evidence, operational sign-off.
- **Exit:** product owner, security, privacy, accessibility, and operations approve release and support model.

## 9. Testing and quality strategy

Feature completion requires source review, automated tests, runtime evidence appropriate to its claim, and release owner sign-off.

| Test layer | Required coverage |
|---|---|
| Unit | State machines, validators, permission transitions, adapters, schemas, retrieval bounds, cancellation, retry/idempotency rules |
| Contract | PARMAR/VOKKI API schemas; provider/tool adapters; release, approval, task, audit, and platform contracts |
| Integration | Identity → PARMAR policy → provider/tool → response/action validation → release; storage, migration, memory, research, and approval persistence |
| End-to-end | Typed and voice interaction; blocked/approval/reject/approve; memory consent/revoke/delete; research failure/source display; profile switch; logout; offline/uncertain action |
| Governance | Provider cannot alter policy; user approval bound to exact action; all execution paths recheck PARMAR; withheld content never spoken, stored as released, or acted upon |
| Security/privacy | Cross-user/workspace isolation; CSRF/session/replay; external egress consent; prompt injection; malicious files/tool outputs; secrets; deletion/retention; SSRF; rate/size abuse; logging redaction |
| Digital human/voice | Identity consistency; fallback; reduced motion; animation/lifecycle mapping; actual mic/camera indicators; transcript/audio retention; TTS release-only; barge-in/cancel |
| Offline/recovery | Network loss at each stage; queued request replay; process restart; database corruption; backup restore; sync conflict; cancellation with uncertain external outcome |
| Performance/load | Named device matrix; cold/warm startup; p50/p95/p99 latency; concurrent users; CPU/GPU/memory/battery; queue saturation; provider outage; database growth |
| Accessibility/localization | Keyboard, screen reader, captions/transcripts, reduced motion, contrast/reflow, localized safety/consent/error copy, speech language matrix |
| Platform acceptance | Real supported browsers/OSs/devices; secure storage, permission denial/revocation, lifecycle, update, package/signature, offline and resource behavior |
| Production readiness | Deployment auth/config, secrets, monitoring, alerts, restore/rollback, incident and vulnerability-response exercises |

Tests in the repository are useful source-level evidence for chat, provider, response safety, approvals, sessions, memory, conversations, research, VOKKI UI, and other PARMAR/AETHER components. They were not run for this planning document and do not establish device, deployment, production, or performance behavior. Historical AETHER test summaries are not current acceptance evidence; AETHER retains its own independent gates.

## 10. Release strategy

### Full product vision

Complete cross-platform digital-human intelligence interface with natural voice, adaptive rendering, memory, research, projects, governed tool execution, integrations, personalization, offline/hybrid behavior, proactive support, and production operations. This is long-term direction, not current capability or a single release promise.

### Initial web release — proposed, needs user approval

- Authenticated web conversation through PARMAR.
- Clearly configured and consented provider only after the external-egress security gates in Phase 2 pass, or transparently labeled deterministic Local Demo.
- PARMAR lifecycle, response release, approval status, and error behavior.
- Accessible text interaction; optional push-to-talk only if consent, provider transfer, and browser support conditions are met.
- Owner-scoped conversation and explicit memory controls only after production identity and data lifecycle acceptance.
- Explicit research option only after source disclosure and authorization.
- No external connector action, wake word, background monitoring, OS notifications, local-model claim, native parity claim, or AETHER integration.

### Independent platform release gates

Each client has its own approved scope, support matrix, security review, acceptance evidence, and release decision. A capability is unavailable on a platform until that platform's gate passes; shared code or another client's acceptance is not evidence of parity.

| Platform | Current repository evidence | Minimum gate for a release claim |
|---|---|---|
| Web | Existing VOKKI web surface; production identity and deployment readiness are not established | Approve web scope; pass identity/route authorization, ingress TLS/termination/proxy trust, provider-egress TLS/certificate validation and applicable consent gates; verify browser/OS matrix, accessibility, data lifecycle, performance, monitoring, recovery, and release operations for the deployed web service |
| Desktop | No VOKKI desktop client established; AETHER desktop work is separate | Approve a VOKKI desktop architecture and support matrix; independently pass signed packaging/update, identity, permission, storage, lifecycle, accessibility, ingress/egress transport security for any network path, security, performance, recovery, and AETHER-separation checks |
| Android | Existing VOKKI screen is informational within an AETHER offline shell, not a VOKKI client | Approve VOKKI Android scope; independently pass supported OS/device, identity, native permissions, secure storage, lifecycle, accessibility, ingress/egress transport security for any network path, performance, offline/network, signing/update, security, and recovery checks |
| iOS | Implementation is documented as not started | Approve VOKKI iOS scope; independently pass supported OS/device, identity, native permissions, secure storage, lifecycle, accessibility, ingress/egress transport security for any network path, performance, offline/network, signing/update, security, and recovery checks |

These are separate gates, not a mandated delivery order. Web is a proposed first release only; Desktop, Android, and iOS each require explicit selection and may remain out of scope without blocking another platform's approved release.

### Subsequent capability releases

1. Real provider with consent, monitoring, limits, and response quality evidence.
2. Memory lifecycle, data controls, workspace and document support.
3. Claim-aware research and one reviewed low-risk connector.
4. Digital-human renderer and synchronized speech.
5. Platform-specific desktop/mobile clients after separate approval and acceptance.
6. Local/hybrid AI, proactive notifications, multi-user workspace, and advanced automation only after their decisions and POCs.

## 11. Risk and decision register

### Priority definitions

- **P0:** security/governance blocker to exposing or executing the capability.
- **P1:** essential for a usable, trustworthy initial VOKKI release.
- **P2:** important capability or reliability gap.
- **P3:** advanced/future capability.

| ID / Priority | Risk or decision | Current evidence / impact | Dependency and required decision |
|---|---|---|---|
| R-01 / P0 | Production identity and listener exposure | Default resolver is anonymous; persistent sessions are optional; non-loopback bind can be configured; some routes permit anonymous requests. | Decide production identity/deployment boundary; require verified authz on every exposed user-data/provider/action route; fail closed until evidenced. |
| R-02 / P0 | External AI user consent | Provider authorization is server-side and not per-user consent; prompt/context may be sent when external use is enabled. | Approve provider/data inventory, per-user consent UX, revocation, retention and opt-out before enabling egress. |
| R-03 / P0 | Data lifecycle and encryption | Memory revocation leaves stored rows; export/account-wide deletion/backup expiry not established. SQLite permissions/integrity are not at-rest encryption; restore not demonstrated. Proposed memory-deletion targets (primary ≤24 hours; backup/replica expiry ≤35 days) are unapproved. | Approve data classes, keys, retention, backup, deletion timelines, provider deletion limits, recovery objectives, and proposed memory-deletion targets. |
| R-04 / P0 | Approval/action confusion | Existing approval continuation resumes provider generation; no general executor or independent action-result proof. False “action complete” claims risk harm. | Specify PARMAR action boundary, executor, independent evidence, cancellation/unknown outcome handling, audit and UI semantics. |
| R-05 / P0 | AETHER security boundary | AETHER remote browsing is NO-GO and disabled. | Keep separate; no dependency or flag change absent independent gates and explicit authorization. |
| R-06 / P1 | Initial product and platform scope | Web-first is approved; Desktop, Android and iOS are future independently gated platforms. Android screen remains informational and iOS is not started. | Implement web scope first; do not claim or release any future client without its independent platform gate. |
| R-07 / P1 | Real inference and provider economics | Hybrid local/external provider routing, task-appropriate selection, consent before external transfer and no silent fallback are approved. Local Demo is not a model; production providers/models are not selected or configured. | Select and evaluate specific providers/models, cost/reliability limits, locality, retention and transport only after consent and security gates. |
| R-08 / P1 | Profile and team model | Independent PARMAR accounts, optional securely linked login methods, personal/multiple-profile/family-team modes and strict isolation are approved directions; production profiles and full isolation are not established. | Decide identity provider/recovery, profile/workspace roles and linking mechanics; prove cross-account/workspace isolation before enabling. |
| R-09 / P1 | Camera reference retention | Session-scope change does not itself delete IndexedDB record. | Decide logout/expiry/deletion cleanup and verify local storage removal; see Part 13 report. |
| R-10 / P1 | Task modes and autonomy | Guide, Execute and Orchestrate modes under PARMAR Core governance, authorization, approval and verification are approved; current approval continuation is not a general executor. | Specify action categories and implement authorization, approval binding, least-privilege execution, independent verification, cancellation, audit and emergency-stop gates before real side effects. |
| R-11 / P2 | Digital-human quality and licensing | High-quality 3D, photorealistic-premium and cinematic directions are approved; current source has a static portrait only and no selected renderer/rig or rights/device evidence. | Preserve all three directions; evaluate renderer, tier, assets, rights, hardware and measured quality before selection/claim. |
| R-12 / P2 | Voice modes and privacy | Multilingual voice is the product direction; initial mode is push-to-talk. Wake-word/background listening requires separate approval and security gates. Existing browser voice is partial. | Define language/platform matrix, processing locality, provider consent, transcript/audio retention and supported voice adapters; never enable hidden/background capture. |
| R-13 / P2 | Offline/hybrid and sync | Hybrid online/offline behavior, local AI where supported, offline drafts and controlled sync are approved directions; no local model runtime or sync is verified. Side-effecting queued actions must not replay automatically. | Select and evaluate runtime/infrastructure; decide keys, retention, conflict, revocation, sync protocols and offline recovery before enabling or claiming. |
| R-14 / P2 | Research truthfulness | Research source links/evidence, conflicting-source disclosure, uncertainty and independent verification are approved requirements. Source metadata does not prove generated claims; proposed evaluator targets are unapproved/unmeasured. | Define claim domains, evaluator/labeled set, “verified” rules and thresholds; keep verified labels disabled until measured and accepted. |
| R-15 / P2 | Reliability/operations | No measured budgets, queueing, retry, durable task recovery, or production runbook evidence. | Approve workload/SLOs, topology, RPO/RTO, operations ownership. |
| R-16 / P2 | Accessibility/language scope | WCAG 2.2 AA target and multilingual support are approved; responsive/reduced-motion source exists, but comprehensive conformance and platform-specific quality evidence is absent. | Define locale coverage, device/platform measurements, conformance evidence, owners and release thresholds; do not claim conformance before testing. |
| R-17 / P3 | Floating/wake-word and proactive assistance | Dedicated workspace and PARMAR-wide presence are approved; the current web implementation has a floating workspace launcher, not a floating interactive chat/voice mode. Wake-word/background listening requires separate approval and security gates. | Evaluate interactive floating mode and OS support separately; keep wake-word/background capture disabled until its additional approval and lifecycle/security evidence pass. |
| R-18 / P3 | Local/hybrid intelligence and cinematic rendering | PARMAR-managed independent local-AI infrastructure and evaluated external models are approved directions. No runtime/model/vendor is selected; hardware, license, distribution, update ownership, cost and quality are unevaluated. | Compare and select specific runtime/model only after reproducible POC, license/supply-chain review, device matrix and named patch/update owner. |

### Implementation details and technical decisions still requiring approval

The following are technical or operational decisions, not reversals of the
approved product directions above:

1. Select the production PARMAR identity provider, recovery path, linked-login design, role model and account/workspace lifecycle.
2. Select individual external providers/models, local model/runtime, cost limits, provider retention terms, routing implementation and consent receipts.
3. Define automatic-memory categories and consent UX, retention/deletion timelines, account export/reset behavior, key management, backup expiry and sync semantics. The proposed 24-hour primary deletion and 35-day backup/replica expiry values remain unapproved.
4. Define camera-still storage and cleanup at logout, expiry, profile switch and account deletion.
5. Define supported speech locales and platforms, local/cloud processing, transcript/audio retention and future non-push-to-talk modes.
6. Select a digital-human renderer/quality tier only after evaluation of the three approved directions, licenses and device measurements.
7. Define action categories, risk thresholds, executor/verifier architecture, audit, cancellation, emergency stop and independent evidence for each side effect.
8. Select offline/local AI and controlled-sync implementation, encryption/keys, conflict and recovery semantics; side-effecting queued work must never replay automatically.
9. Define measurable web/platform accessibility, multilingual coverage, performance/quality thresholds, device matrix and release evidence for the approved WCAG 2.2 AA target.
10. Define research domains, independent evaluator, labeled set and thresholds before any claim is marked “verified.”
11. Select the PARMAR-managed local-AI infrastructure and individual external model/provider only after licensing, hardware, supply-chain, distribution and update-owner review.
12. Define asset ingestion and customization controls, rights/safety review, consent, storage/retention and platform-specific rendering; situation-based recommendations remain separately gated.
13. Assign deployment, update, incident-response, operations, and release-approval owners.

### Decision-to-capability dependency and safe-default map

The approved directions below are not evidence of implementation or permission
to bypass a gate. Safe states prevent premature capability exposure while
technical choices, implementation, and acceptance evidence remain incomplete.

| Approved decision | Dependent capabilities | Remaining release gate | Safe behavior until implementation/evidence |
|---|---|---|---|
| D-01: Web-first; Desktop/Android/iOS are future independently gated platforms | Web initial scope and separate client feature/release claims | Each client must pass its own §10 platform gate | Implement/release only web scope with evidence; no parity or future-client claims. |
| D-02: Independent PARMAR accounts; optional securely linked login methods; personal, multiple-profile, family/team modes with strict isolation | Sign-in/recovery, profiles, roles, sharing, cross-user/workspace isolation | Phase 1 identity, route authorization and cross-account/workspace acceptance | No production identity or multi-profile/team access until verified; Local Demo is not production identity. |
| D-03: Hybrid local/external AI, task-appropriate routing, explicit consent before external transfer, no silent fallback | Inference, research egress, routing and fallback | Phase 2 consent/egress gate, provider evaluation and security acceptance | No external egress absent per-user authorization; no silent fallback or unsupported local-AI claim. |
| D-04: Automatic memory with user review/edit/delete/export/reset controls | Memory capture/retrieval, conversation context and account lifecycle | Phase 5 consent, identity, data-lifecycle and user-control acceptance | Do not capture/retrieve memory before explicit memory consent; do not assume retention/deletion timelines or model-training permission. |
| D-05: Camera understanding only with explicit permission and user-initiated capture; no hidden/background recording | Camera capture, image analysis and persisted stills | Per-platform camera/media permission, data-lifecycle and processing gate | No hidden/background capture; no capture/storage until the bounded operation and lifecycle pass. |
| D-06: Full multilingual voice direction, initial push-to-talk; wake-word/background listening needs separate approval/security gates | Speech input/output, language support, listening modes | Phase 4 per-platform permission, privacy and voice acceptance | Push-to-talk only after its gate; no wake-word/background listening or hidden cloud fallback. |
| D-07: Preserve 3D, photorealistic-premium and cinematic directions; renderer selection remains open | Avatar renderer, assets, hardware and quality claims | Phase 3 renderer, rights and platform/device acceptance | Preserve all three directions; no unselected renderer/quality claim. |
| D-08: Guide/Execute/Orchestrate under PARMAR Core governance, authorization, approval and verification | Task orchestration and real connector side effects | Phase 7 policy, action/approval, executor, independent verifier and audit gates | Guide-only behavior; approval alone never executes; no real side effects. |
| D-09: Hybrid online/offline vision, local AI where supported, offline drafts and controlled sync; never automatically replay queued side-effecting actions | Offline persistence/inference, drafts, queueing, hybrid routing and sync | Phase 9 runtime/data/platform/security gate | No unverified offline AI/sync claim; never queue-replay a side-effecting action automatically. |
| D-10: WCAG 2.2 AA target, multilingual support and measurable platform-specific quality standards | Accessibility/localization, performance budgets and release evidence | Define and pass platform-specific Phase 10/12 acceptance | Do not claim conformance, locale coverage or quality thresholds before evidence. |
| D-11: Research with source links/evidence, conflicting-source disclosure, uncertainty and independent verification | Research source and claim confidence labels | Phase 6 research/evaluator acceptance | Show provenance and uncertainty; do not mark claims verified until the independent evaluator passes. |
| D-12: PARMAR-managed independent local-AI infrastructure plus evaluated external models; no runtime/model/vendor selected | Local/hybrid inference, model/runtime procurement and updates | Phase 9 POC, license, supply-chain, device and update-owner review | No runtime/model/vendor assumption or local-AI production claim. |
| D-13: Full user-controlled VOKKI environment/appearance customization preserving canonical identity, voice and personality; uploaded assets require rights, safety and consent checks | Background selection/upload, wall/panel, lighting/colors, framing and appearance | Phase 3 preference, asset-rights, safety, privacy and platform gates | Preserve identity/voice/personality; keep unreviewed uploads and separately gated situation-based suggestions unavailable. |

## 12. Repository reuse and migration strategy

### Reuse without changing authority

- Retain [chat/service.py](./chat/service.py), [chat/providers.py](./chat/providers.py), [chat/orchestration.py](./chat/orchestration.py), [chat/context.py](./chat/context.py), [chat/response_safety.py](./chat/response_safety.py), and [chat/readiness.py](./chat/readiness.py) as a governed conversation foundation, subject to provider consent/reliability changes.
- Retain [interface/approvals.py](./interface/approvals.py), [sessions.py](./sessions.py), [conversations.py](./conversations.py), [memories.py](./memories.py), and [audit/decision_logs.py](./audit/decision_logs.py) after production data/key/recovery decisions.
- Retain VOKKI web lifecycle and voice/camera UX as bounded adapters, not proof of platform parity or digital-human implementation.
- Preserve PARMAR policy/enforcement modules as the authority; do not move authorization into VOKKI UI or model prompts.

### Migration principles

- No blanket rewrite. Replace a component only when Phase 0 evaluation shows a measurable or security requirement it cannot meet.
- Introduce versioned API/data contracts and migration tooling with rollback and backup evidence.
- Preserve existing user data; do not run migrations until their scope is separately approved and backup/restore is proven.
- Keep anonymous Local Demo distinct from production accounts and persistent data.
- Keep AETHER source and security gates untouched; do not merge its browser data, identity, or authority into VOKKI.
- The root README now describes VOKKI as a PARMAR-governed communication interface, links this PRD and the parallel development plan, and distinguishes current interface behavior from the broader approved product direction.

## 13. Implementation-readiness assessment

### Verdict

**Not ready for full-product implementation or production release.** The user-approved product directions and Task 23 documentation integration are verified in §11, but implementation-specific decisions, PARMAR Core services, security controls, runtime evidence and release acceptance remain incomplete. This documentation verification is not implementation or release acceptance.

**Ready for Phase 0 planning and tightly scoped evaluation only**, once owners are assigned. Web-first is approved product direction; no external provider, new action executor, cross-platform parity, or AETHER runtime integration should be assumed without its own implementation and acceptance gates.

### Blocking conditions

- Resolve P0 identity/deployment, external AI consent, data lifecycle, and action-boundary requirements.
- Review [VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md](./VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md), close its production blockers, and obtain runtime/test/independent security evidence before approving production security design.
- Resolve technical identity/provider, voice-platform, memory-lifecycle, action, runtime and operations details without reopening or weakening the approved product directions.
- Establish measurable baselines and release evidence rather than claiming source-level implementation as runtime verification.
- Maintain AETHER's independent project/security boundary and disabled browsing gate.

### Handoff rule

Implementation work must observe the approved product directions and proceed only within separately authorized scopes whose technical/security prerequisites and Phase 0 evidence are satisfied. Each roadmap phase must have a separate implementation task with bounded scope, tests, security review, rollback plan, and evidence. This document itself authorizes no code changes.

## 14. Task 17 audit correction traceability

The following maps the independent audit's findings F-01–F-13 to the focused corrections in this revision. User-approved product directions are recorded in §11; technical choices, proposed numeric targets and evidence remain pending where stated. No evaluation or implementation is claimed.

| Audit finding | Correction in this PRD |
|---|---|
| F-01 — Circular Phase 8/11 dependency | §7 and §8: platform-adapter contract is a Phase 0 artifact; Phase 8 depends on that contract, not Phase 11 implementation. |
| F-02 — Ambiguous platform release gates | §8 Phase 11–12 and §10: independent Web/Desktop/Android/iOS gates; one client neither certifies nor blocks another. |
| F-03 — Authentication loophole in SEC-01 | §3.13: non-loopback production deployment fails closed unless every exposed user-data/provider/tool/action route has verified server-side authentication and authorization; unlisted routes are denied. |
| F-04 — Security controls scheduled after sensitive capability | §8 Phases 0, 2, 7, and 10; §10: baseline route identity/authorization, consent and egress controls precede external provider traffic; connector-specific controls precede real execution. Phase 10 is defense-in-depth. |
| F-05 — Phase 1 tests require future data stores | §8 Phase 1: test isolation for identity/session/preferences introduced there; expand the cross-user matrix as each later data class is introduced. |
| F-06 — “Safe defaults” could enable deferred choices | §7 and §8 Phase 0: unresolved decisions disable dependent capability and block its phase/release gate; no permissive inferred default. |
| F-07 — Environment customization incomplete | §3.2 and Phase 3: the approved user-controlled environment/appearance direction is preserved with configurable backgrounds, uploads, positioning, wall/panel styles, lighting, colors, framing, rights/safety/consent gates and canonical identity reset. |
| F-08 — Memory revocation/deletion semantics incomplete | §3.5 MEM-01a/MEM-03 and §11: new use stops immediately; in-flight/pre-egress handling and already-transmitted-data limits are explicit; primary deletion and backup/replica expiry targets are measurable proposals awaiting approval. |
| F-09 — Claim verification not testable | §3.6 RE-03/RE-03a and §11: claim-level source-span support, explicit unsupported/indeterminate behavior, versioned human-reviewed evaluation set, and proposed precision/recall thresholds pending approval. |
| F-10 — Accessibility/locales unspecified | §3.15 and §11: WCAG 2.2 AA and multilingual support are approved targets; locale matrices, platform evidence, quality budgets and conformance remain gates. |
| F-11 — “Independent verification” undefined | §3.14 GOV-04 and §5.3: separately authorized observation evidence is required; provider repetition and executor self-report alone do not qualify. |
| F-12 — Performance budget methodology incomplete | §3.17 OPS-01/OPS-05 and §4: event definitions, workload/device matrix, cache state, sample/percentile/confidence reporting, availability denominator/exclusions, and platform-specific measurement required. Numeric values remain unapproved proposals. |
| F-13 — Local AI evaluation too narrow | §3.12 OFF-04 and §6: the approved direction is PARMAR-managed independent local-AI infrastructure plus evaluated external models; compare runtime/model options and evaluate hardware, locality, licensing, distribution, supply chain, and update/rollback ownership. |

## 15. Source evidence index

Key current evidence (line ranges refer to the inspected checkout):

- VOKKI web surface, status, voice, camera, approval: [interface/static/index.html](./interface/static/index.html) lines 227–323; [interface/static/voki-interface.js](./interface/static/voki-interface.js) lines 820–965.
- Canonical static portrait and lifecycle presentation: [interface/static/voki-avatar.js](./interface/static/voki-avatar.js) lines 6–66; [interface/static/styles.css](./interface/static/styles.css) lines 7122–7150, 7425–7455.
- Browser recognition/synthesis: [interface/static/voki-speech.js](./interface/static/voki-speech.js) lines 133–240, 392–645.
- AI providers, local demo, limits: [chat/providers.py](./chat/providers.py) lines 20–26, 70–95, 101–145, 206–243, 343–475.
- PARMAR response governance/release: [chat/service.py](./chat/service.py) lines 271–333, 378–435, 623–656.
- Provider authorization: [chat/readiness.py](./chat/readiness.py) lines 274–360.
- Memory API and repository: [interface/futuristic_app.py](./interface/futuristic_app.py) lines 967–1068, 1475–1488; [memories.py](./memories.py) lines 326–430, 450–535, 535–626.
- Approval creation/consumption/continuation: [interface/futuristic_app.py](./interface/futuristic_app.py) lines 251–325, 1160–1268; [interface/approvals.py](./interface/approvals.py) lines 568–672.
- Research: [research/service.py](./research/service.py) lines 26–91; [research/models.py](./research/models.py) lines 298–317.
- Threaded server and request bounds: [interface/futuristic_app.py](./interface/futuristic_app.py) lines 70, 850–900, 1636–1660.
- Android VOKKI informational scope: [android/app/src/main/kotlin/org/parmar/aether/ui/ParmarVokkiScreen.kt](./android/app/src/main/kotlin/org/parmar/aether/ui/ParmarVokkiScreen.kt) lines 49–54.
- iOS not started: [ios/IMPLEMENTATION-AND-VERIFICATION.md](./ios/IMPLEMENTATION-AND-VERIFICATION.md) lines 1–5.
- AETHER boundary and no-go: [desktop/security.cjs](./desktop/security.cjs) line 5; [AETHER-SECURITY-GATES.md](./AETHER-SECURITY-GATES.md) lines 1–18.
- Source-level test inventory: [tests/](./tests/); tests were not run for this document.
- Part 13 source-and-test-inventory assessment: [VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md](./VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md); no tests or production checks were run for that report.

---

**Document status:** Draft for requirements and implementation-readiness review.  
**Repository status at authoring start:** `main`, `69527f6b39d0521746eb91cd96b5fa44fc48348c`, clean.  
**Implementation status:** No application implementation is authorized or claimed; this revision contains documentation corrections only.  
**AETHER status:** Preserved; `REMOTE_BROWSING_ENABLED=false`.

## 16. Task 20 independent audit finding traceability

This table records the focused corrections made in response to all eight Task 20 findings. The additions clarify requirements and acceptance evidence; they do not claim implementation, runtime validation, production readiness, or approval of pending policies. No previously approved VOKKI capability is removed or downgraded. Open decisions and proposed policies remain explicitly unresolved.

| Finding | Correction in this PRD |
|---|---|
| H-01 — Provider consent revocation | §3.4 defines behavior before, during, and after transmission, prohibits unsupported recall/deletion claims, and requires fresh consent before future transfer. AI-06/AI-07 and Phase 2 add revocation and zero-future-egress acceptance tests. |
| M-01 — Complete data lifecycle | §3.13 adds class-specific lifecycle coverage for identity/session, conversations, memory, files, backgrounds, camera/media, audit/tasks, and provider-transmitted data; account-closure behavior; SEC-07 evidence; and explicit pending timelines. |
| M-02 — Floating VOKKI | §§3.2–3.3 define functional quick chat/voice, expansion, continuity, platform limitations, accessibility, and separately gated wake-word/background listening. DH-08/VO-06/VO-07 add acceptance criteria. |
| M-03 — Digital-human quality tiers | §3.2 preserves high-quality 3D, photorealistic, and cinematic directions, identifies photorealism as premium target, and separates vision from selected implementation tiers. DH-06 requires evaluation and user approval before selection. |
| M-04 — Media understanding | §3.7 specifies distinct document, image, audio, and video gates for permissions, processing, transfer, retention, failure, and evidence. WS-04 requires per-type testing; unsupported media remains disabled. |
| M-05 — Transport security | §§3.13, Phase 2, Phase 10, and §10 require verified ingress/TLS termination, trusted-proxy boundaries, provider-egress TLS/certificate validation, fail-closed deployment configuration, and deployment evidence; no deployed control is claimed. |
| LOW-01 — Situation-based clothing | §3.2 preserves situation-based outfit suggestions as future, user-controlled customization subject to scope approval; DH-07 tests opt-in/selection and non-interference with identity/personality. |
| LOW-02 — Decision dependency map | §11 maps the approved D-01–D-13 directions to dependent capabilities, remaining release gates, and safe behavior until implementation/evidence is complete. |
