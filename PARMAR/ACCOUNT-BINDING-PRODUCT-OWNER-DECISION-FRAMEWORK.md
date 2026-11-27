# PARMAR — Batch 22.12.18: Product-Owner Policy Decision Framework

> **POLICY DECISION FRAMEWORK — NOT IMPLEMENTATION AUTHORIZATION**
>
> Sections C.1–C.16 record limited-scope Product Owner decisions as approved.
> Remaining defaults and unresolved §D matters are proposals or deferred
> choices; the limited delegated-permissions boundary in §D does not approve
> managed-account ownership. Gates 1–3 remain NOT PASSED.
>
> This document does not authorize B2 schema design or implementation,
> account provisioning or binding changes, link/unlink/recovery operations,
> provider selection, production authentication, or production readiness.

## A. Executive status and evidence classifications

### 1. Existing approved ADR requirements

The tenancy ADR is the approved source for the following high-level outcomes:

- Every account has an immutable PARMAR account ID ([VOKKI-IDENTITY-TENANCY-ADR.md:39–43](./VOKKI-IDENTITY-TENANCY-ADR.md#L39)).
- Authentication-provider selection is explicitly deferred ([VOKKI-IDENTITY-TENANCY-ADR.md:45–49](./VOKKI-IDENTITY-TENANCY-ADR.md#L45)).
- Optional login methods require fresh proof of the method being added and must not be linked or merged automatically ([VOKKI-IDENTITY-TENANCY-ADR.md:51–55](./VOKKI-IDENTITY-TENANCY-ADR.md#L51)).
- Recovery must be secure and include passkey/additional verification, abuse limits and lost-device protection ([VOKKI-IDENTITY-TENANCY-ADR.md:57–61](./VOKKI-IDENTITY-TENANCY-ADR.md#L57)).
- Per-device sessions and individual/all-device logout are required outcomes ([VOKKI-IDENTITY-TENANCY-ADR.md:63–67](./VOKKI-IDENTITY-TENANCY-ADR.md#L63)).
- Account closure must revoke sessions and approvals, report deletion/retention honestly and prohibit standing support access ([VOKKI-IDENTITY-TENANCY-ADR.md:123–127](./VOKKI-IDENTITY-TENANCY-ADR.md#L123)).

These approvals do not select a provider, approve a protocol implementation, approve a schema, authorize implementation or establish production readiness.

### 2. Implemented source behavior

The following are current source facts, not deployed or production evidence:

- OIDC is disabled unless `PARMAR_OIDC_ENABLED=true` ([oidc.py:715–724](./oidc.py#L715)).
- The OIDC verifier uses an allowlist and validates signature, issuer, audience, expiry, `iat`, subject and nonce ([oidc.py:578–620](./oidc.py#L578)); it maps `iat` to authentication time ([oidc.py:665–692](./oidc.py#L665)).
- The resolver only resolves a verified identity through an existing binding ([identity_contracts.py:211–230](./identity_contracts.py#L211)).
- Account status is `ACTIVE` or `DISABLED` ([identity_store.py:310–335](./identity_store.py#L310)).
- Provider bindings use `(issuer, subject)` as a primary key and restrict deletion of the target account ([identity_store.py:341–369](./identity_store.py#L341)). Binding rows lack a binding-immutability trigger.
- The internal provisioner creates a random active account ([identity_store.py:603–637](./identity_store.py#L603), [identity_store.py:828–830](./identity_store.py#L828)).
- Trusted sessions hold account identity and authentication context but no binding/security version ([sessions.py:53–80](./sessions.py#L53)).
- Account-wide revocation exists ([sessions.py:1310–1347](./sessions.py#L1310)).
- `/api/logout` only revokes the local PARMAR session ([interface/futuristic_app.py:1919–1924](./interface/futuristic_app.py#L1919)).
- The current audit utility sanitizes selected fields and appends JSONL ([audit/decision_logs.py:19–56](./audit/decision_logs.py#L19)); it is not evidence of tamper evidence, access control or retention.

### 3. Proposed controls

The recommendations below are proposed controls pending explicit product-owner, security and other required approvals. They must not be treated as already implemented or approved.

### 4. Deferred choices

Provider, assurance, recovery, notification, audit, lifecycle, retention, operational and production choices remain deferred unless an authoritative ADR expressly approves the outcome.

## B. Executive recommendation

Adopt a provider-neutral, explicitly user-initiated binding model as the recommended package:

1. Do not create or bind an account from an unknown provider identity.
2. Require current-account and new-method proof for a future link operation.
3. Use exact issuer/subject identities and reject conflicts rather than merging or reassigning.
4. Require explicit confirmation and transaction-bound replay protection.
5. Protect the last usable method and require a separately approved recovery route.
6. Invalidate affected sessions and approvals after approved binding or account-security changes.
7. Keep audit, notice and provider-logout expectations explicit; do not claim provider capabilities without verification.

This is an unapproved recommendation. Source existence and unit/mock coverage do not establish production behavior or approval.

## C. Complete 16-decision coverage

### 1. Provider selection

- **Status: APPROVED — product-owner decision**
- **Approval scope:** This approval records the product owner's decision exclusively for provider-neutral account ownership and identity linking. It approves the following policy rules:
  1. Account ownership and identity linking are provider-neutral.
  2. An unknown OIDC identity must not create a PARMAR account automatically.
  3. An existing PARMAR account must be proven before linking.
  4. Fresh proof of the new provider identity is required before linking.
  5. The user must explicitly confirm a binding before it is committed.
  6. No account linking, merging or reassignment may occur automatically.
  7. Identity ownership conflicts must fail closed.
- **Not approved by this decision:** Selection of a specific provider, issuer, client, audience, region or environment; protocol deployment details; implementation or schema changes; production OIDC activation; provider-side logout; operational acceptance; or any other implementation decision. Those matters remain deferred and require their separate approved gates and security/operations review.
- **Implementation boundary:** This approval does not authorize account provisioning, linking, unlinking, merging, reassignment or recovery functionality. It does not authorize code or database changes and does not establish live or production readiness.
- **Security/operations boundary:** Security review remains required for assurance, proof strength, protocol handling, conflict control and transaction/race behavior. Operations approval remains required before deployment or operational activation.

- **Unresolved question:** Which provider(s), issuer(s), client(s), audience(s), products, regions and environments are approved?
- **Post-approval default:** Keep B2 provider-neutral. A fixed provider allowlist and exact issuer/client/audience may be configured only after separate provider and security approval.
- **Alternative:** Support multiple providers, with greater configuration, assurance and operations burden.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security owner and operations owner.
- **Consulted:** Privacy/legal reviewer where personal data, region or retention is affected.
- **Dependencies:** 2–6 and provider capability verification.
- **Completion gate:** Gate 1; provider-specific deployment choices must also pass Gate 6.
- **Blocker:** No provider or protocol is selected now.
- **Evidence:** IT-02 defers selection ([VOKKI-IDENTITY-TENANCY-ADR.md:45–49](./VOKKI-IDENTITY-TENANCY-ADR.md#L45)); OIDC code exists but is disabled by default ([oidc.py:715–724](./oidc.py#L715)).

### 2. Identity ownership, cardinality and reassignment

- **Status: APPROVED — product-owner decision**
- **Approval scope:** This approval records the product owner's decision exclusively for external-provider identity ownership. It approves the following policy rules:
  1. One external provider identity may belong to at most one PARMAR account.
  2. One PARMAR account may have multiple verified provider identities.
  3. Automatic identity reassignment is prohibited.
  4. Automatic account merging is prohibited.
  5. Identity ownership conflicts must fail closed.
- **Not approved by this decision:** Initial account enrollment authority or proof, provider selection, implementation or schema changes, account recovery, exceptional reassignment procedures, unlinking, production activation or any other lifecycle decision. Such recovery or reassignment procedures require separate approval before implementation.
- **Implementation boundary:** This approval does not authorize linking, unlinking, reassignment, merging, recovery or account provisioning functionality. It does not authorize code or database changes and does not establish live or production readiness.
- **Security/operations boundary:** Security and operations review remains required for proof strength, conflict handling, exceptional procedures, transaction behavior and deployment.

- **Unresolved question:** What exact external-identity cardinality and binding lifecycle implementation should be used while preserving these approved ownership rules?
- **Post-approval default:** A verified external identity maps to at most one account, while multiple verified identities may attach to one account. Automatic reassignment or merge is not permitted; conflicts fail closed.
- **Alternative:** Approved just-in-time provisioning, only after explicit enrollment/security policy and abuse controls.
- **Owner:** Product owner.
- **Required approvers:** Product owner and security.
- **Consulted:** Operations and privacy/legal as applicable.
- **Dependencies:** 1, 3, 6 and 8.
- **Completion gate:** Gate 1; implementation boundary passes Gate 4.
- **Blocker:** Internal `_provision_account` creates active accounts without a user-facing policy boundary ([identity_store.py:603–637](./identity_store.py#L603), [identity_store.py:828–830](./identity_store.py#L828)).
- **Evidence:** Existing HTTP route tests reject account-creation routes and assert zero accounts ([test_account_registry.py:563–587](./tests/test_account_registry.py#L563)).

### 3. Proof before linking

- **Status: APPROVED — product-owner decision**
- **Approval scope:** This approval records the product-owner decision exclusively for proof, confirmation and fail-closed handling of identity linking. It approves the following requirements:
  1. Fresh proof of the existing PARMAR account is mandatory before identity linking.
  2. Independent proof of the new provider identity is mandatory.
  3. Explicit transaction-bound user confirmation is mandatory before a binding is committed.
  4. Appropriate authentication freshness must be enforced.
  5. Replay protection is mandatory.
  6. CSRF protection is mandatory.
  7. Missing, invalid, expired, conflicting or unverifiable proof must fail closed.
- **Deferred assurance thresholds:** Provider-specific assurance thresholds remain subject to security review and are not approved by this decision. Numeric freshness windows, `auth_time`/`max_age` interpretation, `acr` values and provider-capability assumptions remain unapproved and must not be inferred from this approval.
- **Not approved by this decision:** Link/unlink/recovery implementation, provider selection, protocol configuration, schema/API changes, numeric assurance thresholds, account provisioning, production activation or any other implementation decision.
- **Implementation boundary:** This approval establishes policy principles only. It does not authorize code, database, route or workflow changes and does not establish live or production readiness.
- **Security/operations boundary:** Security review is required to define provider-specific freshness/assurance controls and verify replay, CSRF, transaction and fail-closed behavior. Operations approval remains required before deployment.

- **Unresolved question:** What provider-specific proof and assurance thresholds satisfy the approved principles?
- **Post-approval default:** Require independent, fresh proof for the target account and new provider identity; bind both proofs to one expiring transaction; require explicit confirmation; deny replay/CSRF and any missing, invalid or conflicting proof.
- **Alternative:** None that weakens any approved requirement. Security may define implementation-specific methods and provider thresholds without reducing the mandatory proof and fail-closed principles.
- **Owner:** Product owner.
- **Required approvers:** Product owner and security.
- **Consulted:** Operations and UX.
- **Dependencies:** 4–6.
- **Completion gate:** Gate 1, implemented in Gate 4.
- **Blocker:** No link route exists; the callback rejects active sessions ([interface/futuristic_app.py:1281–1315](./interface/futuristic_app.py#L1281)).
- **Evidence:** IT-03 requires fresh proof and prohibits automatic linking/merging ([VOKKI-IDENTITY-TENANCY-ADR.md:51–55](./VOKKI-IDENTITY-TENANCY-ADR.md#L51)).

### 4. Authentication freshness and assurance

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves appropriate authentication freshness and reauthentication for account-security decisions. The approved direction requires security review of provider claims rather than treating token issue time or provider identity alone as sufficient fresh proof.
- **Not approved by this decision:** Exact freshness windows, `auth_time`/`max_age` interpretation, `acr` values, provider capabilities or assurance tiers. Those remain subject to security/provider review.
- **Implementation boundary:** This does not authorize implementation, provider configuration or production authentication.

- **Unresolved question:** What freshness, `auth_time`, `max_age` and `acr` values or accepted values apply to login, link and recovery operations?
- **UNAPPROVED default:** Do not treat `iat` alone as proof of recent user authentication; require operation-specific policy and provider support verification.
- **Alternative:** Provider-specific assurance tiers or no `acr` requirement for low-risk login, subject to security approval.
- **Owner:** Product owner with security authority for minimum assurance.
- **Required approvers:** Product owner and security.
- **Consulted:** Provider capability owner and operations.
- **Dependencies:** 1, 3 and 8.
- **Completion gate:** Gate 1; live claim behavior passes Gate 6.
- **Blocker:** Current verifier requires `iat`, not `auth_time`, and does not enforce `max_age` or `acr` ([oidc.py:615–620](./oidc.py#L615), [oidc.py:665–692](./oidc.py#L665)).
- **Evidence:** Provider/claim behavior is not yet verified.

### 5. Explicit confirmation

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves explicit, transaction-bound confirmation for sensitive identity changes.
  1. Identity linking remains governed by approved Decision 3.
  2. Unlinking requires operation-appropriate fresh proof and explicit confirmation before commitment.
  3. Recovery requires independent ownership evidence and explicit confirmation before any account-access or binding change.
  4. No automatic linking, merging or reassignment is permitted.
- **Deferred details:** Exact freshness windows, provider-specific `auth_time`, `max_age`, `acr` interpretation, recovery evidence standards and detailed confirmation UX remain subject to Security and Operations review.
- **Not approved by this decision:** Implementation, schema/API changes, provider configuration, production activation or specific recovery procedures.
- **Implementation boundary:** This approval establishes confirmation policy only; it does not authorize unlinking or recovery functionality.

- **Unresolved question:** What exact information and final acknowledgement must precede a binding, unlink or recovery operation?
- **UNAPPROVED default:** Separate, transaction-bound confirmation after target-account and new-method proofs.
- **Alternative:** One combined proof/confirmation step, if security review establishes equivalent replay and CSRF protections.
- **Owner:** Product owner.
- **Required approvers:** Product owner and security.
- **Consulted:** UX and operations.
- **Dependencies:** 3–4 and 11.
- **Completion gate:** Gate 1; route behavior Gate 4.
- **Blocker:** No binding confirmation flow exists.
- **Evidence:** Existing callback is a login flow ([interface/futuristic_app.py:1281–1315](./interface/futuristic_app.py#L1281)).

### 6. Duplicate identities and cross-account conflicts

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves fail-closed handling of identity conflicts, no automatic merge and no automatic reassignment or remapping. Identity conflicts must not silently change account ownership.
- **Not approved by this decision:** Exceptional correction/reassignment, support authority, recovery procedure, implementation or schema changes. Those require separate approval and security/operations review.
- **Implementation boundary:** This approval does not authorize correction workflows, reassignment, migration or implementation.

- **Unresolved question:** May one provider identity bind to only one account, can one account bind multiple identities, and may exceptional correction ever reassign a binding?
- **UNAPPROVED default:** One exact `(issuer, subject)` key to one account; no silent merge or reassignment.
- **Alternative:** Support reassignment only through an independently authorized correction workflow.
- **Owner:** Product owner.
- **Required approvers:** Product owner and security.
- **Consulted:** Operations and support.
- **Dependencies:** 1–5 and 10.
- **Completion gate:** Gate 1 and schema Gate 2.
- **Blocker:** Database uniqueness is implemented, but binding ownership/immutability is not ([identity_store.py:341–394](./identity_store.py#L341)); no lifecycle writer exists.
- **Evidence:** Duplicate concurrency test ([test_account_registry.py:464–499](./tests/test_account_registry.py#L464)).

### 7. Unlinking and last authentication method

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves unlinking only with fresh proof and explicit confirmation, and protects the last usable authentication method outside an approved recovery process.
- **Not approved by this decision:** The exact usable-method definition, unlink/exception UX, recovery evidence, implementation or production activation.
- **Implementation boundary:** This does not authorize unlinking or recovery functionality.

- **Unresolved question:** What is the usable-method set, and is unlinking the last usable method ever permitted outside approved recovery?
- **UNAPPROVED default:** Require fresh proof and confirmation; never unlink the last usable method outside approved recovery.
- **Alternative:** Permit unlink with explicit warning if another approved recovery route exists.
- **Owner:** Product owner.
- **Required approvers:** Product owner and security.
- **Consulted:** Operations and UX.
- **Dependencies:** 3–6, 8 and 11–13.
- **Completion gate:** Gates 1–4.
- **Blocker:** No unlink route or last-method test exists.
- **Evidence:** Last-method protection is gated by IT-03 ([VOKKI-IDENTITY-TENANCY-ADR.md:51–55](./VOKKI-IDENTITY-TENANCY-ADR.md#L51)).

### 8. Recovery and account restoration

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves secure account recovery that does not rely on profile attributes or support assertion alone and that uses independent ownership evidence, predictably revoked/restored state and account-abuse protections.
- **Not approved by this decision:** Recovery factors, thresholds, delays, lockout, appeal, notification, support procedures or exceptional recovery authority. These remain security/privacy/operations matters.
- **Implementation boundary:** This does not authorize recovery implementation or production activation.

- **Unresolved question:** Which independent proofs, delays, attempt limits, lockout, appeal, notice and support responsibilities apply?
- **UNAPPROVED default:** No recovery by profile attributes or support assertion alone; require approved independent proof and revoke/restore state predictably.
- **Alternative:** Bounded manual recovery with independent authorization, time limits and audited evidence.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal where applicable.
- **Dependencies:** 3–7, 10–15.
- **Completion gate:** Gates 1–4.
- **Blocker:** ADR outcome exists, but mechanisms are unimplemented and deferred ([VOKKI-IDENTITY-TENANCY-ADR.md:57–61](./VOKKI-IDENTITY-TENANCY-ADR.md#L57)).

### 9. Disablement, suspension, reactivation and closure

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves separate lifecycle authority and truthful account-state changes, with account disablement/closure revoking affected sessions and approvals and without standing support access.
- **Not approved by this decision:** Exact states, transition authority, grace periods, reactivation rules, appeal deadlines or closure/retention implementation. Those remain deferred.
- **Implementation boundary:** This does not authorize lifecycle implementation or production activation.

- **Unresolved question:** Which account states exist, who may transition them, what evidence is required and how reactivation, closure and appeals work?
- **UNAPPROVED default:** Retain only `ACTIVE`/`DISABLED` until additional states have approved semantics.
- **Alternative:** Add separately approved `SUSPENDED`, `CLOSING` and `CLOSED` states with defined transitions.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal for closure/retention.
- **Dependencies:** 8, 10–15.
- **Completion gate:** Gate 1 and schema Gate 2.
- **Blocker:** Current source exposes only ACTIVE/DISABLED ([identity_store.py:310–335](./identity_store.py#L310)); session revocation behavior is implemented for account status ([sessions.py:1620–1654](./sessions.py#L1620)).
- **Evidence:** Closure outcome and honest reporting are approved; details remain gated ([VOKKI-IDENTITY-TENANCY-ADR.md:123–127](./VOKKI-IDENTITY-TENANCY-ADR.md#L123)).

### 10. Administrator/support intervention

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves that support may guide users but may not establish account ownership or change bindings unilaterally. Any future exceptional intervention requires separate authorization.
- **Not approved by this decision:** Staff roles, dual control, break-glass limits, recovery exceptions, implementation or operational access.
- **Implementation boundary:** This does not authorize administrative or support functionality.

- **Unresolved question:** Which staff operations are permitted, by which roles, under which dual-control and time bounds?
- **UNAPPROVED default:** Support may guide users but may not establish ownership or change bindings unilaterally.
- **Alternative:** Separately authorized, two-person exceptional correction with a bounded case record.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal and support leadership.
- **Dependencies:** 6–9 and 12–15.
- **Completion gate:** Gate 1 and threat Gate 3.
- **Blocker:** No account-binding admin workflow exists.
- **Evidence:** Standing support access is prohibited by ADR ([VOKKI-IDENTITY-TENANCY-ADR.md:123–127](./VOKKI-IDENTITY-TENANCY-ADR.md#L123)).

### 11. Security notifications and delivery failures

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves security notification for binding, recovery, lifecycle and closure outcomes and requires clear handling of queued, delivered and failed notification states.
- **Not approved by this decision:** Exact events, channels, delivery guarantees, retry behavior, privacy presentation or retention. These remain product/security/privacy/operations matters.
- **Implementation boundary:** This does not authorize notification infrastructure or production activation.

- **Unresolved question:** Which binding, recovery, state and closure events require notice, and may a mutation complete when required notification cannot be queued or delivered?
- **UNAPPROVED default:** Durably enqueue required notices before reporting success; distinguish queued from delivered.
- **Alternative:** Permit best-effort notice while creating a visible delivery-failure record, subject to security approval.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal and UX.
- **Dependencies:** 7–10, 12 and 15.
- **Completion gate:** Gate 1; delivery implementation Gates 4–7.
- **Blocker:** No lifecycle notification/outbox implementation exists.

### 12. Audit integrity, access, failure and retention

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves lifecycle audit requirements with restricted access, integrity verification, outage/failure handling and privacy-conscious retention.
- **Not approved by this decision:** Audit event schema, numeric retention periods, integrity technology, storage architecture or durability implementation.
- **Implementation boundary:** This does not authorize audit infrastructure or production activation.

- **Unresolved question:** What lifecycle events, readers, integrity controls, retention periods and outage behavior apply?
- **UNAPPROVED default:** Allowlisted lifecycle events, protected access, integrity verification and fail-closed behavior for required audit events.
- **Alternative:** Append-only/best-effort audit with risk acceptance, only if approved and scoped to non-security-critical events.
- **Owner:** Product owner sets data/UX policy; security owns minimum integrity.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal.
- **Dependencies:** 9–11 and 15.
- **Completion gate:** Gate 1 and schema Gate 2.
- **Blocker:** Current logger is not a lifecycle audit system ([audit/decision_logs.py:19–56](./audit/decision_logs.py#L19)).

### 13. Session and pending-approval invalidation

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves invalidation of affected sessions and pending approvals after approved binding, recovery or account-security changes.
- **Not approved by this decision:** Exact revocation scope, security-version implementation, revocation latency, account-wide versus targeted behavior or operational thresholds.
- **Implementation boundary:** This does not authorize session or approval implementation changes.

- **Unresolved question:** Which binding, recovery or account changes invalidate which sessions and pending approvals, and within what maximum delay?
- **UNAPPROVED default:** Binding/recovery/security changes invalidate affected sessions and approvals through an account/binding security version or equivalent verified stale-state check.
- **Alternative:** Enumerated account-wide revocation, if cross-process/concurrency evidence proves complete invalidation.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** UX and operations.
- **Dependencies:** 6–12 and 15.
- **Completion gate:** Gate 1 and schema Gate 2.
- **Blocker:** Sessions have no binding/security version ([sessions.py:53–80](./sessions.py#L53)); account-wide revocation is present ([sessions.py:1310–1347](./sessions.py#L1310)).
- **Evidence:** Revoked sessions/evidence cannot redeem approvals ([test_approval_integrity.py:1242–1266](./tests/test_approval_integrity.py#L1242)).

### 14. Provider logout and revocation

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves that PARMAR local logout/session revocation is authoritative for PARMAR access; no provider-side logout claim is approved.
- **Not approved by this decision:** Provider logout, back-channel logout, token revocation, provider capabilities or failure guarantees.
- **Implementation boundary:** This does not authorize provider integration or production activation.

- **Unresolved question:** Is provider-side logout, back-channel logout or token revocation required, and how are provider-outage results communicated?
- **UNAPPROVED default:** Do not promise provider logout; local PARMAR revocation is authoritative for PARMAR access.
- **Alternative:** Add verified provider logout/revocation after provider capability, failure and privacy review.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Provider owner and privacy/legal.
- **Dependencies:** 1, 13 and 15.
- **Completion gate:** Gate 1; provider-specific behavior Gate 6.
- **Blocker:** `/api/logout` is local-only ([interface/futuristic_app.py:1919–1924](./interface/futuristic_app.py#L1919)).

### 15. Account deletion and binding/identity retention

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves separating closure, binding revocation, data deletion and retention reporting, and avoids indefinite raw provider-attribute retention.
- **Not approved by this decision:** Tombstone content, numeric retention periods, backup expiry, deletion implementation or privacy/legal exceptions.
- **Implementation boundary:** This does not authorize deletion or retention implementation.

- **Unresolved question:** What is deleted, retained as a tombstone or retained in audit/backup, for how long and with what status reporting?
- **UNAPPROVED default:** Separate closure, binding revocation and data deletion; retain no raw provider attributes beyond the approved minimum.
- **Alternative:** Tombstone records or binding anonymization if required by an approved anti-reassignment, audit or recovery policy.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal.
- **Dependencies:** 6, 9–14.
- **Completion gate:** Gate 1 and Gate 7.
- **Blocker:** Account deletion is blocked and binding FK is restrict-only ([identity_store.py:355–394](./identity_store.py#L355)); closure/retention details remain gated ([VOKKI-IDENTITY-TENANCY-ADR.md:123–127](./VOKKI-IDENTITY-TENANCY-ADR.md#L123)).

### 16. Legacy migration and Local Demo separation

- **Status: APPROVED — product-owner decision**
- **Approval scope:** The product owner approves that legacy records remain unmapped until approved owner verification and that Local Demo identities remain separate from PARMAR accounts.
- **Not approved by this decision:** Migration mapping procedures, normalization, proof of ownership, collision handling, implementation or rollback.
- **Implementation boundary:** This does not authorize migration or account assignment.

- **Unresolved question:** Which legacy records may be mapped, what owner proof is required, and how are Local Demo identities kept separate?
- **UNAPPROVED default:** Leave records unmapped until approved owner verification; never infer ownership from attributes or identifier appearance.
- **Alternative:** Controlled migration with verified identity mapping and collision rollback.
- **Owner:** Product owner.
- **Required approvers:** Product owner, security and operations.
- **Consulted:** Privacy/legal.
- **Dependencies:** 2–6, 8, 12 and 15.
- **Completion gate:** Gate 1 and migration Gate 2.
- **Blocker:** Migration test preserves profiles with zero accounts ([test_account_registry.py:257–277](./tests/test_account_registry.py#L257)); resolver requires an existing binding ([identity_contracts.py:211–230](./identity_contracts.py#L211)).

## D. Additional outstanding policy matters

This section tracks residual questions and technical/operational details, not
a reversal of the recorded approvals. APR-01–APR-20 were separately approved
on 2026-11-13 as a proposed policy baseline. That approval settles only the
recommended policy direction and stated boundaries; exact thresholds,
provider choices, operational mechanisms, specialist reviews, schema,
implementation and release remain gated. The status in this table applies to
the exact unresolved question in each row, not to an overlapping APR policy
direction already approved within its scope. On 2026-11-25, the Product Owner
also recorded limited decisions PO-02–PO-08, PO-10 and PO-14 in the
[consolidated approval packet](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md).
Those choices do not pass a gate or approve technical mechanisms. The status
in this table reflects the remaining scope after those decisions.

PO-13 is a tracking identifier used by the consolidated packet, not one of
D1–D16 or APR-01–APR-20. It was absent from the earlier §D table. The row
below records the explicit Product Owner Option A disposition recorded on
2026-11-26 by the authorized decision supplied in the current task.

| Matter | Unresolved question | Owner / approvers | Consulted | Dependencies | Gate | Status |
|---|---|---|---|---|---|---|
| Identity normalization/input representation | Exact issuer/subject canonicalization, embedded-U+0000 validation behavior, issuer migration, subject changes and provider-key migration | Product owner; security | Identity/data-model owner, provider owner, operations | 1, 6 | Gate 1–2 | PARTIALLY APPROVED — issuer+subject is the identity tuple regardless of adapter; canonicalization, embedded-U+0000 acceptance and migration deferred |
| Binding lifecycle | Whether bindings are revoked, retained or reassigned and how uniqueness survives closure | Product owner; security | Operations, privacy/legal | 6, 9, 15 | Gate 1–2 | PARTIALLY APPROVED — retain ACTIVE/DISABLED states and protect the last independently usable verified method; full lifecycle/retention remains open |
| Cross-store failure | Atomicity and partial-failure behavior across identity, session, audit and notification stores | Security; product owner accepts UX impact | Operations, engineering | 11–13 | Gate 2–4 | PARTIALLY APPROVED — fail closed/no reported success by default; technical ordering, holds and exceptions require Security/Operations approval |
| Recovery details | Recovery enumeration, attempt limits, lockout, appeal and notice | Product owner; security, operations | Privacy/legal, support | 8, 10–13 | Gate 1–4 | PARTIALLY APPROVED — independent strong-factor/verified-method proof and deny ambiguity; thresholds/assisted recovery/appeal remain open |
| Notification failure | Whether notification failure blocks activation or permits an observable pending state | Product owner; security, operations | Privacy/legal | 11–13 | Gate 1–4 | PARTIALLY APPROVED — durable enqueue before success for ownership-changing events; exact events/channels/delivery remain open |
| Audit design | Audit access, integrity verification, retention and fail-closed conditions | Security; product owner, operations | Privacy/legal | 12 | Gate 1–2 | PARTIALLY APPROVED — no success on required failure; audit architecture/access/integrity/retention require independent approval |
| Managed/family authority | Family, guardian and organization relationships grant no automatic account ownership. Delegated permissions must be explicit, scoped and revocable and may not confer identity-linking, merging, reassignment or account-recovery authority. Workspace membership does not grant personal-content access. A future managed-account ownership model requires separate product-owner approval and security/privacy review | Product owner; security, operations | Privacy/legal | 2, 6, 8–10 | Gate 1–3 | APPROVED — delegated permissions only; managed-account ownership remains separate |
| Local Demo separation | No conversion of Local Demo or legacy identity to a PARMAR account without approved verification | Product owner; security | Operations, privacy/legal | 2, 16 | Gate 1–2 | APPROVED — keep identities unmapped absent owner verification; anonymous dispatch mitigation verified in source/tests, independent Security/deployment closure pending |
| Provider/logout assumptions | Required provider logout/revocation semantics and outage behavior | Product owner; security, operations | Provider owner | 1, 14 | Gate 1–6 | APPROVED — PARMAR local revocation is authoritative; provider logout/revocation semantics remain deferred |
| **PO-13 — product-packaging/subscription phrase** | The exact historical phrase is “fully primium type.” **Selected disposition: Option A — no product requirement; withdraw the phrase as non-operative.** No additional scope, definition, subscription, billing, entitlement, pricing or access-control meaning is approved. | Product Owner | None | This closes PO-13 policy ambiguity; it does not add or cancel PARMAR Premium or future product scope and creates no subscription/entitlement implementation dependency | Gate 1 policy disposition | **APPROVED — OPTION A (2026-11-26)** |

## E. Complete approval worksheet

Sections C.1–C.16 record limited-scope Product Owner decisions as approved;
the recommended defaults in this worksheet do not extend those scopes. This
worksheet is not implementation authorization. Gate 1 remains NOT PASSED
pending recorded Security/Operations reviews and accountable-owner
confirmation of the §D dispositions.

| ID | Subject | Exact unresolved question | UNAPPROVED recommended default | Accountable owner | Required approvers | Consulted reviewers | Dependencies | Approval status evidenced in this record | Completion gate |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Provider-neutral account ownership and identity linking | Which provider-neutral ownership/linking rules are approved, while provider selection remains deferred? | Proposed scope: no unknown-identity account creation; existing-account proof, fresh provider proof and explicit confirmation before linking; no automatic linking/merge/reassignment; conflicts fail closed | Product owner | Product owner; security and operations retain separate review responsibilities | Privacy/legal | 2–6 | APPROVED — LIMITED SCOPE PER §C.1 | Gate 1; provider/deployment details remain deferred to Gate 6 |
| 2 | External identity ownership and cardinality | May an external identity belong to multiple accounts, or may one account have multiple identities, and may identities be reassigned or merged? | One external identity belongs to at most one account; one account may have multiple verified identities; no automatic reassignment or merge; ownership conflicts fail closed | Product owner | Product owner; security and operations retain separate review responsibilities | Privacy/legal | 1, 3, 6, 8 | APPROVED — LIMITED SCOPE PER §C.2 | Gate 1–4; recovery/exceptional reassignment remains separate |
| 3 | Proof before linking | Which fresh target-account proof and independent provider proof are mandatory, and how are replay/CSRF/failure handled? | Proposed: fresh existing-account proof, independent fresh provider proof, transaction-bound confirmation, replay/CSRF protection and fail-closed invalid/expired/conflicting proof | Product owner | Product owner; security review applies to assurance thresholds and controls | Operations, UX | 4–6 | APPROVED — LIMITED SCOPE PER §C.3 | Gate 1–4; numeric/provider assurance thresholds remain deferred |
| 4 | Freshness/assurance | What `auth_time`, `max_age`, `acr` and age rules apply per operation? | Proposed: require appropriate reauthentication/freshness principles; exact thresholds and provider claims remain deferred | Security | Product owner, security | Operations, provider owner | 1, 3, 8 | APPROVED — PRINCIPLES ONLY PER §C.4 | Gate 1–6 |
| 5 | Explicit confirmation | Is confirmation required for linking, unlinking and recovery-sensitive identity changes? | Binding follows Decision 3; unlinking requires fresh proof and confirmation; recovery requires independent ownership evidence and confirmation; no automatic identity changes | Product owner | Product owner, security | UX, operations | 3–4, 7–8, 11 | APPROVED — LIMITED SCOPE PER §C.5 | Gate 1–4; freshness/recovery details remain deferred |
| 6 | Conflicts | One binding per identity; may reassignment or multiple identities exist? | No automatic reassignment or merge; conflict fail-closed; exceptional correction remains separate | Product owner | Product owner, security | Operations, support | 1–5, 10 | APPROVED — LIMITED SCOPE PER §C.6 | Gate 1–4; exceptional correction remains separate |
| 7 | Unlink/last method | What is usable, and may the last method be removed? | Fresh proof and confirmation; protect the last usable method outside approved recovery | Product owner | Product owner, security | Operations, UX | 3–6, 8, 11–13 | APPROVED — LIMITED SCOPE PER §C.7 | Gate 1–4; exact usable-method/recovery details remain separate |
| 8 | Recovery | What independent proofs, limits, delay, notice and appeal apply? | Secure recovery with independent ownership evidence and no attribute/support-only recovery | Product owner | Product owner, security, operations | Privacy/legal, support | 3–7, 10–15 | APPROVED — OUTCOME ONLY PER §C.8 | Gate 1–6; factors/thresholds remain security/privacy/operations review |
| 9 | Account states | What states/transitions/reactivation/closure rules apply and who authorizes them? | Separate lifecycle authority; affected sessions/approvals revoked on disablement/closure; exact states remain deferred | Product owner | Product owner, security, operations | Privacy/legal | 8, 10–15 | APPROVED — LIMITED SCOPE PER §C.9 | Gate 1–4; exact states/authority remain separate |
| 10 | Admin/support | What staff may intervene, and under what dual-control/time bounds? | Support may guide users but cannot establish ownership or change bindings unilaterally | Product owner | Product owner, security, operations | Privacy/legal, support | 6–9, 12–15 | APPROVED — LIMITED SCOPE PER §C.10 | Gate 1–4; exceptional roles/procedures remain separate |
| 11 | Notifications | Which events require durable notice and what happens on queue/delivery failure? | Security notification for binding/recovery/lifecycle/closure outcomes with queued/delivered/failed states | Product owner | Product owner, security, operations | Privacy/legal, UX | 7–10, 12, 15 | APPROVED — OUTCOME ONLY PER §C.11 | Gate 1–7; exact events/channels/delivery guarantees remain separate |
| 12 | Audit | Which events/readers/integrity/retention/failure rules apply? | Lifecycle audit with restricted access, integrity verification and privacy-conscious failure/retention handling | Security owner | Product owner, security, operations | Privacy/legal | 9–11, 15 | APPROVED — OUTCOME ONLY PER §C.12 | Gate 1–7; schema/storage/numeric retention remain separate |
| 13 | Session invalidation | Which changes revoke sessions/approvals and within what bound? | Revoke affected sessions and pending approvals after approved binding/recovery/security changes | Product owner | Product owner, security, operations | UX, operations | 6–12, 15 | APPROVED — LIMITED SCOPE PER §C.13 | Gate 1–7; scope/latency/implementation remain separate |
| 14 | Provider logout | Is provider-side logout/revocation required and how are failures handled? | PARMAR local revocation is authoritative; no provider logout claim is approved | Product owner | Product owner, security, operations | Provider owner, privacy/legal | 1, 13, 15 | APPROVED — LIMITED SCOPE PER §C.14 | Gate 1–6; provider logout/revocation remains separate |
| 15 | Deletion/retention | What is deleted, retained, backed up and truthfully reported? | Separate closure, binding revocation, data deletion and truthful retention reporting | Product owner | Product owner, security, operations | Privacy/legal | 6, 9–14 | APPROVED — OUTCOME ONLY PER §C.15 | Gate 1–7; tombstone/content/numeric retention remain separate |
| 16 | Legacy migration | Which legacy records and Local Demo identities may map, with what owner proof? | Leave legacy/Local Demo records unmapped until approved owner verification | Product owner | Product owner, security, operations | Privacy/legal | 2–6, 8, 12, 15 | APPROVED — LIMITED SCOPE PER §C.16 | Gate 1–4; normalization/procedure/rollback remain separate |

## F. Cross-decision dependencies and non-negotiable boundaries

No decision may be made independently where it affects provider identity, account ownership, link proof, conflict handling or invalidation.

- 1 and 4: provider claims and supported assurance semantics must be verified together.
- 2, 3, 5 and 6: enrollment, target-account proof, confirmation and conflict handling form one account-ownership package.
- 7, 8 and 10: last-method protection requires an approved recovery and support boundary.
- 9, 13, 14 and 15: state transitions must have consistent session, approval, provider-logout and retention semantics.
- 11 and 12: notification and audit durability must be decided before a transaction reports success.
- 16 and 2: legacy or Local Demo records cannot create or acquire a PARMAR account without approved ownership evidence.

The following are never silently weakened: immutable internal account identity, fresh proof before adding a login method, no automatic linking/merging, secure recovery outcomes, per-device session and remote logout, account closure/session/approval revocation and no standing support access. They remain source requirements, not a provider/schema/production approval.

## G. Implementation gates

Documentation and mock/unit tests alone do not pass any gate.

### Gate 1 — Policy approval

- **Owner:** Product owner.
- **Depends on:** none.
- **Pass/fail:** All 16 decisions and all rows in §D have a disposition, named owner, required approvers and recorded status; no recommendation remains mislabeled as approved.
- **Evidence:** approved decision record and recorded security/operations reviews.
- **Status:** NOT PASSED.

### Gate 2 — Identity/binding data-model approval

- **Owner:** Identity/data-model owner.
- **Depends on:** Gate 1.
- **Pass/fail:** Cardinality, exact issuer/subject normalization independent of adapter ID, verifier-provenance semantics, binding ownership/immutability, lifecycle states, audit history, session invalidation and cross-store failure semantics are approved; SQL preserves the existing non-empty length bounds and edge-whitespace validation without normalizing accepted values; embedded U+0000 behavior is explicitly resolved because Python `len()` counts beyond it while SQLite `length(TEXT)` stops at it; direct SQLite TEXT-affinity coercion versus application type rejection is documented; concurrent binding attempts produce at most one mapping and no partial second mapping, including when the same issuer/subject is presented through different adapter IDs.
- **Evidence:** reviewed schema/migration/rollback plan, application/SQL validation-parity cases covering the resolved embedded-U+0000 behavior, explicit application type-guard and SQLite storage-affinity cases, invariant checks and independent-connection concurrency evidence, including cross-adapter duplicate-key rejection and the disposition of verifier-provenance references.
- **Status:** NOT PASSED.

### Gate 3 — Threat model and abuse-case review

- **Owner:** Security.
- **Depends on:** Gates 1–2.
- **Pass/fail:** Takeover, session theft, replay, CSRF, provider compromise, duplicate/concurrent binding, recovery abuse, last-method unlink, insider abuse, notification/audit outage and state races have a mitigation and owner.
- **Evidence:** threat/abuse matrix and residual-risk disposition.
- **Status:** NOT PASSED.

### Gate 4 — Link/unlink/recovery implementation

- **Owner:** Engineering.
- **Depends on:** Gates 1–3.
- **Pass/fail:** Unknown identities never create accounts; binding proof, confirmation, CSRF, conflict handling, audit/notification and session invalidation match approved policy; denied operations leave no partial state.
- **Evidence:** authorization matrix, code review, transaction/failure tests and sanitized audit/notification examples.
- **Status:** NOT PASSED.

### Gate 5 — Focused automated security tests

- **Owner:** QA/security test owner.
- **Depends on:** Gate 4.
- **Pass/fail:** Positive/negative authorization, stale/replayed proof, conflicts, concurrency, disabled status, last-method protection, enumeration, audit/notification failure and session invalidation are reproducibly exercised.
- **Evidence:** mapped test results and independent failure review.
- **Status:** NOT PASSED.

### Gate 6 — Isolated live Keycloak E2E

**Execution status for every row: NOT EXECUTED — no live run or provider evidence is claimed.**

| Scenario | Existing mock/unit coverage | Required live E2E coverage | Expected outcome | Evidence required | Status |
|---|---|---|---|---|---|
| Successful pre-bound account login | OIDC callback existing-binding test [test_oidc_authentication.py:1086–1118](./tests/test_oidc_authentication.py#L1086) | Test realm, exact issuer/client, real id-token exchange and session creation | Pre-bound account receives only the correct trusted session | Actual run log, realm/config provenance, account/session evidence | NOT EXECUTED |
| Unknown/unbound identity rejection | Unknown-binding test [test_oidc_authentication.py:892–908](./tests/test_oidc_authentication.py#L892) | Live unknown subject through real provider flow | No account/session/binding created | Actual response and database/run evidence | NOT EXECUTED |
| Duplicate/conflicting identity rejection | Duplicate concurrency test [test_account_registry.py:464–499](./tests/test_account_registry.py#L464) | Live/provider and concurrent binding conflict only after lifecycle exists | Generic rejection; no reassignment or duplicate mapping | Transaction and conflict evidence | NOT EXECUTED |
| Invalid token/signature | Signature and algorithm tests [test_oidc_authentication.py:693–800](./tests/test_oidc_authentication.py#L693) | Real live invalid/tampered token and JWKS cases | Authentication denied; no session | Actual run/log evidence | NOT EXECUTED |
| Issuer/audience validation | Claim validation tests [test_oidc_authentication.py:538–652](./tests/test_oidc_authentication.py#L538) | Live wrong issuer/audience/azp and expiry cases | Authentication denied; no session | Provider/test-configuration and response evidence | NOT EXECUTED |
| Nonce validation | Wrong nonce tests [test_oidc_authentication.py:446–485](./tests/test_oidc_authentication.py#L446) | Live mismatched nonce | Authentication denied; transaction consumed/cleared | Callback and nonce-evidence record | NOT EXECUTED |
| PKCE failure | State/PKCE tests [test_oidc_authentication.py:100–176](./tests/test_oidc_authentication.py#L100) | Live verifier mismatch or missing challenge | No code exchange/session | Proxy/run log and response evidence | NOT EXECUTED |
| State mismatch/replay | Replay tests [test_oidc_authentication.py:972–1021](./tests/test_oidc_authentication.py#L972), [test_oidc_authentication.py:1424–1469](./tests/test_oidc_authentication.py#L1424) | Live mismatch and repeated callback | First callback only is processable; replay denied | State-store and callback run evidence | NOT EXECUTED |
| Provider error/cancellation | Provider-error tests [test_oidc_authentication.py:1268–1398](./tests/test_oidc_authentication.py#L1268) | Real provider denial/cancellation callback | Safe rejection; transaction consumed; no session | Actual callback/result and state evidence | NOT EXECUTED |
| Disablement/session revocation | Account disablement tests [test_sessions.py:567–693](./tests/test_sessions.py#L567) | Live disabled account followed by existing-session resolution | Existing sessions revoked; login denied | Account status, session and run evidence | NOT EXECUTED |
| Provider outage/TLS failure | TLS/provider transport tests [test_oidc_authentication.py:310–367](./tests/test_oidc_authentication.py#L310) | Controlled unreachable/invalid-TLS provider endpoint | Safe unavailable response; no secret leakage/session | Sanitized transport logs and response evidence | NOT EXECUTED |
| Cleanup/isolation | Test realm/bootstrap and E2E bootstrap [test_keycloak_e2e_bootstrap.py](./tests/test_keycloak_e2e_bootstrap.py), [test_keycloak_oidc_live_e2e.py](./tests/test_keycloak_oidc_live_e2e.py) | Manual isolated run with ownership and cleanup checks | Test identities/config/state removed or explicitly owned and retained | Workflow run, cleanup result and provenance | NOT EXECUTED |

Gate 6 passes only after an actual isolated live run with every required row executed and passing, cleanup verified and no production credential/provider configuration used.

### Gate 7 — Production readiness

| Evidence category | Measurable pass criterion | Required evidence | Owner / approval | Status |
|---|---|---|---|---|
| TLS/deployment | HTTPS-only, exact callback/issuer/audience, no production fallback | Deployment config review, certificate and endpoint evidence | Security and operations | NOT PASSED |
| Session lifecycle/revocation | Idle/absolute expiry, rotation and account/binding revocation meet approved thresholds | Independent session exercise and operational runbook | Product owner, security, operations | NOT PASSED |
| Audit | Required events recorded, access restricted, integrity verified and retention approved | Audit architecture, access test, integrity test, retention schedule | Security and operations | NOT PASSED |
| Backup/restore | Recovery objective and restore completeness approved and exercised | Restore drill and data integrity comparison | Operations; product/security acceptance | NOT PASSED |
| Multi-process/multi-host | Binding/session/OIDC state persistence and concurrency verified on approved topology | Independent-host/provisioning and failover tests | Operations and security | NOT PASSED |
| Monitoring/incident response | Binding/recovery failures and revocation failures alert, owner and response are named | Runbooks, alert tests and tabletop evidence | Operations and security | NOT PASSED |
| Recovery continuity | Recovery, lockout, support and appeal processes approved and exercised | Recovery drill, support-boundary review and customer messaging | Product owner, security, operations | NOT PASSED |
| Isolation/cleanup | Test identities and provider configuration cannot reach production | Environment separation, credentials/access review and cleanup result | Operations and security | NOT PASSED |

Numerical thresholds, retention periods and maximum revocation delay are **TBD** unless approved by product/security/operations. Gate 7 is not passed by documentation or test counts.

## H. Evidence and preservation

### Exact implementation evidence

- [identity_contracts.py:211–230](./identity_contracts.py#L211): existing-binding-only resolution.
- [identity_store.py:310–335](./identity_store.py#L310): account statuses.
- [identity_store.py:341–394](./identity_store.py#L341): binding uniqueness/FK and lack of binding reassignment trigger.
- [identity_store.py:603–637](./identity_store.py#L603) and [identity_store.py:828–830](./identity_store.py#L828): internal account provisioning.
- [oidc.py:578–620](./oidc.py#L578): JWT algorithm/claim verification.
- [oidc.py:665–692](./oidc.py#L665): `iat` maps to authentication time.
- [oidc.py:715–724](./oidc.py#L715): OIDC disabled by default.
- [sessions.py:53–80](./sessions.py#L53): session fields do not include binding/security version.
- [sessions.py:1310–1347](./sessions.py#L1310): account-wide session revocation.
- [sessions.py:1590–1654](./sessions.py#L1590): account-status lookup and fail behavior.
- [interface/futuristic_app.py:1281–1315](./interface/futuristic_app.py#L1281): active-session callback rejection and login-flow nature.
- [interface/futuristic_app.py:1820–1860](./interface/futuristic_app.py#L1820): unauthenticated OIDC start.
- [interface/futuristic_app.py:1919–1924](./interface/futuristic_app.py#L1919): local logout.
- [audit/decision_logs.py:19–56](./audit/decision_logs.py#L19): JSONL logger limitations.
- [test_account_registry.py:257–277](./tests/test_account_registry.py#L257): legacy profiles migrate with zero accounts.
- [test_account_registry.py:464–499](./tests/test_account_registry.py#L464): duplicate binding concurrency.
- [test_account_registry.py:563–587](./tests/test_account_registry.py#L563): unauthenticated account routes absent.
- [test_oidc_authentication.py:892–908](./tests/test_oidc_authentication.py#L892): unknown binding fails closed.
- [test_sessions.py:567–693](./tests/test_sessions.py#L567): disabled-account revocation and resolution.
- [test_approval_integrity.py:1242–1266](./tests/test_approval_integrity.py#L1242): revoked session/evidence cannot redeem approval.

### Evidence limitations

No tests, provider calls or live Keycloak operations were run for this framework update. Mock/unit coverage is recorded only. This document cites source and tests; it does not treat documentation, test counts or skipped live scenarios as live or production evidence.

## I. Final preservation record

Before editing this framework, the baseline was:

- Branch: `parmar/batch-22-12-8-oidc-integration`
- HEAD: `a14395a7aa601404b7dbcaa83fdb4f26b87c7594`
- Framework SHA-256: `4a25fc16e7a164e43272379fc7f79871398ed85ccdd55dbd70e6cddff078bdbe`
- Policy SHA-256: `1d083d05b60128689dc8c3de7c7b631c10e453d0d0175d21bc0425f7d7fedede`
- All three preserved Keycloak E2E files matched their snapshots.

The authoritative ADR and existing policy proposal must remain unchanged.
