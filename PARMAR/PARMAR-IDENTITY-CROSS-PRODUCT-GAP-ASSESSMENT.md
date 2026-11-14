# PARMAR Identity and Tenancy — Cross-Product Gap Assessment

**Assessment type:** Read-only repository assessment
**Evidence cutoff:** Current repository worktree; source inspection is not runtime or security acceptance.
**Scope:** PARMAR Core, VOKKI, AETHER Android, and AETHER Desktop
**Authority:** The approved requirements in the [VOKKI Identity and Tenancy ADR](./VOKKI-IDENTITY-TENANCY-ADR.md#L1), traced by the [IT-01–IT-15 matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md#L1), and supplemented by the [VOKKI Master PRD](./VOKKI-MASTER-PRD.md#L99).

## 1. Executive summary

The repository contains useful local/prototype foundations, but does not establish a deployed PARMAR account service, production authentication provider, PARMAR-wide SSO, or shared identity across products. VOKKI has local owner-scoped records, server-side session primitives, profiles/workspaces, and some route-level authorization. These are not a production identity or complete tenancy system. AETHER's local profiles are product-local browser profiles, not PARMAR accounts. Android currently preserves a no-network offline-shell boundary; Desktop keeps remote browsing disabled and has distinct local browser profiles and partitions.

**No product is shown to meet production identity and tenancy acceptance.** The most consequential gaps are the absent account registry and identity mapping, lack of provider selection/approval and production authentication, incomplete device/recovery/session controls, incomplete profile grants and route authorization, missing production data/key/backup lifecycle evidence, absent scoped external-AI consent, and absent account closure. No runtime, deployment, independent security, or production acceptance evidence was established by this repository review.

The [parallel development plan](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L18) also describes AETHER browser work as independent of PARMAR account availability while later recording PARMAR-wide SSO. This can be reconciled only by distinguishing AETHER's local/offline shell from any authenticated PARMAR surface; the broad account-independence wording should be clarified rather than treated as permission to add a separate AETHER login or weaken the offline contract.

## 2. Scope, evidence, and classification

### Governing documents reviewed

- [VOKKI identity/tenancy ADR](./VOKKI-IDENTITY-TENANCY-ADR.md#L1)
- [IT-01–IT-15 traceability matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md#L1)
- [VOKKI Master PRD](./VOKKI-MASTER-PRD.md#L99)
- [Identity ADR approval review](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md#L46)
- [PARMAR Parallel Development Master Plan](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L18)

### Implementation and architecture evidence reviewed

- PARMAR identity and authorization foundations: [identity.py](./identity.py#L17), [identity_store.py](./identity_store.py#L32), and [futuristic_app.py](./interface/futuristic_app.py#L91)
- VOKKI sessions, conversations, memory, and provider handling: [sessions.py](./sessions.py#L32), [conversations.py](./conversations.py#L90), [memories.py](./memories.py#L55), [chat/readiness.py](./chat/readiness.py#L274), [chat/router.py](./chat/router.py#L19), and [chat/orchestration.py](./chat/orchestration.py#L680)
- AETHER Android boundary and persistence: [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml#L1), [LocalAetherDatabase.kt](./android/app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt#L1), [PERSISTENCE-ARCHITECTURE.md](./android/PERSISTENCE-ARCHITECTURE.md#L1), and [AETHER-MOBILE-OFFLINE-CONTRACT.md](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9)
- AETHER Desktop security and local profiles: [security.cjs](./desktop/security.cjs#L1), [profiles.cjs](./desktop/profiles.cjs#L7), [profile-partitions.cjs](./desktop/profile-partitions.cjs#L1), [main.cjs](./desktop/main.cjs#L45), [ISOLATION-READINESS.md](./desktop/ISOLATION-READINESS.md#L1), and [AETHER-SECURITY-GATES.md](./AETHER-SECURITY-GATES.md#L113)

### Status definitions

- **Implemented:** evidence supports the bounded behavior in the examined source; this does not imply deployment or production acceptance.
- **Partially implemented:** some relevant primitives or scoped behavior exist, but the approved requirement is incomplete.
- **Missing:** no adequate implementation evidence was found.
- **Not applicable:** the requirement does not apply to the product boundary being assessed. It is not a waiver of shared PARMAR policy.

The IT matrix below classifies repository evidence across products. Its “implemented” findings describe bounded source behavior only. None of the statuses claims production readiness.

## 3. ADR IT-01 through IT-15 compliance matrix

| Decision | Status | Repository evidence | Gap and product impact |
|---|---|---|---|
| **IT-01 — Immutable internal PARMAR account ID** | **Partially implemented** | [identity_contracts.py](./identity_contracts.py) defines random immutable UUIDv4 account identities; Task 37 adds an internal account-record registry and read-only binding lookup in [identity_store.py](./identity_store.py). | No production authentication, binding writer, provider-subject mapping flow, or migration mapping is established. VOKKI's local owner UUIDs and AETHER's local profile identifiers are not proof of PARMAR accounts. |
| **IT-02 — Defer provider selection until comparison and security approval** | **Partially implemented** | The principal/resolver boundary in [identity.py](./identity.py#L73) is provider-neutral. | No production identity-provider comparison, provider/protocol selection, security approval, or production integration was found. The provider-neutral interface is not SSO. |
| **IT-03 — Login-method linking only with fresh proof; no automatic linking/merging** | **Missing** | No account-method mapping or linking flow was found in the inspected identity store [identity_store.py](./identity_store.py#L141). | No proof-of-control, conflict, notification, recovery, or account-merge protections. No product may infer account equivalence from matching attributes. |
| **IT-04 — Recovery, passkeys, verification, attempt limits, lost-device protection** | **Missing** | [sessions.py](./sessions.py#L762) issues sessions when called with a user ID; session primitives exist. | No production credential verifier, recovery or passkey flow, additional-verification policy, login-attempt limit, or lost-device process is established. |
| **IT-05 — Per-device sessions, inventory, individual/all logout, step-up** | **Partially implemented** | [sessions.py](./sessions.py#L32) models expiry policy; [sessions.py](./sessions.py#L791) resolves sessions, and [sessions.py](./sessions.py#L841) revokes an individual session. | No device inventory/metadata policy, user-facing all-device revocation, per-device credential acceptance, or step-up flow. |
| **IT-06 — Personal, multiple-profile, family/team eventual scope** | **Partially implemented** | [identity_store.py](./identity_store.py#L32) models profiles, workspaces, and membership roles. | Code primitives do not settle family/team policy, invitations, detailed roles, legal/privacy rules, or product release enablement. |
| **IT-07 — Workspace membership does not grant personal-content access** | **Partially implemented** | [identity_store.py](./identity_store.py#L413) checks membership to list already-associated workspace profiles; [futuristic_app.py](./interface/futuristic_app.py#L771) uses that repository method. | Membership and association are not a complete per-operation authorization system across conversations, memory, files, approvals, or other data. Complete route/resource checks and negative tests are absent. |
| **IT-08 — Owner-controlled profiles with explicit revocable View/Edit/Manage grants** | **Partially implemented** | [identity_store.py](./identity_store.py#L304) owner-checks profile reads; its workspace-profile association records the adding user at [identity_store.py](./identity_store.py#L376). | No explicit View/Edit/Manage grant model, operation mapping, grant revocation semantics, or enforcement across every resource/API. |
| **IT-09 — User-scoped memory by default; no automatic migration or sharing** | **Partially implemented** | [memories.py](./memories.py#L432) scopes consent and memory methods by owner user ID; conversations also carry owner and nullable profile fields in [conversations.py](./conversations.py#L90). | Memory is user-scoped rather than profile-scoped, matching the default, but production account identity, isolation acceptance, and any approved migration/share behavior are absent. |
| **IT-10 — Review/edit/export/delete/reset and consent revocation; truthful lifecycle** | **Partially implemented** | [memories.py](./memories.py#L472) provides owner-filtered listing and [memories.py](./memories.py#L540) onward provides mutation/deletion/clear operations; VOKKI exposes memory and consent routes in [futuristic_app.py](./interface/futuristic_app.py#L894). | No complete account/data-class export, end-to-end reset, retention/deletion completion reporting, or backup/replica/provider-copy lifecycle is established. Consent revocation is not deletion. |
| **IT-11 — Production encryption, keys, residency, recovery, security testing** | **Missing** | Android disables application backup in [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml#L3); this is not encryption or PARMAR production backup/key evidence. | No cross-product production encryption/key custody/rotation/recovery, residency, backup/restore, or independent security-testing evidence was established. |
| **IT-12 — Scoped external-AI consent, minimization, no silent fallback** | **Partially implemented** | [chat/readiness.py](./chat/readiness.py#L274) implements a server-side allow-list that denies external use by default; [chat/router.py](./chat/router.py#L49) records explicit selection and disables fallback. | Server configuration is not user-scoped consent. Consent scope/versioning, minimization proof, egress verification, revocation, and end-to-end no-fallback acceptance are not established. No provider is selected by the ADR. |
| **IT-13 — PARMAR-managed independent AI as a gated long-term goal** | **Missing** | The goal and evaluation gates are documented in the [ADR](./VOKKI-IDENTITY-TENANCY-ADR.md#L98) and plan. | No approved runtime/model, licensing/security/supply-chain evaluation, deployed infrastructure, or update owner. Documentation is not an implemented service. |
| **IT-14 — Offline drafts/cache, server reauthorization, conflict resolution, no replay** | **Partially implemented** | Android's [offline contract](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9) and local database [LocalAetherDatabase.kt](./android/app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt#L38) establish a local-only shell/store. | AETHER Android has no server sync by design. VOKKI offline synchronization, server-side reauthorization, explicit conflict handling, and no-side-effect-replay acceptance are not established. Do not treat AETHER local storage as VOKKI sync. |
| **IT-15 — Secure account closure, revocation, truthful reporting, no standing support access** | **Missing** | Individual session revocation exists in [sessions.py](./sessions.py#L841). | No account-wide closure, approval revocation, complete deletion/retention report, or production support-access model was found. |

## 4. PARMAR Identity

- **Immutable internal account ID:** Task 37 adds a random UUIDv4 account record and read-only lookup in the existing identity database. It is not connected to the legacy `Principal.user_id` or an authenticated PARMAR account. In [identity.py](./identity.py#L17), `Principal` represents request identity; it is not itself an account registry.
- **Provider-neutral boundary and identity mapping:** `PrincipalResolver` is a provider-neutral interface in [identity.py](./identity.py#L73). The local demo resolver is anonymous; an optional development-auth path is explicitly constrained in [futuristic_app.py](./interface/futuristic_app.py#L91). No provider-subject-to-PARMAR-account mapping or production credential verification is shown.
- **PARMAR-wide SSO and shared identity:** PRD §3.1 requires one PARMAR account and PARMAR-wide sign-on across VOKKI and authenticated AETHER surfaces, without separate product credentials [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md#L101). No shared identity/SSO service or cross-product authentication integration was found in the reviewed implementation.
- **Account-level authorization:** VOKKI has local owner checks, profile ownership, workspace roles, and some route guards. These are not a complete account-level policy service or route/resource authorization perimeter. AETHER local browser profiles are not account identities.

## 5. Sessions and security

- **Server-issued sessions:** [sessions.py](./sessions.py#L762) provides a server-side authenticated-session creation method, token resolution, rotation, and individual revocation. This is a usable primitive, not evidence that an approved production authentication flow issues sessions.
- **Expiry and rotation:** [sessions.py](./sessions.py#L32) defines idle/absolute policy and [sessions.py](./sessions.py#L801) rotates tokens. Deployed configuration and end-to-end acceptance were not established.
- **Device-bound sessions and remote logout:** no device inventory or device-bound session model was found. The available revocation method takes an individual session ID; no all-device user workflow was evidenced.
- **Step-up, recovery, and authentication abuse controls:** no production step-up, passkey/recovery, additional verification, login-attempt throttling, or lost-device process was found.
- **Cookie, CSRF, and origin protections:** VOKKI uses a `__Host-` cookie with `HttpOnly`, `Secure`, and `SameSite=Lax` in [sessions.py](./sessions.py#L895); request context and CSRF checks are in [futuristic_app.py](./interface/futuristic_app.py#L436) and [futuristic_app.py](./interface/futuristic_app.py#L467). Origin validation is in [futuristic_app.py](./interface/futuristic_app.py#L212). These code paths are evidence of controls, not proof of deployed proxy/TLS configuration, universal route coverage, or security acceptance.
- **Native credential storage:** Android stores local application data and disables backup; it has no PARMAR credential/session integration to assess. Desktop local browser profiles use Electron session partitions in [profile-partitions.cjs](./desktop/profile-partitions.cjs#L1). No PARMAR credential storage or native secure-token storage integration was found.

## 6. Profiles, workspaces, and authorization

- **Profiles and active profile:** local profile records are owner-keyed in [identity_store.py](./identity_store.py#L32); VOKKI request context tracks an active profile and selection checks ownership in [futuristic_app.py](./interface/futuristic_app.py#L436) and [futuristic_app.py](./interface/futuristic_app.py#L1079). This does not establish profile-scoped authorization for every resource.
- **Workspaces and membership:** [identity_store.py](./identity_store.py#L191) stores workspaces and roles `OWNER`, `ADMIN`, and `MEMBER`; membership and profile association are distinct tables. Workspace profile associations are not invitations or the approved View/Edit/Manage grant system. No invitation workflow was found.
- **Cross-profile and cross-workspace isolation:** conversations include `owner_user_id` and optional `profile_id`, and repository methods offer owner-filtered queries in [conversations.py](./conversations.py#L852). These are positive local boundaries, but legacy nullable profile records and incomplete route/resource coverage leave isolation unproven end-to-end.
- **AETHER local profiles:** Desktop profile metadata is local and capped in [profiles.cjs](./desktop/profiles.cjs#L7); per-profile persistent partitions are defined in [profile-partitions.cjs](./desktop/profile-partitions.cjs#L11). Android is a local shell without PARMAR identity. Neither product's local profile is a PARMAR profile or account.

## 7. Data, memory, consent, and lifecycle

- **Conversation ownership:** VOKKI records have owner and optional profile associations in [conversations.py](./conversations.py#L90), with owner-filtered persistence methods [conversations.py](./conversations.py#L852). This is not a complete profile/workspace grant implementation.
- **Memory scope:** [memories.py](./memories.py#L432) keys consent and operations to user IDs. This supports the approved user-scoped default; no automatic profile migration/share was found.
- **Consent and controls:** VOKKI has memory consent state and user-owned list/update/delete/clear primitives [memories.py](./memories.py#L455). The repository does not establish a comprehensive export/reset UX or coverage of every stored data class. Revoking memory consent does not, by itself, delete retained records.
- **Encryption and backups:** no production encryption/key lifecycle evidence was identified for VOKKI data. Android `allowBackup=false` is a platform backup restriction, not encryption. AETHER's documented local persistence must not be presented as production PARMAR identity-data protection.
- **Retention and account lifecycle:** no complete, verifiable data-class retention/deletion reporting, backup expiry, account closure, session-and-approval revocation, or support-access workflow was found.

## 8. External AI, local AI, and offline behavior

- **External provider authorization:** `ExternalAuthorization` is a server-side allow-list defaulting to deny in [chat/readiness.py](./chat/readiness.py#L274). Provider routing records explicit selection and sets `fallback_allowed=False` in [chat/router.py](./chat/router.py#L49). These controls do not establish per-user scoped consent or end-to-end no-egress behavior. No provider selection or approval is evidenced.
- **Data minimization and consent revocation:** the inspected external authorization model scopes provider/capability/mode, not user consent, data categories, retention terms, or revocation. No proof of minimum-context transfer or zero-egress denial was identified.
- **PARMAR-managed local AI:** the long-term goal is documented, but no selected/accepted PARMAR-managed runtime or update ownership is implemented.
- **AETHER Android offline boundary:** the manifest declares no network permission and disables backup in [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml#L1). The [offline contract](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9) explicitly excludes external requests, WebView, and PARMAR/VOKKI service calls. Local SQLite persistence is present in [LocalAetherDatabase.kt](./android/app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt#L38). These are source/documentation findings, not runtime proof that no network access occurs on packaged devices.
- **VOKKI offline/sync:** no VOKKI offline draft/cache synchronization implementation meeting server-side reauthorization, explicit conflict handling, and no automatic replay of side-effecting actions was established.
- **AETHER Desktop network boundary:** `REMOTE_BROWSING_ENABLED` is `false` in [security.cjs](./desktop/security.cjs#L5); `main.cjs` uses profile sessions and request controls at [main.cjs](./desktop/main.cjs#L1297). This deny state and existing security gates must not be weakened to implement identity integration.

## 9. Product-specific assessment

### PARMAR Core

**Evidence:** The repository contains identity/session interfaces and local storage primitives, including [Principal and resolver contracts](./identity.py#L17), [profile/workspace repository](./identity_store.py#L48), and [session management](./sessions.py#L762).

**Gaps:** No complete production Core identity service, login-provider adapter, provider-subject mapping flow, shared SSO service, account recovery, account-level authorization service, or production lifecycle/deployment evidence was found. The internal registry foundation is not a complete production Core service.

### VOKKI

**Evidence:** Local identity/session/profile/workspace endpoints and owner-scoped conversation/memory methods exist in [futuristic_app.py](./interface/futuristic_app.py#L754), [conversations.py](./conversations.py#L852), and [memories.py](./memories.py#L432). Session primitives, CSRF checks, cookie flags, and a default-deny external authorization policy are present.

**Gaps:** No production authentication integration; no full account/device/recovery lifecycle; incomplete profile-aware grants and route authorization; user-scoped rather than profile-scoped memory (as required by default); incomplete export/reset/deletion and encryption/backup controls; no established scoped external-AI user consent; no production offline sync or account closure.

### AETHER Android

**Current boundary:** Local-only Android shell with no declared network permission, no PARMAR/VOKKI service integration, local SQLite storage, and application backup disabled. See [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml#L1), [LocalAetherDatabase.kt](./android/app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt#L38), and [offline contract](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9).

**Identity assessment:** No PARMAR account/session identity exists in the inspected Android shell; browser/app-local identity must not be conflated with PARMAR identity. Future SSO for an authenticated PARMAR surface requires a separately approved integration contract that preserves the offline shell's no-network behavior and does not add a separate AETHER login. The current absence of network permission is an explicit constraint, not an accidental gap to work around.

**Unverified:** packaged runtime, device behavior, backup-exclusion outcomes, and actual network-request absence were not verified in this assessment.

### AETHER Desktop

**Current boundary:** Desktop has product-local profiles [profiles.cjs](./desktop/profiles.cjs#L81), profile-specific Electron partitions [profile-partitions.cjs](./desktop/profile-partitions.cjs#L11), and hardened renderer preferences in [main.cjs](./desktop/main.cjs#L724). A loopback PARMAR control URL is configured in [main.cjs](./desktop/main.cjs#L47); it is not evidence of user authentication or SSO. Remote browsing remains explicitly disabled in [security.cjs](./desktop/security.cjs#L5).

**Identity assessment:** No PARMAR account integration or separate AETHER login was found. Local browser-profile metadata and partitions must not be migrated or presented as PARMAR accounts without an approved explicit mapping and user-controlled data lifecycle. Future authenticated PARMAR surfaces must use the shared PARMAR identity boundary while preserving product-specific permissions and the browsing deny state.

**Isolation limitation:** [ISOLATION-READINESS.md](./desktop/ISOLATION-READINESS.md#L5) documents a Linux second-process path and an in-process browser path on non-Linux platforms. The [AETHER security gates](./AETHER-SECURITY-GATES.md#L113) keep remote browsing NO-GO and require runtime/platform acceptance. Identity integration is not a reason to bypass these gates.

## 10. Cross-product dependency map

| Layer | Responsibility | Current dependency/evidence | Required boundary |
|---|---|---|---|
| **PARMAR Core** | Establish immutable account identity, provider-neutral authentication, identity mapping, shared sign-on, session/recovery policy, account lifecycle, and authoritative policy interfaces. | Interfaces/primitives exist; no complete shared production service was established. | Provider remains unselected until comparison and security approval. Authentication is shared; authorization is resource/product-specific. |
| **VOKKI** | Consume PARMAR identity, bind requests/data to the trusted principal, enforce owner/profile/workspace grants at every route/data class, and present consent/lifecycle controls. | Local identity/session/profile/workspace/conversation/memory code exists. | No client-supplied identity; no workspace membership privilege over personal content; no unapproved external transfer or silent fallback. |
| **AETHER Android** | Preserve offline/local-only application behavior; if a separately approved protected PARMAR surface is added, consume shared PARMAR sign-on without making the offline shell depend on network availability. | Manifest/offline contract/local DB; no current account integration. | Do not add network permission, service calls, or separate login as an implicit identity fix. Any changed network boundary requires explicit approval and platform/security acceptance. |
| **AETHER Desktop** | Keep app-local profiles and browsing sessions isolated; use shared PARMAR identity only for separately approved authenticated PARMAR functionality. | Local profile/partition code; remote browsing denied. | Do not treat control URL or local profile as SSO/account. Do not change remote-browsing deny, process-isolation, or platform security gates. |

## 11. PARMAR-wide responsibilities

1. Define and operate the provider-neutral immutable account identity and mapping contract; provider selection remains deferred.
2. Own authentication assurance, recovery, passkeys, abuse protection, session issuance/revocation, device inventory, and step-up policy.
3. Provide a shared PARMAR sign-on contract across products without making product authentication a grant of product-specific permissions.
4. Define account lifecycle, deletion/retention reporting, and independently auditable administrative/support access controls.
5. Provide shared authorization-policy interfaces while leaving each product/API responsible for enforcing its resource and capability boundary.
6. Require migration and compatibility evidence before mapping existing local owner IDs, AETHER profiles, browser partitions, or stored data to PARMAR accounts.
7. Gate production enablement on deployed runtime, privacy/security review, testing, backup/recovery, and named operations ownership.

## 12. Product responsibilities

- **VOKKI:** use the trusted PARMAR principal; authorize every route and data class; retain user-scoped memory by default; implement owner-controlled explicit grants only after detailed policy; provide consent, review/export/delete/reset and honest lifecycle behavior; block external AI absent scoped authorization; do not infer an offline sync model.
- **AETHER Android:** preserve its local-only/no-network offline shell, local data boundary, and no-account assumption for local features. Any future protected PARMAR surface must have explicit design approval, use shared PARMAR identity rather than a new AETHER login, and be separately tested without broadening the offline app's network behavior.
- **AETHER Desktop:** keep local browser profiles distinct from PARMAR accounts; preserve session partitions, renderer hardening, network deny controls, and NO-GO gates. Shared identity does not authorize remote browsing or content access.

## 13. Migration and compatibility risks

1. **Owner UUID ambiguity:** VOKKI owner UUIDs are not proven PARMAR account IDs. Assigning or rekeying them without an approved mapping risks cross-account data disclosure or orphaned records.
2. **Legacy conversation scope:** `profile_id` is nullable in [conversations.py](./conversations.py#L90) and schema upgrade logic exists at [conversations.py](./conversations.py#L665). Do not automatically assign legacy records to a newly selected profile or workspace.
3. **Memory ownership:** memory is user-scoped. Profile/workspace adoption must not migrate or share it automatically; preserve consent and owner binding.
4. **Account linking:** provider-subject/email matching or silent merge can combine distinct users. IT-03 requires fresh proof and forbids automatic linking/merging.
5. **Session migration:** existing local session rows/tokens cannot be assumed portable to a future provider or trusted SSO session. Define revocation/re-authentication and ensure sessions are not silently upgraded.
6. **AETHER profile collision:** Desktop and Android local profiles, SQLite state, browser cookies, and partitions have different local identifiers and semantics. They are not PARMAR account/profile records; importing them requires an explicit user-controlled migration plan.
7. **Offline changes:** adding authentication or synchronization to AETHER Android could violate the current no-network contract. Offline state cannot silently become a sync queue; define consent, reauthorization, conflicts, revocation while offline, and no-replay behavior first.
8. **Operational lifecycle:** account closure must cover databases, backups, logs, provider copies, approvals, sessions, devices, and disconnected local data. Present code does not establish that lifecycle.

## 14. Recommended implementation sequence and acceptance criteria

This sequence is an assessment recommendation, not implementation authorization or an approval of deferred choices.

1. **Resolve contract and ownership:** clarify the AETHER offline/account-independence wording; define PARMAR Core ownership, resource authorization boundaries, account lifecycle, and the decision process for provider comparison. Keep provider unselected until security approval.
2. **Specify identity and migration:** document immutable account IDs, provider-subject mapping, linking proof, recovery, session/device/step-up policy, and a compatibility plan for existing local UUIDs and AETHER profiles. Do not migrate data until the plan and consent are approved.
3. **Build and verify Core identity/session boundary:** only after requirements and security approvals, implement provider-neutral account/authentication interfaces and tested server-issued sessions, recovery, device controls, revocation, and account lifecycle.
4. **Close VOKKI authorization and data lifecycle:** inventory every route/data class; enforce owner and explicit grant decisions; preserve memory scope; implement reviewed consent/export/delete/reset/retention behavior; prove production encryption/key/backup controls before persistent production data.
5. **Integrate products independently:** VOKKI adopts the shared identity contract. Any AETHER authenticated surfaces are separately scoped and use PARMAR SSO; preserve Android offline/no-network constraints and Desktop remote-browsing deny/isolation gates.
6. **Gate AI and offline sync separately:** require scoped explicit consent, minimal context, observed no-egress denials/no fallback, and separately reviewed offline sync with server reauthorization, explicit conflicts, and no automatic side-effect replay.
7. **Independent acceptance and release:** execute the tests below on the actual deployment and supported platform matrix; obtain security/privacy/operations approvals. Do not claim production readiness before evidence and release approval.

### Minimum test and acceptance criteria

- **Identity:** two users receive distinct immutable account IDs; provider mappings cannot collide; client-supplied identity/role changes have no effect; linking requires fresh proof and never auto-merges.
- **SSO/product boundaries:** the same PARMAR account contract is used for authenticated VOKKI/AETHER surfaces; no second product credentials or account IDs; AETHER local/offline functionality remains available without account/network unless separately changed by approval.
- **Sessions:** server-side expiry and rotation; individual and all-device revocation; stale tokens/approvals rejected; recovery/passkey/additional verification and lost-device cases exercised; rate limits and step-up verified.
- **Authorization:** two users, multiple profiles, and multiple workspaces; owner-only defaults; workspace membership alone denied personal-content access; explicit View/Edit/Manage operation matrix and revocation tests for every route/data class.
- **Memory/data:** owner-scoped reads/writes; no automatic profile/workspace migration; review/edit/export/delete/reset and consent revocation tested; truthful status for backups, retention, provider copies, and incomplete deletion.
- **Production protection:** encryption at rest and in backups; key custody/rotation/recovery; residency documentation; restore and security exercises; deployment/TLS/proxy controls verified.
- **External AI:** explicit scoped consent, data minimization, denial/revocation tests, observed zero egress without authorization, unavailable-provider behavior without silent fallback; no provider enabled before approval.
- **Offline:** Android packaged/device network-denial and permission checks; offline persistence/deletion verified. Any VOKKI sync must reauthorize server-side, surface conflicts, honor revocation, and prove no automatic side-effect replay.
- **AETHER Desktop:** profile/session isolation, renderer/process boundary and request denial verified per supported OS; `REMOTE_BROWSING_ENABLED=false` remains unchanged until its separate security gates pass.
- **Closure/support:** session/device/approval revocation, data-class deletion/retention reporting, backup expiry, disconnected-device behavior, and no-standing-support-access verified.

## 15. Contradictions, blockers, and validation record

### Documentation consistency and unresolved technical/policy decisions

- The ADR, traceability matrix, and PRD agree on one PARMAR-wide account/SSO boundary, no separate VOKKI/AETHER login, no provider selection, user-scoped memory by default, and separately gated implementation/release. The approval review records the same D-02 clarification [approval review](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md#L56); the PRD identity requirements are at [§3.1](./VOKKI-MASTER-PRD.md#L101).
- The parallel plan records shared PARMAR SSO and separately gated D-02 scope [parallel plan](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L42), but its opening says AETHER browser work does not depend on “PARMAR account availability” [parallel plan](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L25). Clarify that this means the independent local/offline browser shell remains available without an account; otherwise it conflicts with the approved SSO requirement for authenticated PARMAR surfaces. This assessment does not silently resolve the wording.
- No authentication provider or protocol is selected. Provider mapping and account lifecycle transitions, recovery/passkey policy, attempt thresholds, step-up triggers, device metadata/revocation latency, detailed family/team/invitation/grant policy, retention/deletion timelines, encryption/key/residency/recovery architecture, external AI providers/consent UX, PARMAR-managed AI runtime, and offline cache/conflict policy remain open. Task 37's persistent account-record foundation is not production authentication or provider mapping.
- Current code and documentation are not runtime, security, privacy, deployment, or production readiness evidence.

### Production-readiness blockers

Production identity or dependent production capabilities remain blocked by the absence of production authentication and an approved account/provider mapping flow; unselected provider and unapproved comparison; lack of production recovery/passkeys/abuse controls; incomplete session/device/step-up controls; incomplete route/resource authorization and grant semantics; incomplete data export/deletion/retention lifecycle; absent production encryption/key/residency/backup evidence; lack of scoped external-AI consent and egress acceptance; lack of verified sync/closure/support controls; and absent deployment/platform runtime and independent security acceptance. These gaps must be closed through separately approved work. No implementation was started by this assessment.

### Commands and tests executed before this report

The following test attempts were made during the assessment:

| Exact command | Actual result |
|---|---|
| `python -m pytest -q PARMAR/tests/test_identity_http.py PARMAR/tests/test_identity_store.py PARMAR/tests/test_sessions.py PARMAR/tests/test_session_http.py PARMAR/tests/test_conversation_http.py PARMAR/tests/test_memory_http.py` | `/bin/bash: line 1: python: command not found` (exit 127). |
| `python3 -m pytest -q PARMAR/tests/test_identity_http.py PARMAR/tests/test_identity_store.py PARMAR/tests/test_sessions.py PARMAR/tests/test_session_http.py PARMAR/tests/test_conversation_http.py PARMAR/tests/test_memory_http.py` | `/bin/bash: line 1: python3: command not found` (exit 127). |
| `cd PARMAR/android && ./gradlew :app:testDebugUnitTest --offline` | Failed (exit 1): Android Gradle plugin `com.android.application` version `8.7.3` was not found in the offline plugin repositories. Android unit tests were not run. |
| `node --test --test-concurrency=1 test/*.test.cjs` (from `PARMAR/desktop`) | Not run: Node is not on `PATH`; Desktop tests were unavailable. |

These are environment/build-availability failures, not passing test results and not evidence that the implementation is correct or incorrect.

## 16. Assessment boundary

This document records repository evidence and gaps only. It does not modify or supersede the approved ADR/PRD, select a provider, authorize implementation or migration, enable authentication/network access, waive AETHER security gates, or claim production readiness.
