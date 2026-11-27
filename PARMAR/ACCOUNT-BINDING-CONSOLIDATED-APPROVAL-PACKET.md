# PARMAR Account-Binding Consolidated Approval Packet

> **Purpose:** One repository-grounded decision, review, and evidence packet for the Account-Binding architecture.
>
> **Status:** Reviewer-ready requests are prepared, with blocked/pre-review items clearly distinguished where evidence is not yet available. It records the Product Owner's limited decisions PO-02–PO-08, PO-10 and PO-14 made on 2026-11-25. It grants no specialist, schema, implementation, provider-operation, deployment, or release approval.

## 1. Executive disposition

The recorded Product Owner decisions **D1–D16** remain approved only within the scopes stated in [ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md](./ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md) §§C.1–C.16. Separately, **APR-01–APR-20** were approved by the user on **2026-11-13** as a **proposed policy baseline**, subject to every stated security, legal, privacy, and implementation gate. Neither record authorizes implementation, schema acceptance, migration, production authentication, provider selection, or release.

**Gate 1, Gate 2, and Gate 3 remain NOT PASSED.** Gates 4–7 also remain NOT PASSED or NOT EXECUTED. The B2 schema is a proposal, not an accepted model. The authorized synthetic prototype now has 58 passing disposable SQLite tests, including activation/unlink race, process-exit recovery and backup/restore checks; these do not replace independent Security, Operations, Data-Model or Product Owner approval, real migration/recovery evidence, or supported-topology acceptance.

Preserve these separate boundaries:

- OIDC remains production-disabled; no provider, issuer, client, audience, or production environment is selected.
- The protected-operation atomic-fence remains **NO-GO**.
- The anonymous Local Demo chat/research-dispatch path is mitigated in current source and verified by focused fake-provider tests; independent Security/deployment closure remains pending and separate from account binding.
- PO-13 is approved as **Option A**: no product requirement; withdraw the exact
  historical phrase “fully primium type” as non-operative. The decision is
  dated 2026-11-26 and is attributed to the Product Owner instruction. It does
  not cancel PARMAR Premium or future product scope and introduces no
  subscription, billing, entitlement, pricing or access-control change.
- Subscription or entitlement changes are not approved.
- APR-13's proposed 30-day closure grace period remains a candidate, not a finalized rule.

**Overall outcome:** the approval package is consolidated and review-ready, but external authority decisions, independent reviews, and technical evidence prevent Gate 1–3 completion or implementation readiness.

## 2. Status and evidence rules

Statuses in this packet use the requested vocabulary:

- **APPROVED** — an approval is recorded, but only within its explicitly stated scope.
- **PENDING** — a named authority must decide or review; the current evidence does not settle it.
- **BLOCKED** — a prerequisite, independent authority, infrastructure, or evidence is absent.
- **NOT APPLICABLE** — the item does not apply to this architecture. No material approval item below is marked NOT APPLICABLE.

“Approved policy baseline” is not equivalent to approved implementation, design, schema, migration, deployment, or release. Only explicitly attributed decisions in the records below count as approvals; recommendations, source-code behavior and test-file presence do not. Role labels below identify the accountable authority class; no individual specialist reviewer is presumed assigned unless a source document records one.

The new identifiers `PO-*`, `SEC-*`, `OPS-*`, `DM-*`, `PRIV-*`, `PROV-*`, `MIG-*`, `REL-*`, and `TM-*` are packet tracking labels only. They do not replace or alter D1–D16, APR-01–APR-20, framework gates, or prior findings.

## 3. Consolidated approval inventory

### 3.1 Recorded Product Owner decisions D1–D16

Each row preserves the recorded limited scope. The open fields are not a reason to reopen or downgrade the approved portion.

| ID | Status and authority | Approved scope, as bounded in the framework | Evidence | Exact remaining decision/evidence; dependency and acceptance |
|---|---|---|---|---|
| D1 | **APPROVED** — Product Owner | Provider-neutral account ownership; unknown identity does not create an account; prove existing account and new method; explicit confirmation; no automatic link/merge/reassignment; conflicts fail closed. | Framework §C.1; ADR IT-02/IT-03; APR-11 baseline. | Provider, issuer, client, audience, region, environment and deployment remain unselected; require provider comparison and Security/Operations approval before Gate 6. |
| D2 | **APPROVED** — Product Owner | One external identity has at most one PARMAR owner; one account may have multiple verified identities; no automatic merge/reassignment. | Framework §C.2; ADR IT-01/IT-03; APR-11. | Exact issuer/subject normalization, key migration, exceptional correction and lifecycle retention require PO/Security/Operations/privacy review and Gate 2 evidence. |
| D3 | **APPROVED** — Product Owner | Fresh existing-account proof, independent new-provider proof, transaction-bound confirmation, replay/CSRF protection, and fail-closed invalid or conflicting proof. | Framework §C.3; APR-11; B2 §§7–8. | Provider-specific assurance, freshness thresholds, claim semantics and adversarial test evidence remain pending Security/provider review before Gate 4/6. |
| D4 | **APPROVED — principles only** — Product Owner; Security review pending | Appropriate freshness/reauthentication; token issue time alone is not an approved freshness rule. | Framework §C.4; ADR; B2 §2.2. | `auth_time`, `max_age`, `acr`, thresholds and provider capability verification remain pending Security, PO and provider owner; Gate 1/6 acceptance requires recorded rules and live claim evidence. |
| D5 | **APPROVED** — Product Owner | Explicit confirmation for sensitive identity changes; linking follows D3; unlinking requires proof/confirmation; recovery uses independent evidence and confirmation. | Framework §C.5; APR-11. | Confirmation UX and operation-specific freshness/evidence are pending; accept only after Gate 1 decisions and Gate 4 tests. |
| D6 | **APPROVED** — Product Owner | Conflicts fail closed; no automatic reassignment or merge. | Framework §C.6; APR-11. | Whether any exceptional correction process exists, its authority and evidence remain pending; Gate 2 must preserve immutable ownership and prove concurrency uniqueness. |
| D7 | **APPROVED** — Product Owner | Unlink requires fresh proof and confirmation; protect the last usable method outside approved recovery. | Framework §C.7; APR-11. | Definition of “usable method,” recovery exception, and final-transaction test remain pending; PO/Security/Operations must settle before Gate 4. |
| D8 | **APPROVED — outcome only** — Product Owner | Secure recovery with independent ownership evidence, abuse protection and predictable revoke/restore behavior; not profile similarity or support assertion alone. | Framework §C.8; APR-05; ADR IT-04. | Recovery factors, thresholds, delays, abuse controls, lockout, appeal, notices and support roles need PO/Security/Operations/privacy review and recovery-drill evidence. |
| D9 | **APPROVED — limited scope** — Product Owner | Lifecycle authority is distinct; disablement/closure invalidate affected sessions and approvals; no standing support access. | Framework §C.9; APR-04/07/13. | States, transitions, actor authority, grace/cancellation, reinstatement, appeals and closure semantics remain pending; Gate 2 needs state invariants; Gate 7 needs lifecycle evidence. |
| D10 | **APPROVED — limited scope** — Product Owner | Support may guide users but cannot establish ownership or change bindings unilaterally. | Framework §C.10; APR-03/18. | Exceptional roles, dual control, case evidence, time bounds, notice and audit require separate PO/Security/Operations/privacy approval before any staff workflow. |
| D11 | **APPROVED — outcome only** — Product Owner | Lifecycle/security notification outcomes distinguish queued, delivered and failed. | Framework §C.11; APR-09. | Event/channel policy, delivery-failure behavior, privacy, retention and operational ownership remain pending; Gate 1/3 and Gate 7 need a reviewed policy, tests, and runbook. |
| D12 | **APPROVED — outcome only** — Product Owner; Security review pending | Lifecycle audit needs restricted access, integrity verification and retention handling. | Framework §C.12; APR-10; B2 §6. | Audit technology, append/order integrity, key custody, retention and outage semantics require Security/Operations/privacy review; do not infer that existing JSONL logging meets this requirement. |
| D13 | **APPROVED — limited scope** — Product Owner | Binding/recovery/security changes invalidate affected sessions and approvals. | Framework §C.13; APR-07; B2 §§6.5–6.7. | Exact scope/latency and implementation evidence remain pending. A version check is not an atomic side-effect fence; preserve the separate NO-GO. |
| D14 | **APPROVED — limited scope** — Product Owner | PARMAR local revocation is authoritative; no provider logout guarantee is approved. | Framework §C.14; APR-19. | Any provider logout/back-channel behavior and outage semantics require provider/security/operations review; do not promise it or make PARMAR access depend on an unverified provider behavior. |
| D15 | **APPROVED — outcome only** — Product Owner | Closure, binding revocation, data deletion and truthful retention reporting are distinct; retain no raw provider attributes beyond the approved minimum. | Framework §C.15; APR-12/15/16/17. | Tombstones, classes, retention, backup expiry, deletion evidence and grace remain pending legal/privacy/operations review; acceptance requires custodian-backed status and restore evidence. |
| D16 | **APPROVED — limited scope** — Product Owner | Legacy/Local Demo records remain unmapped until approved owner verification; never infer ownership from attributes or identifier appearance. | Framework §C.16; APR-15/19; migration design. | Mapping evidence, collision quarantine, migration procedure, rollback and restore evidence remain pending; no mapping is authorized by this packet. |

### 3.2 APR-01–APR-20 recorded policy-baseline approval

All rows below have the same recorded authority, scope, and date: **User approval; APPROVED — proposed policy baseline; 2026-11-13**. The source approval explicitly remains subject to security, legal, privacy and implementation gates and says not to claim production authorization.

The approval register also preserves approved ADR outcomes IT-01–IT-15 and Master PRD directions D-01–D-13. Those records remain authoritative within their scopes and are not reopened here. For Account Binding, this includes immutable PARMAR account identity, deferred provider selection, no automatic linking/merging, secure recovery outcomes, per-device session controls, user-scoped memory, strict separation of identity from authorization, and truthful closure/deletion reporting. D-02's shared identity/SSO boundary is settled; the transport, provider, session topology and each product release are not.

| ID | Approved proposed direction | Evidence | Missing decision/evidence and next authority |
|---|---|---|---|
| APR-01 | Individual, user-initiated enrollment as the desired ordinary path; organization/family enrollment deferred; desired methods are Google, Apple, Email OTP, Email + Password, without selecting a provider. | Approval register §§1–2; user approval review. | Provider and assurance comparison, abuse/privacy review and operations owner; PO/Security/Operations before any enrollment route. |
| APR-02 | Fresh, replay-resistant server-verified enrollment proof; an asynchronous pending request cannot authenticate or access data. | Approval register §2; approval review APR-02. | Exact factor, expiry, retention and anti-enumeration evidence; Security/Privacy/Operations before activation or pending storage. |
| APR-03 | One PARMAR-controlled provisioning authority; any administrative facilitation cannot replace user proof; separation of requester/approver for exceptions. | Approval register §2; approval review APR-03. | Named role model, dual control and audited procedures; PO/Security/Operations before staff or activation path. |
| APR-04 | Lifecycle policy direction requires explicit authorities, reasons, independent review, deadlines and appeal; deny unlisted transitions. | Approval register §2; approval review APR-04. | Actual states, transition matrix, named authorities and deadlines; PO/Security/Operations/Privacy before lifecycle implementation. |
| APR-05 | Secure recovery and method replacement require ownership evidence and fresh proof; deny ambiguity; no attribute-only or support-only recovery. | Approval register §2; ADR IT-04. | Recovery factors, thresholds, delays, notifications, abuse controls and appeal; PO/Security/Operations/Privacy. |
| APR-06 | Measurable layered abuse limits, non-enumerating responses, and no attacker-triggered permanent lockout; no numeric values inferred. | Approval register §2. | Evidence-based thresholds, accessibility review, telemetry and response runbook; Security/Operations with PO disposition. |
| APR-07 | Prompt per-device revocation on security/lifecycle changes; pending approvals must be invalidated/revalidated; no numeric propagation value inferred. | Approval register §2; ADR IT-05. | Topology, exact scope/latency, approval authority contract and platform tests; PO/Security/Operations. |
| APR-08 | Action-scoped step-up; separate from recovery, provider linking proof and resource authorization. | Approval register §2. | Exact actions, freshness/assurance and UX; PO/Security/provider review before enforcement. |
| APR-09 | Security notifications for specified enrollment, binding, recovery, lifecycle, revocation and closure outcomes when a safe verified channel exists; no existence leakage. | Approval register §2; framework D11. | Exact events/channels, delivery failure policy, privacy and operational ownership; PO/Security/Operations/Privacy. |
| APR-10 | Durable minimal security audit for listed sensitive events; required audit failure does not produce success; restrictive actions require durable state/outbox; diagnostics cannot substitute. | Approval register §2. | Audit implementation, access/integrity/retention/key design and tested outage behavior; Security/Operations/Privacy and PO residual-risk disposition. |
| APR-11 | No active binding writer until provider approval; eventual linking requires fresh account and method proof, exact unique mapping, intent, notice, recovery/last-method safety and independent testing; no auto-link/merge. | Approval register §2; framework D1–D7; B2. | Provider, proof semantics, lifecycle schema and test evidence; PO/Security/Operations before writer or provider flow. |
| APR-12 | Account ID is permanently reserved to enforce non-reuse; keep its minimum protected tombstone distinct from provider-binding tombstones; no unnecessary claims or credentials. | Approval register §2; ADR IT-01. | Legal/privacy basis, minimization, access, retention/review for each tombstone; Privacy/Legal, Security, Operations and PO before deletion/reuse claims. |
| APR-13 | Closure revokes protected access; cancellation only in an explicitly approved window before irreversible work; `CLOSED` is terminal for routine operations. | Approval register §2; framework D9/D15. | 30 days is a candidate only; decide grace/cancellation/reinstatement after legal/privacy/operations evidence; no grace period is approved as final. |
| APR-14 | Non-active account cannot retain membership-based access; closure revokes memberships/invitations; shared records need a separately named owner. | Approval register §2; ADR IT-06–IT-08. | Workspace operation/owner model, handover, authorization and legal/privacy review; no personal-content access by membership. |
| APR-15 | User-scoped memory; no automatic migration/assignment of legacy or unprofiled data; class-based export/deletion and truthful partial status. | Approval register §2; ADR IT-09/10/15. | Data inventory, custodian, legal/privacy review, export scope, format/timing specifications; no unsupported promise. |
| APR-16 | Per-custodian lifecycle for backup/replica/external copies; restore cannot silently reintroduce deleted data; no numeric expiry inferred. | Approval register §2; recovery/cutover report. | Custodian commitments, key/backup/restore evidence, RPO/RTO and legal review; Operations/Privacy/Security. |
| APR-17 | Access closure and deletion completion are distinct; report only evidenced closure/deletion states, including pending, failed, retained or unverifiable. | Approval register §2. | Custodian acknowledgements, status process and evidence criteria; Operations/Privacy/Security and PO. |
| APR-18 | No standing support access to private content; any exception must be separately authorized, purpose/time-bound, least privilege, notified and audited. | Approval register §2; ADR IT-15. | Whether an exception is needed and the exact dual-control process; PO/Security/Operations/Privacy before any support access. |
| APR-19 | Preserve the approved PARMAR-wide identity/SSO boundary; separately approve each product audience, session topology, authorization and release. | Approval register §§1–2; ADR and Master PRD D-02. | Product-specific route/resource authorization, threat and release evidence; Security/Operations/PO per product. |
| APR-20 | Invitation proposes workspace membership only; it cannot establish identity or personal-data access; family/guardian enrollment remains disabled pending safeguards. | Approval register §2; ADR IT-06–IT-08. | Legal, age/guardian, consent, expiry, role and abuse rules; PO/Security/Operations/Privacy before invitations or family/team onboarding. |

### 3.3 Product Owner residual choices and future-decision triggers

These are **residual details**, not requests to reconfirm D1–D16 or APR-01–APR-20. The baseline approvals remain in force. Rows marked APPROVED record only the exact prior or newly dated Product Owner scope; dependent technical choices and specialist reviews remain outstanding and cannot be overridden by a Product Owner policy choice.

| Packet ID | Status | Exact question and options for the Product Owner | Recommendation and consequence | Dependencies / acceptance |
|---|---|---|---|---|
| PO-01 / D1, APR-01, APR-19 | **APPROVED** | Current decision: keep provider selection deferred. A future selection decision is triggered only after a requirements comparison and specialist review; no provider is selected now. | Preserve the approved deferral. This avoids unsupported selection but leaves production authentication unavailable. | Future selection requires provider comparison, Security/Operations review, verified claims/logout/outage behavior and Gate 6 evidence. No approval request now. |
| PO-02 / D2, D6, Gate 2 | **APPROVED — LIMITED** (2026-11-25) | Product Owner selected issuer+subject as the identity tuple; adapter ID does not split identity ownership. Exact canonicalization, embedded-U+0000 acceptance and migration behavior remain deferred pending evidence. No automatic reassignment is permitted under D2/D6. | Preserves one identity boundary across adapters; unresolved provider-specific normalization and input representation may leave ambiguous identities quarantined. | Provider semantics and Security/data-model review; explicit embedded-U+0000 disposition, schema invariants and independent-connection uniqueness evidence remain required. |
| PO-03 / D7, APR-11 | **APPROVED — LIMITED** (2026-11-25) | Deny unlink of the last independently usable, verified method except through separately approved recovery. | Reduces lockout/takeover risk but can delay unlink until recovery is available. | Recovery/step-up policy, transaction-level recheck and concurrency tests remain required. |
| PO-04 / D8, APR-05/06/08 | **APPROVED — DIRECTION ONLY** (2026-11-25) | Require independent strong-factor/verified-method proof and deny ambiguous recovery. Thresholds, delays, assisted recovery and appeal details remain deferred to specialist review. | Reduces takeover risk; stronger proof may increase lockout/support burden. No numeric thresholds or staff recovery authority are approved. | Threat model, abuse/accessibility analysis, named recovery authority, notice and recovery-drill evidence remain required. |
| PO-05 / D9, APR-04/13 | **APPROVED — LIMITED** (2026-11-25) | Keep the current `ACTIVE`/`DISABLED` states until a reviewed state/authority/appeal matrix is approved. | Prevents unreviewed lifecycle states; closure and suspension workflows remain unavailable pending decisions. | Security/Operations/Privacy review, Gate 2 state constraints, notification and revocation tests remain required. |
| PO-06 / D10, APR-03/18 | **APPROVED — LIMITED** (2026-11-25) | Staff may provide guidance only; no staff ownership assertion or unilateral binding change. | Limits insider/privacy risk but may lengthen exception handling. No staff workflow is authorized. | Named roles, separation of duties, case evidence, notice, audit and independent review remain required for any future exception proposal. |
| PO-07 / D11, APR-09 | **APPROVED — LIMITED** (2026-11-25) | Require durable enqueue before reporting success for ownership-changing events; distinguish queued/delivered/failed. Exact events, verified channels and other failure behavior remain open. | Avoids reporting success before durable notice intent; outages can delay a lifecycle operation. Enqueue is not delivery acknowledgement. | Security/privacy review, delivery simulation, failure-injection tests and Operations ownership remain required. |
| PO-08 / D13, APR-07 | **APPROVED — LIMITED** (2026-11-25) | Revoke affected sessions/approvals fail-closed; set numeric bounds only after measured topology evidence. | Limits stale authority; broad revocation can disrupt users. No numeric propagation bound is approved. | Security/Operations topology and independent session tests remain required; this is not an atomic-fence substitute. |
| PO-09 / D14, APR-19 | **APPROVED** | Current decision: PARMAR local revocation is authoritative; no provider logout promise. Any future provider logout/back-channel feature would require a distinct decision after provider capability review. | Preserve the current boundary; do not imply remote session termination. A future provider failure must not restore PARMAR access. | Future extension requires provider, Security and Operations evidence; Gate 6. No approval request now. |
| PO-10 / D15, APR-12/13/15/16/17 | **APPROVED — DEFERRAL** (2026-11-25) | Preserve permanent PARMAR account-ID non-reuse; defer class-specific retention, tombstone and closure-window decisions pending qualified review. | Avoids unsupported deletion/backup promises. The 30-day closure grace remains only a candidate. | Data inventory, qualified legal/privacy decision, custodian commitments, backup/restore and deletion evidence remain required. |
| PO-11 / D16, APR-15 | **APPROVED** | Current decision: legacy/Local Demo records remain unmapped until approved owner verification. Any future mapping requires a distinct attributable migration decision. | Preserve unmapped state. This avoids guessed ownership but leaves records unlinked. | Future mapping requires named migration authority, per-record evidence, collision quarantine, rollback and restore rehearsal. No migration is authorized now. |
| PO-12 / APR-14/20, IT-06–IT-08 | **APPROVED** | Current decision: family/guardian enrollment remains disabled; invitations convey membership proposals only and never personal-content access or account ownership. | Preserve the approved deferral. This limits family/team features pending safeguards. | Any future expansion requires legal/privacy, workspace authorization and distinct security/release review. No enablement is authorized now. |
| PO-13 / framework §D, B2 §11 | **APPROVED — OPTION A** (2026-11-26) | No product requirement; withdraw “fully primium type” as non-operative. | Preserve the phrase only as historical evidence. No subscription, billing, entitlement, pricing or access-control behavior is introduced or cancelled. | Product Owner decision recorded in this current task; it does not alter future product scope or specialist gates. |
| PO-14 / framework §D, APR-10, B2 §6.8 | **APPROVED — DEFAULT ONLY** (2026-11-25) | Fail closed and report no success by default; consider a narrowly scoped pending outcome only after independent approval. This does not choose audit-store architecture or approve exceptions. | Favors truthful security outcomes; outages may interrupt account operations. A pending path adds delay and operational burden and remains unapproved unless separately reviewed. | Independent Security/Operations approval of store ordering, holds and failure controls; APR-10 compliance; failure-injection and recovery evidence remain required. |

### PO-13 decision brief

**Status:** APPROVED — PRODUCT OWNER OPTION A (2026-11-26).
The exact historical phrase “fully primium type” is withdrawn as non-operative.
This disposition is separate from D1–D16 and APR-01–APR-20 and does not add,
cancel or interpret any PARMAR Premium or future product scope.

**Repository evidence and boundaries:**

- The phrase appears in the B2/B3 proposals and approval packet, but not in
  the pre-existing D1–D16 framework, APR-01–APR-20 approval record, tenancy
  ADR or Master PRD as a defined subscription requirement.
- The [Subscription Settings panel](./interface/static/index.html) says no
  billing provider is configured, marks the feature unavailable, and says no
  billing status is inferred. The [README account-settings contract](./README.md)
  says account-level subscription/billing preferences are unavailable and no
  `/api/settings` endpoint or production account owner exists.
- The current repository search found no PARMAR user subscription/entitlement
  API, billing provider or account entitlement store. The
  [provider-readiness record](./chat/readiness.py) discusses upstream model
  provider billing/quota only; it is not a PARMAR customer subscription or
  feature entitlement.
- Authentication/identity does not itself grant product capability access.
  Any future paid entitlement would be a separate authorization contract; no
  browser preference, provider email claim or account-binding row is an
  entitlement authority.

**Selected Option A consequences:** no subscription, billing, entitlement,
pricing or access-control behavior is introduced. The existing unavailable
subscription UI remains unchanged. The phrase is retained only in historical
evidence and must not be used as a future entitlement or implementation
requirement. It does not cancel or otherwise define PARMAR Premium or any
future product scope.

**No specialist dependency is created by PO-13 Option A.** A future Product
Owner decision adding entitlement or billing policy would require a separate,
attributable policy decision and applicable specialist reviews.

### 3.4 Independent Security, Operations, data-model and other approvals

| ID | Status / approving authority | Exact review or decision required | Available evidence | Missing evidence and acceptance criterion |
|---|---|---|---|---|
| SEC-01 / Gate 1 | **PENDING** — independent Security reviewer | Record review of the bounded D1–D16/APR policy scopes, residual security requirements and §D dispositions without expanding approved scopes. | Framework §§C–G; APR approval record. | Signed/attributable review, owner assignment, unresolved-item dispositions and no unapproved default labeled approved. |
| SEC-02 / Gate 2 | **PENDING** — independent Security reviewer | Approve exact B2 security invariants, binding ownership/immutability, proof references, audit model, lifecycle states and failure semantics. | B2 is a detailed proposal; no B2 acceptance record. | Independent model review plus prototype/equivalent evidence for schema constraints, rollback and independent-connection races; all required invariants pass. |
| SEC-03 / Gate 3 | **PENDING** — Security | Review complete threat/abuse matrix, controls, test mappings, residual risks and owners. | B2 §8, B3 §8.1 and this packet's draft matrix. | Security findings and disposition recorded per TM row; mitigation owner and evidence required; unresolved risks explicitly left open. |
| SEC-04 / D3–D4, Gate 3/6 | **PENDING** — Security, identity/data-model owner and provider-capability owner | Define proof freshness, `auth_time`/`max_age`/`acr`, issuer/subject semantics including embedded U+0000 behavior, and CSRF/state/replay/PKCE rules. | Current login implementation has OIDC state/nonce/PKCE/JWT checks but does not implement an approved link flow or a reviewed assurance contract. Current `ProviderIdentity` and B2 SQL reject embedded U+0000; SQLite `length(TEXT)` stops at U+0000, but that behavior is unreachable under the explicit rejection check. Whether rejection is accepted provider policy remains deferred. | Written accepted claim/input contract and a decision on U+0000 acceptance; provider evidence and focused failure/replay tests. |
| SEC-05 / D12, APR-10 | **PENDING** — Security | Approve audit event classification, access, integrity/order, key custody, retention and failure behavior. | B2 describes audit options; current JSONL logger is not a protected lifecycle audit system. | Chosen policy/architecture, failure-injection proof and independent integrity/access review. |
| SEC-06 / Runtime finding | **PENDING** — independent Security reviewer and application owner | Confirm closure of the separate anonymous Local Demo external chat/research-dispatch finding against current source and deployment scope. | Current anonymous HTTP handling forces `local-demo`; external chat and search services deny dispatch without execution authorization. Four focused fake-provider/search tests passed on 2026-11-25. | Independent Security confirmation and deployment/configuration review remain; no live provider call was made. This finding is separate from account binding and does not clear the atomic-fence NO-GO. |
| SEC-07 / Atomic fence | **BLOCKED** — Security and Operations | Independently prove any proposed protected-operation atomic fence before changing existing runtime NO-GO. | Runtime audit and recovery/cutover report preserve unconditional NO-GO; shared-authority migration design is proposal only. | Reviewed architecture and race/crash/downstream side-effect evidence; no account-binding gate or version counter substitutes for it. |
| OPS-01 / Gate 1, APR-03/04/07/09 | **PENDING** — accountable Operations owner | Accept lifecycle, recovery, session invalidation, notice, reconciliation and incident ownership; name responsible operators. | Policy register specifies role classes but no attributable operational approval or complete ownership assignment. | Named accountable/backup roles, runbooks, alerts, escalation and tested response. |
| OPS-02 / Gate 2, APR-10/11 | **PENDING** — Operations | Review topology, database/file access, worker leases/retries, audit/notification outages and cross-store behavior. | B2 proposed same-host SQLite and reconciliation behavior; production topology is unproven. | Approved deployment profile, contention/failure evidence, operational thresholds, monitoring and recovery runbooks. |
| OPS-03 / Gate 7, APR-16 | **BLOCKED** — Operations | Approve migration authority, all-writer quiescence, old-writer exclusion, backup/restore, rollback/forward-recovery and RPO/RTO. | Recovery/cutover report: NOT PROVEN. B2 and shared-authority migration documents specify proposed backup/restore and rollback steps, but there is no approved/implemented procedure, shared migration implementation, quiescence control or manifest startup gate. | Named dual-authorized migration owner, approved runbook, tested restore, cutover/rollback evidence, manifest/path authority gate and no stale writers. |
| OPS-04 / Gate 7 | **PENDING** — Operations and Security | Approve provider outage, revocation, notification, recovery, alert and incident runbooks on supported topology. | Documents state requirements; no operational exercise or approved topology evidence. | Runbook review, alert tests/tabletop, restore/recovery exercise, explicit release sign-off. |
| DM-01 / Gate 2 | **PENDING** — Identity/data-model owner | Accept or reject the exact B2 Option B logical schema, transaction boundaries, binding lifecycle, audit/outbox semantics, migration compatibility, verifier-configuration provenance where adapters present the same issuer/subject tuple, embedded-U+0000 policy, and provider-subject at-rest representation. | [B2 schema](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§2.1, 4–7; [B3 plan](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) §§2, 8; PO-02 fixes identity ownership to issuer+subject regardless of adapter but defers canonicalization/migration. Current application and proposed SQL both reject embedded U+0000. The synthetic DDL stores `subject_key` as ordinary SQLite `TEXT` for uniqueness tests only; it does not implement the logical protected/reference-only classification or an exact-match production storage strategy. | Attributable data-model decision; approved schema/migration/rollback contract; invariant evidence that adapter IDs cannot split ownership; explicit U+0000 policy disposition; approved subject protection, key/rotation/backup handling and exact-match uniqueness/lookup strategy; specify retention of multiple verifier-provenance references. |
| MIG-01 / Gate 2/7 | **BLOCKED** — named migration authority; Operations/Security | Approve any real-data mapping, manifest, quarantine disposition, cutover, rollback or restore. | Migration design proposal; recovery/cutover report says controls NOT PROVEN. | Verified ownership evidence, full inventory, clean backup/restore, all-writer quiescence and explicit dual authorization. No migration is authorized here. |
| PRIV-01 / APR-05/12/15–18 | **PENDING** — qualified Privacy/Legal reviewer | Review provider subject/evidence data, lawful purpose, minimization, notices, access, retention, tombstones, closure, backup and support exceptions. | APR baseline sets constraints; no completed legal/privacy approval evidenced in reviewed account-binding materials. | Attributable review and approved per-class retention/deletion and user-facing statements. |
| PROV-01 / APR-01/11/19 | **BLOCKED** — provider owner plus Security/Operations | Compare provider claims, issuer/subject stability, logout/revocation, outage, region and test environment. | OIDC source exists, defaults disabled; no provider or live binding evidence is selected. The workflow deliberately leaves the Keycloak image unset and will not pull or start it until an exact reviewed digest is configured. | Record provider/image comparison and approval of the exact test image/provenance, plus exact test realm/config evidence before Gate 6; production selection remains a later explicit decision. |
| REL-01 / Gate 7 | **BLOCKED** — accountable release owner, Security and Operations | Approve exact release scope and supported deployment after all applicable gates pass. | No release approval or production readiness evidence. | Complete Gate 1–7 evidence, independent review, production change authorization and release record. |
| PO-RISK / Gate 3 | **PENDING** — Product Owner | For each Security-reviewed residual risk, explicitly accept, reject, or require mitigation; no blanket acceptance. | No residual-risk disposition is recorded for the B2 account-binding threat model. | Security's risk statement, impact, treatment, owner and evidence for each TM row; explicit attributable PO response. |

### 3.5 Reviewer-ready decision requests and consequences

The following are request cards, not approval records. An accountable individual
must be assigned by each authority; the repository records authority classes,
not named specialist reviewers. Each reviewer should return **accepted**,
**rejected**, or **conditional**, with scope, rationale, evidence reviewed,
findings, reviewer identity and date. A missing response leaves the item
PENDING/BLOCKED. No acceptance below authorizes implementation, execution, or
production activation unless a separate authorization expressly says so.

| Request | Authority; evidence to review; exact decision and acceptance criterion | Consequence of acceptance | Consequence of rejection/conditions |
|---|---|---|---|
| SEC-01 | Independent Security reviewer. Review D1–D16 scope and §D residual matters in the [decision framework](./ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md) §§C–E, [APR register](./PARMAR-ACCOUNT-PROVISIONING-APPROVAL-REGISTER.md), and this packet §§3–4. Decide whether Security's Gate 1 review is complete without extending PO decisions. Accept only with attributable disposition of required controls, review findings, and owner assignments. | Records only Security's Gate 1 review; Operations review, other gates, and implementation authorization remain outstanding. | Gate 1 stays NOT PASSED; correct findings and resubmit; no implementation. |
| SEC-02 | Independent Security reviewer. Review [B2](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§2–8, [B3](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) §§2–8, [Gate 2 harness](./tests/account_binding_b2_schema_validation.py) (58 synthetic tests passed under disposable authorization), and the U+0000/Unicode/type findings and plaintext subject limitation in this packet. Decide whether the proposed security invariants, failure handling and validation plan are acceptable. Accept only with explicit dispositions for unresolved assumptions and adequate independent evidence. | Security concurrence on the reviewed proposal and available synthetic evidence only; DM/Operations acceptance and remaining Gate 2 evidence remain required. | Gate 2 remains NOT PASSED; revise the proposal or provide the missing independent evidence. |
| SEC-03 | Security. Review [B2 threat model](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §8, [B3 threat/test mapping](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) §8.1 and this packet §5 (TM-01–TM-20). Decide mitigation adequacy and residual-risk disposition for each applicable threat; accept only with named owners and per-threat evidence/remaining-risk statements. | Security threat review may be recorded; PO-RISK dispositions are still separate and must be per threat. | Gate 3 stays NOT PASSED; mitigation owners revise affected items; no lifecycle implementation. |
| SEC-04 | Security, identity/data-model owner and provider-capability owner. Review [current OIDC implementation](./oidc.py#L578), [B2 input/identity design](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§2.1, 4 and 7, and framework D3–D4. Decide proof freshness/claim semantics, issuer/subject handling (including U+0000), and CSRF/state/nonce/PKCE requirements. Accept only as a written, scoped contract with provider capability evidence and test criteria. | Contract may inform a later authorized link design; it does not select a production provider or enable OIDC. | Provider/link flow remains unavailable; Gate 3/6 remain NOT PASSED/NOT EXECUTED. |
| SEC-05 | Security. Review [B2 audit alternatives](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §6.8 and [current JSONL logger](./audit/decision_logs.py#L19). Decide required event classes, access, integrity/order, key custody, retention constraints and fail-closed behavior. Accept only with a chosen, testable policy and outage/integrity acceptance criteria. | Audit requirements are approved for design; implementation, Privacy/Legal and Operations review remain outstanding. | No ownership-changing operation may be implemented as successful without a reviewed audit policy; Gate 2/3 remain NOT PASSED. |
| SEC-06 | Independent Security reviewer and application/deployment owner. Review [runtime NO-GO audit](./PARMAR-RUNTIME-NO-GO-INDEPENDENT-AUDIT.md), [Local Demo route](./interface/futuristic_app.py), [`test_local_demo_chat_remains_anonymous_and_functional`](./tests/test_http_security.py#L317), [`test_anonymous_chat_research_cannot_dispatch_search_or_external_chat`](./tests/test_http_security.py#L355), [`test_external_chat_requires_trusted_execution_revalidation_before_dispatch`](./tests/test_chat_service.py#L862), and [`test_search_requires_trusted_execution_revalidation_before_provider_dispatch`](./tests/test_research.py#L352). Decide whether anonymous external dispatch is closed for the reviewed deployment scope. Accept only with source, focused-test, configuration and exposure review. | Closes only the separately scoped Local Demo finding; it does not clear the protected-operation atomic-fence NO-GO or pass an Account Binding gate. | Keep the finding open and external dispatch blocked; remediate and obtain re-review. |
| SEC-07 | Security, Operations and protected-operation owner. Review [runtime NO-GO audit](./PARMAR-RUNTIME-NO-GO-INDEPENDENT-AUDIT.md), [core identity contract](./PARMAR-CORE-IDENTITY-CONTRACTS.md#L152) and [shared-authority migration proposal](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md). **No fence design or execution evidence is currently submitted for approval.** First specify acceptable authority/fencing, race, crash and downstream-effect evidence; then review a separately prepared design. | No approval can be recorded from this package alone. A later accepted design/evidence package may support a distinct NO-GO disposition, never automatic production enablement. | Existing unconditional NO-GO remains; protected operations stay blocked. |
| OPS-01 | Accountable Operations owner. Review [B2 operational sections](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§6, 9–10, [B3 operations dependencies](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) §§10–11 and this packet §7. Assign lifecycle, reconciliation, recovery, notification and incident roles/on-call coverage. Accept only with named accountable and backup owners plus runbook/escalation evidence. | Operations ownership is recorded for the scoped duties; production topology and Gate 7 exercises remain open. | Gate 1/7 remain NOT PASSED; no operationally dependent lifecycle implementation. |
| OPS-02 | Operations. Review [B2 persistence/failure model](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§2.5, 6–7 and [recovery/cutover report](./PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md). Decide supported topology, database/file authority, concurrency profile, worker/retry/lease ownership and cross-store outage handling. Accept only for a named topology with measurable checks and monitoring/recovery criteria. | Topology/failure assumptions may be used for a later implementation plan; no Gate 2/7 pass without evidence and other approvals. | Keep topology unsupported/unknown; no migration, deployment or cross-store implementation. |
| OPS-03 | Operations and named migration authority, with Security review. Review [migration design](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md), [recovery/cutover report](./PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md) and B2 §10. Decide the migration-control policy: dual authority, quiescence, stale-writer exclusion, manifest/path controls, backup/restore, rollback/forward recovery and RPO/RTO. Accept only after a named owner, reviewed runbook and independent restore/cutover evidence are supplied. | Can approve a bounded migration plan only; actual migration still requires separate explicit execution authorization. | Migration remains BLOCKED; no cutover, restore or production data access. |
| OPS-04 | Operations and Security. Review [B3 operational readiness](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) §§10–11, [Keycloak workflow](../.github/workflows/parmar-keycloak-oidc-e2e.yml), and recovery report. Decide alerting, provider outage, revocation, notification, recovery and incident runbooks on the named topology. Accept only after assigned responders, tested alert paths/tabletop and recovery criteria. | Operational design review only; no provider run or production release authorization. | Gate 6/7 remain NOT PASSED/NOT EXECUTED; no live run or activation. |
| DM-01 | Identity/data-model owner. Review [B2](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§4–7, [B3](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) §§2, 8, and the executed [harness](./tests/account_binding_b2_schema_validation.py). Decide Option B cardinality, ownership/history, lifecycle/version rules, audit/outbox and reconciliation semantics, verifier-provenance retention across adapters, migration compatibility, embedded-U+0000 representation/validation, and acceptable SQLite TEXT-affinity coercion. Accept only with an explicit schema contract and evidence covering database constraints, application type guards, length semantics, concurrency and rollback. | Records data-model acceptance only; Gate 2 also needs Security/PO/Operations and remaining independent evidence. | Gate 2 stays NOT PASSED; revise the design or reject the prototype evidence. |
| MIG-01 | Named migration authority, Operations and Security. Review [migration design](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md), [recovery/cutover report](./PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md), B2 §10 and D16. Decide admissible source inventory, owner evidence, quarantine, manifest, all-writer quiescence, cutover/rollback and restore acceptance. Current package lacks verified inventory, authorized runbook and restore evidence. | May accept a migration plan only after missing evidence is supplied; actual run remains separately authorized. | Migration and Gate 7 remain BLOCKED; records remain unmapped. |
| PRIV-01 | Qualified Privacy/Legal reviewer. Review APR-05/12/15–18, [B2 classifications/retention](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§5, 9–10, [policy decisions](./PARMAR-ACCOUNT-BINDING-POLICY-DECISIONS.md), and recovery/cutover statements. Decide lawful purpose, minimization, notices, access, evidence/subject retention, tombstones, backup expiry, deletion claims and support exceptions. Accept only with per-data-class decisions and accurate user-facing statements. | Privacy/Legal disposition is recorded for scoped data handling; technical controls and operational evidence remain required. | No binding/recovery data collection or retention claim is approved; Gate 7 remains NOT PASSED. |
| PROV-01 | Provider owner plus Security and Operations. Review [OIDC verifier](./oidc.py#L578), [manual Keycloak workflow](../.github/workflows/parmar-keycloak-oidc-e2e.yml), [bootstrap](./tests/keycloak_e2e_bootstrap.py), and the fail-closed unset image configuration. Decide test-image provenance, test issuer/client/claims, subject stability, logout/outage semantics and isolation. Accept only with an exact immutable digest and provenance, explicitly scoped disposable environment, and separate review; production provider selection is a separate decision. | Allows a later authorized isolated test configuration only; no workflow run or production provider approval is implied. | Gate 6 stays NOT EXECUTED; do not set the image, pull/run it or contact a provider. |
| REL-01 | Accountable release owner, Security and Operations. Review the completed Gate 1–7 evidence register, exact deployment/configuration, recovery evidence and release candidate when available. Decide a specific release scope only after every mandatory gate passes. | Only an attributable scoped release decision after complete evidence may authorize the release under its separate change process. | No production authentication, deployment or release; status stays NOT READY. This is not yet a signable release request because prerequisite evidence is absent. |
| PO-RISK | Product Owner, **only after Security has completed the corresponding TM review**. Use this packet §5, one TM row at a time. Decide **accept**, **reject**, or **require mitigation** for each residual risk, recording impact, treatment, owner, evidence and rationale; blanket acceptance is not accepted. | Records only that specific residual-risk disposition; it does not replace Security, Operations, Privacy/Legal, DM, provider or release approval. | Rejected/conditional risks return to named mitigation owners; Gate 3 remains NOT PASSED and dependent implementation/activation stays blocked. |

PO-13 is approved as Product Owner Option A, 2026-11-26: withdraw
“fully primium type” as non-operative, with no cancellation or definition of
PARMAR Premium and no subscription or entitlement implementation. This brief
does not reopen D1–D16, APR-01–APR-20 or recorded limited Product Owner choices.

#### Conditional Product Owner residual-decision requests

These are requests to decide only after the named specialist evidence is
returned. They do not reopen the already-approved portions in §3.1–3.3. Until
the prerequisite evidence exists, the conservative current direction remains
in force.

| PO item | Exact decision requested and prerequisite evidence | Accept only if | If deferred/rejected |
|---|---|---|---|
| PO-02 / D2, D6 | Choose exact issuer/subject canonicalization and embedded-U+0000 acceptance after provider semantics, data-model review, SQL/application parity analysis and migration-impact evidence; preserve the issuer+subject ownership tuple regardless of adapter. | Signed rule is implementable consistently in verifier, application, SQL, migration and tests; no identity split or automatic reassignment. | Keep unambiguous exact values only; quarantine unresolved identities; no schema acceptance or migration. |
| PO-03 / D7 | Define “independently usable, verified method” and the recovery exception after Security/Operations provide last-method, race and recovery evidence. | Definition is testable in the final transaction and has a separately approved recovery path. | Last-method unlink remains denied outside any already separately approved recovery. |
| PO-04 / D8 | Decide recovery factors, thresholds/delays, assisted recovery and appeal only after Security/Privacy/Legal/Operations provide abuse, accessibility, notice and drill evidence. | Explicit evidence-based limits, authority, user notice and appeal are approved; ambiguous recovery still fails closed. | No assisted recovery or threshold is inferred; deny ambiguous recovery. |
| PO-05 / D9 | Decide additional lifecycle states, transition authority, cancellation/grace, reinstatement and appeal after Security/Operations/Privacy review and state-invariant evidence. | Every transition has actor, preconditions, invalidation, notice, audit and appeal behavior. | Keep only current `ACTIVE`/`DISABLED`; no closure/suspension workflow is enabled. |
| PO-06 / D10 | Decide whether any exceptional staff role/process is ever allowed after role/SoD, privacy, audit and support-boundary review. | Explicit least-privilege scope, dual control, case evidence, notice, expiry and independent audit are approved. | Support remains guidance-only; no staff ownership assertion or unilateral binding change. |
| PO-07 / D11 | Decide lifecycle event/channel and delivery-failure policy beyond the approved durable-enqueue direction after Privacy/Security/Operations establish safe verified channels, leakage tests and outage behavior. | Event/channel matrix is privacy-safe; queued/delivered/failed states and user-visible outcomes are testable. | Do not claim delivery; do not expand the already-approved enqueue-before-success scope. |
| PO-08 / D13 | Set numeric session/approval invalidation bounds after Operations supplies measured topology/failover evidence and Security reviews race tests. | Bound is measurable on the approved topology and includes failure behavior; it is not represented as an atomic execution fence. | No numeric bound is claimed; fail-closed invalidation direction remains. |
| PO-10 / D15 | Decide per-class retention, tombstones, closure grace and backup expiry after qualified Privacy/Legal review, data inventory and custodian-backed restore/deletion evidence. | Each data class has lawful purpose, period, backup/deletion treatment and truthful user-facing statement. | Retention remains deferred; the 30-day closure grace remains a candidate only. |
| PO-14 / APR-10 | Decide whether any bounded pending outcome is acceptable only after Security/Operations select store ordering, hold controls, recovery and failure-injection evidence. | A narrowly scoped pending state has explicit expiry, operator recovery, truthful UX and no authority bypass. | Preserve fail-closed/no-success default; no exception path is implemented. |

### 3.7 B2 security and data-model decision briefs

| Brief | Recommended position | Alternatives | Consequences | Required authority/evidence |
|---|---|---|---|---|
| U+0000 | Reject before Python construction and SQL parameter binding. | Preserve as opaque text; reject by provider only; quarantine. | Safest parity and log safety; may reject a provider value or require provider migration. | DM-01, Security and provider-capability owner; provider claim compatibility and migration impact. |
| Unicode normalization | Retain exact Unicode code points until separately approved; NFC/NFD canonical equivalents remain distinct. | NFC normalize before lookup/storage; NFD normalize; context-specific provider rules. | NFC preserves one canonical form but changes existing keys and requires collision/migration analysis. Provider compatibility varies. | DM-01, provider owner and Security; collision test matrix and migration/reconciliation plan. |
| TEXT affinity and malformed types | Exact Python `str` issuer/subject and exact Python `int` binding versions at adapter boundary; SQL constraints and affinity are defensive only. | Strict SQLite tables; quarantine; provider-specific coercion. | Reduces coercion ambiguity but strict tables may not run on older SQLite; coercion at adapter is still required for direct callers. | DM-01 and Security; runtime SQLite version, adapter inventory and direct-write threat evidence. |
| Schema privilege | Separate application and migration/schema roles; application role cannot create/drop tables, indexes or triggers; filesystem/database replacement denied to untrusted writers. | Shared trusted schema owner; application DDL privileges; external database policy only. | Least privilege improves trigger/constraint integrity; migration operations become slower and require dual control. | Operations and Security; deployment topology, role inventory and migration runbook. |
| Binding-version | Exact positive Python integer, stale update rejected by `old_version + 1` trigger, no state-only version increment. | Numeric string coercion; server-generated version only; optimistic timestamp. | Exact integers are deterministic; application and SQL value boundaries must agree for direct adapters. | DM-01 and Security; type test matrix and direct-WRITE threat evidence. |

### 3.8 Specialist review packages

#### Security review package

- **Decision:** approve the synthetic and future production trust boundary for SQLite foreign-key initialization, trigger/schema modification, direct SQL writers and identity validation.
- **Evidence:** 58 synthetic B2 tests plus the OIDC, identity, session, approval, memory and conversation connection-path tests; `_connect()` and repository factories enable and verify foreign keys; raw connections are intentionally not trusted.
- **Recommended option:** application-only lifecycle writers, separate migration authority, and least-privilege OS/container/process controls. Do not rely on a SQLite trigger as protection from a process able to replace/drop schema objects.
- **Alternatives:** shared database owner; application DDL privilege; external database authorization only.
- **Consequences:** least privilege and migration quiescence reduce bypass risk but require named operational ownership and controlled tooling.
- **Authority:** independent Security reviewer plus application owner. No approval is recorded until attributable written acceptance.

#### Data Model review package

- **Decision:** approve final issuer/subject Unicode/NUL/type contract and migration compatibility.
- **Evidence:** `ProviderIdentity` rejects embedded U+0000 and non-string values; SQL rejects NUL and non-text identity columns; NFC/NFD remain distinct; direct numeric/float values expose SQLite TEXT affinity and must be rejected by the adapter. The synthetic DDL stores subject text in plaintext and does not implement at-rest protection.
- **Recommended option:** reject U+0000; preserve exact Unicode until provider compatibility is established; require exact Python `str` and exact positive `int` values at the adapter boundary.
- **Alternatives:** NFC normalization, NFD normalization, provider-specific normalization, quarantine.
- **Consequences:** normalization can merge or split identities and requires migration collision analysis. Rejection can block incompatible providers or legacy records.
- **Authority:** Identity/Data-Model owner with Security, Privacy/Legal and provider-capability owner; approve at-rest representation, key custody/rotation/backup and exact-match uniqueness before production schema acceptance.

#### Operations review package

- **Decision:** approve filesystem, process, backup, migration and incident controls for the SQLite topology.
- **Evidence:** existing stores use mode `0600` and per-run or per-path isolation patterns; synthetic tests prove foreign-key and lifecycle behavior only on one host.
- **Recommended option:** dedicated OS user/container, mode `0600` database and parent-directory controls, symlink rejection, read-only backups, all-writer migration quiescence and dual-authority migration procedures.
- **Alternatives:** shared OS account; network filesystem; application-only migration locking; external database role system.
- **Consequences:** stronger isolation is compatible with SQLite but prevents low-privilege workers from sharing schema ownership. Network SQLite does not establish the reviewed topology.
- **Authority:** accountable Operations owner with Security and named migration authority.

#### Provider compatibility review package

- **Decision:** approve issuer/subject canonicalization, claim stability and exact provider behavior.
- **Evidence:** OIDC implementation validates issuer/audience/subject; B2 ownership is issuer+subject regardless of adapter; synthetic B2 tests preserve Unicode code points and reject NUL.
- **Recommended option:** no provider selection or normalization change until exact provider claims and canonicalization rules are documented.
- **Alternatives:** provider-specific issuer normalization; global NFC/NFD normalization; opaque verifier claim references.
- **Consequences:** canonicalization affects identity uniqueness and migration; logout/revocation remains provider-specific and does not replace PARMAR-local revocation.
- **Authority:** provider owner plus Security and Operations.

### 3.6 Separate authorization requests

The decisions above review policy or design. The following operational
authorizations are distinct, narrow requests and are **not granted by this
packet**. Each requires attributable scope, actor, date, limits and stop
conditions in the repository approval record.

| Authorization request | Required authority and prerequisite package | Exact scope if granted | If absent or rejected |
|---|---|---|---|
| AUTH-B2-SYNTHETIC | Product Owner plus named Identity/Data-Model, Security and Operations authorities; authorization `3509b65517d31ed63c2c2f50c22c0fc8f8d7cb140ad5487cbad7bc4b19180ea8` covered the disposable synthetic run already executed. | One disposable, synthetic SQLite database run with no configured application database, user-derived data, migration, provider or production service. | Prototype evidence is recorded but does not pass Gate 2 or authorize any real implementation. |
| AUTH-BINDING-IMPLEMENTATION | Product Owner's explicit implementation authorization plus accountable Engineering owner, after Gates 1–3 and applicable Security/DM/Operations/provider decisions are recorded. | Only the enumerated lifecycle stages in the approved B3 plan; excludes migrations, live provider operations, production settings and clearing the atomic-fence NO-GO unless each receives separate authorization. | No application lifecycle implementation; OIDC remains production-disabled. |
| AUTH-MIGRATION | Named migration authority with Operations and Security dual authorization, accepted migration plan, inventory, owner evidence, quiescence proof, verified backup/restore and rollback/forward-recovery criteria. | A precisely identified environment and dataset for the approved migration/cutover window only. | No DDL against configured/production data, mapping, cutover or restore. |
| AUTH-RESTORE-DRILL | Operations/data custodian with Security/Privacy as applicable; isolated target, approved backup, data classification and cleanup/retention instructions. | Restore only the named protected backup into the named isolated environment for the approved evidence purpose. | No restore operation; Gate 7 remains NOT PASSED. |
| AUTH-KEYCLOAK-E2E | Provider owner, Security and Operations approve the exact image provenance, disposable realm, runner/secrets, network isolation, scenarios and cleanup evidence; a protected GitHub Environment with required reviewers and the explicit `RUN-LIVE-E2E` dispatch confirmation provide separate operator authorization. | Manual workflow against only the approved disposable Keycloak image/realm with ephemeral credentials; no production provider or credentials. | The workflow fail-closes while the image is unset and environment approval is external; do not pull/run it or contact a provider; Gate 6 remains NOT EXECUTED. |
| AUTH-PRODUCTION-OIDC | Product Owner, Provider owner, Security, Operations and accountable Release authority after every mandatory Gate 1–7 criterion and deployment/change control is accepted. | Exact approved production issuer/client/audience, deployment and release scope recorded in the change authorization. This does not clear the separate protected-operation atomic-fence NO-GO. | Keep `PARMAR_OIDC_ENABLED` false and production authentication disabled. |

## 4. Gate-by-gate assessment

### Gate 1 — Policy approval

- **Exact criterion:** all 16 decisions and each framework §D matter have a disposition, accountable owner, required approvers and recorded status; recommendations are not mislabeled approved; required Security/Operations reviews are recorded.
- **Evidence:** bounded D1–D16 approval entries in framework §§C.1–C.16; recorded APR-01–APR-20 proposed-policy-baseline approval dated 2026-11-13; remaining matters are listed in framework §D and §§3.3–3.4 here.
- **Gap:** no attributable Security or Operations review is evidenced. Some §D rows identify role-level owners and explicit deferred status but still lack a named accountable individual and the required specialist disposition.
- **Status: NOT PASSED.** Do not ask the Product Owner to reapprove D1–D16 or APR-01–APR-20. The remaining Product Owner decisions are only those explicitly listed in §3.3 and must retain the approved bounds.

### Gate 2 — Identity/binding data-model approval

- **Exact criterion:** approve cardinality, exact issuer/subject normalization independent of adapter ID, immutable binding ownership/history, lifecycle states, audit history, session invalidation, cross-store failure semantics and protected subject storage; review schema/migration/rollback and invariant checks; decide whether the tested U+0000 rejection is accepted provider policy; show independent-connection concurrency permits at most one mapping and no partial second mapping.
- **Evidence:** B2 proposes Option B and describes constraints, transactions, failure handling and migration. The authorized synthetic harness executes the DDL in a disposable temporary database; its latest 58-test run covers foreign keys, lifecycle/version guards, uniqueness, same-process races using separate SQLite connections, interrupted transaction and process-exit reopen, SQLite backup/restore, raw-connection initialization, SQLite affinity, NUL rejection, Unicode preservation and schema-privilege boundaries. A safe in-memory probe confirmed SQLite `length(TEXT)` behavior, which is not an acceptance mismatch while the SQL check rejects U+0000. No B2 acceptance record, independent reviewer record, real migration, operational restore rehearsal or supported-topology independent-process evidence is recorded.
- **Gap:** obtain DM-01, Security, Privacy/Legal and Product Owner review of policy implications, U+0000 handling and subject-at-rest protection; Operations topology/failure review; and remaining independent-process, migration and restore evidence in §6 or equivalent evidence. Prototype authorization and tests are not Gate 2 acceptance.
- **Status: NOT PASSED.** Only disposable synthetic DDL was executed; no production/application DDL, migration or schema acceptance is claimed.

### Gate 3 — Threat model and abuse-case review

- **Exact criterion:** takeover, session theft, replay, CSRF, provider compromise, duplicate/concurrent binding, recovery abuse, last-method unlink, insider abuse, notification/audit outage and state races each have a mitigation and accountable owner; Security records review and the Product Owner accepts/rejects residual risk.
- **Evidence:** B2 §8 and B3 §8.1 provide design threats and planned checks; §5 here adds a review matrix with owner roles, mapped evidence and residual-disposition fields.
- **Gap:** the matrix remains a proposed review aid; no independent Security disposition, named implementation/operations owners or per-threat Product Owner residual-risk decisions after Security review exist. The Local Demo dispatch path has source/test mitigation evidence; independent closure remains pending.
- **Status: NOT PASSED.**

### Gate 4 — Link/unlink/recovery implementation

- **Exact criterion:** no account from unknown identity; approved proof, confirmation, CSRF, conflict, audit/notice and invalidation behavior; denied operations leave no partial state.
- **Evidence:** source has login-oriented OIDC controls and an inactive binding lookup foundation; no binding lifecycle writer or link/unlink/recovery workflow is established.
- **Gap/status:** **NOT PASSED.** Implementation is expressly unauthorized and depends on Gates 1–3, provider/assurance decisions and a separate implementation authorization.

### Gate 5 — Focused automated security tests

- **Exact criterion:** reproducible positive/negative authorization, stale/replayed proof, conflicts, concurrency, disabled status, last-method, enumeration, audit/notice failure and session invalidation evidence, with independent failure review.
- **Evidence:** the current full offline suite passed `1084 passed, 12 skipped, 5 subtests passed`; the offline Keycloak bootstrap/live-gated suite passed `28 passed, 12 skipped`. All 12 skips are live-only scenarios and no provider was contacted. Existing tests cover current behavior and synthetic fixtures only; they do not prove proposed B2 lifecycle implementation or Gate 5 acceptance.
- **Gap/status:** **NOT PASSED.** Tests follow authorized implementation and must map to the final threat matrix; do not claim coverage from test names or planned commands.

### Gate 6 — Isolated live Keycloak E2E

- **Exact criterion:** every required live scenario passes in a disposable isolated realm; cleanup/provenance are verified; no production credentials/configuration are used. The existing workflow is manual and covers login, not proposed binding lifecycle.
- **Evidence:** test/bootstrap files and a manual-dispatch [Keycloak workflow](../.github/workflows/parmar-keycloak-oidc-e2e.yml) exist. Static inspection confirms run-scoped credentials/databases, an internally isolated container network, loopback-only publication, ownership-checked cleanup, and login/unbound/disabled-account session assertions. The infrastructure shell script passes `bash -n`; PyYAML 6.0.3 parsed all 8 workflow files. Actionlint was unavailable for this continuation; the earlier Actionlint check covered only 7 workflow files before the latest workflow edits. The exact image selection/provenance approval is absent, and the workflow deliberately leaves `PARMAR_KEYCLOAK_IMAGE` unset. No live run or account-binding link/unlink/recovery scenario evidence exists.
- **Gap/status:** **NOT EXECUTED / NOT PASSED.** Requires implemented and separately authorized flows, isolated runner/secrets, provider approval and cleanup evidence. OIDC remains production-disabled.

| Required scenario | Exact acceptance outcome | Required evidence | Status |
|---|---|---|---|
| Successful pre-bound account login | Real id-token exchange creates only the correct trusted session for the pre-bound account. | Isolated test realm, exact issuer/client provenance, run log and account/session evidence. | NOT EXECUTED |
| Unknown/unbound identity | No account, session or binding is created; safe generic rejection. | Live unknown subject response and database/run evidence. | NOT EXECUTED |
| Duplicate/conflicting identity | Generic rejection; no reassignment or duplicate mapping. | Lifecycle-enabled conflict/concurrency result and transaction evidence. | NOT EXECUTED |
| Invalid token/signature | Authentication denied; no session. | Live invalid/tampered token and JWKS run evidence. | NOT EXECUTED |
| Issuer/audience/`azp`/expiry | Wrong or expired claims are rejected; no session. | Test configuration and sanitized response/run evidence. | NOT EXECUTED |
| Nonce mismatch | Authentication denied; transaction is consumed/cleared. | Callback and nonce-state evidence. | NOT EXECUTED |
| PKCE failure | No code exchange or session. | Verifier/challenge failure and callback evidence. | NOT EXECUTED |
| State mismatch/replay | First valid callback only is processable; replay/mismatch is denied. | State-store and callback-run evidence. | NOT EXECUTED |
| Provider error/cancellation | Safe rejection; transaction consumed; no session. | Provider callback/result and state evidence. | NOT EXECUTED |
| Disabled account/session revocation | Existing sessions are revoked and subsequent login is denied. | Account status, session and run evidence. | NOT EXECUTED |
| Provider outage/TLS failure | Safe unavailable response; no secret leakage or session. | Sanitized transport logs and response evidence. | NOT EXECUTED |
| Cleanup/isolation | Test realm and identities are removed or explicitly owned and retained; no production reachability. | Workflow provenance, cleanup result, environment/credential review. | NOT EXECUTED |

Gate 6 passes only when every applicable row is executed and passes in the isolated environment and cleanup is verified.

### Gate 7 — Production readiness

- **Exact criterion:** approved TLS/deployment and exact callback/issuer/audience; measured session/revocation; durable audit; exercised backup/restore; multi-process/multi-host evidence; monitoring/incident response; recovery continuity; isolation/cleanup; accountable release approval.
- **Evidence:** requirements exist in framework §G.7, APR register, migration design and recovery/cutover report. The latter reports recovery/cutover readiness NOT PROVEN.
- **Gap/status:** **NOT PASSED.** No verified backup/restore, migration authority, quiescence, production topology, runbooks, provider deployment or release evidence.

| Evidence category | Exact pass criterion | Required evidence / approving authority | Status |
|---|---|---|---|
| TLS/deployment | HTTPS-only; exact callback/issuer/audience; no production fallback. | Deployment/certificate/endpoint review — Security and Operations. | NOT PASSED |
| Session lifecycle/revocation | Idle/absolute expiry, rotation and account/binding revocation meet approved thresholds. | Independent session exercise and runbook — Product Owner, Security, Operations. | NOT PASSED |
| Audit | Required events recorded; access restricted; integrity verified; retention approved. | Audit architecture, access/integrity tests and schedule — Security, Operations. | NOT PASSED |
| Backup/restore | Approved recovery objective and exercised restore completeness. | Restore drill and data-integrity comparison — Operations with Product/Security acceptance. | NOT PASSED |
| Multi-process/multi-host | Binding/session/OIDC state and concurrency verified on approved topology. | Independent-host/provisioning and failover tests — Operations, Security. | NOT PASSED |
| Monitoring/incident response | Binding/recovery/revocation failures alert; owner and response are named. | Runbooks, alert tests and tabletop — Operations, Security. | NOT PASSED |
| Recovery continuity | Recovery, lockout, support and appeal are approved and exercised. | Recovery drill, support-boundary review and customer messaging — Product Owner, Security, Operations. | NOT PASSED |
| Isolation/cleanup | Test identities and provider configuration cannot reach production. | Environment separation, credential/access review and cleanup result — Operations, Security. | NOT PASSED |

## 5. Threat and abuse review matrix (draft for independent review)

This is a complete *review draft*, not a passed threat assessment. Controls shown are proposed or policy requirements unless explicitly evidenced elsewhere. `Owner` is a role awaiting named assignment. Every residual risk is **OPEN** until Security records its disposition and the Product Owner explicitly accepts/rejects it after review.

| ID | Threat/abuse case and impact | Proposed control / source | Accountable owner role | Required verification evidence | Residual risk |
|---|---|---|---|---|---|
| TM-01 | Unknown or unbound identity creates/claims a PARMAR account; enumeration exposes account existence. | No automatic account creation; generic fail-closed conflicts; APR-01/02/11; B2 §§3, 5. | Identity service owner; Security | Unknown/unbound live and negative tests; assert no account/session/binding side effects and generic response. | OPEN — onboarding abuse and enumeration behavior need Security review. |
| TM-02 | Stolen session or stale authentication is used to add a provider identity. | Existing-account proof plus independent new-method proof, approved freshness, one-time transaction; D3/D4 and B2 §7. | Authentication owner; Security | Freshness/claim matrix; expired/stale session and proof tests; provider capability evidence. | OPEN — exact assurance/freshness is not defined. |
| TM-03 | CSRF, state/nonce/PKCE substitution, callback replay or transaction fixation commits the wrong identity. | Session-bound transaction, CSRF/origin protection, state/nonce/PKCE, one-time consumption; D3, B2 §§7.2–7.3. | OIDC/link-flow owner; Security | Mismatch, replay, missing/expired proof, CSRF and transaction-substitution tests with zero writes. | OPEN — login controls do not establish safe link-flow controls. |
| TM-04 | Malicious/compromised provider, issuer confusion or subject change causes cross-account binding. | Explicit provider allowlist after review; exact issuer/subject mapping; no email/name matching; fail closed. | Provider owner; Security | Issuer/subject normalization decision, issuer rotation/subject-change tests, provider threat review. | OPEN — provider unselected and key normalization unresolved. |
| TM-05 | Concurrent binding attempts cause duplicate mapping or silent ownership transfer. | One authoritative binding row, unique active-owner invariant, immutable owner, transaction/version checks; B2 §§4–7. | Data-model and lifecycle owners; Security | Independent connections/processes race for same identity and two identities; prove one winner, no partial second mapping and no reassignment. | OPEN — disposable DDL and same-process races using separate SQLite connections are tested; independent-process/topology evidence, lifecycle implementation and specialist review remain outstanding. |
| TM-06 | Recovery is abused through social engineering, weak evidence, rate-limit bypass or support assertion. | Independent evidence, no attribute/support-only recovery, layered measurable limits, appeal and notice; APR-05/06; D8/D10. | Recovery owner; Security/Operations | Abuse-case tests, threat exercise, thresholds, support/appeal runbook and recovery drill. | OPEN — factors, thresholds and authority unresolved. |
| TM-07 | Unlink removes the last usable method or races with another unlink/recovery. | Last-method protection and final-transaction recheck; D7/APR-11; B2 lifecycle proposal. | Binding lifecycle owner; Security | Concurrent unlink/disable/recovery tests; deny last usable method outside approved recovery; no partial mutation. | OPEN — “usable” and recovery exception not defined. |
| TM-08 | Insider/admin changes ownership, bypasses proof, or accesses private content. | No unilateral support ownership changes; separate authorities, audit, least privilege; APR-03/18; D10. | Operations/support owner; Security/Privacy | Role/SoD matrix, negative authorization tests, dual-control exercise, access log/integrity evidence. | OPEN — roles and any exception process unapproved. |
| TM-09 | Disablement, closure, reactivation or binding change races with sessions/approvals; stale authorization survives. | Security-version/invalidation model and fail-closed resolution; APR-07/13; D9/D13. | Session/approval owner; Security | Race, restart and stale approval/session tests with measured revocation bound. | OPEN — cross-store effects and bound pending; version check is not an atomic fence. |
| TM-10 | Required audit store outage or tampering allows unrecorded identity change or false success. | APR-10 durable minimal event and restrictive behavior; B2 Options A/B/C are still design alternatives. | Audit owner; Security/Operations | Choose and review policy; corrupt/locked/read-only/disk-full/audit-key failures; verify no success-shaped response and integrity controls. | OPEN — no audit system/reconciler accepted or proven. |
| TM-11 | Notification failure hides takeover or reveals account existence to an unverified channel. | Verified safe channel; queued/delivered/failed distinction; no existence leakage; APR-09. | Notification owner; Security/Privacy | Delivery failure, retry, duplicate, wrong/unverified channel and outage tests; operational alerts. | OPEN — event/channel/failure choices remain pending. |
| TM-12 | Reconciliation worker crash, duplicate lease or stale worker applies effects twice or reports false completion. | Stable IDs, fenced leases, conditional progress and idempotent effects; B2 §§6–7. | Reconciliation owner; Operations/Security | Crash/takeover/duplicate delivery/stale epoch injection; exactly-once effect evidence and truthful terminal states. | OPEN — worker not implemented; thresholds and ownership absent. |
| TM-13 | Tokens, provider subjects, proof material or lifecycle details leak through logs, metrics, errors or notifications. | B2 field classifications; APR-10; minimize references and sanitize outputs. | Security/Privacy and service owner | Log/output scan and injected secret values; prove no raw tokens/proofs or unnecessary subjects; access review. | OPEN — actual storage/logging design not implemented or independently assessed. |
| TM-14 | Migration guesses legacy/Local Demo ownership, misassigns data, or permits stale writers. | Keep unmapped; verified attributable mapping; quarantine ambiguity; no automatic email/UUID matching; D16/APR-15. | Migration authority; Operations/Security | Exact source/target key-set reconciliation, owner evidence, orphan/collision quarantine, rollback and old-writer exclusion. | OPEN — no migration controller, complete inventory or authority. |
| TM-15 | Restore resurrects revoked sessions/approvals or deleted data; incomplete backup masks loss. | Per-custodian lifecycle; verified restore and manifest; APR-16/17; migration design §5. | Operations; Security/Privacy | SQLite backup/restore drill, data/authority comparison, stale-state checks, RPO/RTO and deletion reconciliation. | OPEN — recovery/cutover report says NOT PROVEN. |
| TM-16 | Separate stores, multi-process writers or SQLite topology invalidate concurrency/atomicity assumptions. | Explicit supported topology; one authority per operation; no distributed atomicity claim; B2 and migration design. | Data-model owner; Operations/Security | Independent process/connection contention, filesystem/journal/synchronous evidence and fail-closed path checks. | OPEN — no approved deployment profile or cross-store proof. |
| TM-17 | Anonymous Local Demo path could reach configured external chat/research dispatch, contrary to the local-only boundary. | Current route forces `local-demo`; external ChatService/Orchestrator and SearchService paths require execution authorization. Account-binding design does not mitigate it. | Application owner; Security | Source inspection and four focused fake-provider/search tests passed on 2026-11-25; independent Security and deployment/configuration review remain. | MITIGATED IN CURRENT SOURCE — independent closure and deployment exposure confirmation pending; atomic-fence NO-GO remains separate. |
| TM-18 | Prematurely enabling a protected operation could commit after revocation/cancellation because check and side effect are not atomic. | Existing atomic-fence NO-GO; shared-authority migration proposal is not evidence. | Security/Operations and protected-operation owner | Separate reviewed fence architecture plus race/crash/downstream effect evidence before any NO-GO change. | OPEN — unconditional NO-GO remains. |
| TM-19 | Provider logout failure leaves provider session active and is misrepresented as PARMAR revocation failure/success. | PARMAR local logout remains authoritative; no provider logout promise; D14/APR-19. | Provider owner; Security/Operations | Provider capability/outage evidence and truthful UI/runbook; ensure provider failure cannot restore PARMAR access. | OPEN — provider selection and semantics absent. |
| TM-20 | Subscription/entitlement or managed-account policy is silently inferred from identity/binding design. | Preserve separate entitlement and delegated-authority gates; no ownership from membership. PO-13 Option A withdraws “fully primium type” as non-operative without defining or cancelling future Premium scope. | Product Owner; Security/Privacy | No entitlement implementation follows from PO-13; a future product decision requires an explicit separate record and authorization test separation. | CLOSED — PO-13 policy ambiguity removed by Option A; no entitlement change authorized. |

## 6. Bounded Gate 2 validation proposal — synthetic prototype executed; Gate 2 not passed

### 6.1 Purpose and boundary

This proposal is limited to synthetic-only validation of the proposed SQLite schema and migration mechanics. It is not a production migration, proof of production durability, provider test, account-binding implementation, or a means to clear the protected-operation NO-GO. Authorization `3509b65517d31ed63c2c2f50c22c0fc8f8d7cb140ad5487cbad7bc4b19180ea8` authorized the disposable prototype run described here; that authorization does not grant independent Gate 1–7 approval or real-data/migration/live-provider authorization.

The synthetic validation source is implemented in
[`tests/account_binding_b2_schema_validation.py`](./tests/account_binding_b2_schema_validation.py).
It is not collected by the default pytest filename pattern. Under the recorded
prototype authorization, its explicit invocation executed the DDL in a temporary
SQLite database and passed 58 tests in the latest expanded run (the initial
baseline had 53). This evidence is prototype-only;
the harness does not implement or validate the B2 migration.

### 6.2 Prototype scope and limits

- The executed harness uses pytest temporary storage, not a configured application database path.
- One synthetic SQLite database using generated account IDs and provider subjects; no production or user-derived data.
- A throwaway schema containing the B2 binding constraints. It does not contain a migration implementation or source/destination migration schema.
- The explicitly invoked harness asserts issuer/subject constraints, foreign keys, ownership, lifecycle, version and same-process independent-connection properties. Added backup/restore and interrupted-transaction/process-exit cases exercise SQLite primitives only; they are not operational recovery evidence.
- The harness uses a minimal synthetic `accounts(account_id PRIMARY KEY)` parent. It does not recreate current account-table triggers, validate the existing identity-store schema/migration, or prove integration compatibility. It observes that both current application and SQL checks reject embedded U+0000; whether that is the final provider-facing policy remains for DM/provider/Security decision.
- A future authorized full validation would require an evidence log with schema version, test identifiers, synthetic row counts/digests and pass/fail results, with no secrets or real identity data.
- A future migration/recovery exercise would require separately approved synthetic source/destination migration mechanics and recovery evidence.

No repository DDL, application schema, dependency, production path, secret, persistent user database, provider configuration, or live identity would be changed or read.

### 6.3 Isolation checks before any authorized run

1. Use a disposable VM/container with separate storage and no mounts to repository data or configured database directories.
2. Verify production credentials, secret stores, credential helpers and environment configuration are absent and inaccessible.
3. Deny network egress and verify no provider, production service or database is reachable.
4. Verify the SQLite path resolves inside the disposable storage; verify no symlink or path alias reaches existing data.
5. Use generated fixtures and ephemeral keys only; verify cleanup authority and retained-evidence policy before launch.
6. Preserve every runtime NO-GO and disabled-provider boundary. If any isolation check is missing, failed or ambiguous, do not run.

### 6.4 Proposed checks and measurable acceptance

- **Schema constraints:** foreign keys enabled on each connection; immutable account/owner keys; permitted lifecycle transitions and version increments only; issuer/subject SQL validation matches the current application bounds for non-NUL strings and rejects embedded U+0000 in both application and SQL checks; final provider-facing acceptance of that restriction remains a policy decision; application rejection of non-string values and SQLite TEXT-affinity behavior for direct numeric/BLOB values are separately tested/documented; inserting the same issuer/subject through a different adapter cannot create a second identity row or ownership slot; uniqueness of active identity ownership; invalid states, deletion, reassignment, missing references and duplicate rows rejected.
- **Lifecycle constraints:** allowed and denied transitions; pending attempts cannot claim ownership; no activation without the required synthetic evidence references; unlink cannot remove the last usable synthetic method outside the separately modeled recovery path; failures roll back without partial state.
- **Independent connections/processes:** use distinct SQLite connections and independent processes synchronized at barriers. Race two writers for the same provider identity and for conflicting account owners. Pass only if at most one eligible owner commits, the other leaves no partial ownership/effect, and results remain correct after restart.
- **Migration behavior:** test clean upgrade, already-upgraded rerun, invalid source schema, duplicate/conflicting owner, missing/extra records, interrupted migration at each stage, rollback before activation and refusal to activate incomplete/mixed state. Compare exact synthetic key sets and documented counts/digests.
- **Restore evidence:** create the synthetic backup using the reviewed SQLite method; restore to a fresh isolated destination; compare schema, rows, key sets, constraints, state and digests; prove revoked/terminal synthetic states are not revived by the defined restore procedure. No real-data restore claim follows.
- **Failure injection:** busy/locked database, read-only path, corrupt fixture, constraint failure, interrupted process and uncertain commit outcome. Require explicit fail-closed result and no success-shaped fallback.
- **Evidence review:** Identity/Data-Model owner, Security and Operations independently inspect test scripts, environment/path checks, raw sanitized results, restore comparison and cleanup record before considering Gate 2 evidence.

### 6.5 Destroy/retain

After an authorized run, destroy the disposable environment, synthetic database, source copy, backup, ephemeral keys, fixtures and harness outputs. Retain only the specifically approved sanitized evidence record and cleanup attestation; do not retain credentials, database files or identity-bearing fixtures. Independently verify destruction. If evidence retention requires any generated artifact, the authorizers must identify it before the run and approve its scope and storage.

**Current state: authorized synthetic prototype EXECUTED; prototype DDL/tests passed locally.** Authorization `3509b65517d31ed63c2c2f50c22c0fc8f8d7cb140ad5487cbad7bc4b19180ea8` covers only the disposable synthetic SQLite prototype. This is not independent Gate 2 acceptance and does not authorize real migration, restore, lifecycle implementation, provider operation, production activation or gate clearing.

## 7. Repository-grounded implementation sequence (future work only)

All commands below are **planned future verification**, not commands executed in this task. Each stage depends on prior approvals and a separate implementation authorization. OIDC remains production-disabled; the protected-operation NO-GO is not cleared by these stages.

| Stage | Work and dependencies | Acceptance criteria | Planned verification / external requirements |
|---|---|---|---|
| 1. Database schema and migration | Only after Gates 1–3, DM-01, migration authority and approved Gate 2 evidence. | Reviewed schema and migration; exact uniqueness/FKs/indexes/triggers; no dual-writer/resolver; manifest and incomplete-state rejection; ambiguous legacy rows quarantined; backup/restore, idempotent resume and rollback evidence; no inferred ownership. | Planned: `python -m pytest PARMAR/tests/test_identity_store.py PARMAR/tests/test_account_registry.py -q` plus authorized migration tests and isolated backup/restore rehearsal. Requires named data-model and migration owners, approved topology and separate migration authorization. |
| 2. Account-binding lifecycle service | After stage 1 and approved lifecycle/authority policy. | Only allowed transitions; expected-state/version checks; no reassignment; same-owner reactivation requires new proof; denial/failure leaves no partial mutation; stable reconciliation ID is committed with lifecycle state. | Planned after adding the lifecycle test module: `python -m pytest PARMAR/tests/test_identity_store.py PARMAR/tests/test_account_registry.py PARMAR/tests/test_account_binding_lifecycle.py -q`. Requires reviewed transaction and writer-access boundary. |
| 3. OIDC linking and identity verification | After stage 2, provider selection and approved assurance/claim contract. | Link purpose separated from login; account/session-bound state, nonce and PKCE; approved freshness; one-time consumption; generic conflict results; unknown identities do not provision; no proof/secrets in outputs/logs. | Planned: `python -m pytest PARMAR/tests/test_oidc_authentication.py PARMAR/tests/test_identity_http.py -q`; live checks deferred to stage 8. Requires approved isolated provider/realm; no production activation. |
| 4. Session and approval invalidation | Security-version definition in stage 1 and lifecycle commit behavior in stage 2. | Stale sessions/evidence/approvals fail closed across restart; approved invalidation scope; unavailable authority denies; integrity preserved; no claim that version check is an atomic side-effect fence. | Planned: `python -m pytest PARMAR/tests/test_sessions.py PARMAR/tests/test_approval_integrity.py PARMAR/tests/test_approval_persistence.py -q` plus account/version races. |
| 5. Reconciliation, audit and notifications | After stages 1–4 and Security/Operations selection of audit and delivery failure policies. | Fenced leases, stable idempotency IDs, crash recovery, truthful queued/delivered/failed states, no false completion; operator recovery separately authorized; no cross-database atomicity claim. | Planned after adding the indicated modules: `python -m pytest PARMAR/tests/test_account_binding_reconciliation.py PARMAR/tests/test_account_binding_audit.py PARMAR/tests/test_account_binding_notifications.py -q`. Include crash, duplicate-effect, stale-lease, unavailable-store and ambiguous-ack failure injection; approved owner, thresholds, alerts and runbooks required. |
| 6. Recovery, unlinking and account lifecycle | After stages 2–5 and explicit D7–D15 details, recovery, support, retention, notice and audit approvals. | Final transaction rechecks last method; independent recovery evidence; explicit transition authority; history/retention preserved; support cannot assert ownership; no automatic deletion/reassignment. | Planned after adding recovery tests: `python -m pytest PARMAR/tests/test_account_binding_recovery.py PARMAR/tests/test_account_binding_lifecycle.py PARMAR/tests/test_sessions.py PARMAR/tests/test_approval_integrity.py -q`; repeat reconciliation tests per transition. |
| 7. Security, concurrency and failure-injection tests | Test design accompanies stages 1–6; integrated pre-E2E acceptance. | Gate 5 matrix passes: IDOR/CSRF/replay, uniqueness races, migration failpoints, rollback, stale versions, last-method, outages, crash/retry, truthful completion; existing protected-operation NO-GO remains before side effects. | Planned: `python -m pytest PARMAR/tests/test_identity_store.py PARMAR/tests/test_account_registry.py PARMAR/tests/test_identity_http.py PARMAR/tests/test_oidc_authentication.py PARMAR/tests/test_sessions.py PARMAR/tests/test_approval_integrity.py PARMAR/tests/test_approval_persistence.py -q` plus authorized new tests. No production credentials/user DBs. |
| 8. Live Keycloak E2E and operational readiness | After stages 1–7, Gate 6 provider/security review, and separately approved isolated run. | Disposable isolated realm; binding scenarios pass; cleanup/provenance verified; provider behavior documented. Backup/restore, key custody, alerts/runbooks, incident/recovery, topology and release reviews complete. OIDC remains production-disabled until separate production approval. | Planned manual workflow: `.github/workflows/parmar-keycloak-oidc-e2e.yml`; command `python3 -m pytest PARMAR/tests/test_keycloak_oidc_live_e2e.py -q -ra --tb=short` with approved isolated bootstrap and `PARMAR_LIVE_KEYCLOAK_E2E=1`. Requires isolated runner, credentials scoped to disposable realm, verified cleanup and release owner. |

## 8. Approval summary by authority

### Product Owner

- **Already approved:** D1–D16 within framework §§C.1–C.16; APR-01–APR-20 as the proposed policy baseline, dated 2026-11-13.
- **Do not request again:** broad identity/SSO boundary, no automatic linking/merging, no unknown-identity account creation, proof/confirmation principles, no ownership by membership, or the APR policy directions.
- **Recorded on 2026-11-25:** The Product Owner approved bounded choices PO-02–PO-08, PO-10 and PO-14 as stated in §3.3. Their technical, operational, privacy, provider and numerical details remain subject to the dependencies listed there. **Still required:** those independent reviews/evidence and explicit per-threat residual-risk disposition after Security review. PO-01, PO-09, PO-11 and PO-12 record already-approved current deferrals/boundaries; no reapproval is requested. **PO-13 is approved as Option A on 2026-11-26:** withdraw “fully primium type” as non-operative, without cancelling or defining future PARMAR Premium or authorizing subscription/entitlement changes.

### Security

- **Still required:** SEC-01–SEC-07; independent Gate 1 review; exact B2 model and Gate 2 review; Gate 3 threat/abuse and residual-risk review; proof/assurance, audit, atomic-fence and independent runtime finding dispositions.
- **Authority boundary:** Agent or document recommendations do not constitute Security approval. Security approval cannot be inferred from source code or test presence.

### Operations

- **Still required:** OPS-01–OPS-04; named lifecycle/reconciliation owners; approved topology, thresholds, incident/runbooks, backup/restore and migration authority; independent Gate 1 review.
- **Authority boundary:** no migration, cutover, restore drill or provider activation is authorized by this packet.

### Identity/data-model and migration authorities

- **Still required:** DM-01 and MIG-01. Gate 2 requires accepted schema/migration semantics and independent concurrency evidence. Gate 7 requires demonstrated cutover/restore controls and named dual authority.

### Privacy/Legal, provider, and release authorities

- **Still required:** PRIV-01, PROV-01 and REL-01. Provider/region selection, data handling, retention, backup/deletion statements and release are not authorized by D1–D16 or APR-01–APR-20.

## 8.1 Independent specialist approval matrix

| Authority | Scope reviewed | Available attributable evidence | Status | Exact blocker / next external action |
|---|---|---|---|---|
| Product Owner | D1–D16; APR-01–APR-20 baseline; bounded PO-02–PO-08, PO-10, PO-14 choices; PO-13 Option A approved 2026-11-26. | Repository records and the current Product Owner instruction with dated disposition. | **APPROVED ONLY within recorded policy scopes** | PO-13 introduces no subscription/entitlement scope; specialist implementation and release approvals remain separate. |
| Independent Security | Identity proof boundaries, foreign-key enforcement, trigger/schema trust, direct SQL writers and attack surface. | Synthetic 58-test harness; 76 OIDC tests; source review; no external reviewer decision. | **NOT APPROVED** | Qualified independent reviewer must return an attributable signed/dated decision for SEC-01–SEC-07. |
| Identity/Data Model | U+0000, NFC/NFD, identity cardinality, SQL constraints, migration compatibility and TEXT affinity. | 58 synthetic tests; documented recommendations; no external decision record. | **NOT APPROVED** | DM-01 and SEC-04 require named Identity/Data-Model, Security and provider owners. |
| Operations | Supported SQLite topology, OS/process isolation, backup/restore, migration and rollback authority. | Source and synthetic evidence; no supported-topology or restore exercise. | **NOT APPROVED** | OPS-01–OPS-04 and MIG-01 require named accountable owners and independent evidence. |
| Privacy/Legal | Identity-data handling, audit access, retention, deletion, recovery and notices. | APR baseline and data-class documentation only. | **NOT APPROVED** | PRIV-01 requires a qualified named Privacy/Legal reviewer and attributable decisions. |
| Provider Compatibility | Issuer/subject normalization, claim behavior, stability and provider-specific compatibility. | Current OIDC source and synthetic identity evidence; no provider comparison or live realm evidence. | **NOT APPROVED** | PROV-01 requires provider owner plus Security/Operations approval and exact tested issuer/configuration. |
| Release Authority | Exact deployment/release scope after every gate. | No release evidence or signed release record. | **NOT APPROVED** | REL-01 requires complete Gate 1–7 evidence and explicit change authorization. |

### 8.2 Local approval-infrastructure implementation

The repository now contains a fail-closed specialist approval register and
workflow:

- `.github/approval/records.json` is the formal record set. It is empty; this
  means no formal specialist appointment or approval has been invented.
- `.github/approval/approval-record.schema.json` defines the required
  attributable fields.
- `.github/approval/specialist-roles.json` distinguishes the six independent
  specialist roles.
- `.github/approval/SPECIALIST-ONBOARDING.md` provides the exact nomination,
  permission, GitHub configuration, evidence and decision-submission package.
- `.github/scripts/validate-specialist-approvals.py` rejects missing reviewer
  authority, missing commit/artifact evidence, changed reviewed files, future
  timestamps and unrecorded revocation/expiry.
- `.github/workflows/parmar-specialist-approvals.yml` runs the validator on
  pull requests and `main`.
- `PARMAR/tests/test_specialist_approval_validator.py` verifies an empty
  register and stale-artifact rejection.

This infrastructure does not appoint a reviewer or constitute approval.
Repository rulesets, CODEOWNERS, teams and protected Environments must still
be configured and independently verified by an authorized GitHub administrator.
No production OIDC activation, protected-operation fence change or PO-13
decision has been made.

### 8.3 Enforced stage-authorization implementation

- Gate 2 requires Data Model, Security and Operations approvals.
- Gate 3 requires Security.
- Gate 4 requires Data Model, Security and Operations.
- Gate 5 requires Security and Operations.
- Gate 6 requires Provider Compatibility, Security and Operations.
- Gate 7 requires Release Authority, Security, Operations, Privacy/Legal,
  Data Model and Provider Compatibility.
- The validator supports `--stage`, `--commit` and `--author-login`.
- Formal records require GitHub login and immutable GitHub user ID, verified
  affiliation and named authority. Live workflow validation supplies
  `GITHUB_TOKEN`; missing or unverifiable identity blocks authorization.
- Implementation authors and the reviewer login cannot self-approve.
- Relevant artifact changes invalidate approval; unrelated changes do not.
- Live Keycloak dispatch requires both protected-environment approval and a
  valid formal Gate 6 stage decision.

### GitHub reviewer-evidence check

- Repository `mksp1319-parmar/PARMAR-v1`: reachable, public, branch `main`.
- Authenticated REST environment list returned HTTP 200 with no Environment entries; direct `parmar-keycloak-e2e` lookup returned HTTP 404.
- PR #7 (“Add PARMAR identity and Keycloak E2E hardening”) is merged, but it has zero submitted reviews, zero requested reviewers and zero review comments in the available API evidence.
- No issue or PR in the repository contains a named specialist approval for Security, Data Model, Operations, Privacy or Provider compatibility.
- Merge or repository write activity is not specialist approval and was not reused as one.

## 9. Corrections and second-pass review

This packet reconciles the recorded APR policy approval with the bounded D1–D16 record; it does not reopen either. It records the Product Owner's limited PO-02–PO-08, PO-10 and PO-14 choices dated 2026-11-25 without converting them into specialist review, schema approval, implementation authorization, or release. It also makes the previously missing threat-to-control-to-test-to-owner fields explicit, retains residual risk as open, and states the Gate 2 evidence-order authorization boundary.

Second-pass consistency checks for this packet:

- D1–D16 are not downgraded or expanded; APR-01–APR-20 are not described as pending at the approved policy-baseline level.
- Every remaining PO choice is scoped to unresolved details; every specialist decision is attributed to the appropriate authority class.
- Gates 1–7 remain not passed/not executed where evidence is absent.
- The B2 model remains a proposal; the synthetic schema harness executed 58 disposable SQLite tests, but migration implementation, supported-topology independent-process behavior, application lifecycle and operational recovery controls were not validated or approved. SQLite backup/restore and process-exit recovery primitives were tested synthetically, not an operational restore procedure. Embedded U+0000 is rejected consistently by `ProviderIdentity` and SQL, but that is not an approved provider-facing policy; Unicode NFC/NFD normalization remains unresolved. Numeric and float adapter inputs remain the application-adapter responsibility.
- The offline baseline and Local Demo guard tests recorded in §11 were run and do not pass Gate 5.
- The PO-02 issuer/subject ownership key is explicit across adapters in B2/B3 and Gate 2 criteria; the proposed fixture matrix now requires a cross-adapter duplicate-key case. Verifier-provenance retention remains for DM/provider review.
- B2's proposed SQL aligns issuer/subject bounds and edge-whitespace rejection for ordinary non-NUL values without selecting provider-specific canonicalization. Both the current value object and proposed SQL reject embedded U+0000; the final policy remains unresolved, while the SQLite `length()` difference is not a mismatch for rejected values.
- B2 audit/notification language now distinguishes the approved no-success direction from unselected A/B/C failure policies; proposed recovery/migration procedures are not represented as approved or exercised. The recovery/cutover report was revalidated accordingly.
- The Keycloak workflow now fail-closes on a missing image selection and a missing explicit dispatch confirmation. It does not claim an image-digest or provider approval, and it requires the `parmar-keycloak-e2e` GitHub Environment with its own protected-environment configuration before steps run.
- OIDC production-disabled, the atomic-fence NO-GO and the separate Local Demo finding and its pending independent closure remain preserved. PO-13 is resolved as Product Owner Option A on 2026-11-26 and introduces no subscription or entitlement boundary.

## 10. Evidence and source register

Primary approval and design evidence:

- [ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md](./ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md) — D1–D16 scopes and Gate 1–7 criteria.
- [PARMAR-ACCOUNT-BINDING-POLICY-DECISIONS.md](./PARMAR-ACCOUNT-BINDING-POLICY-DECISIONS.md) — account-binding proposal, interpreted under the recorded approval scope.
- [ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) — unapproved schema/transaction proposal, threat list and synthetic-prototype boundary.
- [ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) — corrected implementation order, gate evidence and planned verification.
- [PARMAR-ACCOUNT-PROVISIONING-APPROVAL-REGISTER.md](./PARMAR-ACCOUNT-PROVISIONING-APPROVAL-REGISTER.md) and [PARMAR-ACCOUNT-PROVISIONING-USER-APPROVAL-REVIEW.md](./PARMAR-ACCOUNT-PROVISIONING-USER-APPROVAL-REVIEW.md) — APR-01–APR-20 approval, date, boundaries and remaining implementation gates.
- [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md) — approved IT outcomes and explicit deferrals.

Security, operations and migration evidence:

- [PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md](./PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md) — broad identity review; not a substitute for account-binding Gate 3.
- [PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md](./PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md) — recovery/cutover readiness NOT PROVEN.
- [PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md) — proposal and isolation/authorization requirements; real migration/restore not authorized or run.
- [PARMAR-RUNTIME-NO-GO-INDEPENDENT-AUDIT.md](./PARMAR-RUNTIME-NO-GO-INDEPENDENT-AUDIT.md) — historical anonymous-dispatch finding and current mitigation evidence; protected-operation atomic-fence NO-GO remains.

## 11. Validation record and final state

- Documentation/source inspection: performed for the sources listed above.
- Current full offline Python suite: `env -u PARMAR_LIVE_KEYCLOAK_E2E python -m pytest -q -ra --tb=short` —
  **1084 passed, 12 skipped, 5 subtests passed** after adding the PO-13
  traceability regression. The 12 live-only scenarios are skipped when the
  explicit live flag is unset. The final review artifact digests were refreshed
  and independently verified after this run.
- Targeted session/OIDC/approval regression:
  `python -m pytest -q PARMAR/tests/test_sessions.py PARMAR/tests/test_oidc_authentication.py PARMAR/tests/test_approval_integrity.py PARMAR/tests/test_approval_persistence.py`
  — **189 passed**. A trusted-session creation path now revokes the just-created
  session/evidence if the post-creation account-status check fails; a focused
  regression test verifies the outage path.
- Keycloak offline/live-gated suite:
  `python3 -m pytest PARMAR/tests/test_keycloak_e2e_bootstrap.py PARMAR/tests/test_keycloak_oidc_live_e2e.py -q -ra --tb=short`
  — **28 passed, 12 skipped**; no live provider was contacted.
- Synthetic cross-store/fencing rehearsal:
  `python3 -m pytest -q PARMAR/tests/test_account_binding_atomic_rehearsal.py`
  — **13 passed**. It demonstrates only its single-disposable-SQLite fixture.
- Synthetic migration/recovery rehearsal:
  `python3 -m pytest -q PARMAR/tests/test_account_binding_migration_rehearsal.py`
  — **4 passed**. It classifies synthetic rows and exercises transaction
  restart and SQLite backup primitives; it is not an operational migration.
- Current B2 synthetic suite:
  `python3 -m pytest -q PARMAR/tests/account_binding_b2_schema_validation.py`
  — **58 passed** in the expanded run.
- Specialist approval validation:
  `python3 .github/scripts/validate-specialist-approvals.py` —
  **PASSED: 0 formal specialist approval records**.
- Review artifact manifest:
  `python3 .github/scripts/verify-review-artifact-manifest.py` —
  **PASSED: verified 63 entries and 110 role-bound handoff digests**, including
  the authoritative policy framework in all six specialist scopes.
- Visual acceptance: dependencies restored and Playwright Chromium installed;
  `npm test` in `PARMAR/interface/visual-tests` —
  **21 passed**.
- Earlier offline-regression figures (`957 passed`, `28 passed/8 skipped`,
  `38 identity-focused passed`) predate the current Phase B–G synthetic tests
  and the added gated Keycloak assertion; they are retained only as historical
  baseline evidence and are not current acceptance counts.
- Synthetic prototype authorization: `3509b65517d31ed63c2c2f50c22c0fc8f8d7cb140ad5487cbad7bc4b19180ea8` authorizes only the disposable synthetic SQLite prototype defined in this task. It does not authorize a real-data migration, restore, lifecycle implementation, live provider operation, production activation or any independent Gate 1–7 approval.
- Identity/data-model decision boundary: embedded U+0000 is now rejected by `ProviderIdentity` and by the synthetic SQL DDL. NFC/NFD normalization remains unresolved and must not be selected by the Agent. SQLite numeric and float TEXT/INTEGER affinity is not a substitute for adapter-side exact type validation. Binding-version application guards require exact positive Python integers; SQLite remains a defensive second boundary.
- B2 synthetic prototype: `python -m pytest -q PARMAR/tests/account_binding_b2_schema_validation.py` — **58 passed** in a temporary SQLite database. The test module extracts and executes the current B2 DDL; it verifies foreign keys, uniqueness, lifecycle transitions, activation/unlink races, connection-close and process-exit rollback, synthetic backup/restore integrity, immutable fields, malformed inputs, raw-connection behavior, schema-privilege boundaries and identity type rules. It does not prove application proof/confirmation/recovery/last-method controls, an actual migration, or an operational topology.
- SQLite built-in behavior probe (separate in-memory `SELECT` from the synthetic B2 fixture): `length('x'||char(0)||'y')` returned `1`; Python `len()` counts beyond that character. The proposed SQL also rejects U+0000 with `instr(..., char(0)) = 0`, so the probe demonstrates a SQLite primitive difference, not a current SQL/application acceptance mismatch. Whether U+0000 rejection is final provider policy remains deferred.
- Keycloak static checks: `bash -n .github/scripts/parmar-keycloak-oidc-e2e-infra.sh` — **PASS**; all workflow `run` command blocks were checked as shell syntax where applicable. Independent workflow validation: Actionlint 1.7.7 (official Linux amd64 release, checksum-verified) passed all 7 workflow YAML files with no findings, and PyYAML 6.0.3 parsed all 7 files successfully. The live workflow was not dispatched or executed.
- Continuation static checks on 2026-11-26: `bash -n`, `git diff --check`,
  `python -m compileall -q PARMAR .github/scripts`, and PyYAML parsing of all
  **8** workflow YAML files passed. Actionlint was unavailable for this
  continuation; the earlier seven-file Actionlint result does not cover the
  current eighth workflow file.
- Remote GitHub verification on 2026-11-25: repository `mksp1319-parmar/PARMAR-v1` was reachable and reported `main`/HEAD `cbca03c03ae5c4c541666e102b9ee4a62aa91a86`; the remote workflow blob was SHA `c2db33b3ada563a051abdd0212ef183472afe365`. The local modified workflow blob has SHA `8b54426dcc7668f9ec5399013ad33fbd6e82a7559951b030e03adb8c2f016719` and is not a remote/workflow-run baseline. Environment list and branch-protection limitations are repository evidence only, not reviewer approval.
- Documentation patch hygiene: `git diff --check` — **PASS**.
- Keycloak image approval provenance: no approval record for an exact pinned digest was found in the reviewed repository approval documents or available session history. The workflow now sets no digest and its pull/start script refuses to proceed.
- GitHub verification on 2026-11-25 using the authenticated REST API returned HTTP 200 with `{"environments":[],"total_count":0}` for the repository Environment list; direct lookup of `parmar-keycloak-e2e` returned HTTP 404. Therefore, no such Environment is currently visible to the available credential, and no required reviewers or deployment branch restrictions are externally verified. The live environment check is definitive for the accessible credential but cannot prove a hidden/permission-scoped configuration. Branch protection lookup returned HTTP 403 (`Resource not accessible by integration`), so branch-protection settings remain unverified. Repository approval of the exact image digest/provider is **BLOCKED**; the workflow deliberately leaves `PARMAR_KEYCLOAK_IMAGE` empty and the infrastructure script refuses to pull or start Keycloak.
- GitHub read-only integration on 2026-11-26 found no open pull requests,
  confirmed the Keycloak workflow is active, and reported zero runs for it.
  Unauthenticated REST requests for rulesets and the Environment were
  rate-limited (HTTP 403); current live governance state remains unverified.
- Builds and offline regression: **run**. Synthetic B2 DDL/prototype: **58 tests passed** under authorization, including synthetic SQLite process-exit recovery and backup/restore primitive checks. No real migration, operational restore, live provider operation or production activation was run.
- Security, Operations, Privacy/Legal, data-model, provider or release approvals: **not granted by this packet**.
- This continuation corrects the stale NUL-length claim, reconciles prototype-execution status, and adds disposable concurrency, interrupted-transaction and backup/restore tests. No application lifecycle code or migration was implemented or executed; no operational restore was run. All pre-existing worktree modifications and untracked files are preserved.
- Git branch/HEAD, final status and changed-file hashes are recorded in the task completion report, not embedded here, to avoid stale self-referential hashes.

### 11.1 Continuation phase evidence register — 2026-11-26

| Requirement | Existing evidence | Remaining gap / authority | Changes made | Verification | Acceptance |
|---|---|---|---|---|---|
| A — Identity/OIDC/session/approval audit | Current identity contracts, stores, callback flow, session evidence, approval binding and fail-closed atomic-fence tests reviewed. | Cross-store disablement/reactivation and authorization fencing require approved lifecycle design and Security/Operations review; no supported account disable writer or cross-store transaction exists. | Revoked newly persisted trusted-session state when the post-create account-status check errors or reports inactive; added outage regression coverage. | Phase A targeted suites: 189 passed; latest complete offline suite: 1084 passed, 12 skipped, 5 subtests passed. | BLOCKED for end-to-end lifecycle consistency; current gated authentication paths reviewed. |
| B — B2 architecture decisions | Existing B2 package documents issuer/subject alternatives, NUL and Unicode policy, subject-at-rest gap, schema privileges, SQLite topology, and cross-store risks. | Identity/Data-Model, Security, Privacy/Legal, Provider and Operations authorities must decide exact policy/representation/topology; no decision inferred. | Added DM-01–DM-09 questions, owner/impact/evidence requirements; no policy selected. | Existing B2 harness: 58 passed; approval validator: zero formal records. | BLOCKED. |
| C — Formal approvals | Reviewer packages, validator, artifact manifest, proposed ruleset and Environment configuration exist. | Reviewer identity register and approval records are empty; administrator/team/environment configuration is not live-verified. Required specialist and Release authorities remain external. | No review or approval was fabricated or requested without an authorized reviewer channel. | Approval validator: 0 formal records; manifest: 63 verified entries and 110 role-bound digests; no open PR and zero recorded Keycloak workflow runs in the latest available remote evidence. | BLOCKED. |
| D — B3 lifecycle implementation | B3 plan and current OIDC/login foundation exist; protected operations fail closed at runtime. | Explicit implementation approval and accepted B2/security/privacy/provider contracts are missing. | No restricted lifecycle behavior activated or implemented; added reference tests only. | Full offline regression: 1084 passed, 12 skipped; synthetic atomic/fencing rehearsal: 13 passed. | BLOCKED. |
| E — Migration/backup/recovery | B2/B3 and recovery reports specify procedures; synthetic DDL transaction and backup primitives were exercised. | No approved migration authority, operational restore, rollback runbook acceptance or real-data authorization. | Added a synthetic classification/interruption/restart/backup-restore rehearsal and a stop-gated operator runbook; corrected the worktree-archive scope. | Synthetic migration/recovery rehearsal: 4 passed; no real migration or restore-write executed. | BLOCKED. |
| F — Live Keycloak/OIDC | Offline callback/bootstrap tests and a gated workflow exist; workflow image remains unset. | Approved image/provenance, protected Environment reviewers, provider owner and explicit live-run authorization are absent. | Added gated assertions for disabled-account session revocation, mismatched issuer/audience and unpublished JWKS key ID. No live provider contacted. | Twelve live-only scenarios skip when not explicitly enabled; workflow active but zero runs. | BLOCKED. |
| G — Production/release | Runtime NO-GO controls, OIDC-off default, test evidence and governance proposal exist. | Gates 1–7, exact specialist approvals, live acceptance, operations evidence and release authority are incomplete. | Kept production OIDC disabled and protected-operation atomic fence NO-GO. | No production action. | NO-GO. |

### 11.2 Agent-generated adversarial technical review passes — 2026-11-26

These are direct technical review passes, not independent specialist
approvals. Severity describes the consequence if a future implementation were
to proceed without the stated closure; existing production gates remain
disabled.

| Review pass | Severity and affected artifact | Finding / root cause | Authorized correction, test and re-review | Current disposition |
|---|---|---|---|---|
| Data-model correctness | HIGH — [B2 schema design](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md), [Data Model review package](../.github/approval/review-packages/data-model.md), B2 DDL harness | Exact issuer/subject canonicalization, NFC/NFD equivalence, verifier provenance, protected-subject representation and some migration dispositions are authority decisions. SQLite TEXT affinity and NUL length behavior are not equivalent to exact Python input validation. | Preserved the approved issuer+subject tuple and lifecycle proposal; documented DM-01–DM-09 alternatives and consequences; retained application exact-type/NUL checks and SQLite defensive constraints. B2 harness: 58 passed; manifest refreshed and verified. Re-reviewed as technically explicit but not accepted policy. | BLOCKED on Product Owner and Identity/Data Model, Provider, Security, Privacy/Legal and Operations decisions. |
| Security and abuse resistance | HIGH — [B3 implementation plan](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md), [Security review package](../.github/approval/review-packages/security.md), runtime NO-GO | Current login and account resolution do not implement binding proof, unlink/recovery, assurance thresholds, abuse limits or an approved lifecycle authority. Cross-store state races cannot be dismissed by a request-time version check. | Kept OIDC disabled and protected operations NO-GO; added no new authorization path. Existing OIDC/session regressions and full suite passed; live issuer/audience/JWKS and disablement assertions were added but remain gated. Re-reviewed: no production control is claimed. | BLOCKED on formal Security/Product Owner review and authorized B3 implementation. |
| Concurrency and transaction safety | HIGH — [B3 §5](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md), [atomic rehearsal](./tests/test_account_binding_atomic_rehearsal.py), runtime stores | Existing identity, sessions and approvals are separate stores; they have no shared transaction. A synthetic outbox branch could have committed an effect marker after a failed fenced completion. | Corrected the synthetic branch to roll back on failed conditional completion; added event-order, stale-worker, transaction-failure, invalidation/enqueue-failure and terminal-state tests. Atomic rehearsal: 13 passed; the fixture was re-reviewed only within its SQLite scope. | Fixture behavior locally verified; real protected-operation fence remains NO-GO pending approved topology, effect-recipient fencing and specialist review. |
| Migration and recovery | HIGH — [migration/recovery runbook](./ACCOUNT-BINDING-MIGRATION-RECOVERY-RUNBOOK.md), [recovery report](./PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md) | No B2 production migration or SQLite restore-write tool, all-writer quiescence control, supported source/destination topology or operational rollback authority exists. | Added a stop-gated operator sequence and synthetic duplicate/conflict/orphan/invalid classification, interruption/restart, digest binding and backup/restore checks. Migration/recovery rehearsal: 4 passed. Re-reviewed: fixture does not activate bindings or prove operational recovery. | BLOCKED on approved tool, topology-matched rehearsal, Operations/Security authority and real release/change authorization. |
| Privacy and auditability | HIGH — B2 subject storage and [Privacy/Legal review package](../.github/approval/review-packages/privacy-legal.md), [B3 audit contract](./ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md) | Synthetic subjects are ordinary plaintext TEXT; production key custody, equality lookup, backup/rotation, retention and notice are unresolved. Generic JSONL audit is not proof of tamper resistance, restricted access or approved retention. | Made those limits explicit in B2/B3 and review questions; no cryptographic representation or retention policy was selected. Tests establish only synthetic storage behavior; re-review found no basis to claim privacy/audit acceptance. | BLOCKED on Security, Privacy/Legal, Identity/Data Model and Operations/key-custodian decisions. |
| Operational deployment readiness | HIGH — [SQLite durability report](./PARMAR-SQLITE-DURABILITY-EVIDENCE-REPORT.md), [worktree backup runbook](../docs/backup-recovery.md), [Operations review package](../.github/approval/review-packages/operations.md) | SQLite has no native database roles; file/schema writers can bypass trigger assumptions. Current per-store connections do not establish multi-host/network-filesystem, power-loss, or cross-database durability. Worktree archives exclude SQLite databases. | Corrected FK/factory and backup-scope statements; added topology, quiescence, backup, restore and stop-condition requirements. Static checks and synthetic backup tests passed; re-reviewed as documentation/prototype only. | BLOCKED on administrator verification, declared topology, operational restore drill and independent Operations approval. |

### 11.3 Consolidated release gate matrix — 2026-11-26

The status below is the current evidence disposition, not a prediction. A passing
local test or an invitation/review package does not substitute for the named
authority's recorded approval. PO-13 is approved as Option A on 2026-11-26.

| Gate | Exact acceptance criteria | Current evidence | Automated verification | Responsible authority | Status | Remaining dependency |
|---|---|---|---|---|---|---|
| Product-owner policy / PO register | D1–D16 and applicable PO choices have explicit, correctly scoped dispositions; no deferred decision is inferred. PO-13 Option A is explicitly recorded. | D1–D16 and limited approvals are recorded; PO-13 is approved as no product requirement, without cancellation or definition of future Premium scope. | `python3 .github/scripts/validate-specialist-approvals.py` (formal-record integrity only; does not decide PO policy). | Product Owner; Security and Operations retain separate gates. | PASS for PO-13 disposition only | No remaining PO-13 action; all specialist, implementation and production gates remain separate. |
| B2 architecture / data model | Exact identity comparison and normalization, lifecycle/ownership invariants, verifier provenance, uniqueness, transaction boundaries, NUL/type/affinity behavior, protected subject storage, schema privileges, SQLite topology and cross-store limits are approved and supported by reproducible evidence. | B2 remains proposed. Synthetic DDL tests do not approve unresolved identity, cryptographic, provider, privacy or deployment policies. | `python3 -m pytest -q PARMAR/tests/account_binding_b2_schema_validation.py PARMAR/tests/test_account_binding_migration_rehearsal.py`; manifest verification command below. | Identity/Data Model, with Security, Privacy/Legal, Provider Compatibility, Operations and Product Owner as applicable. | BLOCKED | Authorized decisions on DM-01–DM-09 and specialist acceptance of the exact reviewed artifacts. |
| B3 implementation acceptance | Approved B2 contracts are implemented for link/unlink/recovery, last-method safety, disable/reactivation/closure, invalidation, security-version confirmation, idempotency, concurrency, retries, audit and notices; denied operations leave no partial effects. | B3 plan is review-ready, but restricted lifecycle writers are not implemented or authorized. Synthetic single-database rehearsal is not application implementation. | `python3 -m pytest -q PARMAR/tests/test_account_binding_atomic_rehearsal.py PARMAR/tests/test_sessions.py PARMAR/tests/test_oidc_authentication.py`; coverage is necessary, not sufficient. | Engineering, after Product Owner and required specialist gates. | BLOCKED | Accepted B2/security/privacy/provider contracts and explicit implementation authorization. |
| Security approval | Threat/abuse cases and residual risks are reviewed; assurance, proof, replay, CSRF, takeover, concurrency, failure, insider and recovery controls are accepted on exact artifact digests. | Security review package exists; no formal Security approval record or reviewer identity is present. | `python3 .github/scripts/validate-specialist-approvals.py --stage gate3` and manifest verification. | Independent Security authority. | BLOCKED | Named, verified independent reviewer; recorded decision bound to exact commit and digests. |
| Data Model approval | Cardinality, exact issuer/subject semantics, verifier provenance, lifecycle, constraints, storage, migration, rollback and cross-store disposition are accepted. | Data Model package includes DM-01–DM-09; no formal approval record exists. | `python3 .github/scripts/validate-specialist-approvals.py --stage gate2`; manifest verification. | Independent Data Model authority. | BLOCKED | Named reviewer decision for exact B2/B3/migration artifacts. |
| Privacy/Legal approval | Data minimization, subject representation, key custody/rotation/backup, retention, notice, access, deletion and recovery disclosure are accepted. | Privacy/Legal package exists; no approval or retention schedule is recorded. | `python3 .github/scripts/validate-specialist-approvals.py --stage gate7`; manifest verification. | Privacy/Legal authority. | BLOCKED | Independent review and recorded decision; policy choices cannot be inferred by implementation/tests. |
| Operations approval | Supported SQLite/runtime/filesystem topology, writer quiescence, deployment, backup/restore, monitoring, incident response, RPO/RTO, key operations and rollback are tested and approved. | Current stores are separate SQLite files; no supported production topology, operational restore drill, or formal Operations approval. | `python3 -m pytest -q PARMAR/tests/test_account_binding_migration_rehearsal.py`; `python3 -m pytest -q PARMAR/tests/test_account_binding_atomic_rehearsal.py`; neither establishes production operations. | Independent Operations authority. | BLOCKED | Approved topology and authorized operational migration/restore rehearsal with evidence. |
| Provider Compatibility approval | Exact issuer/client/audience, discovery/JWKS behavior, claims, key rotation, TLS, logout and provider outage behavior are verified for the selected provider. | Provider is unselected; live image and provider evidence are absent; OIDC remains disabled by default. | `python3 -m pytest -q PARMAR/tests/test_oidc_authentication.py`; actual provider acceptance additionally requires live E2E below. | Provider Compatibility authority, with Security and Operations. | BLOCKED | Select provider and obtain its approved immutable image/configuration and provider-specific review. |
| Migration and recovery | Source inventory, quarantine, backup integrity, migration/restart idempotency, interruption recovery, rollback authority and post-action identity/session/approval checks pass against the actual approved topology. | Four synthetic rehearsal tests exercise only a disposable fixture; runbook is stop-gated; operational recovery is NOT PROVEN. | `python3 -m pytest -q PARMAR/tests/test_account_binding_migration_rehearsal.py`; operational drill requires authorized tooling/environment. | Operations, Data Model, Security and Release Authority. | BLOCKED | Approved migration code, disposable topology-matched rehearsal, verified restore, rollback authority and independent sign-off. |
| Live Keycloak E2E | Every Gate 6 row executes against isolated approved Keycloak, passes, proves cleanup/isolation, and records provenance without production credentials. | No live run; provider image intentionally empty; live scenarios skip unless explicitly enabled. | `python3 -m pytest -q PARMAR/tests/test_keycloak_e2e_bootstrap.py PARMAR/tests/test_keycloak_oidc_live_e2e.py -ra`; live workflow only after all external prerequisites. | Provider Compatibility, Security and Operations; protected-environment reviewers authorize execution. | BLOCKED | Admin-configured protected Environment/reviewers, approved image provenance, explicit run authorization and actual successful workflow run. |
| GitHub governance / protected review | Required Environment reviewers, branch/ruleset restrictions, code-owner review and workflow protections are active and externally verified. | CODEOWNERS/ruleset/Environment proposals exist; reviewer register empty; active Environment and branch-protection state are not verified; workflow has zero runs. | `python3 .github/scripts/validate-specialist-approvals.py`; administrator must verify live GitHub settings—no local test proves activation. | Repository administrator and authorized governance owners. | BLOCKED | Configure and independently verify required reviewers, rulesets/branch protection and Environment restrictions. |
| Production OIDC activation | All applicable product, architecture, Security, Data Model, Privacy/Legal, Operations, Provider, migration, live and governance gates pass; separate activation authority is recorded. | OIDC disabled by default; no activation authority; no production configuration changed. | `python3 .github/scripts/validate-specialist-approvals.py --stage gate7`; runtime configuration review. | Release Authority and repository/operator authority. | NO-GO | Complete and verify every prerequisite, then obtain explicit production activation authorization. |
| Protected-operation atomic consistency | Authorization, account/security version, approval consume, effect, audit and required durable enqueue share an accepted atomic fence; partial failure, duplicate request and stale worker fail closed. Cross-system delivery is proven idempotent/fenced or explicitly bounded. | Synthetic SQLite reference uses one disposable database only. Runtime stores remain separate; no atomic cross-store fence or distributed-coordination evidence exists. | `python3 -m pytest -q PARMAR/tests/test_account_binding_atomic_rehearsal.py`; this validates the fixture only. | Security and Operations, with Data Model and Product Owner policy approval. | NO-GO | Select and implement topology-supported atomic authority; test all real effect sinks/fencing and receive independent approval. |
| Release authority | All required gates are PASS on the exact release commit/artifacts; residual risks, rollback, monitoring, recovery and release scope are explicitly accepted. | No formal Release Authority record; approval records and reviewer identities are empty. | `python3 .github/scripts/validate-specialist-approvals.py --stage gate7`; manifest verification. | Independent Release Authority. | NO-GO | Complete all prerequisite gates and record verified Release Authority approval. |

Manifest check: `python3 .github/scripts/verify-review-artifact-manifest.py`.
Formal approval validator: `python3 .github/scripts/validate-specialist-approvals.py`.
Both commands check repository evidence only; neither can create approval or
prove that remote GitHub governance is active.
