# PARMAR Account Provisioning Policy — Draft

| Field | Value |
|---|---|
| Status | **Draft for explicit user, product, security, privacy/legal, and operations review; not approved** |
| Scope | Policy for future PARMAR Core account enrollment, lifecycle, provisioning authority, recovery, closure, and provider-binding activation gates |
| Governing decisions | Approved requirements IT-01 through IT-15 in [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md) |
| Related architecture | [PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md), [PARMAR-IDENTITY-IMPLEMENTATION-BASELINE.md](./PARMAR-IDENTITY-IMPLEMENTATION-BASELINE.md), [PARMAR-CORE-IDENTITY-CONTRACTS.md](./PARMAR-CORE-IDENTITY-CONTRACTS.md), and [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md) |
| Evidence boundary | Aligned with the read-only Task 37.3 verification; no production authentication or provisioning is evidenced or authorized |

> **This is a policy proposal, not an implementation plan authorization.** Only the required outcomes recorded as IT-01–IT-15 are approved. Recommendations, state transitions, operational controls, and thresholds in this draft are not approved merely because they appear here. Do not activate `TrustedInternalAccountProvisioner`, create a provisioning endpoint, add a provider adapter or binding writer, enable SSO, or change any product source as a result of this draft.

## 1. Purpose and policy principles

This draft defines a security-first policy boundary for any future creation or lifecycle change of a PARMAR account. It is intended to resolve policy questions before implementation, not to choose a provider or settle implementation details implicitly.

1. **PARMAR owns the account identity.** Generate a random PARMAR-issued UUIDv4. It is immutable, never reused, and never derived from email, phone, username, display name, device, provider subject, legacy `user_id`, or client input.
2. **Identity is not authorization.** An account does not imply access to a product, profile, workspace, personal content, approval, execution, or browser capability.
3. **Verified authority only.** A server-side policy decision—not a client account ID, a Python object, a provider claim, or a method name—must authorize provisioning and lifecycle changes.
4. **No automatic identity equivalence.** Matching email/name/phone, equal-looking UUIDs, a workspace invitation, or possession of a device does not link, merge, or migrate identities.
5. **Fail closed and avoid enumeration.** Ambiguous, malformed, expired, conflicting, or unavailable evidence denies the operation without disclosing whether another account or method exists.
6. **Separate account state from data lifecycle.** Suspension, disabling, closure, and data deletion are distinct states/operations with separately auditable effects.
7. **Minimize and report truthfully.** Keep only data needed for an approved purpose; report each data class, retention exception, and deletion outcome accurately.
8. **No standing support access.** Support or administrative authority never implies access to personal content.
9. **One ecosystem identity, separate product policy.** PARMAR Home, VOKKI, AETHER, and future products use the shared account identity when authenticated; each remains responsible for product and resource authorization.

### 1.1 Explicitly out of scope

This draft does not choose an authentication provider, protocol, region, account-assurance level, recovery factor, rate-limit value, session lifetime, data-retention period, deletion deadline, or SSO topology. It does not specify or authorize production authentication, provider integration, binding writes, account recovery, MFA/passkeys, session changes, public account routes, UI changes, migration of legacy identities, or account creation by `TrustedInternalAccountProvisioner`.

## 2. Current baseline and limits

Task 37.3 independently verified the v3 account-registry foundation and its integrity tests. This is storage and contract groundwork, not a live enrollment system:

- The registry currently records random immutable account IDs, creation time, and `ACTIVE`/`DISABLED`; it has no approved status-transition or account-closure workflow. The database prevents account-ID changes and account deletion.
- `TrustedInternalAccountProvisioner` remains inactive and has no application caller or public HTTP route. It is convention-based, not an enforced in-process capability. Python identity objects are constructible and do not prove authentication provenance.
- The provider-binding table is a lookup foundation. There is no active provider adapter or binding writer; no provider identity may be enrolled or linked from claims or client data.
- PARMAR Home and VOKKI continue to use legacy server-side `Principal.user_id` in applicable request paths. There is no approved mapping to `AccountIdentity`, and no conversation or memory migration.
- Desktop remote browsing remains disabled. Android remains offline-only.

Any lifecycle status names, authority model, safeguards, and acceptance criteria below are **proposals**. They are not existing registry behavior. A later implementation requires explicit approval and separate security, privacy, operational, and product gates.

## 3. Account identity and lifecycle policy

### 3.1 Immutable identity and creation invariants

- PARMAR Core alone generates the account ID using a cryptographically secure random UUIDv4 source. The ID is independent of every authentication method and mutable user attribute.
- No request accepts an account ID as a way to select the identity being created, authenticated, linked, recovered, or authorized. Client-supplied identity fields are ignored or rejected and never override the server-derived principal.
- Account creation must be transactional and idempotent for a single verified enrollment operation. A retry must not create multiple accounts for one accepted enrollment attempt.
- A provider identity, if a separately approved adapter later verifies one, remains a distinct `(issuer, subject)` value. It can resolve only through an exact, unique, server-controlled binding. It must not be parsed or converted into a PARMAR account ID.
- Keep account IDs immutable and never reassign or reuse them, including after closure. Preserve legacy `user_id`, profile, conversation, memory, and local-device namespaces as distinct identities unless a separately approved migration establishes verified ownership.

### 3.2 Proposed lifecycle states

The following state model is a recommendation for policy approval. It is not implemented by the v3 registry; in particular, `PENDING`, `SUSPENDED`, `CLOSING`, and `CLOSED` are not currently registry states.

```text
Enrollment request --verified--> ACTIVE
       |                            |
       +--> REJECTED / EXPIRED /    +--> SUSPENDED --review--> ACTIVE
            WITHDRAWN (no account)  |         |
                                    |         +--> DISABLED --review--> ACTIVE
                                    +--> DISABLED
                                    |
                                    +--> CLOSING
SUSPENDED -------------------------> CLOSING
DISABLED --------------------------> CLOSING
                                          |
                               +----------+----------+
                               |                     |
                     approved cancellation       closure checks
                     within approved window         pass
                               |                     |
                               v                     v
                             ACTIVE                CLOSED (terminal)
                                                     |
                                   separate data-class lifecycle jobs
                                                     v
                                   DATA STATUS: pending / deleted /
                                   partially retained / failed / unverifiable
```

The state names and transitions below are **proposed recommendations**, not approved policy or implemented registry behavior. `PENDING` is an enrollment-request state, not an active `AccountIdentity`; a PARMAR account ID should be minted only after the approved proof succeeds. `PENDING` may be omitted if verification completes synchronously before account creation. Rejected, expired, and withdrawn enrollment requests are terminal request outcomes, not account states. Data-job statuses are separate from account states. The matrix is authoritative if the illustrative diagram is read as ambiguous.

| Proposed state | Meaning and access behavior | Entry/exit authority and audit expectation |
|---|---|---|
| **PENDING** | Enrollment is accepted for verification but not complete. Deny product access, session issuance, provider-bound sign-in, and personal-data access. Expire or reject when proof is invalid, abandoned, or conflicting. | Enter only through an approved provisioning flow. Activate only after all required verification and abuse checks. Log request/reference, policy version, result, and expiry without raw proof or unnecessary personal data. |
| **ACTIVE** | Account is eligible to authenticate only through a separately approved authentication method and current session policy. It grants no product/resource authorization by itself. | Enter after accepted verification or approved reinstatement. Every transition is server-authorized and audited. |
| **SUSPENDED** | Proposed temporary, time-bounded security or abuse hold. Deny sign-in and protected access, revoke sessions and re-evaluate pending approvals, but do not treat the hold as account closure or deletion. Preserve data under approved retention controls. | Enter only under a defined security/abuse policy with a reason code, actor/service, review owner, and review deadline. Restore only after review and fresh ownership checks where needed. |
| **DISABLED** | Proposed non-temporary access block for an explicit policy, user, or operational reason. It is not a synonym for suspension, closure, or deletion. Deny sign-in and protected access. Retain data only under an approved basis and report the reason category to the account owner where safe and lawful. | Enter/exit only by an authorized actor or approved workflow. Record scope, reason category, authority, notification decision, review/appeal path, and all session/approval effects. Avoid indefinite silent disablement; a review policy is required. |
| **CLOSING** | A verified request or approved policy decision has initiated permanent account closure. Immediately stop new authentication, revoke active sessions/devices and applicable approvals, and block protected access. Data-class lifecycle work may continue asynchronously. | Enter only after the closure authority is verified and the user is told what will happen, what may be retained, and what cannot be recalled. Any grace period, cancellation rights, and required step-up must be separately approved. |
| **CLOSED** | PARMAR authentication and account access are permanently ended. Closure does not assert that every copy of every data class has been deleted. | Reach only after required access revocation is evidenced and closure status can be truthfully reported. No routine reopening; account ID is never reused. The policy must define whether a distinct, verified appeal/reinstatement exception exists. |

**Suspension versus disabling:** suspension is proposed as a temporary risk-control state with a review deadline; disabling is a separate access prohibition with a specified policy/owner and a review or appeal route. Neither transfers ownership or authorizes staff to view personal content.

**Closure versus deletion:** closure permanently ends account access; deletion is a separate, per-data-class process. The lifecycle must distinguish deletion pending, deleted, retained by a stated basis, backup expiry pending, provider copy not recallable, failed, and unverifiable. Do not call an account “deleted” merely because it is closed or a primary database row was removed.

#### Proposed transition authority matrix

The functional roles below are policy proposals, not existing roles or code capabilities. “Provisioning Authority,” “Security Authority,” and “Lifecycle Authority” must be assigned, separated from requesters where stated, and approved before implementation. An administrator may not create authority merely by holding a product or workspace administrator role.

| Permitted transition | Initiator | Approver / decision authority | Required evidence | Reversible? Review / appeal | Mandatory security and data effects |
|---|---|---|---|---|---|
| Enrollment request → `PENDING` | Prospective account holder through an approved enrollment flow; an approved facilitator may only open the request for the person. | Provisioning Authority applies the approved enrollment policy. | Request/correlation ID, explicit intent, challenge issuance, expiry, and an abuse/rate-limit decision. No account ID or provider binding is created. | Request may be continued, withdrawn, rejected, or expired; appeal uses a new verified request. | Do not issue sessions or expose account existence. Keep only the minimum short-lived request data under an approved expiry policy. |
| Enrollment request → `ACTIVE` | Prospective account holder completes the approved flow. | Provisioning Authority verifies the evidence and atomically mints the immutable UUIDv4; no administrator may substitute for this proof. | Fresh, replay-resistant proof of control of the selected approved method; exact issuer/subject validation where applicable; uniqueness/conflict check; accepted policy version. | Account identity is not reassigned or rolled back. Later suspension/disablement may block access; activation errors require an audited correction, never ID reuse. | Create exactly one account transactionally. Do not infer linking, workspace membership, profile access, or legacy ownership. No provider binding writer exists until its separate gates pass. |
| Enrollment request → `REJECTED`, `EXPIRED`, or `WITHDRAWN` | Applicant withdraws; otherwise the enrollment service records failed proof, conflict, or expiry. | Provisioning Authority applies deterministic approved rules; an appeal/retry is reviewed through a fresh request, not by an operator overriding evidence. | Failed/invalid/ambiguous proof, uniqueness conflict, expiry, or verified withdrawal event. | Terminal request outcome; retry is a new request. No active account exists to reinstate. | No account ID, provider binding, session, product access, or migration. Retain only minimal audit/request metadata for its approved period; use non-enumerating responses. |
| `ACTIVE` → `SUSPENDED` | Account holder may request a temporary protective hold; otherwise an approved security detector or authorized security responder may initiate it. | Security Authority confirms the policy trigger. An emergency automated/on-call hold may take immediate effect only with independent review within an approved deadline. | Fresh owner request or documented risk/incident signal with scope, reason code, actor, and review deadline. | Temporary and reviewable. Restore only through `SUSPENDED` → `ACTIVE`; appeal/review owner and deadline must be communicated where safe. | Immediately deny new auth/resource access, revoke sessions/devices, re-evaluate pending approvals, and make all provider bindings unusable while state is non-active. Preserve data; do not delete, reassign, or broaden access. |
| `ACTIVE` → `DISABLED` | Account holder may request disablement through a verified session; an authorized Core policy owner may initiate a policy/legal hold. | Provisioning Authority for a user request; independent authorized policy/security approver for an operator-initiated action. The requester cannot approve their own operator action. | Fresh owner proof or documented policy/legal basis, scope, reason category, notice decision, and review/appeal route. | Reversible only through `DISABLED` → `ACTIVE` after review and fresh ownership proof. | Deny auth and product access; revoke sessions/devices and re-evaluate approvals; make bindings unusable. Preserve personal and workspace data under the approved retention/ownership rules; no administrator content access. |
| `SUSPENDED` → `DISABLED` | Assigned security review owner after investigation. | Independent Security/Policy Authority; the investigator/requester does not self-approve. | Reviewed incident evidence and a reasoned determination that the block is not merely temporary; record review and appeal information. | Reversible through `DISABLED` → `ACTIVE` after appeal/review; no automatic expiry to active. | Keep access denied, revoke/re-check sessions, approvals, and binding resolution, preserve data, and notify safely. Do not convert the state to deletion. |
| `SUSPENDED` or `DISABLED` → `ACTIVE` | Account holder requests review/recovery, or the assigned review owner initiates restoration. | Independent Security/Provisioning Authority authorized to lift the original restriction. | Closure of the triggering issue, fresh account-owner verification appropriate to the risk, current method review, and explicit restoration decision. | Reversible by a new separately authorized suspension/disablement; appeal path remains available under approved policy. | Re-enable authentication eligibility only after the state change is committed. Existing sessions are not resurrected; issue new sessions only after fresh authentication. Re-evaluate bindings and approvals; resource authorization remains separate. |
| `ACTIVE`, `SUSPENDED`, or `DISABLED` → `CLOSING` | Account holder requests closure. A non-user-initiated closure is not permitted by this draft absent a separate, explicit, approved legal/security policy and independent review. | Lifecycle Authority verifies owner proof and closure intent; independently reviews any non-user-initiated exception. | Fresh ownership/step-up proof, explicit confirmation, data-class/retention notice, and any approved legal-hold or exception evidence. A suspended/disabled holder must use the approved recovery path to prove ownership. | Cancellation is possible only if a separately approved grace window exists and before `CLOSED`; after closure, no routine reopening. Appeal does not silently reactivate the old ID. | Immediately block authentication, revoke sessions/devices and pending approvals, make all bindings unusable, and create per-class lifecycle jobs. Freeze membership/resource mutations as specified below; do not transfer ownership or delete data by inference. |
| `CLOSING` → `ACTIVE` (cancellation) | Verified account holder within the approved cancellation window. | Lifecycle Authority confirms the request is eligible and any cancellation hold is clear. | Fresh owner proof, explicit cancellation, no completed irreversible deletion or legal hold, and a recorded policy version. | Reversible only during the approved window. If no window is approved, this transition is not permitted. | Do not restore revoked sessions; require fresh authentication. Re-evaluate method bindings, memberships, approvals, consent, and any jobs already started; cancel jobs only where safely/idempotently possible and report irreversible work truthfully. |
| `CLOSING` → `CLOSED` | Lifecycle service after the closure workflow reaches its approved closure condition. | Lifecycle Authority validates required revocation evidence and per-class job/status records; independent review is required for exceptions/failures. | Durable evidence of auth/session/device/approval revocation, provider-binding inactivation, product-access block, data-custodian acknowledgements or explicit pending/retained states, and closure notice. | Terminal; no routine reverse transition. Any future return requires a separately approved new enrollment with a new ID and no implicit data/binding restoration. | Keep the account non-authenticating and ID non-reusable. Preserve only approved minimal tombstone/audit data. Continue backup/replica/provider jobs and show partial, pending, retained, failed, or unverifiable outcomes; `CLOSED` does not mean all data is deleted. |

No transition is implied merely because an actor can call an in-process Python interface. The approved implementation must enforce the authority and separation-of-duties rules at a trusted service boundary. All other state transitions are denied.

#### Effects for non-active states and closure data classes

These are recommended effects, not implementation claims:

- **Authentication methods and bindings:** any account not `ACTIVE` fails provider-binding resolution and cannot receive a principal/session. On closure, mark linked methods/bindings unusable and retain a minimal uniqueness tombstone or equivalent restriction for the approved period, so the same `(issuer, subject)` cannot silently create or attach to another account. Do not retain provider credentials or unnecessary claims. Physical binding removal is allowed only after an approved retention/uniqueness-safe process; it must never enable implicit re-enrollment, linking, merging, or account recreation.
- **Sessions and approvals:** suspension, disablement, and closure block access immediately and revoke all applicable per-device sessions. The approval authority separately cancels or revalidates outstanding approvals; identity services do not execute or approve them. A cancellation/reinstatement never resurrects old credentials or approvals.
- **Workspace membership and shared resources:** disable membership-based access while an account is non-active; on closure revoke the account’s memberships and invitations. Preserve workspace-owned/shared records under the workspace data owner’s policy. Do not delete shared resources, transfer their ownership, or give administrators/member accounts access to personal content by implication. Any ownership reassignment requires a separate verified and audited policy.
- **Personal profiles, conversations, and memories:** deny access while non-active. On closure, process these by data class under the approved user-control and retention policy. Never assign legacy, unprofiled, or user-scoped records to another account/profile/workspace. Report pending, retained, deleted, failed, or unverifiable results separately.
- **Backups and replicas:** track each custodian, restore path, retention basis, and expiry state. Do not claim deletion or cryptographic erasure until independently verified for the relevant copies. If a backup can restore the data, the deletion job must account for re-deletion or other approved restore controls.
- **External copies and notices:** a previously transferred copy is not “recalled” by account closure. Report provider request/acknowledgement/failure/not-supported/not-verifiable status truthfully; do not promise recipient deletion without evidence.

### 3.3 Reinstatement and recovery

- Recovery restores control of the **same** immutable account only after an approved ownership-verification process. It is not a new account, an account merge, or a way to bypass a disabled/suspended state.
- Reinstating a suspended or disabled account requires the authority that may lift that state, a reasoned decision, appropriate fresh verification, and an audit record. The process must review active methods, sessions, devices, approvals, and pending lifecycle operations.
- Lost-device handling must permit individual and all-device revocation consistent with IT-05. A lost device, email/phone match, support ticket, or access to a workspace is not, alone, proof of account ownership.
- Recovery-method replacement must verify the account owner and fresh control of the replacement method under an approved policy. Notify existing verified channels where safe, create a security event, and consider a separately approved delay or high-risk hold.
- A closed account is not silently reopened. Whether a narrowly scoped appeal/reinstatement process is allowed is an unresolved decision. If it is not allowed, any later enrollment requires a new verified process and a new random account ID; no data or provider binding is implicitly restored.
- If ownership cannot be established, fail closed. Do not let support manually set an account ID, attach a provider subject, or expose account existence as a recovery hint.

## 4. Provisioning authority and pathways

The recommended model is **a PARMAR-controlled, non-public provisioning policy service as the sole enforcement point**, with individually authorized pathways. This recommendation does not authorize or activate the existing provisioner. Naming a component “trusted” is not a security control: future enforcement must authenticate the workload and caller, check policy and purpose, limit reachable operations, and record auditable evidence.

| Pathway | Recommended authorization requirements | Required audit and abuse controls | Prohibited actions |
|---|---|---|---|
| **PARMAR-controlled trusted provisioning service** | Keep the service internal and callable only by an explicitly authenticated workload or reviewed user-enrollment workflow. Require an authenticated service identity, narrowly scoped operation authorization, approved policy version, request/correlation ID, verified evidence reference, and idempotency key. Separate account-ID minting from identity proof. Apply least privilege, secret management, input validation, transaction integrity, access review, and fail-closed dependency behavior. | Record requester/workload, authority decision, policy version, enrollment type, evidence references (not evidence secrets), outcome, generated account ID, timestamp, and correlation ID. Protect audit integrity and alert on anomalous volume, failures, retries, or privilege changes. Apply rate limits and abuse detection to every ingress path. | No direct browser/mobile access, public unauthenticated route, caller-selected account ID, arbitrary claims-to-account conversion, email matching, silent fallback, or invocation merely because code can instantiate a Python class. No application caller until a later task receives explicit approval. |
| **Verified user-initiated enrollment** | Recommended default for future individual enrollment, only after an authentication method/provider and assurance policy are approved. The person must initiate the flow and complete fresh proof of control of the selected method. Verification must bind to the exact issuer/subject under the reviewed adapter contract; account ID is minted server-side. If verification is asynchronous, keep the request pending and unusable until approved evidence is complete. | Rate-limit by appropriate independent dimensions (for example source, verified method, device/risk signals) without relying on any one signal. Use replay-resistant challenges, bounded retries/cooldowns, non-enumerating responses, abuse monitoring, idempotency, security notifications, and safe duplicate/conflict handling. Do not set numeric thresholds in this draft. | No self-asserted “verified” flag; no client-supplied account ID; no auto-account creation from unverified provider claims; no activation from a matching email/name/phone; no automatic link/merge when a method already maps elsewhere. |
| **Administrative provisioning** | An administrator may only initiate or facilitate a narrowly scoped workflow under an explicitly approved authority. The prospective account holder must independently provide fresh, verified proof of control before activation; administrative approval cannot substitute for that evidence. Recommend two-person approval for exceptional human-facilitated requests or account-state changes, with the requester and approver distinct. | Immutable record of requesting and approving actors, approved authority/purpose, ticket reference, target notice, independent verification result, scope, decision, and later review. Alert on self-targeting, bulk creation, unusual target populations, repeated denials, and out-of-policy use. Maintain periodic access review and separation of duties. | No administrator may impersonate a user, self-approve an ownership claim, supply substitute proof, choose or alter a PARMAR account ID, bypass proof before activation, grant themselves target-account access, access personal content by role, or create a profile grant. |
| **Organization/family workspace enrollment** | Treat an invitation as a proposed workspace-membership event, not account creation or identity proof. The invitee independently completes approved PARMAR enrollment or authenticates to an existing account; the invitation is bound to the intended workspace and redeemed by the verified invitee. Family/guardian enrollment requires a separately approved age, authority, consent, and legal policy. | Audit invitation issuer, scope, expiry, redemption account, membership result, notice, revocation, and rate/abuse signals. Use opaque, single-use, expiring invitations and non-enumerating redemption; define invitation delivery and recovery before implementation. | No separate organization/family account namespace; no automatic account linking or membership from matching email; no personal-profile or memory access from workspace membership; no implied authority for an inviter/administrator to provision or recover another person's account. |

### 4.1 Duplicate enrollment handling

- A duplicate exact `(issuer, subject)` conflict fails closed; it must not create a second account or move the existing binding.
- A duplicate enrollment must not disclose whether the method, email, phone, or account exists. Use a generic safe response and a separately verified sign-in/recovery path.
- Do not automatically link, merge, recover, or migrate based on matching attributes. A linking flow is a separate approved operation requiring fresh proof of both the existing account session and the method being added.
- Concurrent/retried requests must produce at most one account for one accepted enrollment intent. Any unresolved collision is surfaced to a protected security/operations workflow without exposing account details to the requester.

## 5. Enrollment security requirements

These are proposed requirements for any future enrollment release; they are not implemented or approved operational thresholds.

### 5.1 Verification and takeover resistance

1. Select no enrollment method until provider-neutral requirements, candidate comparison, security review, privacy/legal review, and operations ownership are approved under IT-02.
2. Verify fresh control of the exact method being enrolled through a reviewed server-side adapter. Provider claims are evidence to validate, not PARMAR identity or authorization.
3. Require explicit user intent, challenge freshness, replay protection, issuer/audience/expiry validation, and exact method uniqueness. Fail closed on malformed, expired, ambiguous, or unavailable verification.
4. Do not treat matching or verified email/name/phone as account-equivalence proof. Prevent account enumeration in enrollment, sign-in, linking, and recovery responses.
5. Do not create an active account from development authentication, a legacy `user_id`, a browser/client request, an unverified claim, an invitation alone, or a Python object constructed in process.
6. Never silently upgrade a development/demo identity or assign its existing conversations/memories to a new account. Any future mapping requires a separate approved migration, verified ownership, preserved source data, and rollback.

### 5.2 Abuse prevention

- Apply layered rate limiting, replay controls, bot/abuse detection, anomaly monitoring, and bounded retries to enrollment, verification, recovery, linking, and administrative workflows.
- Set numerical thresholds, lockout/cooldown behavior, challenge mechanisms, and support escalation only through an explicit security decision informed by abuse analysis. Do not make up defaults in code or this draft.
- Avoid denial-of-service lockouts that let an attacker permanently block a victim. Define recovery, appeal, and alert behavior before activating an account lock.
- Separate requester-facing generic errors from restricted operational diagnostics. Do not put account existence, provider subject, raw email/phone, proof, or token in user-visible errors or general logs.
- Test concurrency, replay, retry, duplicate attempts, partial service failure, notification failure, and audit failure against real persistence and independent connections before release.

### 5.3 Sensitive actions, sessions, and notification

- Require fresh, action-scoped reauthentication/step-up for policy-designated sensitive changes, including adding/removing an authentication method, changing recovery methods, lifting a high-risk suspension, changing security settings, and initiating or cancelling closure. The exact action list, method, and freshness window remain open under IT-04/IT-05.
- Account suspension, disabling, closure, suspected takeover, and recovery must trigger the approved per-device/all-device session and pending-approval revocation/revalidation policy. Identity alone never approves or executes pending actions.
- Notify affected users about enrollment, new method binding, recovery-method changes, unusual recovery attempts, state changes, closure, and data-lifecycle outcomes using separately approved channels and privacy-safe content. Notification failure must not become an authentication bypass; escalation and hold behavior must be decided.
- Security notifications must not disclose a sensitive account attribute to an unverified recipient or undermine anti-enumeration controls.

### 5.4 Audit event integrity and retention

The proposed audit trail covers at minimum:

- enrollment request, verification, activation, rejection, expiry, duplicate/conflict, and administrative approval;
- account suspension, disablement, reinstatement, closure, and any deletion/retention status transition;
- authentication-method addition, removal, conflict, failed proof, recovery, and notification outcome;
- session/device revocation and pending-approval invalidation/revalidation;
- rate-limit/abuse decisions and changes to provisioning policy or authority;
- per-data-class export, deletion, retention, backup expiry, provider-copy request, failure, and completion.

Events should include a stable event/correlation ID, account ID only where established, actor/workload category, policy version, reason code, timestamp, operation, outcome, and non-secret evidence references. Do not log passwords, tokens, passkeys, raw assertions, recovery codes, full proof payloads, or unnecessary conversation/profile content. Use append-only or tamper-evident storage, restricted access, clock integrity, alerting, and a documented event-retention/deletion policy.

The event-retention period, custody, cryptographic integrity mechanism, access model, and behavior when audit storage is unavailable are **unresolved**. The future policy must state which critical operations fail closed when an audit event cannot be durably recorded and must not report success when required evidence is missing.

## 6. Provider-binding activation gates

No persistent provider-binding writer, adapter-backed enrollment, or provider sign-in flow may be implemented or enabled until every applicable gate below has explicit evidence and approval:

1. **Provider and protocol selection:** document requirements-based alternatives and obtain explicit security approval plus product, privacy/legal, and operations review. No provider is selected by this policy.
2. **Adapter security review:** threat-model exact verification, issuer canonicalization, subject stability, audience/expiry/replay behavior, key rotation, outage/failure handling, and secret management. Review implementation and deployment independently.
3. **Fresh proof:** prove current control of the new method. Linking to an existing account additionally requires a fresh authenticated session/step-up proving control of that account. A provider assertion alone does not choose the target account.
4. **Exact uniqueness and integrity:** enforce unique `(issuer, subject)` binding and a restrictive relationship to exactly one immutable PARMAR account. Enable and verify foreign keys on every repository connection. Invalid or ambiguous rows fail closed.
5. **No attribute linking:** matching email, phone, name, profile, workspace, provider subject across issuers, or legacy UUID never links or merges accounts. Unknown binding does not trigger implicit account creation.
6. **Audited link/unlink policy:** define user intent, approval, notification, conflict resolution, owner verification, unlink consequences, recovery safety, last-usable-method protection, event retention, and rollback before any writer exists. Every mutation is transactional and race-tested.
7. **Account state check:** disabled, suspended, closing, and closed accounts cannot resolve to authenticated principals. Binding existence alone is not authentication or authorization.
8. **Abuse and account recovery:** approved passkey/additional verification, attempt limits, lost-device handling, recovery, step-up, session revocation, and incident ownership exist and pass security tests.
9. **Test and release gate:** independent tests cover duplicate binding races, invalid issuer/subject values, issuer confusion, replay, disabled accounts, outage, recovery, notification/audit failure, and no account enumeration on the exact deployment artifact. Obtain explicit release approval.

The Task 37.3-verified registry has a binding schema and read-only lookup foundation, but no binding writer. The schema must remain inactive for authentication until these gates pass.

## 7. Recovery, closure, and data lifecycle

### 7.1 Recovery ownership

- Recovery must establish control of the same PARMAR account through the separately approved recovery assurance policy. Recovery factor, verification steps, fallback, attempt thresholds, time delays, and support responsibilities remain open.
- Recovery must not be based solely on a matching email/phone/name, account ID knowledge, workspace membership, device possession, administrator assertion, or provider subject claim.
- Method replacement, lost-device recovery, suspicious recovery, and recovery after closure require distinct decisions and audit/notification behavior.
- Where evidence conflicts or is unavailable, deny and preserve access restrictions. Do not expose private content or permit staff to override identity by manually setting an account ID.
- A recovery result restores authentication eligibility only. Product permissions, profile grants, workspace membership, approvals, and consent are checked independently.

### 7.2 Closure and revocation

Recommended closure sequence, subject to approval:

1. Verify the requesting account owner and require the approved sensitive-action reauthentication.
2. Explain affected products/data classes, pending work, retention exceptions, backup/provider limitations, possible disconnected-device state, and the cancellation/grace rule before confirmation.
3. On accepted closure, enter `CLOSING`, reject new authentication, revoke active sessions/devices, and invalidate or revalidate pending approvals through their authority.
4. Make every existing provider binding unusable for authentication and prevent new bindings, grants, consent-based transfers, and product access. Revoke workspace memberships/invitations without transferring ownership or deleting shared workspace resources. Record durable audit events and create per-data-class lifecycle jobs.
5. Report status until all required custodians respond. Mark `CLOSED` only when the policy-approved closure conditions are met; do not imply that every external or backup copy is gone.
6. If a data custodian fails, retain an explicit `pending`, `failed`, `partially_retained`, or `unverifiable` state and escalate. Do not convert an error into a success-shaped response.

The grace period, cancellation window, legal/security holds, export-before-close option, treatment of new data during closure, and definition of “closure complete” require fresh approval. Immediate access revocation and data deletion are separate controls.

### 7.3 Data-class retention and deletion reporting

For each class, the future implementation must inventory the source of truth, replicas, indexes/caches, backups, logs, analytics, device copies, and any external processor copies. At minimum, report:

| Data class | Required status distinction | Reporting limitation |
|---|---|---|
| Account/method records | Pending, retained under stated basis, disabled/revoked, deletion requested/completed where permitted | Preserve immutable-ID non-reuse; whether a minimal tombstone remains, and for how long, is unresolved. |
| Sessions/devices/approvals | Revocation requested, revocation confirmed, failed/unavailable, pending-approval outcome | Do not say revoked until the owning authority confirms it; disconnected devices may retain local state until their approved expiry/reconnect policy applies. |
| Profiles/workspaces/memberships | Per-record pending/deleted/retained/ownership dispute | Workspace membership never authorizes personal-content access; preserve separate ownership and migration boundaries. |
| Conversations/memories/consent | Per-store deletion/export/reset and scope; separately identify unassigned legacy records | Do not auto-assign, broaden scope, or claim deletion from backups/replicas without evidence. |
| Backups/replicas | Pending expiry, expired/deleted, restore-protected, retained by basis, unverifiable | State the approved backup lifecycle and whether restore can reintroduce deleted data; no unsupported deletion deadline. |
| Audit/security records | Retained until approved expiry or legally/security-required basis; then deletion/de-identification status | Minimize identifiers and content. Do not promise immediate erasure where integrity/retention obligations apply. |
| External processor copies | Request pending, acknowledged, completed, not supported, failed, or not verifiable/not recallable | A sent transfer cannot be represented as recalled unless the recipient provides verifiable deletion evidence under approved terms. |
| AETHER local data | Product-local status, disconnected-device limitation, user action or policy expiry | Account closure does not remotely erase a device that has not reconnected; Android remains offline-only. |

Set retention periods and deletion SLAs only after data inventory, legal/privacy review, key/backup design, and custodian commitments. Cryptographic erasure is not a substitute for evidence that keys, replicas, and backups are in scope. User-facing status must distinguish “request accepted,” “processing,” “completed,” “partially retained,” “failed,” and “not verifiable.”

No deletion guarantee may exceed what every relevant data custodian and backup/provider lifecycle can demonstrate. IT-10 and IT-15 require user controls and truthful reporting; they do not establish numeric retention periods or instant erasure.

## 8. Product boundaries

| Product | Account policy | Authorization/data boundary | Current safety constraint |
|---|---|---|---|
| **PARMAR Home** | Future first-class consumer of the one shared account identity. No separate Home account system. | Server-side identity and ownership must never be established from a browser-supplied account ID. Product routes independently authorize profiles, workspaces, conversations, and memories. No mapping from legacy `Principal.user_id` without a separately approved migration. | Task 37.3 found no live registry resolver or approved legacy mapping. Do not describe this draft as Home integration. No Home UI/source changes. |
| **VOKKI** | Uses the same PARMAR identity when authenticated; does not mint PARMAR accounts independently. | VOKKI routes own resource authorization. Workspace membership alone never grants personal content, memory, or profile access. No legacy owner UUID/conversation/memory migration from this policy. | Existing development identity remains distinct; full route/grant policy and integration gates remain open. No VOKKI UI/source changes. |
| **AETHER Desktop** | Any future authenticated control surface must use the shared account under a separately approved trusted control-plane design. | Browser content must never receive PARMAR credentials, privileged identity APIs, or authentication capabilities. Identity must not imply browsing permission. | Keep `REMOTE_BROWSING_ENABLED=false`; remote browsing remains disabled independently of account state. No Desktop source changes. |
| **AETHER Android** | No account enrollment, sign-in, or SSO in the current release. Any future authenticated feature requires a separate explicit decision and offline/security review. | Product-local data is not a PARMAR identity or account mapping. | Remain strictly offline-only: no `INTERNET` permission, networking implementation, WebView, or online registration. No Android source changes. |
| **Future PARMAR products** | Consume the shared account registry; never create a product-specific identity authority. | Register an audience and independently approved product/resource authorization, consent, lifecycle, and audit policy before protected data access. | No shared session or permission inheritance merely from a common account. |

## 9. Threat scenarios and required policy outcomes

| Scenario | Required outcome |
|---|---|
| Attacker submits a target account ID during enrollment or recovery | Ignore/reject client identity; generate or resolve only from server-verified evidence; no ownership established. |
| New provider assertion contains a familiar email address | Do not link or merge. Require the approved exact method-binding flow and fresh proof. |
| Two simultaneous enrollments race for the same `(issuer, subject)` | At most one binding/account outcome; loser receives a non-enumerating result; no partial or reassigned mapping. |
| Compromised or unreviewed internal caller instantiates the Python provisioner | Treat this as a trust-boundary failure, not proof of authorization. Future controls must authenticate/authorize workloads and restrict deployment/callers; keep the interface inactive until reviewed. |
| Workspace administrator requests member's personal profile or memory | Deny unless a separate owner-issued, current, operation-specific grant exists; workspace role alone is insufficient. |
| Support agent claims a user lost access and asks for manual recovery | Do not set identity or access content. Follow an approved independent ownership-verification path; otherwise deny and escalate. |
| User loses a device or reports compromise | Follow approved individual/all-device revocation, approval invalidation, notification, recovery, and review policy; no silent identity replacement. |
| Replayed/stale enrollment or linking proof | Deny; make no account/binding mutation; record a privacy-safe security event and apply approved abuse controls. |
| Account is suspended/disabled while sessions remain active | Deny further access and revoke/revalidate sessions/approvals within the approved, measurable limit; do not call it deleted. |
| Closure job fails for one replica or backup | Report partial/pending/failed status with the data class and owner; do not report complete deletion. |
| External provider already received data before consent revocation | Block later transfers and report the prior transfer accurately; do not promise recall absent recipient evidence. |
| Android or Desktop authentication requirement is used to justify networking | Reject scope expansion. Android remains offline; Desktop browsing remains disabled pending separate acceptance. |
| Legacy `user_id` matches an account UUID or provider subject text | Treat namespaces as unrelated; never infer or migrate ownership from equality or shape. |

## 10. Decision and approval register

**Status rule:** IT-01–IT-15 approve requirement outcomes only. “Recommendation” below is proposed policy and is not approved. Unless a row explicitly says otherwise, fresh approval is required before that detail is implemented or used to enable a capability.

| ID / question for decision owner | Recommended policy (draft only) | Alternatives | Security consequence of choice | Dependencies | Covered by IT-01–IT-15? | Fresh approval? |
|---|---|---|---|---|---|---|
| **P-01: What enrollment path should create ordinary personal accounts?** | After provider/assurance approval, make verified user-initiated enrollment the default, mediated by one PARMAR-controlled provisioning authority. | Invite-only; controlled service enrollment; defer enrollment. | Self-enrollment can increase abuse; invite-only/admin-only paths create insider, enumeration, and exclusion risks. All paths require proof, rate controls, and non-enumerating behavior. | IT-01/02/04; provider-neutral contract, abuse review, privacy/legal and operations ownership. | Partly: immutable PARMAR identity and provider deferral are approved; the enrollment choice is not. | **Yes** |
| **P-02: Is a pending state required, and what proof activates an account?** | Use `PENDING` only where verification cannot complete synchronously; pending identities cannot authenticate or access data. | No account record until proof is complete; create directly active only after synchronous approved proof. | Premature activation risks takeover and orphaned records; unnecessary pending state increases retained personal data and enumeration risks. | IT-01/02/04; approved method, expiry, cleanup, and audit rules. | No detailed state or proof threshold approved. | **Yes** |
| **P-03: Who may suspend, disable, and reinstate an account?** | Separate time-bounded security suspension from policy/owner disablement; require scoped authority, reason code, review deadline, session/approval consequences, and audit. | Single disabled state with reason subtype; user self-disable plus security-only suspension. | Ambiguous authority can enable silent denial of service or unauthorized restoration. | IT-04/05/15; role model, appeal, notice, and operations process. | Secure recovery/closure outcomes approved, transition mechanics are not. | **Yes** |
| **P-04: What may administrators provision?** | Administrators may only initiate/facilitate a workflow under an explicitly approved authority; independently verified ownership/control evidence remains mandatory before activation. No self-approval or impersonation. | No administrative initiation; narrowly scoped facilitation with dual control and independently verified target participation. | Broad admin power increases insider risk and target-account takeover; no admin path can impede legitimate managed onboarding. | IT-01/04/06/15; actor roles, legal basis, two-person process, audit and review. | Admin authority is not specifically approved; no standing support access is approved as a prohibition. | **Yes** |
| **P-05: What can family/team invitations authorize?** | Invitation redeems only to a verified PARMAR account and proposes a specific workspace membership; no account or personal-profile access is created by the invitation. | Disable invitations until family/team policy is approved; organization-admin invitations with additional verification. | Invitations can enable impersonation, coercion, or overbroad access, particularly for guardian/child relationships. | IT-06/07/08; family/guardian law, consent, roles, membership lifecycle, grant boundaries. | Eventual family/team scope and membership isolation are approved; invite details are not. | **Yes** |
| **P-06: What recovery evidence, factors, thresholds, and delays are acceptable?** | Require independent, risk-reviewed ownership evidence; fresh proof for method replacement; deny on unresolved conflict; support lost-device and passkey/additional-verification cases under an approved process. | Strong-factor-only recovery; limited support-assisted verification under dual control; no recovery for selected high-risk cases. | Weak recovery bypasses authentication; overly strict recovery can permanently lock out owners. | IT-04/05; method/provider decision, threat analysis, support and notification procedures. | Secure recovery, passkeys/additional verification, attempt limits, and lost-device protection are approved outcomes; specifics are not. | **Yes** |
| **P-07: Which actions require step-up, and how quickly must revocation apply?** | Require fresh action-scoped proof for method/recovery changes, closure, sensitive account changes, and high-risk reinstatement; set measurable revocation requirements before launch. | Narrower/broader action set; different approved freshness windows by risk. | Weak step-up enables takeover persistence; excessive challenges can cause unsafe workarounds. Slow revocation leaves stolen sessions usable. | IT-05/15; session/device architecture, platform secure storage, approval authority. | Step-up and per-device/all-device logout required; triggers, lifetimes, and latency are open. | **Yes** |
| **P-08: How are method linking and unlinking governed?** | Permit only explicit user-initiated linking with fresh proof of the existing account and added method, exact uniqueness, audited notification, conflict handling, and last-method protection. Never auto-link or merge. | Defer all linking; allow only a security-reviewed limited method set. | Weak linking is a direct account-takeover path; no linking can reduce recovery options. | IT-02/03/04; provider/adapter approval, recovery, conflict and unlink policy. | Fresh proof and no auto-link/merge already approved; method set and operational contract are not. | **Yes, before any writer** |
| **P-09: What must audit capture, how is integrity enforced, and how long is it kept?** | Use append-only/tamper-evident minimal events for each security/lifecycle decision; define access and retention by data class before deployment. | Managed immutable audit service; signed event chain with separately retained checkpoints; other reviewed mechanism. | Inadequate audit impairs incident response and accountability; over-retention or sensitive logs create privacy risk. | IT-04/05/10/11/15; data inventory, key custody, legal/operations owners. | Audit/accountability is an architecture requirement; retention and implementation details remain open. | **Yes** |
| **P-10: What are the retention, backup-expiry, and deletion timelines?** | Decide per data class after inventory; report asynchronous status and exceptions; make no deletion guarantee beyond verified custodian evidence. | Immediate primary-store deletion with bounded backup expiry; legal retention by class; staged grace period. | Unsupported promises damage trust; indefinite retention increases exposure; premature removal may violate legal/security duties. | IT-10/11/15; backup/replica map, encryption/key design, external processor terms, legal review. | Truthful user controls and lifecycle are approved; timelines/retention exceptions are not. | **Yes** |
| **P-11: Is there a closure grace/cancellation period, and can closed accounts be reinstated?** | Revoke access immediately on confirmed closure; treat data jobs separately; do not routinely reopen a closed identity. Define any cancellation window and exception before release. | No grace, short explicit grace, or narrowly approved appeal; each requires truthful user disclosure. | A long grace leaves access/data exposed; no grace risks irreversible accidental closure; reopening can restore compromised methods. | IT-04/05/15; step-up, notification, support, retention, method-reverification. | Secure closure/revocation is approved; grace and reinstatement details are not. | **Yes** |
| **P-12: What notifications are mandatory and how are delivery failures handled?** | Notify on new enrollment/method, recovery, account-state change, closure, and lifecycle outcome using approved verified channels; don't expose account existence or credentials. | Narrow mandatory set; multiple independent channels for high-risk events. | Missing alerts delay takeover response; unsafe alerts leak account state. | IT-04/05/10/15; verified-channel policy, privacy review, service availability. | Notifications are implied by security outcomes but exact events/channels are not settled. | **Yes** |
| **P-13: How should permanent identity tombstones and deletion interact?** | Never reuse IDs. Retain only the minimum tombstone/mapping needed for integrity, security, and lawful retention, with an explicit basis and approved expiry; erase/de-identify other data when supported. | Retain a minimal non-personal ID tombstone; keep a restricted mapping for approved periods; alternative reviewed legal hold. | Too little evidence can permit ID reuse or confuse audit; excess retention preserves linkable personal data. | IT-01/10/11/15; data protection, legal retention, database and backup design. | Immutability and truthful deletion are approved; tombstone content/period is not. | **Yes** |
| **P-14: What exceptional support access, if any, is permitted?** | No standing access to private content. Any exception requires a separately approved, time-limited, purpose-bound, least-privilege, independently authorized, notified/audited workflow. | Prohibit all content access; approve narrowly defined incident-only break-glass. | Standing access creates insider and breach risk; no emergency path may delay incident containment. | IT-15; support, incident, legal, privacy, audit, and separation-of-duty policy. | No standing support access is explicitly approved as prohibited; exception mechanics are not. | **Yes, for any exception** |
| **P-15: What product-specific integration, audience, and release evidence are required?** | Preserve the already-approved D-02 shared PARMAR account/SSO boundary. For each product, approve only its audience, trusted integration/session topology, independent authorization, and release evidence; local/offline functions remain independent. | Defer a product’s authenticated capability while retaining its approved local/offline features; do not create a product-specific identity. | Unreviewed integration can leak sessions or privilege; delaying integration limits protected features without fragmenting identity. | IT-01/02/05/06/07; D-01/D-02; product-specific threat model and release gate. | The shared identity/SSO boundary and no separate product accounts are already approved. Only product-specific integration and release choices remain open. | **Yes, for each integration** |

## 11. Traceability to approved IT decisions

The table records how this **draft** reflects approved outcomes and distinguishes unapproved detail. It does not amend the final ADR or assert implementation.

| Approved decision | Policy coverage | Already approved | Still requires separate policy/implementation approval |
|---|---|---|---|
| **IT-01 — Immutable internal PARMAR account ID** | §§1, 3.1, 4 | PARMAR-issued immutable identity, not derived from user attributes. | Enrollment path, lifecycle-state representation, tombstone/retention, migration, production use. |
| **IT-02 — Provider selection deferred** | §§1.1, 5.1, 6 | No provider selection until requirements comparison and security approval. | Provider, protocol, enrollment assurance, adapter and deployment design. |
| **IT-03 — Optional linking; no auto-link/merge** | §§3.1, 4.1, 6 | Fresh proof for any optional method linking; no automatic linking or merging. | Linking/unlinking writer, last-method safety, conflict and notification procedures. |
| **IT-04 — Recovery and account-abuse protection** | §§3.3, 5, 7.1 | Secure recovery, passkeys/additional verification, attempt limits, lost-device protection required. | Factors, thresholds, recovery evidence, support duties, step-up triggers. |
| **IT-05 — Per-device sessions, inventory, logout, step-up** | §§3.3, 5.3, 7.2 | These outcomes are required; device revocation is part of state-change policy. | Session/device UX, lifetimes, step-up list, revocation latency and platform details. |
| **IT-06 — Eventual personal/multiple-profile/family/team modes** | §§4, 8 | Eventual scope is approved, not automatic enablement. | Invitations, guardian rules, roles, membership lifecycle, legal basis. |
| **IT-07 — Workspace membership does not grant personal content** | §§1, 4, 8–9 | Membership alone never authorizes personal-content access. | Complete operation-level authorization and route integration. |
| **IT-08 — Owner-controlled profiles and explicit View/Edit/Manage grants** | §§1, 4, 8–9 | Owner-controlled explicit/revocable grants required. | Operation map, grant UX/lifecycle, Manage/delegation, tests. |
| **IT-09 — User-scoped memory by default** | §§2, 7.3, 8 | No automatic profile/workspace migration or sharing. | Any future scope expansion requires separate decision, consent, migration, and testing. |
| **IT-10 — User controls and truthful consent/data lifecycle** | §§5.4, 7.2–7.3 | Truthful reporting, user controls, and prospective consent revocation required. | Retention, deletion, export, backup/replica/provider deadlines and evidence. |
| **IT-11 — Production data/backups protected** | §§5.4, 7.3 | Encryption, key management, residency/recovery, and security testing are requirements. | Deployment, key custody/rotation/recovery, backup policies, timelines. |
| **IT-12 — Explicit scoped external-AI consent/no silent fallback** | §§5.3, 6, 7.3, 9 | Consent and minimization required; no silent provider fallback. | Provider, categories, terms, race behavior, deletion/recall evidence. |
| **IT-13 — PARMAR-managed AI long-term goal** | §8 | A long-term direction only; no runtime or infrastructure is selected. | Feasibility, model/runtime, licensing, security, ownership. |
| **IT-14 — Offline drafts/cache with server reauthorization/no side-effect replay** | §§8–9 | Offline safety requirements remain; no account enrollment implies sync. | Product-specific data classes, keys, conflict, expiry, and runtime verification. |
| **IT-15 — Secure closure, revocation, truthful deletion, no standing support access** | §§3.2–3.3, 5.3–5.4, 7, 10 | Closure/revocation and no standing support access are approved outcomes. | Grace, reinstatement, deletion periods, legal exceptions, support break-glass. |

### 11.1 D-01–D-13 disposition

This crosswalk preserves the approved Master PRD directions without reopening them. “Outside scope” means this provisioning policy does not alter that product direction; it does not cancel an approved requirement or release gate.

| PRD decision | Disposition in this policy |
|---|---|
| **D-01 — Web-first; future platforms independently gated** | **Product-specific implementation/release gate.** This policy changes no platform scope and authorizes no client release. |
| **D-02 — One PARMAR-wide account/SSO boundary, immutable account IDs, optional fresh-proof linking, eventual profile/team scope, strict isolation** | **Preserved.** One shared PARMAR identity and SSO boundary are approved and are not reopened by P-15. Provider/protocol and each product’s integration, audience, session topology, authorization, and release remain separately gated. No product-specific accounts or login credentials. |
| **D-03 — Hybrid AI, explicit consent, no silent fallback** | **Outside scope.** This policy selects no AI provider or runtime and does not authorize external egress or fallback. |
| **D-04 — User-controlled memory lifecycle** | **Preserved.** Account closure does not change review/edit/export/delete/reset controls, user-scoped memory, or consent requirements; no automatic migration or sharing is authorized. |
| **D-05 — Explicit, user-initiated camera capture** | **Outside scope.** No camera or capture behavior changes. |
| **D-06 — Multilingual voice; wake-word separately gated** | **Outside scope.** No voice, listening, or wake-word behavior changes. |
| **D-07 — Preserve visual directions; renderer remains open** | **Outside scope.** No renderer, avatar, or visual-quality choice is made. |
| **D-08 — PARMAR Core governance for Guide/Execute/Orchestrate** | **Preserved.** An account, enrollment, session, or recovery decision is not approval or execution authority. |
| **D-09 — Offline drafts/cache and controlled sync; never auto-replay side effects** | **Preserved; product-specific implementation/release gate.** Account policy does not enable sync or alter offline behavior. AETHER Android remains offline-only; any future sync must satisfy its separate approved controls, including server reauthorization and no automatic side-effect replay. |
| **D-10 — WCAG 2.2 AA and multilingual quality targets** | **Outside scope.** No accessibility or locale claim is changed. |
| **D-11 — Research provenance and independent verification** | **Outside scope.** No research or verification capability is changed. |
| **D-12 — PARMAR-managed AI goal; model/runtime/vendor choices open** | **Outside scope.** No model, runtime, vendor, or infrastructure is selected. |
| **D-13 — User-controlled customization preserving canonical identity and asset controls** | **Outside scope.** No customization, asset, or appearance authority is changed. |

## 12. Proposed acceptance criteria before implementation

These are recommendations for a future approval/release gate. They are not claims that tests exist or pass. Numeric timing/volume thresholds must be approved and documented rather than invented here.

### Identity and provisioning

- Every successful enrollment yields exactly one random PARMAR UUIDv4; it is immutable, never reused, and unaffected by changes to email, phone, display name, provider, device, or product.
- **100%** of active-account creation paths are enumerated, owned, and require a verified, policy-authorized server-side actor; no unauthenticated public route or client-supplied identity can create/establish ownership.
- A replayed, expired, malformed, wrong-issuer/audience, unverified, or unavailable proof creates **zero** active accounts and **zero** provider bindings.
- Two independent connections concurrently processing the same enrollment/binding key produce at most one mapping and no partial account/method relationship; retries are idempotent.
- Tests with matching email/name/phone, equal-looking legacy UUIDs, and matching provider subjects across issuers prove **zero** implicit linking, merging, or legacy migration.
- Enrollment and recovery responses do not disclose the existence of an account or provider method to an unverified requester.

### Lifecycle and recovery

- Every proposed state transition has an explicit actor/authority matrix, allowed prior/next states, denial behavior, transaction boundary, event, notification, review deadline, and appeal/recovery path.
- Suspended, disabled, closing, and closed accounts establish **zero** new authenticated sessions and **zero** protected-resource access. Existing sessions and pending approvals are revoked/re-evaluated within an explicitly approved measured limit.
- Only authorized, independently verified reinstatement returns an account to active access. Closed account IDs are never reused; account creation cannot be used to bypass a closure or recovery conflict.
- Loss of a device, expired proof, duplicate request, concurrent recovery, notification failure, rate-limit event, audit-service outage, and ambiguous ownership are tested as adversarial cases and fail safely.
- Sensitive changes enforce the approved action-specific fresh-proof rule; successful reauthentication does not grant product/resource permission.

### Authority, audit, and data lifecycle

- Every provisioning and lifecycle path names the authenticated principal/workload, authorization rule, purpose, policy version, and audit event. **Zero** administrative paths allow self-provisioning, impersonation, or private-content access by role alone.
- Every account/method/state/session/approval/data-lifecycle mutation produces the approved integrity-protected event without raw credentials, proof payloads, recovery codes, or unnecessary content.
- A missing required audit write never returns a success-shaped result; the approved fail-open/fail-closed behavior is explicit and tested.
- **100%** of relevant data classes, stores, replicas, backups, logs, devices, and external processors are covered by an approved retention/deletion matrix and named custodian.
- Closure tests prove session/device revocation and approval revalidation separately from data deletion. Per-class status distinguishes pending, complete, retained, failed, and unverifiable; no claim exceeds evidence.
- Backup restore/expiry and any external deletion limitation are exercised or documented; no silent reintroduction or unsupported “fully deleted” claim.

### Product boundaries and independent review

- PARMAR Home/VOKKI prove a server-side trusted resolver before account integration; tests reject client account identity and demonstrate no legacy `user_id` mapping without an approved migration.
- Two-account/two-profile/two-workspace tests show **zero** personal-resource access from workspace membership alone; explicit grants, if approved later, are tested independently.
- AETHER Desktop retains `REMOTE_BROWSING_ENABLED=false`, and independent tests show browser content receives **zero** PARMAR credentials, sessions, or privileged identity capabilities.
- AETHER Android remains offline-only: release artifact has no `INTERNET` permission, networking implementation, WebView, remote authentication, or account-registration path.
- Independent reviewers verify exact source revision and release artifact, command/environment, pass/fail/skip status, and residual risks. A skipped or unexecuted security criterion is not acceptance.

## 13. Unresolved policy questions

The following require explicit answers before implementation of an enrollment or lifecycle path:

1. Which enrollment audiences are in scope first: individual users, organization-managed users, family/team, or none until provider selection?
2. Must there be a `PENDING` account state, or should the registry record be created only after all required proof succeeds?
3. What is the distinction and authority model for suspension versus disabling, including review deadlines, notification, appeal, and reinstatement?
4. May any administrator provision another person, and if so, what legal/product scope, user participation, dual-control, and exception evidence are mandatory?
5. Do organization/family invitations create membership only, and what separate guardian/age/consent rules apply?
6. What proof and assurance levels are required for initial enrollment, account recovery, method replacement, linking/unlinking, and closure?
7. Which sensitive actions require step-up, what freshness window applies, and what is the measurable session/device/approval revocation latency?
8. What numerical rate limits, cooldowns, lockout rules, anti-abuse signals, and appeal paths are acceptable without enabling denial-of-service against an account owner?
9. Which security events are mandatory notifications, through what verified channels, and what happens if delivery is unavailable?
10. What audit integrity mechanism, event access roles, retention period, and lawful deletion process are approved?
11. What per-data-class retention, backup/replica expiry, provider deletion, export, closure grace period, and deletion-reporting timelines can be demonstrated?
12. Is any closed-account appeal/reinstatement allowed? What minimum tombstone is retained, on what basis and duration, while never reusing an account ID?
13. Is exceptional support access ever allowed, or should private-content support access be prohibited without exception?
14. For each future product, what integration/session topology, audience, independent authorization evidence, and release approval are required under the already-approved shared PARMAR identity boundary?

No answer should be inferred from code capability, existing development login, a schema field, an approved high-level IT outcome, or this draft's recommendation.

## 14. Change and approval boundary

This policy draft is documentation-only. Approval of this document, if later granted, must identify which numbered recommendations and decisions are accepted, rejected, or deferred; it does not itself authorize code, schema, provider, endpoint, deployment, or release changes. Any implementation task must:

1. cite the approved policy revision and the specific decisions it implements;
2. preserve the approved IT-01–IT-15 requirements and product boundaries;
3. define a narrow implementation scope and migration/rollback plan where applicable;
4. pass the relevant security/privacy, persistence, concurrency, abuse, product, and independent acceptance gates; and
5. obtain separate explicit authorization before activating provisioning, authentication, provider binding, SSO, recovery, or any product integration.

**Change boundary for this task:** create this draft only. Do not stage, commit, push, or implement provisioning/authentication. Preserve all pre-existing worktree changes. Stop after delivering the draft and report.
