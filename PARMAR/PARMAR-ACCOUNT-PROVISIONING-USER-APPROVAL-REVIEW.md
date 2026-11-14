# PARMAR Account Provisioning — User Approval Review

**Purpose:** Record the user's approval of the 20 proposed account-provisioning policy decisions individually.
**Status:** APR-01–APR-20 are **APPROVED — PROPOSED POLICY BASELINE**, dated 2026-11-13.
**Evidence boundary:** This review summarizes policy choices and gates from the source documents listed below. It does not claim the described controls exist or have passed technical, legal, privacy, security, or release verification.

## Recorded approval

> “I approve the recommended APR-01–APR-20 plan as the proposed policy baseline, subject to all stated security, legal, privacy and implementation gates. Do not claim production authorization.”

**Approval date:** 2026-11-13. **Scope for each APR:** Approved — Proposed Policy Baseline.

The review was originally prepared with the decisions pending; this dated record supersedes that status for policy direction only. Unresolved operational specifications and all security, legal, privacy, implementation, and release gates remain open.

The approved direction includes open, user-initiated PARMAR self-service registration (invitations are not mandatory) and desired login methods Google, Apple, Email OTP, and Email + Password. Additional providers may be evaluated for future support. Provider selection, integration, and production activation remain subject to IT-02 and security gates. Each account receives a unique PARMAR-issued Account ID; matching emails never automatically merge accounts. PARMAR-wide SSO remains the approved architecture direction, with product-specific authorization and session controls mandatory.

The proposed 30-day closure grace period remains a candidate requiring legal, privacy, and operational validation; it is not a finalized universal retention rule. No immediate deletion from every backup or external-provider copy is promised. No standing support access to personal content is allowed; any exception remains purpose-limited, time-bound, least-privilege, and audited.

## How to use this review

The following original questions, recommendations, alternatives, consequences, and implementation gates are preserved as the approval basis. Each APR item below now records its individual approved status. Approval of policy direction does not close an implementation gate.

The user approved APR-01–APR-20 together at the proposed-policy-baseline level on 2026-11-13. Some choices still need technical or legal evidence before implementation. This approval settles the policy direction while leaving implementation blocked until the applicable evidence is reviewed and accepted.

### Plain-language terms

- **Authentication** means verifying who controls an account. **Authorization** means deciding what that authenticated account may do.
- **Provider** means a future external sign-in service; none has been selected. A **provider binding** is a protected record connecting a verified provider identity to one PARMAR account.
- **Step-up** means asking for fresh proof again before a sensitive action.
- **Security audit event** is a protected record of an important security or account action. It is not the same as an optional diagnostic log used for troubleshooting.
- **Tombstone** means a minimal retained record that prevents an identifier or provider identity from being reused or silently reassigned.
- **SSO** means one PARMAR sign-in identity being used across products. That shared identity boundary is already approved; technical integration and each product's release remain gated.

## Already-settled boundaries — not up for reapproval here

These are approved requirements or product directions, not pending APR choices:

- IT-01–IT-15 and D-01–D-13 remain unchanged.
- D-02's **PARMAR-wide shared identity and SSO boundary** is approved. Home, VOKKI, Desktop, Android, and future products do not create separate PARMAR identity systems. This review does not choose how SSO is implemented.
- Account IDs are PARMAR-issued, immutable, provider-independent, and not client-selected. No automatic account linking, account merging, or identity claims based on matching email/name/phone are permitted.
- Provider selection remains deferred until requirements comparison and security approval.
- Workspace membership does not grant access to personal content. Resource authorization remains separate from authentication.
- Personal memory remains account/user-scoped unless a separate policy is approved. No automatic profile/workspace migration is approved.
- External AI transfer requires explicit scoped consent, data minimization, and no silent fallback.
- PARMAR governance and required human approval remain separate from identity; signing in or approving a bounded action does not itself execute or verify it.
- AETHER Android remains strictly offline-only in its current release.
- AETHER Desktop `REMOTE_BROWSING_ENABLED=false` remains unchanged until independent isolation gates pass. Authentication does not grant browsing authority.
- Home and VOKKI are separate PARMAR Core product consumers, not separate identity systems. No legacy `Principal.user_id` mapping is approved.

## Group 1 — Enrollment and account creation (APR-01–APR-03)

### APR-01 — Enrollment audience and default path

**What decision is requested?**
Which people may enroll first, and should ordinary individual enrollment be initiated by the person themselves?

**Why it matters**
Enrollment determines who can request a PARMAR account and how much exposure there is to unwanted sign-ups, automated abuse, exclusion, or administrator overreach. Organization/family participation is already an eventual product direction, but its detailed policies and release are not thereby enabled.

**Recommended default — approved as proposed policy baseline**
Start with verified, user-initiated individual enrollment through one PARMAR-controlled authority. Defer organization/family enrollment until its invitation, membership, legal, and safeguarding rules are separately approved.

**Practical alternatives**
- Defer all enrollment until provider-neutral requirements and assurance policy are ready.
- Start with a limited invite-only cohort, with abuse and enumeration controls.
- Approve a separately scoped organization or family cohort later; do not treat an invitation as account identity or ownership proof.

**Consequences**
Central, user-initiated enrollment improves accountability and user intent. Broad self-enrollment may increase automated abuse; invite-only or administrator-only enrollment can exclude users and create coercion or insider risks. None of these paths may accept a client-selected account ID or create a separate product account.

**Evidence/review before implementation**
Requirements-based provider comparison and security approval (provider remains unselected), enrollment assurance/threat analysis, privacy/legal review, rate-limit and anti-enumeration design, and named operations ownership.

**Remains blocked**
Any enrollment route or caller, provisioning activation, production authentication, and organization/family enrollment.

**Recorded decision — APR-01:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-02 — Enrollment proof and pending request

**What decision is requested?**
What must a person prove before a PARMAR account becomes active, and should incomplete verification use a temporary pending request?

**Why it matters**
Activating an account before proof is complete risks impersonation and orphaned active accounts. Keeping pending requests can retain personal data and create account-enumeration or cleanup risks.

**Recommended default — approved as proposed policy baseline**
Mint the immutable PARMAR account ID only after fresh, replay-resistant proof is verified server-side. If verification cannot finish in one interaction, retain only a short-lived pending request that cannot authenticate, receive a provider binding, or access data.

**Practical alternatives**
- Do not create any account record until proof is complete.
- Permit a minimal, expiring pending request for asynchronous verification, with approved expiry and deletion behavior.

**Consequences**
The default reduces premature activation and keeps account identity distinct from an unverified claim. An asynchronous request may improve usability but requires careful minimization and non-enumerating status messages. No provider, factor, or assurance strength is chosen here.

**Evidence/review before implementation**
Provider-neutral verification contract, threat review for replay/issuer/audience/expiry, proof-retention and expiry review, privacy/legal review, duplicate/conflict handling, and failure tests.

**Remains blocked**
Account activation, proof collection, pending-request storage, and any production sign-in flow.

**Recorded decision — APR-02:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-03 — Provisioning authority and administrative facilitation

**What decision is requested?**
Who may initiate or facilitate enrollment, and may an administrator help with the process under a defined authority?

**Why it matters**
Unbounded administrator power can enable insider-driven account takeover or unauthorized creation. A narrowly controlled facilitator may help users, but must not become a substitute identity authority.

**Recommended default — approved as proposed policy baseline**
Keep one non-public PARMAR-controlled authority. An administrator may only facilitate under an explicitly approved purpose; the account holder must independently prove control before activation. Require requester/approver separation for exceptional human-facilitated actions.

**Practical alternatives**
- Do not allow administrator involvement in enrollment.
- Allow narrowly scoped facilitation with dual control, audit, notice, and independently verified user participation.

**Consequences**
No-admin enrollment minimizes insider access but may complicate managed onboarding. Facilitation can improve support but increases risk unless roles are separated and recorded. Administrators may never impersonate a user, self-approve ownership, replace user proof, choose or alter an account ID, or gain personal-content access by role.

**Evidence/review before implementation**
Named roles and separation of duties, legal/product authority, independently verified ownership flow, audit and notification design, abuse controls, and security review. A Python interface or internal code location is not proof of an enforced security capability.

**Remains blocked**
Any administrative enrollment or lifecycle mutation, any activated provisioner, and any public or product-local account creation path.

**Recorded decision — APR-03:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

## Group 2 — Lifecycle, recovery, and account protection (APR-04–APR-08)

### APR-04 — Lifecycle transition authority and review

**What decision is requested?**
Who can initiate and approve account suspension, disablement, reinstatement, rejection/expiry of enrollment, and closure transitions, and what review or appeal is required?

**Why it matters**
Unclear authority can cause unauthorized lockout, restoration, or closure. A transition table must specify who acts, evidence, review, reversibility, and security effects; account state is not a data-deletion result.

**Recommended default — approved as proposed policy baseline**
Adopt the proposed lifecycle matrix in the policy draft only after assigning authorities, requiring reason/evidence records and review deadlines, and providing an appeal path. Deny transitions not expressly listed. Require independent review for operator-initiated actions.

**Practical alternatives**
- Use a simpler disabled state with distinct reason categories and review rules.
- Use separate temporary suspension and longer-lived disablement with different authority and review procedures.

**Consequences**
Distinct states can make temporary security holds and longer-term restrictions clearer, but increase operational complexity. A simpler state model is easier to explain but may blur purpose and review timing. Suspension/disablement must not silently delete data or permit support access to it.

**Evidence/review before implementation**
Lifecycle threat model; assigned Provisioning, Security, and Lifecycle Authorities; legal/privacy review; notice and appeal rules; state/session/approval impact matrix; tested transition and failure behavior.

**Remains blocked**
Production state transitions and state-based authentication/access decisions. The current registry exposes only `ACTIVE`/`DISABLED` and has no status-transition operation.

**Recorded decision — APR-04:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-05 — Recovery and lost-account procedures

**What decision is requested?**
What evidence and process let a person recover control of the same PARMAR account after losing a device or sign-in method?

**Why it matters**
Weak recovery can bypass otherwise strong authentication. Overly strict recovery can permanently lock out the account holder. Recovery restores control of the same identity; it must not create a new identity, merge accounts, or bypass a lifecycle restriction.

**Recommended default — approved as proposed policy baseline**
Require risk-reviewed ownership evidence and fresh proof for replacement methods; deny when evidence is ambiguous. Do not rely solely on matching email/name/phone, account-ID knowledge, workspace membership, device possession, or support assertion.

**Practical alternatives**
- Require an existing strong method; provide no weaker fallback.
- Permit narrowly scoped support-assisted recovery under independent verification, dual control, audit, and notice.
- Deny recovery in specified high-risk cases and provide an appeal/review path.

**Consequences**
Stronger proof lowers takeover risk but can increase lockout and support burden. Support-assisted paths can improve access but create insider and social-engineering risks. Recovery must not grant private-content access or resource permissions by itself.

**Evidence/review before implementation**
Recovery threat model, assurance/factor review, lost-device and passkey policy, abuse and account-enumeration tests, notification policy, legal/privacy review, and independently tested recovery cases. Exact factors and delays remain unselected.

**Remains blocked**
Production recovery, replacement of authentication methods, lost-device recovery, and restoration from suspended/disabled states.

**Recorded decision — APR-05:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-06 — Enrollment, login, and recovery abuse controls

**What decision is requested?**
What rate limits, retries, cooldowns, lockout behavior, anti-automation controls, and appeal process are acceptable?

**Why it matters**
Weak controls invite automated enrollment, credential attacks, and recovery abuse. Aggressive controls can let an attacker lock out a user or can burden legitimate users, including users relying on assistive technology or shared networks.

**Recommended default — approved as proposed policy baseline**
Use layered, measurable abuse controls and non-enumerating responses; avoid permanent lockout by an unauthenticated attacker. Set no numeric threshold until security and usability evidence supports it.

**Practical alternatives**
- Fixed thresholds, easier to explain but potentially easier to evade or abuse for denial of service.
- Risk-adaptive throttling, more flexible but requiring careful signal minimization and bias/privacy review.
- Progressive challenges or monitored staged rollout, improving adaptation but adding user friction and operational burden.

**Consequences**
The choice affects account-takeover risk, availability, accessibility, privacy, and operations workload. Signals should be minimized and must not expose whether an account exists.

**Evidence/review before implementation**
Threat/abuse analysis, accessibility and privacy review of signals, measured traffic assumptions, recovery/appeal design, monitoring ownership, and adversarial tests. No universal threshold is presumed.

**Remains blocked**
Public enrollment, production login/recovery exposure, and production authentication.

**Recorded decision — APR-06:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-07 — Session, device, and approval revocation

**What decision is requested?**
What must be revoked after a lost device, security hold, disablement, closure, or all-device logout, and what measured propagation delay is acceptable?

**Why it matters**
Slow revocation can leave a stolen session or pending approval usable. Revoking too broadly can disrupt legitimate users, but existing sessions must not quietly survive a confirmed security action.

**Recommended default — approved as proposed policy baseline**
Revoke affected per-device sessions promptly on security hold, disablement, and closure. Require the PARMAR human-approval authority to cancel or revalidate pending approvals. Set measurable latency only after the actual service topology is known. Reinstatement must not resurrect old sessions or approvals.

**Practical alternatives**
- Revoke only the affected device/session for routine logout, with account-wide emergency revocation.
- Revoke every session and re-evaluate every pending approval for any lifecycle block.

**Consequences**
Narrow revocation reduces disruption but may miss compromised sessions. Account-wide revocation is safer in uncertain cases but can interrupt all devices. The identity service does not itself approve or execute actions.

**Evidence/review before implementation**
Session/device architecture, approval authority contract, measured propagation tests, disconnected-device behavior, failure handling, and supported-platform security review. Do not invent a latency target without evidence.

**Remains blocked**
Production device inventory/logout, state-change enforcement, session revocation, and approval cancellation/revalidation.

**Recorded decision — APR-07:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-08 — Sensitive-action step-up verification

**What decision is requested?**
Which sensitive actions require a fresh verification, and how recent/strong must that proof be?

**Why it matters**
Fresh verification can limit harm from a stolen or unattended session. Too many or confusing prompts can lead to unsafe workarounds. One proof must not be treated as blanket authority for unrelated changes.

**Recommended default — approved as proposed policy baseline**
Define an action-scoped step-up rule, but keep the precise action list, freshness window, and assurance level open pending threat and implementation evidence. Step-up confirms control of an already-resolved account; it is not resource authorization.

**Practical alternatives**
- Risk-tiered actions and freshness windows.
- A smaller fixed set of mandatory sensitive actions, simpler to explain but less adaptive.

**Boundaries with related decisions**
- **APR-05 recovery:** recovery establishes control of the same account through its own approved evidence. Step-up does not replace recovery or permit bypassing a restriction.
- **APR-11 provider binding/linking:** adding a method separately requires fresh proof of control of that method and proof of the existing account as required by IT-03. Generic step-up alone is insufficient.
- **APR-13 closure/reinstatement:** closure intent, cancellation, and reinstatement use the separately approved lifecycle proof and authority. Step-up does not itself authorize a transition.

**Consequences**
Weak freshness can leave persistent takeover opportunities; excessive prompts can harm usability and accessibility. Exact assurance cannot be selected until provider-neutral security review; provider remains unselected.

**Evidence/review before implementation**
Action threat model, session policy, assurance options review, recovery/linking/closure design coordination, accessibility/privacy review, and tested replay/expiry behavior.

**Remains blocked**
Sensitive account changes and all APR-05/11/13 paths that depend on the unresolved proof rules.

**Recorded decision — APR-08:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

## Group 3 — Notifications, audit, and provider bindings (APR-09–APR-12)

### APR-09 — Security notifications and delivery failure

**What decision is requested?**
Which account/security events should notify the user, through which verified channels, and what should happen when delivery fails?

**Why it matters**
Notifications can help a person detect takeover or unexpected changes. Unsafe delivery can disclose account existence or sensitive information to an unverified recipient. Requiring delivery before every operation may let notification outages block legitimate security actions.

**Recommended default — approved as proposed policy baseline**
Notify about new enrollment/methods, recovery, high-risk state changes, closure, and important data-lifecycle outcomes when a safe verified channel exists. Do not disclose sensitive attributes to unverified recipients. Define escalation without bypassing proof.

**Practical alternatives**
- Notify for every listed event, with stronger coverage but more delivery burden and potential alert fatigue.
- Notify only higher-risk events, reducing noise but potentially delaying detection.
- Use more than one verified channel for selected high-risk events, improving reach but increasing privacy exposure and operational complexity.

**Consequences**
Missing alerts can delay response; excessive or unsafe alerts can expose private information, enable phishing, or undermine non-enumeration. Notification delivery is not identity proof.

**Evidence/review before implementation**
Verified-channel policy, event taxonomy, delivery-failure and escalation plan, anti-enumeration/privacy review, and tested outage behavior.

**Remains blocked**
User-facing enrollment, linking, recovery, state-change, and closure notification workflows.

**Recorded decision — APR-09:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-10 — Security audit records and audit-service outages

**What decision is requested?**
Which events require a protected security audit record, which logs are merely optional diagnostics, and what should happen if a required audit record cannot be durably written?

**Why it matters**
Without required audit evidence, incident response and accountability can fail. But treating optional diagnostic logging as mandatory can unnecessarily block service, while treating diagnostics as a substitute can conceal missing security evidence.

**Recommended default — approved as proposed policy baseline**
Require minimal durable security audit evidence for account creation/activation, recovery/method changes, provider-binding writes, lifecycle changes, session/approval revocation or restoration, privileged authorization/approval, private-data export, and deletion/retention status changes.

If that required record is unavailable:

- **Fail closed before access-granting or identity-changing operations:** no account activation, recovery/method change, binding write, reinstatement, sensitive approval/execution, private-data export, or report of deletion success.
- **Allow a restrictive action only with durable evidence:** denial, suspension, disablement, revocation, or rate limiting may proceed only if the restrictive state is durably applied and an atomic durable outbox/incident record is committed for later audit reconciliation.
- **If neither restriction nor audit can be durably recorded:** deny at the access boundary, escalate, and do not claim the mutation succeeded.
- **Reads:** an already-authorized read may continue only if its approved policy does not require a security audit event. A private-data export is not an ordinary read.
- **Optional diagnostics:** sanitized troubleshooting logs may be sampled or dropped during an outage. They never substitute for mandatory security audit and must not collect unnecessary content or secrets.

**Practical alternatives**
- Fail every sensitive mutation closed when the central audit store is unavailable. This is simpler and strict, but may delay protective restrictions.
- Allow only durable restrictive actions through an atomic outbox and reconcile them later. This can preserve protection during an outage, but requires reliable local durability and recovery evidence.
- Optional diagnostics may continue, be sampled, or be dropped; they are not security audit records.

**Consequences**
Failing open on identity, authorization, approval, export, or deletion claims risks concealed or unauthorized actions. Blocking restrictions may prolong an attack. Outbox designs add availability, durability, and reconciliation complexity. Excessive audit data increases privacy and breach impact. No audit system or durable outbox is claimed to exist.

**Evidence/review before implementation**
Event classification, data minimization, access/retention and legal/privacy review, durable storage/key design, incident ownership, failure-injection tests, and proof that outbox reconciliation cannot silently lose or duplicate events. Do not invent a universal outage duration or threshold.

**Remains blocked**
Any gated operation lacking required durable evidence or approved reconciliation, and any production claim of audit integrity or complete lifecycle reporting.

**Recorded decision — APR-10:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-11 — Provider-binding writer and optional linking

**What decision is requested?**
After provider selection is separately authorized, what user-controlled rules should govern adding or removing a provider sign-in method?

**Why it matters**
A provider binding connects one exact verified `(issuer, subject)` to one PARMAR account. Weak linking is a direct account-takeover path. Binding existence alone is not proof of a current authenticated user.

**Recommended default — approved as proposed policy baseline**
Keep the current registry lookup-only and inactive. Before any writer, require explicit user intent, fresh proof of the existing account and newly added method, exact uniqueness, transactional conflict handling, notification, recovery/last-method safety, and independent testing. Never auto-link or merge.

**Practical alternatives**
- Defer all method linking.
- Allow only a narrowly reviewed method set.
- Permit explicit linking under the recommended proof, uniqueness, audit, and recovery controls.

**Consequences**
Linking can improve choice and recovery but adds a high-risk mutation path. Deferral reduces takeover risk but can limit methods. Matching email/name/phone or unknown bindings never establish identity or create an account.

**Evidence/review before implementation**
Provider comparison and security approval remain prerequisites; adapter threat review, proof/replay/conflict analysis, recovery policy, audit/notification controls, uniqueness/race tests, and release approval.

**Remains blocked**
Any provider-binding writer, provider sign-in flow, link/unlink workflow, or production provider integration.

**Recorded decision — APR-11:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-12 — Account-ID and provider-binding tombstones

**What decision is requested?**
What minimum account-ID record must remain so an immutable ID is never reused, and separately, how long should provider-binding records remain unusable after closure?

**Why it matters**
The account ID and a provider identity are different identifiers with different retention purposes. Removing an account-ID reservation can permit ID reuse and break IT-01. Retaining provider subjects forever can preserve linkable personal data; removing them too early can enable a method to be silently reassigned or used to recreate/link an account.

**Recommended default — approved as proposed policy baseline**
- **Account ID:** permanently reserve the immutable account ID, retaining only the minimum protected tombstone/status needed to enforce non-reuse and report closure accurately.
- **Provider binding:** immediately make it unusable for authentication on a non-active/closed account. Keep any provider-binding tombstone separately from the account-ID reservation and retain/remove it only under an approved, uniqueness-safe policy.
- Restrict both records to authorized identity/lifecycle functions. Do not retain credentials, raw proof, or unnecessary claims. Legal/privacy basis, minimization, access, and review requirements remain unresolved.

**Practical alternatives**
- Retain a minimal account-ID reservation indefinitely and keep provider-binding tombstones for a separately approved period.
- Delete other account attributes while retaining a non-reassignable ID ledger, but only if it demonstrably enforces non-reuse.
- Do not delete the reservation if deletion would permit ID reuse or make the no-reuse guarantee unverifiable. No provider-binding expiry period is selected here.

**Consequences**
An account-ID ledger protects immutable identity and audit integrity but may remain linkable personal data, requiring legal/privacy review. Provider-binding retention affects privacy, future re-enrollment, and uniqueness. Neither record should be described as fully deleted without evidence.

**Evidence/review before implementation**
Identity-ledger design, data minimization, legal/privacy retention basis, access controls, closure/reporting model, provider-link uniqueness design, and verified deletion/retention behavior.

**Remains blocked**
Account-ID reservation deletion/reuse, provider-binding tombstone removal/reuse, and claims that identity records are fully deleted.

**Recorded decision — APR-12:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

## Group 4 — Closure, revocation, and data lifecycle (APR-13–APR-17)

### APR-13 — Closure grace, cancellation, and reinstatement

**What decision is requested?**
Is there a grace period to cancel closure, when is cancellation allowed, and can a closed account ever be reinstated?

**Why it matters**
Immediate closure reduces access exposure, but an irreversible mistake can harm the account holder. A grace period improves recoverability but may prolong retention or delay data jobs. Reopening an account can restore compromised methods if not carefully verified.

**Recommended default — approved as proposed policy baseline**
Block protected access and revoke applicable sessions/approvals when closure is confirmed. Permit cancellation only within an explicitly approved window and before irreversible work. Treat `CLOSED` as terminal for routine operations; any exception requires independent verified review. The proposed 30-day grace period is a candidate only, subject to legal, privacy, and operational validation; it is not a finalized or universal retention rule.

**Practical alternatives**
- No cancellation window; simpler and minimizes continued access, but increases risk of accidental irreversible closure.
- A bounded cancellation window before data deletion starts; improves recovery but delays final closure processing.
- A separately approved appeal without automatically reactivating the old account or restoring old methods.

**Consequences**
Closure ends account access; it does not prove all data was deleted. Cancellation must not resurrect sessions, approvals, or unverified provider methods. Reinstatement evidence and authority must remain distinct from the lifecycle authority question in APR-04.

**Evidence/review before implementation**
Closure confirmation/step-up policy, data-job idempotency, legal holds, notification, recovery proof, session and approval revocation evidence, privacy/legal review, and tested cancellation/failure cases.

**Remains blocked**
Closure UI/processing, cancellation, closed-account reinstatement, and claims about closure completion.

**Recorded decision — APR-13:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-14 — Workspace membership and shared-resource effects

**What decision is requested?**
When should membership be blocked or revoked as an account becomes non-active or closes, and who retains or may reassign workspace-owned shared resources?

**Why it matters**
Continued membership may preserve access after a security restriction. But deleting or transferring shared resources automatically can harm other workspace participants. Personal resources must remain separately owned and authorized.

**Recommended default — approved as proposed policy baseline**
Block membership-based access while an account is non-active and revoke memberships/invitations on closure. Preserve workspace-owned records under a separately named workspace data owner. Do not delete or transfer shared resources by implication. Membership never grants personal-content access.

**Practical alternatives**
- Revoke membership immediately, minimizing access but potentially interrupting shared work.
- Use a defined handover period for workspace records, preserving continuity but requiring strict time bounds and access review.
- Require resource-by-resource owner review before reassignment or deletion, improving control but increasing operational burden.

**Consequences**
A workspace may preserve its own shared records without exposing personal conversations, profiles, or memory. A workspace owner/admin cannot grant themselves personal access just by membership or role.

**Evidence/review before implementation**
Workspace ownership and roles, data-class inventory, legal/privacy review, route-level authorization, handover/retention rules, and two-account/two-workspace tests.

**Remains blocked**
Workspace membership lifecycle, invitations, shared-resource reassignment/deletion, and any cross-user access beyond already-approved authorization.

**Recorded decision — APR-14:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-15 — Personal-data retention, deletion, and export scope

**What decision is requested?**
Which personal data classes are included in export, retention, delete, and reset policy, including conversations, memory, consent records, profiles, and unassigned legacy records?

**Why it matters**
Incomplete scope can omit records or expose records that belong elsewhere. “Export” must be owner-scoped. Legacy records without an approved owner mapping must not be assigned by guesswork. User memory remains account/user-scoped by default.

**Recommended default — approved as proposed policy baseline**
Keep memory user-scoped; do not auto-assign unprofiled/legacy conversations or migrate/share personal records. Decide inclusion/exclusion by data class after inventory, custodian, and legal/privacy review. Report pending, retained, failed, and unverifiable states truthfully.

**Export format and delivery timing**
These are **implementation details to specify later**, not policy decisions approved here. Format depends on actual data classes, supported representations, accessibility/security review, and custodian capability. Delivery timing depends on scale, legal obligations, and verified operations. This review approves no file format, delivery mechanism, or deadline; those details remain blocked until specified and verified.

**Practical alternatives**
- Include all user-accessible classes subject to disclosed, approved exceptions; broader coverage helps portability but increases export security and privacy risk.
- Define a narrower, class-by-class export scope with clearly disclosed exclusions; simpler to implement but may omit useful information.

**Consequences**
Broad exports are sensitive and need strong authorization, integrity, and secure delivery. Narrow scope risks user surprise or incomplete portability. Retention and deletion vary by class; closure is not proof that all copies are gone.

**Evidence/review before implementation**
Data inventory, owner/custodian list, scope and exclusion review, export authorization and integrity design, encryption/key and migration policy, legal/privacy requirements, and verified primary/derived/backup handling.

**Remains blocked**
Production personal-data persistence, export scope/behavior, delete/reset, closure completion claims, and legacy migration. Format/timing require later implementation specification and verification.

**Recorded decision — APR-15:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-16 — Backups, replicas, and external-copy expiry

**What decision is requested?**
What expiry, deletion, and restore protections apply to backups, replicas, caches, audit copies, and copies held by external processors?

**Why it matters**
Copies can outlive deletion from a primary store or reappear after restore. External recipients may have separate retention terms or may be unable to provide deletion evidence. No unsupported deletion promise is acceptable.

**Recommended default — approved as proposed policy baseline**
Define lifecycle per data custodian. Track restore paths and retention basis; prevent silent reintroduction after restore; report external-copy requests as pending, completed, failed, or unverifiable. Set no expiry deadline until the capability is tested and an owner commits to it.

**Practical alternatives**
- Shorter expiry reduces retained exposure but increases cost and may weaken recovery.
- Longer expiry supports restore/recovery but retains data longer.
- External copies may follow separately reviewed contractual terms; if deletion cannot be verified, report that limitation rather than claim erasure.

**Consequences**
Backup policy trades privacy against recovery and operational resilience. A restore process that reintroduces deleted data can invalidate a deletion claim. External copies cannot be recalled merely by closing a PARMAR account.

**Evidence/review before implementation**
Data-flow and custodian inventory, encryption/key management, backup/restore drills, provider terms, legal/privacy review, and proof of deletion/re-deletion or other restore controls.

**Remains blocked**
Production backup/replica lifecycle, cryptographic-erasure claims, external deletion promises, and deletion service-level commitments.

**Recorded decision — APR-16:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-17 — Closure completion and deletion reporting

**What decision is requested?**
What evidence permits reporting an account as closed or reporting deletion as complete, partial, retained, failed, or unverifiable?

**Why it matters**
Access closure and data deletion are separate. A closed account may still have data pending deletion or retained under an approved basis. Reporting “deleted” without custodian evidence is misleading.

**Recommended default — approved as proposed policy baseline**
Separate permanent access closure from asynchronous per-class deletion. Report closure only after access revocation/block evidence. Report deletion only when each in-scope custodian supplies sufficient evidence; keep pending, retained, failed, or unverifiable outcomes visible.

**Practical alternatives**
- Complete access closure independently of data jobs, with a transparent per-class status report.
- Require specified custodian acknowledgements before declaring closure complete, while still disclosing exceptions and delays.

**Consequences**
Waiting for all copies may delay a closure status; reporting closure earlier requires clear language so users do not mistake it for complete erasure. No option may overstate what was deleted.

**Evidence/review before implementation**
APR-10 audit policy, APR-13 closure rules, APR-15/16 data and backup scope, durable revocation evidence, custodian acknowledgements, legal/privacy review, and user-facing status design.

**Remains blocked**
Closure status APIs, user-facing deletion reports, product/data-custodian lifecycle integrations, and any “deleted/completed” claim without evidence.

**Recorded decision — APR-17:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

## Group 5 — Exceptional support and product integration (APR-18–APR-19)

### APR-18 — Exceptional support access to private content

**What decision is requested?**
Is any exceptional, incident-only support access to private content allowed, and if so, what independent safeguards are mandatory?

**Why it matters**
Standing access creates insider and breach risk. An emergency process may help respond to an incident but can become an unreviewed route around user ownership and authorization.

**Recommended default — approved as proposed policy baseline**
No standing access. Prefer no support content access; any exception must be separately approved, time-limited, purpose-bound, least-privilege, independently authorized, notified where safe, and audited.

**Practical alternatives**
- Prohibit all support access to private content, with operationally stronger privacy but potentially fewer support options.
- Allow narrowly defined break-glass access for named incidents under dual control and mandatory after-action review.

**Consequences**
An exception may improve incident handling but increases privacy and insider-abuse risk. Neither support role nor administrator status grants personal-content access or profile permissions.

**Evidence/review before implementation**
IT-15-compatible legal/privacy review, incident-response ownership, separation of duties, audit integrity/retention, notification, and independent access tests. No standing access may be introduced.

**Remains blocked**
Any workflow that lets support staff view private content or bypass owner authorization.

**Recorded decision — APR-18:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

### APR-19 — Product-specific identity integration and release

**What decision is requested?**
For each product, what trusted connection to the shared PARMAR identity is acceptable, what product-specific audience and authorization must apply, and what evidence is required before release?

**Why it matters**
Shared identity does not mean shared permissions, databases, cookies, or content. A broad or unreviewed handoff can leak sessions or authority across products. Local/offline behavior must not be made dependent on account availability.

**Recommended default — approved as proposed policy baseline**
Preserve the approved PARMAR-wide identity/SSO boundary. Review and approve each product integration, audience/session design, authorization evidence, and release separately. Use server-selected audiences and product-specific authorization; do not create product accounts or imply shared permissions.

**Practical alternatives**
- Defer authenticated capability for a product while keeping its approved local/offline use available.
- Propose a separate integration design per product, with independent threat model, authorization tests, and release evidence.

**Consequences**
Deferral limits protected features but preserves isolation. Integration may improve continuity but creates credential, audience-confusion, revocation, and product-authorization risks. This is **not** a question about whether PARMAR-wide shared identity/SSO should exist.

**Evidence/review before implementation**
Provider selection remains separately gated. Require product-specific audience/session topology, replay/expiry/revocation design, complete route/resource authorization, threat review, and independent platform testing. Home/VOKKI remain separate product consumers under PARMAR Core. Desktop browser content receives no privileged PARMAR credentials. Android remains offline-only; any future authenticated Android feature requires a distinct decision.

**Remains blocked**
Home/VOKKI production resolvers, Desktop control-plane authentication, any future Android request, and every authenticated future product integration or release.

**Recorded decision — APR-19:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

## Group 6 — Invitations and family/team access (APR-20)

### APR-20 — Organization/family invitations and enrollment

**What decision is requested?**
Should invitations create only a proposed workspace membership, and what invitation expiry, guardian/age, consent, and authority rules are needed?

**Why it matters**
An invitation can be abused for enumeration, coercion, or overbroad access, particularly in family/guardian contexts. An invite must not create an account, prove identity, or grant access to personal content.

**Recommended default — approved as proposed policy baseline**
Treat an invitation only as a workspace-membership proposal redeemed by an independently verified existing or newly enrolled PARMAR account. Keep family/guardian enrollment disabled until legal, consent, age, and authority rules are approved.

**Practical alternatives**
- Disable invitations until the workspace and family/team policy is complete.
- Support organization-only invitations under a separately reviewed membership policy.
- Define distinct family/guardian rules after legal/privacy review; do not infer them from eventual IT-06 scope.

**Consequences**
Expiring, single-use, opaque invitations can reduce replay and enumeration risks but add delivery and recovery complexity. Family access can create sensitive authority and consent issues. Membership still does not grant personal profile, conversation, or memory access.

**Evidence/review before implementation**
Legal/privacy review, age/guardian and consent policy, workspace role model, verified enrollment and redemption flow, invitation abuse/expiry tests, and explicit product release approval.

**Remains blocked**
Family/team onboarding, invitations, membership creation, and guardian/managed enrollment. APR-01 sets the initial enrollment posture; this item defines invitation effects and safeguards, so both remain separate decisions.

**Recorded decision — APR-20:** APPROVE RECOMMENDATION — Approved — Proposed Policy Baseline; approval date 2026-11-13.

**Status: APPROVED — PROPOSED POLICY BASELINE**

## Consolidated approval tracker

Each decision records the approved policy direction at the proposed-policy-baseline level; implementation gates remain open.

| Decision | Recorded decision | Approval scope and date | Status |
|---|---|---|---|
| APR-01 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-02 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-03 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-04 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-05 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-06 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-07 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-08 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-09 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-10 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-11 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-12 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-13 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-14 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-15 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-16 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-17 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-18 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-19 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |
| APR-20 | **APPROVE RECOMMENDATION** | Approved — Proposed Policy Baseline; 2026-11-13 | **APPROVED — PROPOSED POLICY BASELINE** |

Approval authority: User; date: 2026-11-13
Review revision: `PARMAR-ACCOUNT-PROVISIONING-USER-APPROVAL-REVIEW.md`

## Dependencies and implementation blockers

Policy approval and technical acceptance are separate gates:

| Decision(s) | Immediate blocked work | Additional evidence before implementation/release |
|---|---|---|
| APR-01–APR-03 | Enrollment path, provisioning authority/caller, public endpoint, any account activation | Provider comparison/security review; verified ownership proof; role separation; abuse, privacy, and operational controls |
| APR-02, APR-05–APR-06, APR-08–APR-09 | Verification, recovery, abuse controls, step-up, notifications | Threat and accessibility review; provider-neutral assurance; measured abuse and delivery/revocation behavior |
| APR-04, APR-07, APR-13 | State transitions, session/device/approval revocation, closure/cancellation/reinstatement | Named authorities; tested lifecycle, audit, revocation, recovery, and failure behavior |
| APR-10 | Security-critical operation without required durable audit or approved reconciliation | Event classification, protected audit design, outage injection/recovery tests; no audit system is assumed to exist |
| APR-11–APR-12 | Provider adapter/writer, linking/unlinking, binding or identity-record removal/reuse | Provider selection remains deferred; adapter threat review; unique mapping/race tests; account-ID non-reuse design; legal/privacy retention review |
| APR-14 and APR-20 | Workspace membership/invitation lifecycle and shared-resource handover | Route/resource authorization; legal and age/guardian review; two-account/two-workspace tests |
| APR-15–APR-17 | Export scope, production data lifecycle, closure/deletion claims, backup/replica processing and status reporting | Data inventory, custodian commitments, key/backup/restore evidence, legal/privacy review, independently verified completion status |
| APR-18 | Any support access to private content | Separately approved incident policy, dual control, time/purpose limits, notification/audit, independent review |
| APR-19 | Any authenticated Home, VOKKI, Desktop, Android-future, or other product integration | Product-specific audience/session design, route authorization, isolation testing, independent platform and release approval; D-02 itself is settled |

Regardless of APR policy-baseline approval, the current registry is an inactive v3 foundation: no active provider adapter or binding writer, no live Home/VOKKI account resolver, and no production authentication or provisioning. `TrustedInternalAccountProvisioner` remains convention-based, not an enforced in-process security capability. Do not map legacy user IDs, conversations, or memories to account IDs without a separately approved and verified migration.

## What approval does and does not authorize

The recorded approval settles APR-01–APR-20 only as proposed policy directions, subject to all stated gates. It does not mean any control is implemented, safe in a particular deployment, or legally sufficient.

This approval does not authorize:

- Production authentication, account creation/provisioning, or activation of `TrustedInternalAccountProvisioner`.
- Provider selection, provider integration, binding writers, account linking, or SSO implementation.
- Recovery, passkeys/MFA, session changes, workspace sharing, migration, data deletion, or export implementation.
- Home, VOKKI, Desktop, Android, or other product integration or release.
- AETHER Android networking or change to Desktop `REMOTE_BROWSING_ENABLED=false`.
- Any sensitive action, approval, execution, or external AI transfer.

Each implementation task still needs a narrow explicit authorization, approved policy revision, applicable legal/privacy/security review, technical evidence and tests, independent verification, and release-owner approval. **No production authentication, account provisioning, provider linking, or SSO activation follows automatically from this review.**

## Sources reviewed

- [PARMAR-ACCOUNT-PROVISIONING-APPROVAL-REGISTER.md](./PARMAR-ACCOUNT-PROVISIONING-APPROVAL-REGISTER.md) — source decisions and status.
- [PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md](./PARMAR-ACCOUNT-PROVISIONING-POLICY-DRAFT.md) — proposed lifecycle, authority, recovery, closure, and activation gates.
- [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md) — approved IT-01–IT-15 and shared identity boundary.
- [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md) — implementation evidence and outstanding gates.
- [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md) — approved D-01–D-13 and product boundaries.
- [PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md) — proposed architecture, trust boundaries, and unresolved technical choices.
- [PARMAR-IDENTITY-IMPLEMENTATION-BASELINE.md](./PARMAR-IDENTITY-IMPLEMENTATION-BASELINE.md) — safe states, product release boundaries, and implementation gates.
- [PARMAR-CORE-IDENTITY-CONTRACTS.md](./PARMAR-CORE-IDENTITY-CONTRACTS.md) — current provider-neutral contracts and implementation limits.
