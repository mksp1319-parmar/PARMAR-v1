# PARMAR Identity Architecture Specification

**Status:** Proposed implementation architecture; not an implementation, provider selection, schema approval, or production authorization
**Authority:** The approved requirements in [VOKKI Identity and Tenancy ADR](./VOKKI-IDENTITY-TENANCY-ADR.md#L1), with traceability in [IT-01–IT-15](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md#L1)
**Evidence:** Current repository capabilities are identified separately from proposed contracts. Source existence is not runtime or production acceptance.

## 1. Architecture principles

1. **One PARMAR account identity.** A PARMAR Core-controlled immutable `account_id` is the canonical principal identifier across VOKKI, AETHER, and future PARMAR products. It is generated and assigned by PARMAR, never derived from an email, phone, provider subject, device, display name, or client input.
2. **Provider-neutral authentication boundary.** Authentication adapters translate a successfully verified method into a PARMAR account. Provider/protocol selection remains deferred until comparison and security approval. No product owns a separate login system or account namespace.
3. **Authentication is not authorization.** Authentication establishes the account principal and assurance context. A product/API separately evaluates resource, action, profile/workspace, consent, and policy constraints. A shared account grants no product capability by itself.
4. **Server authority.** Protected requests derive identity from a server-verified session. Client-supplied account IDs, roles, profile owners, workspace memberships, grants, or consent do not establish authority.
5. **Explicit grants; deny by default.** Workspace membership does not expose personal content. Profile sharing requires owner-issued, revocable, operation-mapped View/Edit/Manage grants.
6. **Minimize and preserve scope.** Memory is account/user-scoped by default. Conversation profile association is explicit. Legacy unassigned conversations remain unassigned unless an account owner completes a separately reviewed migration.
7. **Purpose-bound data processing.** Consent is recorded by account, purpose, scope, and version; external AI transfer requires effective consent and minimization at the point of transfer. Revocation is prospective and does not falsely promise recall or deletion of already transferred data.
8. **Separate product/security boundaries.** PARMAR Core provides contracts and services, not a VOKKI UI or browser dependency. AETHER Android remains local-only. AETHER Desktop's identity boundary must not bridge credentials into browser content or alter network/process isolation.
9. **Fail closed and report truthfully.** Missing, expired, ambiguous, or unavailable identity/authorization/consent denies protected work. Data lifecycle status distinguishes pending, completed, retained by policy, and not verifiable.
10. **Approved scope is not readiness.** The 15 ADR requirements are approved outcomes. This proposal does not implement them or satisfy deployment, security, privacy, operational, legal, or release gates.

## 2. Context and component diagrams

### 2.1 Logical context

```text
                         PARMAR Core trust domain
  +------------------------------------------------------------------+
  | Account Registry <-> Authentication Adapter(s) <-> Recovery      |
  |       |                  (provider TBD)            / Passkeys     |
  |       +--> Session Service <--> Device Inventory                  |
  |       +--> Authorization / Grant Service                          |
  |       +--> Consent and Data-Purpose Service                       |
  |       +--> Audit / Approval / Data-Lifecycle contracts            |
  +---------^-----------------------^-------------------^--------------+
            | trusted service calls|                   | approved SSO
            |                       |                   | handoff; method TBD
      +-----+------+            +---+---------+   +-----+----------------+
      | VOKKI API  |            | AETHER      |   | Future PARMAR       |
      | own authz, |            | Desktop     |   | products            |
      | data scope |            | privileged  |   +--------------------+
      +-----^------+            | main only   |
            |                   +---+---------+
       VOKKI UI                       | no credential exposure to
                                      | browser content
                                      v
                                 Browser content
                                 (no identity authority)

  AETHER Android local-only shell: no network or remote-auth path.
  Any future authenticated PARMAR surface is a separate, gated product boundary.
```

### 2.2 Request and authorization path

```text
Client
  |  opaque session credential / approved SSO handoff
  v
Product/API edge --resolve--> PARMAR Session Service
  |                                  |
  |<---- verified account_id,        |
  |       session/device/assurance --+
  |
  +--> Product Authorization Policy
  |      account + action + resource + context
  |      + profile/workspace + explicit grant
  |      + consent/purpose when required
  |
  +--> Data/AI/Lifecycle service only after allow
  |
  +--> Audit event (no secret or unnecessary content)
```

The diagrams are logical. They do not select deployment topology, network protocol, provider, or product transport.

## 3. Trust boundaries

| Boundary | Trusted input | Untrusted input / prohibited assumption | Required control |
|---|---|---|---|
| Authentication adapter → PARMAR account registry | Adapter-verified method proof and adapter identity under an approved configuration | Client claims, unverified attributes, matching email/phone/name | Validate adapter result; map exact method key to one account; audit enrollment/link changes |
| Client → product/API | Server-issued session credential, validated by server | Client-supplied account, role, owner, grant, active workspace, or consent | Resolve session server-side; reject identity-field injection; enforce CSRF/origin protections for browser sessions |
| Product API → authorization service | Verified principal, action, resource ID/type, product context | Product UI state or workspace membership treated as content permission | Complete authorization tuple; explicit grant check; default deny |
| PARMAR Core → product service | Authenticated, audience-limited service identity and correlation metadata | Reusable cross-product user credential or broad authority | Authenticate service channel; product remains responsible for resource authorization |
| Product → data/key service | Authorized data operation and account/resource scope | Raw client key material or unscoped bulk access | Envelope/encryption abstraction; least privilege; audited key/data operations |
| PARMAR → external AI provider | Minimal approved data and active purpose-specific consent | Full conversation/history by default, credentials, unrelated profile data | Egress gate before serialization/transmission; provider/region allow-list; audit evidence |
| AETHER Desktop main → browser content | No identity authority is delegated | Session token, passkey proof, authentication headers, privileged IPC | Main-process-only credential handling; narrow allowlisted IPC; browser renderer gets no identity API |
| AETHER Android shell → network | None under the current approved offline contract | Implied permission to add networking for SSO | Keep no `INTERNET` permission, no WebView/network client/remote auth; future change requires separate approval |
| Support/operator → private content | No standing access | Support role as implicit owner or authorization bypass | No standing private-content access; exceptional access only if separately approved, time-bounded, purpose-bound, audited |

## 4. Identity, session, profile, and data models

The following are **logical architecture records**, not approved SQL tables or database migrations. Field names and physical representation require implementation design review. Secrets and authentication proofs are never fields in ordinary logs or client-visible records.

### 4.1 Account and authentication-method mapping

```text
Account
  account_id: immutable PARMAR-generated opaque identifier
  state: pending | active | closing | closed | disabled
  created_at, updated_at
  lifecycle_version: monotonically changing account-state version

AuthenticationMethod
  method_id: PARMAR-generated opaque identifier
  account_id: Account.account_id
  adapter_id: configured provider-neutral adapter identity
  issuer_namespace: canonical adapter-defined namespace
  subject_key: protected exact provider subject (never email matching)
  state: active | pending_link | revoked
  verified_at, created_at, revoked_at?
  proof_event_id: audit reference for enrollment or linking proof

Uniqueness: (adapter_id, issuer_namespace, subject_key) maps to at most one account.
```

The mapping is server-controlled and access-restricted. New methods are not linked by attribute matching. Optional linking requires a currently authenticated account session, fresh proof of control of the method being added, conflict checking, notification/audit, and a defined recovery path. Merging existing accounts is not implicit; no merge behavior is specified or approved here.

### 4.2 Authentication and authorization context

```text
VerifiedPrincipal
  account_id
  authentication_time
  assurance_level
  authentication_method_ids (opaque references; not proofs)
  session_id
  device_id
  account_state_version

AuthorizationRequest
  principal: VerifiedPrincipal
  product_id
  action
  resource_type
  resource_id
  profile_id? / workspace_id?
  purpose?
  request_id

AuthorizationDecision
  outcome: allow | deny | step_up_required
  policy_version
  reason_code
  decision_id
  expires_at? (only where bounded delegation is explicitly allowed)
```

The principal is server-created. A client may request an active profile/workspace, but the server validates ownership, membership, and applicable explicit grant; selected context is not itself authority.

### 4.3 Session and device records

```text
Session
  session_id: random, non-secret identifier
  account_id
  device_id
  product/audience
  credential_verifier: server-side hash/verifier for opaque high-entropy secret
  issued_at, last_seen_at
  idle_expires_at, absolute_expires_at
  rotated_from_session_id?
  assurance_level, authentication_time
  status: active | revoked | expired
  revoked_at?, revoke_reason?
  csrf_secret_verifier? (browser session only)

Device
  device_id: PARMAR-generated opaque identifier
  account_id
  product/platform family
  user-controlled label? (non-authoritative)
  first_seen_at, last_seen_at
  status: active | revoked
```

Device metadata is minimized and not used as proof of identity. Session credentials are opaque, high entropy, stored hashed/verifier-only server-side, delivered only over an approved secure channel, and never written to logs, analytics, prompts, URLs, or browser content. Session rotation invalidates the old credential atomically. Individual revocation targets a device/session; all-device logout revokes every active session for the account and invalidates associated pending approvals according to the approval contract. Exact lifetime, rotation cadence, revocation latency, device fields, and credential-storage APIs remain security-gated choices.

### 4.4 Profile, workspace, and grant records

```text
Profile
  profile_id
  owner_account_id
  name/metadata
  state
  created_at, updated_at

Workspace
  workspace_id
  owner_account_id
  state
  created_at, updated_at

WorkspaceMembership
  workspace_id
  member_account_id
  membership_role (administrative/workflow role only)
  state
  created_at, revoked_at?

ResourceGrant
  grant_id
  owner_account_id
  grantee_account_id
  resource_type, resource_id
  permission: View | Edit | Manage
  granted_at, expires_at?, revoked_at?
  grant_version
```

Membership and grants are separate relationships. A workspace role, including administrator, does not implicitly grant personal-content access or create a profile grant. Profile ownership controls grant creation and revocation. The operation-to-permission mapping must be explicit, reviewed, and complete before sharing is enabled. `Manage` must not silently delegate ownership or broaden data scope.

### 4.5 Conversation, memory, consent, and lifecycle records

```text
Conversation
  conversation_id
  owner_account_id
  profile_id? (nullable only for legacy/unassigned records or explicitly allowed scope)
  workspace_id? (only with separately approved shared-resource policy)
  created_at, updated_at

Memory
  memory_id
  owner_account_id
  purpose
  encrypted_payload_reference
  created_at, updated_at

ConsentRecord
  consent_id
  account_id
  purpose
  scope (provider, data categories, product/resource scope)
  policy_version
  state: granted | revoked | expired
  granted_at, expires_at?, revoked_at?
  evidence_event_id

LifecycleJob
  job_id
  account_id
  operation: export | reset | delete | close
  requested_at, completed_at?
  state: accepted | pending | completed | partially_retained | failed
  data_classes, retention_basis?, status_reference
```

Memory ownership remains account/user-scoped by default; no automatic profile/workspace migration or sharing. Conversation ownership is explicit. A null profile on historical records is not a request to attach the record to the active profile. Export/deletion contracts enumerate data stores, replicas, backups, audit/retention exceptions, and external copies; completion is reported only when supported by evidence.

## 5. API and interface contracts

These are logical interfaces. Transport, serialization, endpoint paths, and provider protocol remain unresolved. All interfaces have a named owner, caller, boundary, and failure behavior.

| Interface | Owner | Caller | Trust boundary | Contract and failure behavior |
|---|---|---|---|---|
| `AuthenticationAdapter.verify(credential_or_assertion, challenge, client_context)` | PARMAR Core authentication subsystem; adapter implementations are separately reviewed | PARMAR authentication entry point | Untrusted credential input to adapter; adapter result to account registry | Returns verified adapter namespace, exact subject, authentication time, assurance, and proof reference; rejects invalid/expired/replayed proof; unavailable adapter fails closed with retry/reauthentication status; no account disclosure |
| `AccountRegistry.resolve_or_enroll(verified_method, enrollment_context)` | PARMAR Core account service | Authentication orchestration only | Verified adapter assertion to account authority | Resolves exact method mapping or executes approved enrollment; never matches by email/name/phone; ambiguous/conflicting mapping denies and raises security event; account ID is immutable |
| `AccountRegistry.link_method(account_id, verified_current_session, fresh_method_proof)` | PARMAR Core account service | Authenticated account-management flow | Two independent proofs cross into account mapping | Requires fresh proof of control and conflict checks; no auto-link/merge; conflict fails without mapping change; audit and notification required |
| `SessionService.issue(account_id, authentication_context, device_context, audience)` | PARMAR Core session service | Authentication orchestration | Trusted server-to-server request; client does not choose account | Issues opaque high-entropy credential and session metadata after account/assurance checks; unavailable service denies protected sign-in; secrets excluded from telemetry |
| `SessionService.resolve(credential, audience)` | PARMAR Core session service | Product API edge/BFF | Untrusted credential to verified session | Returns `VerifiedPrincipal` only for active, unexpired, non-revoked, audience-valid session; all failures return unauthenticated/deny, never anonymous downgrade |
| `SessionService.rotate(session_id, current_credential, reason)` | PARMAR Core session service | Product API edge / session workflow | Existing verified session to replacement credential | Atomic one-time rotation; replay or race invalidates/denies according to policy; old token immediately rejected |
| `SessionService.revoke(session_id, actor, reason)` / `revoke_account(account_id, actor, reason)` | PARMAR Core session service | Account UI, security workflow, closure workflow | Authenticated account actor or authorized security workflow | Revocation is idempotent and auditable; all-account revocation invalidates all active sessions and triggers pending-approval reevaluation; service failure does not report success |
| `StepUpService.verify(principal, requested_action, fresh_proof)` | PARMAR Core authentication/security subsystem | Product action API or account flow | Sensitive action requires fresh authentication proof | Returns time-bounded assurance result scoped to action; invalid/unavailable proof denies sensitive action without changing account identity |
| `AuthorizationService.evaluate(request)` | PARMAR Core policy/authorization contract; product policy owner supplies resource semantics | Product API before every protected operation | Trusted principal and server-resolved resource metadata | Returns allow/deny/step-up with policy version/reason; missing policy, stale scope, unknown resource, or unavailable decision denies; cache only if bounded policy permits |
| `ConsentService.check(account_id, purpose, scope, data_categories)` | PARMAR Core consent authority; product defines purpose/data categories | Product data/AI egress service | Server-side account and operation scope | Allows only active, matching, version-valid consent; absence/revocation/mismatch/service failure denies transfer or processing requiring consent |
| `KeyService.encrypt/decrypt/dek_for(resource_scope)` | PARMAR Core security platform or separately approved managed key boundary | Authorized data stores only | Workload identity and scoped resource authorization | Key material never returned to client or logs; unavailable/revoked key fails closed; no plaintext fallback; rotation/recovery evidence required |
| `AuditService.append(event)` | PARMAR Core audit owner | Authentication, authorization, consent, approval, lifecycle and egress services | Trusted internal event producers | Append-only integrity and event identity; sensitive tokens/proofs and unnecessary content prohibited; inability to record security-critical event blocks the action if policy requires audit |
| `ApprovalService.revoke_or_revalidate(account_id, session_ids, reason)` | PARMAR Core human-approval authority | Session revocation, account closure, security workflow | Trusted service-to-service call | Pending approvals are invalidated/revalidated by their own authority; identity/session service cannot convert approval into execution; failure is surfaced and closure/revocation is not reported complete |
| `DataLifecycleService.request(account_id, operation, scope)` / `status(job_id)` | PARMAR Core lifecycle authority; each data custodian owns execution | Authenticated account UI or approved compliance workflow | Verified account request to distributed data custodians | Enumerates stores and retention exceptions; returns truthful asynchronous status; partial failure remains visible and is never represented as completed deletion |
| Product `authorize_and_execute(request)` | Each product/API owns its resource-specific policy enforcement | Product UI/backend | Product caller to protected data/action service | Resolves session, evaluates current authorization, checks consent where relevant, and binds audit to account/resource; stale context or dependency failure denies |

### 5.1 Browser and native credential storage requirements

- **Web:** use server-issued, opaque, audience-appropriate sessions; prefer `Secure`, `HttpOnly`, appropriately scoped cookies with `SameSite` policy, CSRF defenses, exact origin validation, TLS/proxy configuration review, session rotation, and no credentials in URLs/local storage/logs. The precise SSO handoff and cookie domain model are unresolved and must be security-reviewed. Do not share a broad parent-domain cookie merely for convenience.
- **Native clients, if separately approved:** use OS-protected credential storage and short-lived, revocable session credentials; exclude credentials from backups, clipboard, logs, crash reports, and shared app metadata. Require platform-specific threat review, device-loss/revocation behavior, and equivalent isolation tests.
- **AETHER Android current shell:** no credential storage or remote-auth implementation is authorized; local-only features remain usable without PARMAR account/network.
- **AETHER Desktop:** privileged main-process/session broker only; no credential in browser renderer, web page, preload-exposed generic storage, address/navigation state, or remote request headers. Browser-network isolation remains independently enforced.

## 6. Authorization decision flow

1. **Authenticate request:** product edge resolves the presented credential through `SessionService.resolve` for the expected audience. Invalid, expired, revoked, or unavailable session resolution fails closed.
2. **Validate request shape:** reject client-provided identity, role, owner, membership, permission, and consent assertions. Resolve target resource and its authoritative owner/scope server-side.
3. **Build complete decision tuple:** account principal, assurance, product, action, resource type/ID, active profile/workspace, applicable explicit grant, request purpose, and current policy version.
4. **Apply mandatory denials:** closed/disabled account, expired/revoked session, missing resource, cross-account owner mismatch, missing profile/workspace context, no explicit grant, or incompatible purpose denies.
5. **Check step-up:** for sensitive operation, require fresh action-scoped proof; do not treat a successful step-up as permission.
6. **Check consent:** for consent-dependent processing or external transfer, require active purpose/scope/data-category consent. Minimize payload before egress.
7. **Return a bounded decision:** `allow`, `deny`, or `step_up_required`, with policy version and reason code. Default is deny. A product must not infer permission from prior navigation, membership, or cached client state.
8. **Execute and audit separately:** only the product/authority that owns the operation executes it. Record principal, action, resource reference, decision, policy/consent versions, and outcome; do not log secrets or excessive content.
9. **Revalidate at commit:** recheck authorization/session/consent immediately before sensitive or side-effecting execution if revocation or context changes can race the operation.

Profile switching invalidates prior profile-scoped client state and prevents stale in-flight responses from populating the newly selected context. Every request still authorizes server-side.

## 7. Cross-product integration model

- PARMAR Core is the sole authority for account IDs, method mappings, authentication assurance, shared session/account lifecycle contracts, consent records, central audit contracts, and human-approval/data-lifecycle coordination.
- Each product consumes a verified PARMAR principal through a server-to-server contract or an approved SSO handoff. The handoff mechanism is **not selected** here. Any future mechanism must be short-lived, audience-bound, single-use where applicable, replay-resistant, and must not expose provider credentials to products.
- Product services maintain only the minimum session/context needed for their boundary. A common account ID does not imply a common database, shared cookie, shared authorization, or shared content.
- VOKKI remains a product/UI layer. Its API owns conversation/profile/workspace resource checks and cannot issue account identity or grants.
- AETHER Desktop's local browser profile IDs and Chromium partitions remain app-local. A PARMAR authenticated control surface, if separately approved, is isolated from browser content and cannot enable remote browsing.
- AETHER Android remains independent and offline-local. This architecture defines no active Android SSO path.
- Future products register a product audience, resource/action policy, data purposes, audit events, session handling, and lifecycle custodians before protected access; they do not create independent product accounts.

## 8. Offline AETHER integration strategy

### Android

The approved Android offline shell MUST remain usable without network or a PARMAR account. This specification does not authorize or propose changing its manifest or adding INTERNET permission, HTTP clients, WebView/browser engines, remote authentication, PARMAR/VOKKI service calls, analytics, remote images, or background synchronization. Local profile/browser identity remains local app state, not a PARMAR account.

If a future product requirement requests a PARMAR-authenticated capability, it is a separate decision and security review. It must define a separate authenticated product surface and network boundary without silently changing the existing offline shell contract. Until that is approved, no account availability or SSO dependency is introduced into Android.

### Desktop

Authentication and browser networking are separate security boundaries:

1. Keep `REMOTE_BROWSING_ENABLED=false` and all existing process-isolation/admission NO-GO gates intact.
2. If a PARMAR-authenticated control surface is separately approved, terminate authentication in a privileged, narrowly scoped host/main process or a separately trusted control client; do not place secrets in remote browser content or expose generic credential APIs over IPC.
3. Use sender validation and explicit IPC allowlists; browser renderer remains sandboxed with context isolation, no Node integration, and no access to the identity broker.
4. Bind any product control session to a strict audience and purpose. Browser URL/navigation, cookies, downloads, or local profile metadata do not authenticate a PARMAR user.
5. Do not use authentication success as permission to browse remotely. The existing remote-network deny and platform-specific isolation gates remain independent prerequisites.

No Desktop identity integration, network behavior change, or remote browsing enablement is implemented by this document.

## 9. Migration and compatibility

1. **Preserve existing data first.** Snapshot and classify existing VOKKI owner UUIDs, sessions, profiles, workspace records, conversation profile IDs, memories/consents, AETHER local profiles, and browser partitions before any future migration.
2. **Do not equate identifiers.** Existing VOKKI owner UUIDs are not proven PARMAR account IDs. AETHER profile IDs, session partitions, and local SQLite data are not account IDs. Build a separately approved mapping process with account-owner verification and collision reporting.
3. **No automatic linking.** Never map by matching email, phone, name, or provider subject across an unverified legacy boundary. Linking requires fresh proof and explicit user action; ambiguity blocks migration.
4. **Keep legacy conversations unassigned.** Nullable `profile_id` records remain explicitly unassigned. Do not attach them to the currently active profile/workspace by inference. Export or migration requires owner review, exact record counts, rollback planning, and isolation tests.
5. **Preserve memory scope and consent.** Do not move user-scoped memory or consent to profiles/workspaces/accounts with broader visibility. A change in scope requires a separate decision, consent, migration plan, and verification.
6. **Invalidate old sessions.** Do not silently upgrade local/demo session credentials into production identity sessions. Require reauthentication; revoke legacy credentials and pending approvals as specified by their authorities.
7. **Maintain product-local AETHER state.** Any future account association must be optional, explicit, reversible where possible, and must not merge browser cookies/data or break offline operation.
8. **Use staged migration gates.** Dry-run mapping; reconcile duplicates/orphans; test two-user isolation and rollback; obtain data-protection/privacy/security approval; migrate a limited approved cohort; verify and report results before broader adoption.

## 10. Threat model

### Assets

Immutable account identity and method mappings; session and device credentials; profile/workspace data and grants; conversations and memory; consent and provider-transfer records; approvals and audit events; encryption keys; local AETHER state.

### Adversaries and failure sources

Unauthenticated or compromised clients; malicious authenticated users; compromised login method/device; credential stuffing and recovery abuse; hostile or compromised provider/adapter; cross-tenant implementation errors; malicious or misconfigured product service; external AI provider misuse; renderer/IPC compromise; stolen local device; malicious or accidental operator access; service/network/key/audit outages.

### Principal threats and required mitigations

| Threat | Required mitigation / acceptance |
|---|---|
| Account takeover or identity collision | Immutable internal ID; exact method mapping; fresh proof for linking; no attribute-based auto-merge; abuse limits, recovery review, notification, and security testing |
| Session theft/replay/fixation | Opaque high-entropy tokens, server-side verifier, TLS, rotation, audience binding, expiry, CSRF/origin defenses, device/all-device revocation, no secret logging |
| Privilege escalation via client fields | Server-derived principal and resource ownership; reject identity/role/owner/grant fields; route/resource authorization matrix; negative tests |
| Cross-profile/workspace data leak | Owner-first access; explicit grants; membership alone denied; no implicit context inheritance; two-user/two-workspace allow/deny tests |
| Stale grants/consent/session race | Versioned/revalidated authorization and consent at sensitive commit; revocation tests; bounded cache only with explicit policy |
| External AI over-disclosure or silent fallback | Purpose-scoped consent check before transfer; minimal payload; provider/region constraints; deny on unavailable provider; zero-egress and no-fallback tests |
| Data exposure from backup/key compromise | Encryption for production data and backups, key custody/rotation/recovery, least privilege, restore/security testing, residency evidence |
| False deletion/account closure claim | Data inventory and custodian acknowledgements; asynchronous truthful lifecycle status; backup/provider exceptions visible; no success until required evidence |
| Browser credential theft or privilege bridge | Desktop main-process boundary; no secrets to browser content; strict IPC sender/origin allowlists; sandbox/context isolation; independent network deny |
| Android contract drift | Manifest/package/dependency/network tests proving no Internet permission, WebView, remote-auth/network client or outbound requests |
| Support/operator misuse | No standing private-content access; separately approved, time-bound, purpose-bound, audited exceptional-access workflow only |
| Audit omission or sensitive audit leakage | Append integrity-protected events for security decisions; exclude tokens, proofs, and unnecessary content; fail closed where audit is a required prerequisite |

The threat model does not claim protection against a compromised OS/kernel, trusted deployment root, or provider without an independently accepted threat boundary and evidence.

## 11. Failure handling

- **Authentication provider/adapter unavailable:** do not create a session or downgrade to anonymous/another account. Preserve local-only product functionality where authorized and explain retry/recovery.
- **Account mapping ambiguous or conflicting:** deny authentication/linking, make no mapping change, avoid account enumeration, and create a security event.
- **Session service unavailable/invalid credential:** deny protected requests; no cached identity fallback. AETHER Android local offline features continue because they do not depend on remote identity.
- **Authorization service unavailable or policy missing:** deny protected reads/writes/actions. Do not use workspace membership or UI state as fallback permission.
- **Step-up unavailable or rejected:** sensitive operation is denied; session identity remains unchanged.
- **Consent absent/revoked/unavailable:** do not perform consent-dependent processing or external transfer. Do not silently route to another provider.
- **Key service unavailable:** fail closed; never write/read plaintext as fallback. Surface storage unavailability without exposing sensitive data.
- **Audit unavailable:** block security-critical transitions if required by policy; never claim an unaudited revocation, transfer, grant, or closure succeeded.
- **Revocation race:** revalidate before sensitive commit; define and test the maximum revocation latency. Pending approvals are independently invalidated/revalidated; no replay or execution fallback.
- **Export/delete partially fails:** return a durable job/status with failed/retained classes and reason; do not label it complete. Retry safely and idempotently.
- **Offline device after account revocation/closure:** state explicitly that remote revocation cannot erase disconnected local state immediately; define local expiry/next-connect handling before enabling account-linked local data.
- **AETHER network attempt:** Android must not issue it under the current contract; Desktop retains its current deny state regardless of identity state. Treat unexpected traffic as a security defect, not an authentication fallback.

## 12. Test strategy and measurable acceptance criteria

Testing must include unit, service-contract, integration, adversarial, migration, platform, and deployed-runtime evidence. Test fixtures use synthetic accounts/data. The architecture is accepted only when the relevant gates have named owners and retained evidence.

### Identity and authentication

- Every account receives exactly one immutable, PARMAR-generated account ID; changing email, phone, provider, display name, or device does not change it.
- One exact authentication-method key maps to at most one account; attempted duplicate or ambiguous mapping is rejected with no partial state.
- No matching-attribute account linking or merge occurs. Linking succeeds only with fresh proof of control and records an auditable event; replayed/stale proof fails.
- Invalid/unavailable authentication does not create a session or resolve to another identity; responses do not disclose whether unrelated accounts exist.
- Provider remains unset until a requirements comparison and security approval record exist.

### Sessions and authorization

- For two synthetic accounts and multiple devices, verify issue, expiry, rotation, token replay rejection, individual device/session logout, and all-device logout. Revoked credentials and bound pending approvals are denied within the approved maximum revocation latency.
- Session credentials never appear in URLs, logs, prompts, analytics, crash reports, browser content, or unapproved backups.
- Browser cookie tests cover `Secure`, `HttpOnly`, SameSite, CSRF, exact origin, TLS/proxy trust, and profile-switch stale-response behavior.
- Every protected route/data operation has a complete authorization matrix; two users/two workspaces verify deny-by-default on read, write, update, delete, export, and action paths.
- Membership alone never authorizes personal content; each View/Edit/Manage grant authorizes only mapped operations; revocation is enforced before the accepted latency.
- Sensitive operations require fresh step-up under approved policy; a successful step-up does not bypass resource authorization.

### Consent, data, AI, and lifecycle

- Memory and conversations remain account-owner-scoped by default. Legacy unassigned conversations remain unassigned after profile selection and migration dry-runs.
- Consent tests cover purpose, scope, categories, policy version, expiration, revocation, and unavailable consent service. Missing or mismatched consent produces zero external egress.
- For authorized transfer, verify the serialized payload contains only approved data categories/context; provider outage never triggers silent fallback; audit records provider/purpose/scope/decision without secrets or excessive content.
- Encryption/key tests prove production data and backups are encrypted, key operations are least-privileged, rotation/recovery works, and key-service outage has no plaintext fallback.
- Export/delete/reset/closure tests enumerate all data custodians, backup and provider copies, idempotent retries, partial failures, truthful status, session and approval revocation, and no standing support access.

### Product/platform integration

- AETHER Android release artifact has no `INTERNET` permission, WebView/browser engine, remote-auth/networking dependency, or outbound request; local offline flows function with no account and no network.
- AETHER Desktop tests preserve `REMOTE_BROWSING_ENABLED=false`, process/isolation gates, renderer hardening, and no credential exposure through page globals, URL, headers, preload, or IPC. Test each claimed platform/runtime; do not infer Windows/macOS guarantees from Linux.
- Product integration proves common PARMAR account identity without shared product credentials or authorization leakage; product-specific access remains independently evaluated.

### Production gate

No production-readiness claim until provider/security decisions are approved, actual deployed topology and key/data controls are verified, supported-platform runtime tests pass without skips, independent security/privacy review completes, recovery/restore and incident procedures are exercised, and accountable release owners sign off.

## 13. Unresolved decisions and security gates

The architecture establishes boundaries without inventing approvals. The following remain open:

1. Authentication provider, protocol, region, account enrollment, callback/handoff, and operating ownership; candidate comparison and security approval are prerequisites.
2. Account ID representation and lifecycle state transitions; method identifier normalization and sensitive mapping-storage controls.
3. Authentication assurance levels; passkey enrollment/recovery; recovery channels; attempt thresholds, throttling, lockout, and anti-enumeration details.
4. Session idle/absolute lifetimes, rotation policy, device metadata, device naming, revocation latency, step-up triggers, and native secure-storage APIs.
5. Cross-product SSO handoff and token/session topology; do not assume shared cookies, JWT, OAuth, OIDC, or a specific protocol is approved.
6. Detailed family/team/workspace policies, invitations, roles, grant operation mapping, Manage delegation, and feature enablement.
7. Consent UX/versioning, purpose/data-category taxonomy, retention, export formats, deletion SLAs, backup expiry, legal exceptions, and external-provider deletion terms.
8. Encryption algorithms/configuration, key custody/rotation/recovery, residency, deployment topology, recovery objectives, and audit retention.
9. External AI provider/model/region, transfer endpoint and terms, and PARMAR-managed AI feasibility/licensing/security/update ownership.
10. Android authenticated-surface request, if any; it is not part of the current offline-only contract.
11. AETHER Desktop authenticated control-surface topology and host-platform acceptance; remote browsing remains independently NO-GO.
12. Account-closure grace period, disconnected-device limits, exceptional access, support/incident process, and truthful completion evidence.

These open choices are prerequisites or production gates, not permission to implement defaults silently.

## 14. Mapping to IT-01 through IT-15

| ADR decision | Architecture sections | Proposed contract / acceptance |
|---|---|---|
| **IT-01** Immutable internal PARMAR account ID | §1, §4.1, §5 | `AccountRegistry`; immutable opaque PARMAR-generated ID; identity stability tests |
| **IT-02** Provider selection deferred | §1, §5, §13 | Provider-neutral `AuthenticationAdapter`; no provider/protocol selection before comparison and security approval |
| **IT-03** Optional linking with fresh proof; no auto-link/merge | §4.1, §5, §10, §12 | `link_method` requires current-account session plus fresh method proof; conflict/replay tests; no attribute-based matching |
| **IT-04** Recovery, passkeys, verification, attempt limits, lost-device protection | §4.3, §5, §10, §11–13 | Recovery/step-up boundary and security policy gates; negative/abuse/lost-device acceptance |
| **IT-05** Per-device sessions, inventory, logout, step-up | §4.3, §5, §6, §12 | Session/device records and issue/resolve/rotate/revoke APIs; individual/all-device revocation tests |
| **IT-06** Personal, multiple-profile, family/team eventual scope | §4.4, §7, §13 | Account-owned profile/workspace model; detailed policy/enablement remains gated |
| **IT-07** Workspace membership not personal-content access | §3, §4.4, §6, §12 | Authorization tuple and deny-by-default; membership-only negative tests |
| **IT-08** Owner-controlled profiles and explicit View/Edit/Manage grants | §4.4, §5, §6, §12–13 | Owner-only grant/revoke contract; exact operation map and cross-resource grant tests |
| **IT-09** User-scoped memory; no automatic migration/sharing | §1, §4.5, §9, §12 | Account-owned memory model; no scope broadening; ownership/migration tests |
| **IT-10** Review/edit/export/delete/reset and truthful lifecycle | §4.5, §5, §11–12 | Consent/lifecycle records, asynchronous status and data-custodian contracts; complete/partial deletion tests |
| **IT-11** Encryption, keys, residency, recovery, security testing | §3, §4.5, §5, §10–13 | `KeyService` and data lifecycle boundaries; encrypted store/backup, key, residency, restore evidence gate |
| **IT-12** Explicit scoped external-AI consent, minimization, no fallback | §3, §5, §6, §10–12 | `ConsentService` before egress; minimal payload; zero-egress and no-fallback tests |
| **IT-13** PARMAR-managed independent AI long-term goal | §1, §7, §13 | No runtime selected; feasibility, licensing, security, operations, and update ownership remain evaluation gates |
| **IT-14** Offline drafts/cache, reauthorization, conflicts, no side-effect replay | §6, §8, §11–12 | Android remains local-only; any future VOKKI sync requires server reauthorization, explicit conflicts, and no-replay tests |
| **IT-15** Secure closure, revocation, truthful lifecycle, no standing support access | §4.5, §5, §10–12 | Account-wide session/approval revocation and `DataLifecycleService`; closure/retention/support-access acceptance |

## 15. Existing capabilities versus proposed architecture

### Existing repository evidence

- [identity.py](./identity.py#L17) defines a principal and resolver protocol; the local demo resolver is anonymous. It is not a production account registry or provider integration.
- [identity_store.py](./identity_store.py) persists local profiles, workspaces, memberships, and workspace-profile associations. Task 37 adds an internal account-record registry and read-only provider-binding lookup; it has no active authentication/binding writer or View/Edit/Manage grant system.
- [sessions.py](./sessions.py#L32) and [sessions.py](./sessions.py#L762) provide server-side session policy/creation/rotation/revocation primitives, but not the complete device/recovery/step-up product flow.
- [conversations.py](./conversations.py#L90) includes owner and nullable profile association; nullable legacy records must remain unassigned absent explicit migration.
- [memories.py](./memories.py#L55) provides owner-scoped memory and consent primitives, not complete export/deletion/encrypted production lifecycle.
- [chat/readiness.py](./chat/readiness.py#L274) includes server-side external authorization and [chat/router.py](./chat/router.py#L19) records routing/fallback state; neither is per-user consent or end-to-end egress acceptance.
- [AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml#L1) and the [offline contract](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9) evidence the Android local-only boundary; no account integration is established.
- [desktop/security.cjs](./desktop/security.cjs#L5), [desktop/main.cjs](./desktop/main.cjs#L724), and [desktop/profile-partitions.cjs](./desktop/profile-partitions.cjs#L11) evidence remote browsing disabled, hardened renderer preferences, and local profile partitions; no PARMAR identity integration is established.

### Proposed, not implemented

All diagrams, logical records, interfaces, authorization flow, SSO integration model, device inventory/recovery/step-up contracts, grant/consent/key/lifecycle services, migration gates, and acceptance criteria in this document are proposed architecture. They do not authorize source/schema changes, select a provider or protocol, enable production authentication or AI transfer, add AETHER networking, weaken Desktop isolation, or claim production readiness.

### Governing-document reconciliation

- The [ADR](./VOKKI-IDENTITY-TENANCY-ADR.md#L39) is the authoritative approved requirement set. This specification treats IT-01–IT-15 as requirements and distinguishes deferred implementation details.
- The [traceability matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md#L14) provides current evidence/gaps; the architecture does not reclassify those source findings as production capabilities.
- The [cross-product gap assessment](./PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md#L1) documents implementation limits, risks, and the AETHER wording tension.
- The [Master PRD §3.1](./VOKKI-MASTER-PRD.md#L101) requires one PARMAR account/SSO and prohibits separate product logins while retaining product-specific authorization.
- The [parallel development plan](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L25) states AETHER browser independence from PARMAR account availability, while its decision reconciliation records PARMAR-wide SSO at [§1](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L42). Read consistently as the offline/local AETHER shell remaining usable without an account; clarify this wording in the plan before any cross-product integration. This specification does not modify that document or weaken the Android offline/desktop security constraints.

## 16. Scope and approval boundary

This is an implementation-oriented architecture proposal only. It does not modify application source or database schemas; select an authentication provider, protocol, AI provider, or deployment; implement authentication, SSO, consent, synchronization, encryption, or lifecycle controls; enable AETHER networking; change Desktop isolation; or claim security/production readiness. Each deferred choice and implementation phase remains subject to its required product, security, privacy/legal, operations, and release approvals.
