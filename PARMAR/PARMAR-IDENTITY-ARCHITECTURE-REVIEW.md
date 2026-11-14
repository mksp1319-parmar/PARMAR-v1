# PARMAR Identity Architecture — Independent Review

| Field | Value |
|---|---|
| Review type | Independent, security-focused, read-only architecture review |
| Evidence basis | Current working-tree documents and source inspected for Task 34 |
| Architecture reviewed | [PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md) |
| Governing decisions | [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md), [traceability matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md), [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md), [PARALLEL-DEVELOPMENT-MASTER-PLAN.md](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md) |
| Approval status | This review does not change or approve any IT/D decision, provider, protocol, implementation, migration, or release |

## 1. Executive assessment

**Verdict: BLOCKED.** The proposal is a coherent, provider-neutral target architecture and correctly separates shared PARMAR identity from product authorization. It preserves the Android offline-only boundary, keeps Desktop remote browsing disabled, rejects automatic account matching, and protects user-scoped memory and legacy unprofiled conversations. No critical architectural flaw was confirmed, and a major redesign is not indicated.

The design is **not ready for dependent implementation**. Before production identity or cross-product integration, human owners must resolve the provider/authentication and SSO session topology without presuming a protocol; VOKKI must have a complete protected-route/data authorization inventory; and AETHER Desktop must have an explicit, independently isolated authenticated-control session design. Profile sharing additionally requires a reviewed operation-to-View/Edit/Manage map. External AI egress needs a race-safe consent/revocation acceptance rule. The current parallel plan also contains wording that should be clarified before integration.

This verdict is not a production-readiness judgment. Repository source and documentation cannot establish deployed behavior. No tests, builds, device/runtime checks, or provider flows were run for this review.

## 2. Scope and inspected evidence

### Governing documents

All seven required current-working-tree documents were present and inspected:

1. [PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md)
2. [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md)
3. [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md)
4. [PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md](./PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md)
5. [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md)
6. [PARALLEL-DEVELOPMENT-MASTER-PLAN.md](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md)
7. [VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md) — inspected as the historical review record; its own supersession notice makes the final ADR authoritative for IT-01–IT-15.

### Implementation evidence

- **VOKKI/PARMAR Core:** [identity.py](./identity.py), [identity_store.py](./identity_store.py), [sessions.py](./sessions.py), [conversations.py](./conversations.py), [memories.py](./memories.py), [interface/futuristic_app.py](./interface/futuristic_app.py), [chat/readiness.py](./chat/readiness.py), and [chat/router.py](./chat/router.py). These show server-created principal contracts, local profile/workspace storage, server-side session primitives, owner-scoped records, HTTP route handling, and server-side external-provider allow-list/fallback controls. They do not establish a production PARMAR account registry, shared SSO, complete route authorization, or deployment acceptance.
- **AETHER Android:** [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml), [AETHER-MOBILE-OFFLINE-CONTRACT.md](./AETHER-MOBILE-OFFLINE-CONTRACT.md), [PERSISTENCE-ARCHITECTURE.md](./android/PERSISTENCE-ARCHITECTURE.md), and [LocalAetherDatabase.kt](./android/app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt). The manifest contains no declared permissions and disables backup; the local database uses SQLite. The offline contract prohibits network, WebView, external handoff, and PARMAR/VOKKI service calls.
- **AETHER Desktop:** [security.cjs](./desktop/security.cjs), [main.cjs](./desktop/main.cjs), [profiles.cjs](./desktop/profiles.cjs), [profile-partitions.cjs](./desktop/profile-partitions.cjs), [browser-preload.cjs](./desktop/browser-preload.cjs), [browser-child-supervisor.cjs](./desktop/browser-child-supervisor.cjs), [browser-child-broker.cjs](./desktop/browser-child-broker.cjs), and [ISOLATION-READINESS.md](./desktop/ISOLATION-READINESS.md). Current source sets `REMOTE_BROWSING_ENABLED=false`, uses local profile partitions and hardened renderers, and records Linux-only process-isolation work with non-Linux in-process behavior and uncompleted runtime acceptance.

**Evidence versus inference:** statements about present source are repository observations, not proof of deployed behavior. Failure scenarios below are realistic consequences of the stated gaps, not claims that those failures have occurred. Existing test files were identified but not executed.

## 3. Architecture strengths

- **Correct identity/authority split:** §§1, 3, 5–7 make PARMAR Core the account authority while requiring products to authorize their own resources/actions. Shared identity does not confer workspace access, approval, execution, or browser authority.
- **Provider and protocol are not silently chosen:** §§2, 5, 7, and 13 label the interfaces logical, keep provider/protocol/handoff open, and require comparison and security approval before selection.
- **No attribute-based account merge:** §4.1 uses exact method mapping and fresh proof for linking; §9 rejects email/name/phone matching and requires explicit verified mapping.
- **Fail-closed design:** session, authorization, consent, key, and audit dependency failures deny protected work; anonymous downgrade and plaintext fallback are explicitly rejected (§§5–6, 11).
- **Least-privilege tenancy model:** §4.4 separates workspace membership from owner-issued revocable resource grants; §6 requires a complete authorization tuple and commit-time revalidation where races matter.
- **Memory and migration safeguards:** §4.5 and §9 preserve user/account scope, explicitly leave legacy unprofiled conversations unassigned, require reauthentication instead of silently upgrading demo sessions, and require dry-run/rollback/isolation evidence.
- **AI consent and lifecycle are treated as independent authority:** §§4.5–6 and 10–12 require scoped consent, data minimization, no silent fallback, truthful partial deletion status, and explicit evidence for backups and external copies.
- **Product/platform boundaries are explicit:** §8 prohibits Android networking/authentication under the current contract and preserves Desktop's remote-browsing deny state independently of sign-in.
- **Acceptance criteria are broad and appropriately not represented as passed:** §12 covers account mapping, sessions, authorization, data lifecycle, AI transfer, platform behavior, and production gates.

## 4. Findings grouped by severity

### HIGH

#### H-01 — Desktop authenticated-control credential isolation needs an enforceable storage boundary

- **Exact location:** Architecture §§2.1, 3, 5.1, 7, and 8; current Desktop evidence in [main.cjs](./desktop/main.cjs), [profile-partitions.cjs](./desktop/profile-partitions.cjs), [browser-preload.cjs](./desktop/browser-preload.cjs), and [ISOLATION-READINESS.md](./desktop/ISOLATION-READINESS.md).
- **Evidence:** The proposal says authentication may terminate in a privileged main process or separate trusted control client, excludes credentials from browser content, and requires strict IPC. It does not explicitly require a distinct authenticated-control process/origin, separate Electron `Session`/cookie store and profile storage, and prohibit reuse of the browser profile partitions. Current Desktop uses persistent per-profile Chromium partitions. Remote browsing is disabled; the readiness record says Linux process isolation is not available on non-Linux and runtime acceptance remains incomplete.
- **Realistic failure scenario (inference):** A later implementation hosts the PARMAR control/login surface in, or shares a persistent partition with, an AETHER browser profile. Auth cookies or control state then become reachable to the browser context or are sent along with browser activity when a separately gated browsing capability is enabled.
- **Impact:** PARMAR credentials or authenticated control state could cross into the browser trust domain; shared sign-in could become an unintended authority bridge.
- **Recommended correction:** Require a separate control-plane process/surface and dedicated non-browser credential store/session partition; forbid PARMAR credentials, auth cookies, bearer headers, and generic credential IPC in every browser profile/renderer. Add per-platform tests proving storage/session separation and no credential-bearing browser requests.
- **Blocks implementation:** **Yes — AETHER Desktop authentication/SSO integration.** It does not block unrelated local/offline AETHER work or VOKKI-only contract design. `REMOTE_BROWSING_ENABLED=false` and all existing NO-GO gates must remain.
- **Decisions affected:** IT-05; D-01, D-02.

#### H-02 — VOKKI lacks a complete protected-route/data authorization inventory

- **Exact location:** Architecture §§3, 5–6, and 12; current route evidence in [interface/futuristic_app.py](./interface/futuristic_app.py) and persistence boundaries in [conversations.py](./conversations.py), [memories.py](./memories.py), and [identity_store.py](./identity_store.py). Related accepted gates are in [PARALLEL-DEVELOPMENT-MASTER-PLAN.md §4](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md) and [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md).
- **Evidence:** The architecture requires every protected operation to be authorized and calls for a “complete authorization matrix,” but supplies no inventory of actual HTTP routes, methods, data classes, public exceptions, ownership predicates, grant checks, or test cases. The inspected VOKKI source has route handling and owner-scoped repositories; neither source existence nor the conceptual flow demonstrates complete perimeter coverage.
- **Realistic failure scenario (inference):** A newly added or overlooked read/export/action route omits session or resource authorization while the rest of the API is protected, allowing an unauthenticated or cross-user request to access data.
- **Impact:** A partial perimeter can invalidate otherwise sound account/session controls and expose conversations, memory, or workspace data.
- **Recommended correction:** Before production integration, produce a versioned route/method/data-class matrix; map each route to principal source, resource owner, profile/workspace/grant and consent predicates, failure behavior, and negative tests. Default all unlisted routes to deny. Cover every route on each release.
- **Blocks implementation:** **Yes — production VOKKI identity exposure and all cross-user sharing.** Synthetic contract work may proceed only with deny-by-default behavior.
- **Decisions affected:** IT-01, IT-07, IT-08, IT-10, IT-12, IT-15; D-02, D-03, D-04, D-08.

#### H-03 — Production authentication and SSO topology remain approval blockers

- **Exact location:** Architecture §§2, 5, 7, and 13; [VOKKI-IDENTITY-TENANCY-ADR.md §§1–3](./VOKKI-IDENTITY-TENANCY-ADR.md); [VOKKI-MASTER-PRD.md §3.1 and §11](./VOKKI-MASTER-PRD.md).
- **Evidence:** The architecture correctly leaves provider, protocol, enrollment, handoff, and token/session topology unresolved. IT-02 explicitly requires provider comparison and security approval before selection. The approved SSO requirement is one PARMAR identity and no separate VOKKI/AETHER accounts, but the design intentionally offers only logical service interfaces—not an approved method to establish SSO sessions across products.
- **Realistic failure scenario (inference):** An implementer fills the gap by selecting a familiar provider/protocol or reusing product credentials/cookies without the required comparison and approval, creating a second account namespace or an unreviewed cross-product token boundary.
- **Impact:** Violates an explicit approval boundary and may establish insecure issuer validation, audience/session sharing, logout, or recovery behavior.
- **Recommended correction:** Keep provider/protocol unselected. Obtain the required comparison and security approval; then approve an SSO contract covering account resolution, product audiences, handoff replay/expiry, session issuance, logout/revocation propagation, recovery, and failure behavior. Evidence must demonstrate one account across protected products without shared authorization or separate product credentials.
- **Blocks implementation:** **Yes — production authentication and PARMAR-wide SSO.** Provider-neutral logical design and synthetic tests can continue. This is a deliberate approval gate, not a contradiction in the specification.
- **Decisions affected:** IT-01, IT-02, IT-04, IT-05; D-02.

### MEDIUM

#### M-01 — Legacy user-owner to PARMAR-account mapping needs a verifiable ownership procedure

- **Exact location:** Architecture §§4.1, 4.5, and 9; current owner fields in [identity.py](./identity.py), [conversations.py](./conversations.py), and [memories.py](./memories.py); [traceability matrix IT-01/IT-09](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md).
- **Evidence:** New logical records use `account_id`/`owner_account_id`, while current VOKKI data uses server-created `user_id`/`owner_user_id` UUIDs. The architecture correctly says they are not proven equivalent and requires account-owner verification, collision reporting, exact counts, and rollback, but does not define the evidence/interaction that verifies a legacy data owner or how unmappable rows remain isolated.
- **Realistic failure scenario (inference):** A migration operator treats a legacy UUID as a PARMAR account ID or resolves an ambiguous owner mapping, attaching conversations or memories to another account or making data inaccessible.
- **Impact:** Cross-account disclosure, orphaned records, or loss of user access; consent and memory scope may be misrepresented.
- **Recommended correction:** Define a separately approved mapping record and provenance, an explicit owner-verification process, collision/orphan quarantine, and before/after ownership counts. Permit no mapping on ambiguous evidence; keep records inaccessible/unassigned until resolved. Test rollback and prove memory remains user/account-scoped without changing visibility.
- **Blocks implementation:** **Yes — production data migration/rekeying.** It does not block an isolated identity contract using synthetic data.
- **Decisions affected:** IT-01, IT-03, IT-09, IT-10.

#### M-02 — Consent-revocation races at the external-transfer boundary need a measurable rule

- **Exact location:** Architecture §§4.5, 5 (`ConsentService.check`), 6, 10, 11, and 12; [VOKKI-MASTER-PRD.md D-03/D-04 gates](./VOKKI-MASTER-PRD.md); existing external authorization in [chat/readiness.py](./chat/readiness.py) and fallback behavior in [chat/router.py](./chat/router.py).
- **Evidence:** The design requires consent immediately before transfer, revocation checks, minimization, zero-egress tests, and no fallback. It also acknowledges revocation races, but does not define the ordering guarantee when a revocation and an already-authorized outbound request race, or the exact audit/status evidence for an in-flight transfer that cannot be recalled.
- **Realistic failure scenario (inference):** Consent is revoked after a check but before the provider receives the request; data is transferred after the user believes further use has stopped, or the UI implies that already-sent data was recalled.
- **Impact:** Unauthorized or unexpected external disclosure and misleading consent/lifecycle reporting.
- **Recommended correction:** Define an atomic/versioned authorization point at the transfer boundary, cancellation behavior for queued/in-flight requests, the exact prospective effect of revocation, and truthful status for data already sent. Add deterministic race tests with a controllable provider transport and assert zero requests after the defined revocation boundary.
- **Blocks implementation:** **Yes — external AI egress.** Local/demo processing with no external transfer is not blocked by this finding.
- **Decisions affected:** IT-10, IT-12; D-03, D-04.

#### M-03 — Profile grant semantics are not implementation-ready for sharing

- **Exact location:** Architecture §§4.4, 6, 12, and 13; [VOKKI-IDENTITY-TENANCY-ADR.md IT-07/IT-08](./VOKKI-IDENTITY-TENANCY-ADR.md); current workspace/profile associations in [identity_store.py](./identity_store.py).
- **Evidence:** `ResourceGrant` models View/Edit/Manage and the specification explicitly says operation mapping, invitation/member lifecycle, and Manage delegation remain open. Existing `workspace_profiles` associations and OWNER/ADMIN/MEMBER roles are not the approved grant model.
- **Realistic failure scenario (inference):** A product maps `Manage` broadly or treats workspace ADMIN/membership as equivalent to a profile grant, enabling a member to read or alter personal content without an owner-issued permission.
- **Impact:** Cross-profile or cross-workspace disclosure or unauthorized mutation.
- **Recommended correction:** Approve a route/action-to-grant matrix, whether and how Manage can delegate, grant expiration/revocation semantics, and failure behavior. Test each operation for owner, explicit grantee, membership-only user, unrelated user, and revoked grant. Keep sharing disabled until acceptance.
- **Blocks implementation:** **Yes — profile sharing and cross-user workspace access.** Owner-only personal use can proceed after its own route gates.
- **Decisions affected:** IT-06, IT-07, IT-08; D-02.

### LOW

#### L-01 — Parallel-plan account-independence wording is ambiguous against approved SSO

- **Exact location:** [PARALLEL-DEVELOPMENT-MASTER-PLAN.md §1](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md), compared with its D-02 register and [VOKKI-MASTER-PRD.md §3.1](./VOKKI-MASTER-PRD.md); the architecture notes this tension in §15.
- **Evidence:** The plan says AETHER browser work does not depend on “PARMAR account availability,” while D-02 and the PRD require PARMAR-wide SSO for authenticated PARMAR surfaces. The plan also says AETHER is independent and preserves local/offline work. Those statements can coexist if “browser work” means local/offline AETHER functionality only, but the opening wording does not make that scope explicit.
- **Realistic failure scenario (inference):** A workstream interprets independence as authorization for a separate AETHER login or as a reason not to use PARMAR identity for a future authenticated AETHER surface.
- **Impact:** Product identity fragmentation or accidental weakening of the approved shared-account boundary.
- **Recommended correction:** Clarify with the decision owner that local/offline AETHER remains usable without an account, while any separately approved authenticated PARMAR surface uses the shared PARMAR identity and receives no browsing authority by default. Do not alter the approved decision.
- **Blocks implementation:** **No — local/offline AETHER work. Yes — cross-product integration until wording is clarified.**
- **Decisions affected:** IT-02; D-01, D-02.

## 5. IT-01–IT-15 traceability review

“Implementable” below assesses whether the proposed design is sufficiently specified for the relevant scope—not whether source exists or a test passed. Production implementation remains subject to H-01–H-03 and the ADR gates.

| Decision | Representation and missing/contradicted requirement | Implementability | Evidence required for acceptance |
|---|---|---|---|
| **IT-01 — Immutable PARMAR account ID** | Correct: §4.1 assigns an opaque PARMAR-generated ID, independent of email/phone/provider/device/client input. Account creation, lifecycle, representation, and legacy owner mapping remain open. No contradiction found. | Logical contract implementable; production account/data mapping is blocked. | Two synthetic accounts get distinct stable IDs; identity survives method/attribute changes; clients cannot choose ID; uniqueness/conflict and migration crosswalk tests. |
| **IT-02 — Defer provider selection** | Correct: no provider/protocol is selected; comparison and security approval are required (§§5, 13). No provider is presumed by the proposal. | Provider-neutral contract is implementable; production authentication is intentionally blocked pending human approval. | Dated requirements comparison, explicit security approval, approved adapter/issuer configuration, invalid/replay/issuer-confusion denial tests. |
| **IT-03 — Fresh-proof linking; no auto-link/merge** | Correct: §4.1 requires current session, fresh proof, conflict checks, audit/notification; matching attributes are prohibited. Recovery, conflict UX, last-method, and merge policy remain open. | Linking remains deferred; no implicit account merge can be implemented safely. | Fresh-proof expiry/replay and conflicting-subject tests; no mapping mutation on failure; audit/notification and verified recovery/last-method scenarios. |
| **IT-04 — Recovery, passkeys, verification, abuse and lost devices** | Correctly recorded as mandatory but gated (§§5, 10, 13). Exact methods, assurance floor, channels, thresholds, support owner, and lockout/notification policy are missing by design. | Designable, not production-ready or sufficiently specific for production recovery implementation. | Approved threat-reviewed recovery/assurance policy; passkey and fallback exercises; rate-limit/credential-stuffing/lost-device tests; non-enumerating responses; session revocation and step-up tests. |
| **IT-05 — Per-device sessions, inventory, logout, step-up** | Correct: session/device logical records, verifier-only opaque tokens, audience, expiry, rotation, individual/account revocation and step-up exist (§§4.3, 5). Device inventory UX, lifetime/latency, storage policy, and Desktop credential store separation remain open (H-01). | Core logical service is implementable after session policy approval; Desktop SSO is blocked until H-01. | Multi-device session issue/expiry/rotation/replay; inventory accuracy; individual/all-device logout; measured revocation bound; step-up; secret-leak scan; platform storage isolation and pending-approval revalidation. |
| **IT-06 — Eventual personal/multiple-profile/family-team scope** | Correct: §4.4 models owner profiles/workspaces while explicitly gating detailed policy and enablement. No premature family/team access is authorized. | Owner-only profiles can be implemented; family/team and sharing await policy and H-03/M-03 gates. | Approved membership/invitation lifecycle and roles; demonstrate membership alone never grants personal data; two-user/two-workspace allow/deny evidence. |
| **IT-07 — Membership never grants personal-content access** | Correct: membership and resource grants are separate (§§1, 4.4, 6). No contradiction found. Route-complete enforcement evidence is absent (H-02). | Requirement is clear, but production acceptance is not possible without route inventory and enforcement. | Every route/data class tested for owner, workspace member without grant, explicit grant, unrelated account, and revoked membership/grant; all reads and writes fail closed. |
| **IT-08 — Owner-controlled profiles and explicit revocable grants** | Correct in principle (§4.4); owner issues/revokes View/Edit/Manage. Exact operation mapping and Manage delegation remain unresolved (M-03). | Owner-only use is implementable; sharing is not implementation-ready. | Approved operation matrix; grant creation/revocation, expiry, delegation and race tests; deny membership/admin-only access; cross-resource tests. |
| **IT-09 — User-scoped memory by default** | Correct: §4.5 preserves account/user-scoped memory and forbids automatic profile/workspace migration/sharing. Existing `user_id` to future `account_id` crosswalk remains a migration gate (M-01). | New account-scoped design implementable; legacy migration blocked pending verified mapping. | Two-account memory isolation; profile switching does not change memory scope; no automatic migration/share; mapping provenance, counts, rollback and orphan handling. |
| **IT-10 — Review/edit/export/delete/reset and truthful lifecycle** | Correct: lifecycle records/status and partial-failure truthfulness are described (§§4.5, 5, 11). Per-data-class inventory, retention, UI, backup/provider-copy semantics, and race handling need detail. | Contract design implementable; production lifecycle claims and closure remain blocked. | Data-custodian inventory; owner-scoped review/edit/export/delete/reset; consent-revocation semantics; backup/provider-copy and partial-failure reports; retry/idempotency and restore evidence. |
| **IT-11 — Production encryption, keys, residency, recovery/testing** | Correctly required; KeyService and production gates are proposed (§§3, 5, 10, 12–13). Algorithms, deployment, key custody, residency, recovery objectives, and operational owners are explicitly unresolved. No source evidence establishes production encryption. | Production storage is blocked until design and operations approvals; conceptual interfaces are implementable. | Deployed data/backup encryption inspection; key access/rotation/recovery tests; residency record; restore exercise; independent security evidence; outage with no plaintext fallback. |
| **IT-12 — Scoped external-AI consent, minimization, no fallback** | Correct: consent service check, purpose/scope/category, minimal transfer, fail-closed provider outage and zero-egress requirement (§§3, 5–6, 10–12). Consent race ordering is underspecified (M-02). Existing server allow-list is not user consent. | No external egress until scoped consent and transfer-boundary rule are accepted. | User-scoped consent/version/revocation; payload minimization inspection; absent/expired/revoked/unavailable consent yields zero egress; race test at transfer boundary; provider outage never switches silently; auditable transfer provenance. |
| **IT-13 — PARMAR-managed independent AI as long-term goal** | Correct: retained as a goal with no model/runtime selection (§§1, 7, 13). No infrastructure is asserted. | Evaluation can proceed as separately approved research; implementation is not ready. | Comparative feasibility, licensing/supply-chain review, security assessment, reproducible benchmarks, deployment/cost analysis, named patch/update owner and rollback plan. |
| **IT-14 — Offline drafts/cache, reauthorization, conflicts, no side-effect replay** | Correct: Android remains local-only; architecture does not create Android SSO/networking. Future sync requires server reauthorization, explicit conflicts and no replay (§§8, 11–12). VOKKI-specific offline data classes remain open. | AETHER Android local shell remains implementable offline; authenticated Android/network SSO is not authorized. VOKKI sync is blocked pending a separate design. | Android packaged merged-manifest and device network-denial tests, WebView/network dependency scan, offline persistence and deletion; if VOKKI sync is separately approved, reauthorization/revocation/conflict/no-replay tests. |
| **IT-15 — Secure closure, revocation, truthful lifecycle, no standing support access** | Correct: account-wide session revocation, approval revalidation, async lifecycle status, no standing access are represented (§§4.3, 5, 10–12). Closure grace/retention, disconnected-device limits, exceptions, support process, and operational proof remain open. | Conceptual contract implementable; production closure/support access is blocked pending policy and deployed evidence. | Closure step-up; session/device/approval revocation; per-data-class status including backups and provider copies; disconnected-device behavior; audited time-bounded exception tests; evidence of no standing support access. |

## 6. D-01–D-13 and PARMAR-wide SSO consistency

| Decision | Consistency review |
|---|---|
| **D-01 — Web-first; future platforms independently gated** | Consistent: §5.1 separates web/native credential requirements and §§7–8 keep AETHER platform boundaries distinct. Identity specification does not claim platform readiness; per-platform runtime/security acceptance is still required. |
| **D-02 — One PARMAR account/SSO; no separate product accounts; strict isolation** | Substantively consistent: §§1, 4.1, 5, and 7 establish a shared account authority, exact mapping, product audiences, and independent product authorization. SSO handoff/session topology is intentionally unselected; H-03 blocks implementation until approved. |
| **D-03 — Hybrid AI; explicit consent; no silent fallback** | Consistent: §§3, 5–6, and 10–11 require scoped consent, minimization, fail-closed provider behavior, and no fallback. External egress remains blocked pending M-02 and operational/provider gates. |
| **D-04 — Automatic memory with user controls** | Not contradicted: §4.5 includes account-scoped memory and lifecycle records, but this identity document does not specify the full capture/review/edit/export/delete/reset UX or memory-specific consent semantics. Those remain IT-09/10 and product lifecycle gates. |
| **D-05 — Explicit permission and user-initiated camera capture** | Not contradicted; camera capture behavior is outside the identity design. If camera data is introduced, it must be covered by the same purpose, consent, data-minimization, lifecycle, and per-platform authorization gates. |
| **D-06 — Multilingual voice; push-to-talk initially; wake-word separately gated** | Not contradicted; speech/listening modes are outside scope. Authentication must not imply microphone permission or authorize background listening. |
| **D-07 — Preserve 3D/photorealistic/cinematic directions** | Not contradicted; rendering, asset rights, and performance are outside this identity architecture and retain their independent product/platform gates. |
| **D-08 — Guide/Execute/Orchestrate under PARMAR Core** | Consistent: §§1, 5–6, and 7 separate authentication from authorization, approval, execution, and verification; identity or step-up alone is not action approval. |
| **D-09 — Hybrid/offline drafts/sync; never replay side effects** | Consistent: §8 prohibits Android networking/SSO under the current contract; §§6, 8, 11–12 require reauthorization, conflicts, revocation handling, and no automatic replay for any separately approved sync. VOKKI sync remains unimplemented. |
| **D-10 — WCAG 2.2 AA, multilingual and measurable platform quality** | Not contradicted; accessibility/localization are not specified here. Authentication/recovery and consent flows still require accessible, platform-specific acceptance under the PRD. |
| **D-11 — Research provenance, conflict disclosure, uncertainty, independent verification** | Not contradicted; research evaluation is outside scope. Consent/identity approval does not establish research provenance or independent claim verification. |
| **D-12 — PARMAR-managed local AI and evaluated external models** | Consistent: no runtime/model/provider is selected (§13); feasibility, license, supply-chain, security, and update ownership remain gates. |
| **D-13 — User-controlled customization; preserve canonical identity; asset checks** | Not contradicted; customization/asset-ingest policy is outside identity scope. Any uploaded asset access/storage still requires owner authorization, consent, rights/safety review, and lifecycle controls. |
| **PARMAR-wide SSO requirement** | The proposal correctly means one PARMAR account and shared sign-on for authenticated PARMAR surfaces—not separate product accounts and not shared product authorization. Provider, protocol, SSO handoff, cookie/session topology, and logout propagation are not selected. Do not infer OAuth/OIDC, shared cookies, a central hosted provider, or any other mechanism. Obtain explicit human/security approval before implementation; preserve product-specific access checks. |

No approved IT or D decision is reopened or silently changed by this review. The only cross-document issue is the wording ambiguity in L-01; resolve it with the decision owner rather than interpreting it as authority to create a second login.

## 7. VOKKI integration assessment

- **Target fit:** PARMAR Core as account/mapping/session authority and VOKKI as an independently authorized product is the right boundary. The request context should be server-derived; client identity/profile/workspace/consent fields must not establish access.
- **Current evidence:** [identity.py](./identity.py) defines principal/resolver contracts and anonymous Local Demo; [sessions.py](./sessions.py) supplies local server-side session primitives; [identity_store.py](./identity_store.py) stores profiles/workspaces/memberships and associations; [conversations.py](./conversations.py) and [memories.py](./memories.py) have owner-scoped storage. These are not a production identity registry or shared SSO.
- **Authorization gap:** existing profile/workspace associations are not View/Edit/Manage grants. There is no demonstrated complete route/data-class inventory or cross-user acceptance. Close H-02/M-03 before exposing production routes or sharing.
- **Consent gap:** current server-side provider allow-list/fallback controls are not per-user, purpose/data-category consent; no end-to-end zero-egress or transfer-race evidence was run.
- **Recommended integration order:** (1) approved provider-neutral account/SSO contract and mapping; (2) complete route authorization matrix; (3) session/recovery/device and revocation implementation; (4) verified account-owner mapping for any data migration; (5) grants and external egress only after their separate acceptance. Keep Local Demo distinct and do not claim production readiness.

## 8. AETHER Desktop assessment

- **Verified source boundary:** [security.cjs](./desktop/security.cjs) sets `REMOTE_BROWSING_ENABLED=false`; [main.cjs](./desktop/main.cjs) applies sandbox, context isolation, no Node integration, profile-specific Chromium sessions, and request-denial behavior. [profiles.cjs](./desktop/profiles.cjs) and [profile-partitions.cjs](./desktop/profile-partitions.cjs) are app-local browser profiles, not PARMAR accounts.
- **Architecture fit:** §§3, 5.1, and 8 prohibit exposing PARMAR credentials to browser content and correctly state that authentication is not browsing permission.
- **Blocking gap:** H-01. Specify a separate control-plane process/surface and credential/session store—not only “main process” versus renderer. Do not reuse the persistent browser profile/session partition or inject identity credentials through browser IPC, navigation, or request headers.
- **Isolation limits:** [ISOLATION-READINESS.md](./desktop/ISOLATION-READINESS.md) documents Linux-only process isolation and non-Linux in-process behavior, and states that runtime acceptance is incomplete. Therefore no identity integration may treat current renderer hardening, tests, or the disabled flag as independent proof that remote content is isolated on all platforms.
- **Required safe state:** preserve `REMOTE_BROWSING_ENABLED=false` and all AETHER admission/isolation NO-GO gates until independent platform/runtime review passes. SSO must not enable browsing, alter request policy, or merge browser cookies/data.

## 9. AETHER Android offline-boundary assessment

- **Verified source boundary:** [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml) has no declared permissions and sets `allowBackup=false`; [LocalAetherDatabase.kt](./android/app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt) implements local SQLite persistence. The [offline contract](./AETHER-MOBILE-OFFLINE-CONTRACT.md) prohibits network calls, WebView/browser engines, external handoff, and PARMAR/VOKKI calls.
- **Architecture fit:** §8 explicitly keeps the Android shell usable without network/account and proposes no active Android SSO path. This correctly preserves the user's no-Android-INTERNET/WebView/networking requirement.
- **Boundary:** an Android-local profile remains local app state, not a PARMAR account. Shared sign-on must not be added to the existing shell. Any future request for a separate authenticated capability requires explicit new approval and must not silently expand this offline app.
- **Unverified:** repository inspection does not prove the merged packaged manifest, dependency graph, actual device network behavior, or backup exclusion at runtime. No Android build/device test was run for this review. `allowBackup=false` is not encryption evidence.

## 10. Migration and data-integrity risks

1. **Identity namespace collision:** current VOKKI user UUIDs and future PARMAR `account_id`s are distinct concepts until an approved mapping proves otherwise. Never equate UUID format or compare email/name/phone to bridge them.
2. **Conversation reassignment:** `profile_id` is nullable in current conversation records. Preserve null as unassigned; do not attach history to the active/new profile or workspace by default.
3. **Memory/consent scope:** keep memory account/user-scoped. Do not move it to profiles/workspaces or broaden consent through identity remapping. Verify row counts, owner mapping, consent state, rollback, and resulting access per account.
4. **Session migration:** do not upgrade anonymous Local Demo or existing local session rows into PARMAR sessions. Require new approved authentication and revoke legacy credentials/pending approvals under their owning authorities.
5. **AETHER state:** Android SQLite state, Desktop profile IDs, Chromium partitions, cookies, and user-data directories remain local product state. No automatic import, account merge, or cookie transfer.
6. **Migration acceptance:** require a dry run with exact source/target counts, owner-verification evidence, collision/orphan quarantine, two-user isolation tests, rollback/restore evidence, and explicit user/data-protection approval before any production mutation.

## 11. Missing acceptance tests and production security evidence

The architecture specification already proposes a substantial acceptance suite in §12. The following items are still missing as **executed evidence**, or need sharper acceptance semantics; their presence as a proposed test is not a pass.

| Required evidence | Why required / gap to close |
|---|---|
| Complete VOKKI route-by-route authorization test matrix | No route inventory was supplied with the architecture; verify every protected method/data class, client identity injection, public exception, owner/grant predicate, and deny path (H-02). |
| Approved SSO end-to-end flow and lifecycle tests | After explicit provider/protocol approval, prove same PARMAR account across protected products, product audience separation, replay resistance, account resolution, logout/revocation propagation, recovery, failure handling, and absence of separate product credentials (H-03). |
| Desktop control/browser credential separation on each supported OS | Prove distinct process/origin/store/session; no token, auth cookie, credential IPC, or authenticated browser request. Test Linux and each claimed non-Linux runtime; keep remote browsing disabled during tests (H-01). |
| Account/data migration dry-run and rollback tests | Exercise duplicate, ambiguous, missing, and orphan owners; prove no automatic email/name linking, no unprofiled conversation assignment, and no memory scope broadening (M-01). |
| Consent revocation/transfer race test | Use a controllable provider transport to define and prove the exact egress boundary; verify no post-boundary requests and truthful status for already-sent data (M-02). |
| Complete View/Edit/Manage operation and revocation tests | Exercise owners, explicit grantees, workspace-only members/admins, unrelated accounts, expiry/revocation, delegation limits, and every affected endpoint (M-03). |
| Device/session and account-closure acceptance | Test concurrent devices, expiry, rotation/replay, individual/all-device revocation, measured revocation latency, step-up, pending approvals, and disconnected local-state limits. |
| Android packaged boundary tests | Inspect merged manifest and dependency graph; run offline flows with device networking disabled; confirm no INTERNET permission, WebView, requests, remote auth, sync, or credential storage. |
| Data protection and lifecycle production evidence | Verify deployed encryption of primary/backup data, key custody/rotation/recovery, residency, restore, export/delete/reset/closure status, provider-copy limitations, and no plaintext fallback. |
| External AI consent, minimization, and fallback acceptance | Verify zero egress without valid per-user consent, exact minimal payload, revocation behavior, provider outage without fallback, and auditable transfer provenance. |
| Independent security/release record | Retain actual supported-platform build/deployment evidence, test results without unapproved skips, threat review, operations/incident/recovery ownership, and accountable release approval. |

No production-readiness claim is justified by this review or the documents alone.

## 12. Blocking decisions requiring human approval

1. **Authentication provider and protocol:** keep unselected. Approve requirements comparison and security review before a selection or integration (IT-02).
2. **Account lifecycle and enrollment/mapping:** approve creation/closure states, exact method-key namespace/normalization, mapping conflict handling, account-owner verification, and migration policy (IT-01/03/15).
3. **SSO and session topology:** approve the handoff/session contract, audience model, logout/revocation propagation, session lifetimes, device inventory, recovery, and step-up semantics; do not assume shared cookies or a protocol (IT-04/05, D-02).
4. **VOKKI route perimeter:** assign an owner to produce and approve the complete route/method/data-class matrix before production exposure (IT-07/08 and dependent data decisions).
5. **Profiles/workspaces:** approve invitation/member lifecycle and exact View/Edit/Manage mapping, including Manage delegation; keep sharing disabled until tested (IT-06/07/08).
6. **Data lifecycle and production protection:** approve retention, deletion/backup deadlines, encryption/key/residency/recovery architecture, and support/exception access (IT-10/11/15).
7. **External AI:** approve providers/regions/terms only after scoped consent, minimization, transfer-race behavior, no-fallback and zero-egress evidence (IT-12/13; D-03/D-12).
8. **AETHER Desktop authenticated surface:** approve a dedicated control-plane storage/process boundary and supported-platform threat/evidence plan; this is separate from approval of remote browsing (IT-05; D-01/D-02).
9. **AETHER Android:** no approval for adding Android networking, `INTERNET`, WebView, SSO, or remote authentication is present in the inspected records. Preserve local-only behavior; any proposed boundary change requires a distinct explicit decision.
10. **Plan clarification:** resolve L-01 with the decision owner without changing the approved D-02 SSO requirement.

## 13. Recommended corrections before implementation

1. Resolve H-01 and H-02 and obtain the H-03 decisions before production identity or cross-product integration.
2. Complete the crosswalk and ownership-verification procedure in M-01 before any data migration; maintain immutable PARMAR account IDs and quarantine ambiguity.
3. Define transfer-boundary consent ordering and tests in M-02 before enabling external AI.
4. Approve the grant operation matrix in M-03; keep workspace sharing and cross-user profile access disabled until it passes.
5. Clarify the parallel-plan wording in L-01 through the authorized product decision process.
6. Keep the existing safe states: no provider/protocol assumption, no automatic account merge, no automatic legacy-profile assignment, memory account-scoped by default, Android offline-only, Desktop browser credentials isolated, `REMOTE_BROWSING_ENABLED=false`, and no production-readiness claim.

These are recommendations and gates only. This review did not change any approved decision or authorize implementation.

## 14. Validation record

- Required-document presence: **verified**; all seven required files were present in the current working tree.
- Source/document inspection: **performed** for the files listed in §2. Findings are based on current working-tree content, not prior reports.
- Tests/builds/runtime/device/provider flows: **not run**. No result is claimed.
- Static trailing-whitespace scan: **passed**. Final branch, HEAD, and worktree status are recorded in the Task 34 completion report.

## 15. Final verdict

**BLOCKED.** The proposal is directionally sound and does not require major redesign, but close H-01–H-03 and obtain the relevant human approvals before dependent production implementation. Keep profile sharing and external AI egress gated by M-02/M-03, and migration gated by M-01. No source, schema, configuration, workflow, or existing document was changed by this review.
