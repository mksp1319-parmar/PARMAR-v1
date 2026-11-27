# PARMAR Account-Binding Policy Decisions

> **ACCOUNT-BINDING DETAIL PROPOSAL — NOT IMPLEMENTATION AUTHORIZATION**
>
> This document records account-binding design recommendations and unresolved details. The user separately approved APR-01–APR-20 as a proposed policy baseline on 2026-11-13; that record governs overlapping policy direction only and does not approve this document's detailed mechanisms, schema, implementation, provider selection, or release. Preserve the limited-scope D1–D16 approvals. No approval in either record authorizes implementation or production.

## 1. Evidence classifications

- **A — Approved requirement:** The final tenancy ADR approves product/security outcomes, not specific technical designs, implementation, or release. See [VOKKI-IDENTITY-TENANCY-ADR.md](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:1), lines 1–27 and 39–127.
- **D — Deferred:** The ADR explicitly leaves provider, assurance details, recovery methods, thresholds, UX, operational ownership, and production gates open. See [VOKKI-IDENTITY-TENANCY-ADR.md](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:19), lines 19–27.
- **I — Implemented in source:** A current-working-tree code fact, not proof of deployed behavior or production acceptance.
- **P — Proposed:** Architecture recommendations, not current controls or approved policy. See [PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md](/workspaces/PARMAR-v1/PARMAR/PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md:1), lines 1–4.
- **U — Unapproved draft:** Recommendations and lifecycle states in the provisioning draft are expressly unapproved. See [PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md](/workspaces/PARMAR-v1/PARMAR/PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md:1), lines 1–11 and 83–85.
- **R — Review assessment:** The architecture review is read-only and does not approve decisions. See [PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md](/workspaces/PARMAR-v1/PARMAR/PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md:1), lines 1–9.

## 2. Current state and consistency findings

1. **Approved SSO outcome, deferred mechanism [A/D].** The ADR requires one PARMAR account/SSO boundary, but does not choose provider, protocol, handoff, or shared-session mechanism. See [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:129), lines 129–134. The architecture review finds this consistent and still gated. See [architecture review](/workspaces/PARMAR-v1/PARMAR/PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md:153), lines 153–180.
2. **OIDC code exists; production approval does not [I/D].** A Keycloak OIDC adapter is implemented, but configuration defaults to disabled and the README says production login remains disabled. Source existence is not approval or live evidence. See [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:578), lines 578–692; [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:719), lines 719–735; and [README.md](/workspaces/PARMAR-v1/PARMAR/README.md:252), line 252.
3. **No link/unlink lifecycle exists [I].** OIDC start/callback are login handlers; the callback rejects an active session. Route inspection found no account link/unlink handler. See [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1281), lines 1281–1315 and [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1832), lines 1832–1843.
4. **OIDC state/cookie controls are login-flow controls [I].** The transaction cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`; state is bound to a transaction-token hash and consumed once, including provider-error callbacks. This does not establish a safe link-flow design. See [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:941), lines 941–957; [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:136), lines 136–183; [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:295), lines 295–354; [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1348), lines 1348–1415.
5. **CSRF scope must not be overstated [I].** Authenticated POSTs require session-bound CSRF validation. The origin helper accepts absent `Origin` and `Sec-Fetch-Site` headers; unauthenticated OIDC start does not receive the authenticated-session CSRF-token check. A new authenticated linking route needs its own verified CSRF/origin design. See [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:456), lines 456–471; [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1032), lines 1032–1052; [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1793), lines 1793–1835.
6. **Provisioning is not capability-secure [I].** No unauthenticated account route is exposed, but the internal provisioner is callable by code holding a repository and directly creates an active account. See [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:603), lines 603–637; [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:820), lines 820–830; [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:563), lines 563–577.
7. **Binding uniqueness is not binding immutability [I].** The schema enforces a primary key on `(issuer, subject)` and an account FK with `ON DELETE RESTRICT`; the shown triggers protect accounts only. Migration code copies binding rows but is not a user-facing lifecycle writer. See [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:341), lines 341–389 and [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:421), lines 421–441.
8. **Current status and session behavior are limited [I].** Account status is `ACTIVE` or `DISABLED`; trusted session creation/resolution checks account activity, and account-wide session revocation exists. No session binding-version/security-epoch field is present. See [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:310), lines 310–335; [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:53), lines 53–80; [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1310), lines 1310–1347; [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1696), lines 1696–1744 and [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1800), lines 1800–1822.
9. **Provider logout is not PARMAR logout [I].** Current `/api/logout` revokes the PARMAR session; no provider-side logout flow is evidenced. See [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1919), lines 1919–1924.
10. **Audit logger is not a lifecycle audit system [I].** It removes selected top-level fields and appends JSON lines; this does not establish tamper evidence, access policy, or retention. See [decision_logs.py](/workspaces/PARMAR-v1/PARMAR/audit/decision_logs.py:19), lines 19–56.
11. **Tests support only current behaviors [I].** Tests cover exact unknown-binding rejection, duplicate insert concurrency, inactive-account lookup, disabled-account session revocation, unauthenticated route absence, and legacy migration without account assignment. They do not prove link/unlink/recovery behavior. See [test_oidc_authentication.py](/workspaces/PARMAR-v1/PARMAR/tests/test_oidc_authentication.py:892), lines 892–908; [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:257), lines 257–277, [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:464), lines 464–526, and [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:563), lines 563–577; [test_sessions.py](/workspaces/PARMAR-v1/PARMAR/tests/test_sessions.py:567), lines 567–585.

### 2.1 Subsequent limited Product Owner decisions

On 2026-11-25, the Product Owner recorded bounded decisions PO-02–PO-08,
PO-10 and PO-14 in the [consolidated approval packet](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md).
These clarify only the selected product-policy direction: issuer+subject
defines the identity tuple regardless of adapter; unlink protects the last
independently usable verified method; recovery requires independent
strong-factor/verified-method proof and denies ambiguity; current
`ACTIVE`/`DISABLED` states remain until a reviewed matrix exists; staff
provide guidance only; ownership-changing events require durable notification
enqueue before success; affected sessions/approvals fail closed; class-specific
retention remains deferred; and cross-store failure defaults to no success.

Exact provider canonicalization, recovery thresholds, lifecycle authorities,
notification channels, revocation bounds, retention schedules, technical
failure ordering and specialist reviews remain open. These decisions do not
approve the proposed mechanisms below, B2 schema, implementation, migration,
provider selection or release. D1–D16 and APR-01–APR-20 are unchanged.

### 2.2 PO-13 product-packaging question

The exact historical phrase “fully primium type” is withdrawn as a
non-operative phrase. PO-13 is **APPROVED — Option A** by the Product Owner
with decision date 2026-11-26. This does not interpret the phrase as paid
entitlement, cancel or define PARMAR Premium, or authorize subscription,
billing, pricing or access-control changes. The decision record is in the
[consolidated PO-13 decision brief](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md#po-13-decision-brief)
and [Product Owner decision framework](./ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md) §D.

## 3. Decision matrix

The detailed defaults below remain proposals except where a governing record explicitly approves the same bounded policy direction. APR-01–APR-20 approval does not approve unlisted details or technical mechanisms. Product Owner approval is required only for residual product choices not already settled within D1–D16 or the APR baseline; specialist and implementation gates remain separate.

### 1. Providers and provider selection

- **Evidence:** IT-02 defers provider/protocol choice [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:45), lines 45–50; OIDC code exists but production login is disabled [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:578), lines 578–692; [README.md](/workspaces/PARMAR-v1/PARMAR/README.md:252), line 252.
- **Question/default:** Which provider, issuer, client, audience, and products are approved? Recommend a fixed explicit allowlist, exact issuer and redirect configuration, and no user-selected discovery.
- **Reason/impact/trade-off:** Limits issuer confusion; users get fewer provider choices. Multiple providers may improve access but increase assurance, collision, and operations burden.
- **Approvals:** Product owner, security, and deployment operations.

### 2. Initial provisioning and ownership

- **Evidence:** Internal provisioner directly creates an `ACTIVE` account [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:603), lines 603–637 and [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:820), lines 820–830; no unauthenticated account-creation route [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:563), lines 563–577.
- **Question/default:** What enrollment proves account ownership? Recommend no account creation from an unknown OIDC identity; only a separately approved enrollment process may mint a server-side ID.
- **Reason/impact/trade-off:** Provider control alone does not establish PARMAR ownership; enrollment is less frictionless than just-in-time creation.
- **Approvals:** Product owner, security, operations.

### 3. Proof before linking

- **Evidence:** IT-03 requires fresh proof of the method being added and prohibits automatic link/merge [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:51), lines 51–56; current login flow rejects active sessions [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1281), lines 1281–1315.
- **Question/default:** Is existing-account proof separately required? Recommend a current account session plus fresh account proof and separate provider proof, bound to the same transaction.
- **Reason/impact/trade-off:** Two proofs prevent provider authentication alone from selecting an account; extra authentication is more burdensome. This stronger two-proof requirement is a recommendation, not an already approved detail.
- **Approvals:** Product owner and security.

### 4. Freshness and assurance (`auth_time`, `max_age`, `acr`)

- **Evidence:** Current verifier requires `iat`, not `auth_time`, and uses `iat` as `authenticated_at` [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:615), lines 615–620 and [oidc.py](/workspaces/PARMAR-v1/PARMAR/oidc.py:665), lines 665–692; detailed assurance is deferred [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:19), lines 19–27.
- **Question/default:** What age and assurance level qualify? Recommend requiring policy-defined recent authentication, validating `auth_time` where supported, and rejecting when freshness is unknown; do not treat `iat` alone as fresh proof.
- **Reason/impact/trade-off:** Better evidence of user presence, with reauthentication friction.
- **Approvals:** Product owner, security, provider-capability review.

### 5. Explicit confirmation

- **Evidence:** Current OIDC handlers implement login, not linking [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1281), lines 1281–1315.
- **Question/default:** What does the user see before commitment? Recommend a separate authenticated, CSRF-protected final confirmation after both proofs.
- **Reason/impact/trade-off:** Reduces accidental linking but adds a step; confirmation content must avoid unnecessary attribute disclosure.
- **Approvals:** Product owner and security.

### 6. Duplicate identities and cross-account conflicts

- **Evidence:** `(issuer, subject)` primary key and FK [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:341), lines 341–369; concurrent duplicate test [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:464), lines 464–499; no binding immutability trigger in account triggers [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:378), lines 378–389.
- **Question/default:** Can bindings ever move? Recommend rejecting conflicts and no silent reassignment or merge; approve an exceptional correction process separately, if any.
- **Reason/impact/trade-off:** Prevents takeover but may make legitimate identity migration slower. Decide whether one account may link multiple identities/providers.
- **Approvals:** Product owner and security.

### 7. Unlinking and last method

- **Evidence:** Last-method rules remain open [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:51), lines 51–56; no unlink route is evidenced.
- **Question/default:** Which methods count as usable? Recommend fresh proof and confirmation; do not remove the last usable method outside approved recovery.
- **Reason/impact/trade-off:** Reduces lockout/takeover risk but requires users to establish an alternative first.
- **Approvals:** Product owner and security.

### 8. Lost-provider and lost-all-methods recovery

- **Evidence:** Recovery, passkeys, additional verification, attempt limits, and lost-device protections are approved outcomes; specifics remain gated [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:57), lines 57–62; [architecture review](/workspaces/PARMAR-v1/PARMAR/PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md:139), lines 139–140.
- **Question/default:** Which independent proofs, delays, notices, and appeal process apply? Recommend no recovery by attribute matching or support assertion alone.
- **Reason/impact/trade-off:** Stronger recovery resists social engineering but can lengthen legitimate recovery.
- **Approvals:** Product owner, security, operations; qualified privacy/legal review as applicable.

### 9. Disablement, suspension, reactivation

- **Evidence:** Only `ACTIVE`/`DISABLED` exists [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:310), lines 310–335; session handling checks status [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1620), lines 1620–1654. Additional states are only draft proposals [draft](/workspaces/PARMAR-v1/PARMAR/PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md:83), lines 83–85.
- **Question/default:** Who controls each transition and review/appeal? Recommend no new state until meanings and authority are approved.
- **Reason/impact/trade-off:** Avoids ambiguous denial of service; a single status is simpler but conflates security holds, user disablement, and closure.
- **Approvals:** Product owner, security, operations.

### 10. Administrator/support intervention

- **Evidence:** No standing support access to private content is approved [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:123), lines 123–127; exceptional intervention remains open [draft](/workspaces/PARMAR-v1/PARMAR/PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md:303), line 303.
- **Question/default:** Which operations may staff initiate or approve? Recommend support guidance only; any exceptional binding correction must be independently authorized, time-bounded, and audited.
- **Reason/impact/trade-off:** Limits insider risk but can slow exception handling.
- **Approvals:** Product owner, security, operations; qualified review as applicable.

### 11. Notifications and failures

- **Evidence:** Events, channels, and failure handling are unresolved [draft](/workspaces/PARMAR-v1/PARMAR/PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md:301), line 301; no binding notification flow is implemented.
- **Question/default:** Which operations require notice, and does failed durable queuing block activation? Recommend notices for binding, recovery, state changes, and closure, with queued/delivered status distinguished.
- **Reason/impact/trade-off:** Improves detection but may delay high-risk operations during notification outages.
- **Approvals:** Product owner, security, operations.

### 12. Audit integrity, access, retention, failure

- **Evidence:** Generic logger’s top-level filtering and append behavior [decision_logs.py](/workspaces/PARMAR-v1/PARMAR/audit/decision_logs.py:19), lines 19–56; audit retention unresolved [draft](/workspaces/PARMAR-v1/PARMAR/PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md:298), line 298.
- **Question/default:** Which records, readers, integrity controls, retention, and outage rules? Recommend minimal allowlisted events, protected access, integrity verification, approved retention, and fail-closed behavior when a required event cannot be durably recorded.
- **Reason/impact/trade-off:** Better incident evidence; audit outages may delay changes, while verbose logs increase data exposure.
- **Approvals:** Product owner, security, operations; qualified privacy/legal review as applicable.

### 13. Session invalidation/security version

- **Evidence:** Session holds account identity/authentication context but no binding version [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:53), lines 53–80; account-wide revocation exists [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1310), lines 1310–1347; account status is checked during create/resolve [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1696), lines 1696–1744 and [sessions.py](/workspaces/PARMAR-v1/PARMAR/sessions.py:1800), lines 1800–1822.
- **Question/default:** Which changes revoke which sessions and within what bound? Recommend an approved account/binding version or equivalent stale-session rejection mechanism.
- **Reason/impact/trade-off:** Stronger race protection may sign users out across devices; targeted revocation is more complex.
- **Approvals:** Product owner for disruption/latency; security and operations.

### 14. Provider-side logout/revocation

- **Evidence:** Local logout revokes the PARMAR session [futuristic_app.py](/workspaces/PARMAR-v1/PARMAR/interface/futuristic_app.py:1919), lines 1919–1924; no provider logout flow is evidenced.
- **Question/default:** Is provider logout required? Recommend treating PARMAR revocation as authoritative for PARMAR access and not promising provider session termination.
- **Reason/impact/trade-off:** Predictable local logout, but provider may remain signed in; coordinated logout adds dependencies.
- **Approvals:** Product owner, security, operations.

### 15. Account deletion, binding history, retention

- **Evidence:** Account ID update/delete protections and binding FK [identity_store.py](/workspaces/PARMAR-v1/PARMAR/identity_store.py:367), lines 367–389; tombstone policy unresolved [draft](/workspaces/PARMAR-v1/PARMAR/PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md:302), line 302; closure/truthful reporting is approved [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:123), lines 123–127.
- **Question/default:** What minimum tombstone remains, for what purpose and duration? Recommend separating closure, binding revocation, and data deletion; do not retain raw provider attributes indefinitely by default.
- **Reason/impact/trade-off:** Balances anti-reuse integrity and privacy; some minimal records may remain after closure.
- **Approvals:** Product owner, security, operations; qualified privacy/legal review as applicable.

### 16. Legacy migration and ownership

- **Evidence:** Migration test retains profiles without assigning accounts [test_account_registry.py](/workspaces/PARMAR-v1/PARMAR/tests/test_account_registry.py:257), lines 257–277; resolver requires existing binding [identity_contracts.py](/workspaces/PARMAR-v1/PARMAR/identity_contracts.py:211), lines 211–230; IT-03 prohibits attribute-based linking [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:51), lines 51–56.
- **Question/default:** Which legacy records can be mapped, and what proof establishes ownership? Recommend leaving records unmapped until an approved owner-verification process; never infer from email, name, or UUID appearance.
- **Reason/impact/trade-off:** Avoids cross-account exposure but may delay historical-data access.
- **Approvals:** Product owner, security, operations; qualified privacy/legal review as applicable.

## 4. Additional missing decisions

Before authorizing a link writer, explicitly decide:

- Binding cardinality: whether one account may link several identities/providers.
- Issuer/subject normalization, issuer migration, subject changes, and provider-key migration.
- Whether bindings are revoked, retained, or ever reassigned; how uniqueness survives closure.
- Atomicity and failure behavior across identity, session, audit, and notification stores.
- Recovery enumeration, attempt limits, lockout, appeal, and notification behavior.
- Whether notification failure leaves a link pending or permits activation.
- Audit access, integrity verification, retention, and fail-closed conditions.
- Family/guardian and organization-managed account authority and recovery.
- Local Demo and legacy identity separation; no conversion to PARMAR accounts without approved verification. The ADR distinguishes prototype building blocks from production acceptance at [ADR](/workspaces/PARMAR-v1/PARMAR/VOKKI-IDENTITY-TENANCY-ADR.md:135), lines 135–147.

## 5. Approval boundaries

| Area | Implementation-team discretion after approval | Required approval |
|---|---|---|
| Internal mechanics | Code organization and safe errors that preserve approved behavior | Security review for trust-boundary, authorization, protocol, or race changes |
| Provider/enrollment | Enforce an already approved fixed configuration | Product owner selects policy; security reviews adapter; operations approves deployment |
| Linking/recovery | Implement approved transitions and failure behavior | Product owner approves proof and user impact; security reviews threat model |
| Admin/audit/notifications | Implement approved roles, schema, and status reporting | Product owner approves authority; security/operations review dual control, audit, and delivery |
| Retention/deletion | Implement an approved schedule | Product owner approves user experience; operations owns execution; qualified review where applicable |
| Production activation | No unilateral implementation-team authority | Product release approval plus security and operations evidence |

No legal or compliance requirement is asserted here. Obtain qualified review where privacy, retention, or legal questions arise.

## 6. Implementation gates

Each gate depends on the preceding gate(s); passing one does not authorize production activation.

1. **Policy approval — owner: product owner; reviewers: security and operations.**
   - **Depends on:** none.
   - **Pass:** All 16 decisions and additional missing decisions have explicit disposition, named owner, and approval status; unapproved recommendations remain labeled.
   - **Evidence:** Approved decision record and recorded security/operations review. Documentation alone is not proof of implementation.

2. **Identity/binding model approval — owner: identity/data-model owner; approvers: product owner and security.**
   - **Depends on:** Gate 1.
   - **Pass:** Approved semantics cover cardinality, exact issuer/subject handling, binding immutability/revocation, states, audit history, session invalidation, and cross-store failures. Concurrent attempts to bind one identity result in at most one mapping and no partial second mapping.
   - **Evidence:** Reviewed schema/ADR, migration/rollback plan, invariant checks, and concurrency results on independent connections.

3. **Threat-model review — owner: security; product owner accepts residual risks.**
   - **Depends on:** Gates 1–2.
   - **Pass:** Account takeover, session theft, CSRF, replay, provider compromise, unknown identity, duplicate/concurrent link, recovery abuse, last-method unlink, insider abuse, notification/audit outages, and state/session races each have a mitigation and accountable owner.
   - **Evidence:** Threat/abuse-case matrix and signed disposition of residual risks.

4. **Link/unlink/recovery implementation — owner: engineering; security reviewer independent of implementer.**
   - **Depends on:** Gates 1–3.
   - **Pass:** Unknown identity never creates an account; proof, confirmation, CSRF, conflict, audit/notification, and session-version behavior match the approved policy. Every denied operation leaves no binding or state mutation.
   - **Evidence:** Route authorization matrix, code review, transaction/failure tests, and sanitized audit/notification examples.

5. **Focused automated security tests — owner: QA/security test owner; engineering fixes failures.**
   - **Depends on:** Gate 4.
   - **Pass:** Every approved link/unlink/recovery route has positive and negative authorization cases; stale/replayed proof, conflicts, concurrency, disabled state, last-method, enumeration, audit/notification failure, and session invalidation are exercised. No required scenario is skipped or replaced by a test count.
   - **Evidence:** Reproducible test results mapped to the approved threat matrix. These results establish only tested behavior, not provider or production security.

6. **Isolated live Keycloak E2E — owner: E2E/operations owner; security approves scope.**
   - **Depends on:** Gates 1–5 and approved test infrastructure.
   - **Pass:** Manual isolated run uses a test realm and non-production credentials; every required live scenario executes and passes; required tests do not skip; cleanup and ownership checks pass.
   - **Evidence:** Actual workflow run/logs, test-environment provenance, executed scenarios, and cleanup record. Static review and skipped tests are not live evidence.

7. **Production readiness — accountable owner: product release owner; approvals: security and operations.**
   - **Depends on:** Gates 1–6.
   - **Pass:** Deployed configuration, recovery/support process, audit/notification monitoring, retention, backup/restore, revocation behavior, incident response, and rollback are evidenced and exercised. Every remaining high-impact risk has a named owner and explicit acceptance or mitigation.
   - **Evidence:** Deployment review, operational exercise records, independent security approval, and product release authorization. No source review or test suite alone establishes production readiness.

## 7. Product-owner decisions that must remain unapproved until decided

1. Provider(s), issuers, clients, audiences, products, and environments.
2. Enrollment paths and ownership evidence for new accounts.
3. Whether existing-account proof is required separately from provider proof, and its acceptable methods.
4. Provider authentication freshness and assurance requirements.
5. Link/unlink confirmation UX and displayed information.
6. Binding cardinality, conflict resolution, and whether reassignment is ever permitted.
7. Definition of last usable method and unlink exceptions.
8. Recovery evidence, delays, notices, appeal, and support responsibilities.
9. Account states, transition authority, review deadlines, and reactivation policy.
10. Administrative intervention, dual-control boundaries, and exceptional-access limits.
11. Required notifications and behavior when delivery cannot be queued or completed.
12. Audit schema, access, integrity, retention, and outage behavior.
13. Session invalidation scope and maximum delay after security-sensitive changes.
14. Provider-side logout expectations.
15. Closure, deletion, tombstone, and retention rules.
16. Legacy migration scope and owner-verification procedure.
17. Additional binding normalization, cross-store transaction, managed-account, and recovery-enumeration decisions.

## 8. Evidence limits

This audit verified source and cited ranges only. It did not run tests, install dependencies, contact a network/provider, execute Keycloak, or establish deployed behavior. This proposal is not approval to implement or activate production authentication.
