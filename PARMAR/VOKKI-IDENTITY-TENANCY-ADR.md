# VOKKI Identity, Tenancy, and Data Isolation

## Architecture Decision Record — Final

| Field | Value |
|---|---|
| Status | **Final decision record for 15 explicitly approved requirements; technical choices and production gates remain open** |
| Decision date | 2026-11-12 |
| Scope | PARMAR-wide identity and SSO, VOKKI accounts, sessions, profiles, workspaces, data isolation, memory, AI data transfer, offline access, and account lifecycle |
| Authority | PARMAR Core remains the policy, authorization, approval, execution, verification, and audit authority |
| Scope of approval | Product/security requirements below only; no provider, protocol, schema, source change, production enablement, or release approval |
| Traceability | [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md) |

> This record consolidates the 15 decisions explicitly approved for Task 31. “Approved” describes the required product/security outcome, not proof of implementation or approval of a particular technical design. Deferred choices and production gates remain explicitly identified below.

## 1. Decision summary and status

This ADR is authoritative for the approved VOKKI identity and tenancy requirements. It supplements the approved VOKKI product directions in [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md), including D-02, D-03, D-04, D-09, and D-12. The two decision sets are related but use different numbering.

### Approved requirements

Each decision ID below preserves the order and meaning of the 15 approved requirements. The requirement is approved; implementation, detailed policy, security acceptance, and release remain gated wherever stated.

### Deferred technical choices and gates

- **Authentication provider and protocol:** no provider or protocol is selected. Compare candidates against documented requirements and obtain security approval before selection or integration.
- **Account provisioning, authentication assurance, recovery channels, passkey policy, attempt thresholds, and step-up rules:** the required protections are approved; exact methods, thresholds, UX, operational ownership, and acceptance evidence remain to be decided.
- **Sessions and device inventory:** per-device secure sessions, device visibility, individual/all-device remote logout, and step-up are required. Session lifetimes, device metadata, storage implementation, notification, and revocation latency remain open.
- **Profiles and family/team policies:** personal, multiple-profile, and family/team modes are approved eventual product scope. Family/guardian rules, workspace lifecycle, invitations, detailed roles, which operations each grant controls, and feature enablement require separate decisions and gates.
- **Memory/data lifecycle:** user-scoped memory remains the default. Consent UX/versioning, retention periods, deletion/backup deadlines, export format, and any future scope change require separate definition and evidence.
- **Production data protection:** effective encryption, key management, residency, recovery, and security testing are mandatory; deployment topology, key custody/rotation/recovery, residency choices, and measurable recovery objectives are not selected.
- **External and PARMAR-managed AI:** no external AI provider, model, runtime, endpoint, or infrastructure is selected. Consent implementation, data/region terms, licensing, supply-chain review, security ownership, and update ownership remain gates.
- **Offline and account closure:** encrypted local storage, cache scope/expiry, conflict semantics, disconnected-device limits, deletion timelines, grace periods, and support/incident procedures remain to be specified.

No unresolved choice in this list reopens an approved requirement. Conversely, an approved requirement does not silently settle any of these choices.

## 2. Approved decisions

### Decision IT-01 — Immutable internal PARMAR account ID

**Approved requirement:** Every PARMAR account has an immutable internal PARMAR account ID. It is the stable PARMAR identity and is not derived from an email address, phone number, provider subject, display name, device, or client-supplied value.

**Still gated:** account creation and lifecycle semantics, identifier representation, method-to-account mapping, persistence, migration, and recovery design. No account table or production account system is authorized by this decision alone.

### Decision IT-02 — Authentication provider selection deferred

**Approved requirement:** Do not select an authentication provider now. Document requirements, compare candidates, and obtain security approval before selecting or integrating a provider.

**Still gated:** provider, protocol, region, account enrollment, callback/deployment design, privacy/legal review, and operational ownership. Provider-neutral requirements do not imply that a provider or method is approved.

### Decision IT-03 — Optional login-method linking

**Approved requirement:** Optional future login methods may be linked to one PARMAR account only after fresh proof of control of the method being added. Never link or merge accounts automatically, including on matching email, phone, name, or other attributes.

**Still gated:** available methods, reauthentication and recovery flows, conflict resolution, user notifications, last-method protection, account merge policy, and any migration process.

### Decision IT-04 — Secure recovery and account-abuse protection

**Approved requirement:** Account recovery must be secure and include support for passkeys, additional verification, limits on login attempts, and protection for lost devices.

**Still gated:** recovery channels and fallback, passkey enrollment/recovery behavior, verification assurance, rate-limit values, lockout and notification rules, support duties, and tested abuse/lost-device procedures. These protections are production prerequisites.

### Decision IT-05 — Per-device sessions and remote logout

**Approved requirement:** Use secure per-device sessions, provide a device inventory, allow individual-device and all-device remote logout, and require step-up verification where appropriate for sensitive actions.

**Still gated:** session lifetime/rotation rules, exact device metadata, platform credential storage, step-up triggers, revocation latency, and security acceptance across supported platforms.

### Decision IT-06 — Approved eventual profile and family/team scope

**Approved requirement:** Personal, multiple-profile, and family/team modes are approved eventual product scope.

**Still gated:** detailed family/team policy, membership and invitation lifecycle, roles, profile-sharing rules, legal/privacy requirements, implementation, and release enablement. Approval of eventual scope is not authorization to expose sharing or multi-user access now.

### Decision IT-07 — Workspace membership does not grant personal-content access

**Approved requirement:** Membership in a workspace does not automatically grant access to a member's personal content.

**Still gated:** workspace-specific permissions and complete route/data-class authorization. Every operation must independently enforce its applicable owner, membership, grant, and policy checks; missing or ambiguous authorization must deny access.

### Decision IT-08 — Owner-controlled profiles and explicit grants

**Approved requirement:** Profiles remain owner-controlled. Sharing a profile requires an explicit, revocable grant from its owner with View, Edit, or Manage access as granted. Workspace membership or administrator status alone cannot create or expand that grant.

**Still gated:** precise operation mapping for View/Edit/Manage, grant UX and lifecycle, management delegation limits, revocation behavior, and route-by-route enforcement and tests.

### Decision IT-09 — User-scoped memory by default

**Approved requirement:** Memory is user-scoped by default. Do not automatically migrate memory to a profile or workspace, or automatically share it.

**Still gated:** any future non-user scope requires a separate decision, explicit consent, a reviewed migration, and isolation tests. Existing user-scoped records and consent must not be reassigned or broadened implicitly.

### Decision IT-10 — User controls, consent revocation, and truthful lifecycle

**Approved requirement:** Provide review, edit, export, delete, reset, and consent-revocation controls. Communicate retention and deletion behavior truthfully, including data that is pending deletion, retained, unavailable, or already transferred and not recallable.

**Still gated:** per-data-class inventory, retention periods, backup/replica handling, provider deletion terms, completion signals, and operational verification. Revoking consent must not be represented as deleting stored data unless deletion has actually occurred.

### Decision IT-11 — Production data and backup protection

**Approved requirement:** Production data and backups require effective encryption, secure key management, documented data residency and recovery, and security testing.

**Still gated:** deployment-appropriate encryption/key design, custody and rotation/recovery, approved residency, recovery objectives, backup/restore exercises, and independent security evidence. File permissions or integrity checks alone are not encryption.

### Decision IT-12 — Explicit consent for external AI transfer

**Approved requirement:** External AI transfer requires explicit, scoped consent and data minimization. A denied or unavailable provider must not trigger silent fallback. No external provider is selected by this ADR.

**Still gated:** provider and region evaluation, consent scope/UX/versioning, data categories, retention/training terms, endpoint/transport verification, revocation, audit, and zero-egress denial testing.

### Decision IT-13 — PARMAR-managed independent AI infrastructure as a long-term goal

**Approved requirement:** PARMAR-managed independent AI infrastructure is a long-term goal.

**Still gated:** feasibility and comparative evaluation, model/runtime selection, licensing, security and supply-chain review, hardware and operating cost, deployment, and named update/patch ownership. This goal does not select or authorize an implementation.

### Decision IT-14 — Offline drafts/cache and controlled synchronization

**Approved requirement:** Offline operation may use drafts and cache. Synchronization must reauthorize on the server, resolve conflicts explicitly, and never automatically replay side-effecting actions.

**Still gated:** approved offline data classes, local encryption/key handling, cache retention and deletion, conflict UX/protocol, revocation while disconnected, sync acceptance, and supported-platform behavior. Offline AI or production sync is not implied.

### Decision IT-15 — Secure account closure and no standing support access

**Approved requirement:** Account closure must be secure, revoke sessions and approvals, report deletion and retention honestly, and provide no standing support access to private content.

**Still gated:** closure confirmation/step-up, grace and retention periods, data-class deletion and backup expiry, legal/security exceptions, provider deletion limits, incident access procedures, and independently tested completion reporting. Any exceptional access requires a separately approved, time-bounded and audited process; it cannot be standing access.

## 3. PARMAR-wide account and SSO boundary

VOKKI uses the user's PARMAR account and PARMAR-wide sign-on. PARMAR products and surfaces must not create separate VOKKI or AETHER logins, credentials, or account identities. A user authenticating to a protected PARMAR surface uses the shared PARMAR identity contract; local-only product functionality does not create a second PARMAR account.

This requirement does **not** select an authentication provider, protocol, or cross-product token/session-sharing mechanism. PARMAR Core remains responsible for establishing identity; each product and API continues to enforce its own authorization and capability boundaries. A shared account does not confer workspace access, personal-content access, AETHER browsing authority, approval authority, or execution authority.

## 4. Current implementation evidence and limits

Source inspection identifies prototype building blocks, not production acceptance:

- [identity.py](./identity.py) defines a server-created principal contract and an anonymous Local Demo resolver; it does not establish a production identity provider or connect sessions to the Core account registry.
- [identity_store.py](./identity_store.py) contains local profile, workspace, membership, workspace-profile association storage, and the separately authorized Task 37 additive account-registry foundation. The registry has no active authentication or binding writer; workspace membership and the current profile association are not the approved View/Edit/Manage grant system.
- [sessions.py](./sessions.py) supports server-side session persistence, expiry, rotation, and individual session revocation. A production authentication flow, device inventory, device metadata policy, and user-facing remote all-device logout/step-up experience are not established.
- [conversations.py](./conversations.py) owner-filters data and allows a nullable profile association; it does not establish the full sharing authorization model.
- [memories.py](./memories.py) stores memory and consent by user ID and supports owner-filtered list/update/delete/clear operations. It does not establish the full export/reset, backup/deletion, or encrypted production lifecycle.
- The [Part 13 privacy/security governance report](./VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md) records important identity, route authorization, provider consent, encryption, key, and lifecycle gaps. Source and test-file existence do not demonstrate passing tests or deployed behavior.

See the [traceability matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md) for per-decision requirements, implementation evidence, gaps, and follow-up work. No source, schema, migration, provider integration, or production login was changed as part of this documentation record.

## 5. Production gates and acceptance boundary

The approved requirements are not production-readiness evidence. Before enabling production account access or dependent capabilities, the accountable product, security, privacy/legal, and operations owners must approve and verify the applicable choices and evidence, including:

1. A provider-neutral PARMAR identity/SSO contract, candidate comparison and security approval, account mapping and lifecycle, and a complete protected-route authorization inventory.
2. Recovery, passkey/additional-verification, abuse, lost-device, session, device-inventory, step-up, and revocation behavior with exercised negative cases.
3. Profile/workspace authorization, explicit View/Edit/Manage grants, revocation, and cross-user/workspace isolation tests; otherwise sharing stays disabled.
4. Memory consent and lifecycle controls, export/deletion/retention evidence, encrypted production stores and backups, key management, documented residency/recovery, and restore/security testing.
5. Explicit external-provider consent, minimal data transfer, observed zero-egress denials, and no silent fallback before any external AI transfer.
6. Offline cache protection, server-side reauthorization, conflict handling, revocation/deletion behavior, and proof that queued side-effecting actions are never automatically replayed.
7. Account-closure and support-access controls with truthful status reporting and no standing access to private content.
8. Independent security/privacy review, actual deployment evidence, executed acceptance tests, and named release approval.

Until those gates pass, do not claim production readiness or enable the dependent production identity, sharing, external-egress, persistent-data, offline-sync, or account-closure capability.

## 6. Related records

- [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md) — product requirements and D-01–D-13 decision register.
- [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md) — traceability for IT-01–IT-15.
- [VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md) — historical review sheet, superseded by this final decision record.
- [PARALLEL-DEVELOPMENT-MASTER-PLAN.md](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md) — shared PARMAR workstream boundaries and future milestone gates.
