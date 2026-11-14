# PARMAR Core Governance Contracts

| Field | Value |
|---|---|
| Status | Architecture contract for review; not an implementation or release authorization |
| Scope | PARMAR Core governance of agents, plugins, workflows, automation, and API integrations |
| Authority | PARMAR Core policy and authorization; explicit human approval remains required for consequential actions |
| Security boundary | AETHER is independent. Keep desktop `REMOTE_BROWSING_ENABLED=false`; Android AETHER remains offline-only. |

> These contracts define required behavior, not current capability. They do not authorize production authentication, provider or integration activation, plugin execution, payment activation, deployment, or unrestricted agent execution. Existing approval records and security gates retain authority for their scope.

## 1. Contract invariants

1. **PARMAR Core decides.** No user interface, model, agent, plugin, workflow, connected account, integration, or verifier can alter policy, grant permission, approve an action, or claim a verified outcome.
2. **Identity is not authority.** Authentication establishes a principal; authorization separately checks the principal, target resource, requested action, applicable permission, purpose, consent, current policy, environment, and approval requirement.
3. **Deny by default.** Missing, malformed, expired, revoked, ambiguous, stale, unavailable, or unauditable evidence denies the operation. No permissive fallback or success-shaped response.
4. **Least privilege and non-inheritance.** Every actor receives only the minimum resource/action scope required for a bounded task. A connected account, installed plugin, agent definition, workflow template, or prior approval confers no blanket or transitive permission.
5. **Human oversight for consequences.** Consequential actions require explicit, action-specific human approval. Approval is neither execution nor proof of success.
6. **Untrusted outputs stay data.** Model, agent, plugin, workflow-step, webhook, and integration outputs are data to validate. They never become privileged instructions or policy input.
7. **No implicit retry.** A consequential action with an uncertain outcome is not retried until its state is reconciled and a fresh policy/authorization check establishes a safe retry or new approval is obtained.
8. **Separate environments and boundaries.** Test/sandbox identities, credentials, data, endpoints, and effects are isolated from production. PARMAR credentials and sessions are never exposed to browser content or untrusted plugins.

## 2. Identity and authority contract

Each identity is a distinct, server-recognized principal or context. IDs are not interchangeable, caller-supplied identity fields are never proof, and a product session does not itself grant resource or action authority.

| Actor | Identity and authority | Explicitly not authority |
|---|---|---|
| **User** | Authenticated PARMAR account resolved by a trusted server boundary; active session/profile/workspace is separately checked. May request work and grant only permitted, scoped permissions. | Client-supplied account/profile/role, session display, workspace membership, or connected-account status does not establish access to a resource or action. |
| **PARMAR Core service** | Separate service identity for policy evaluation, authorization, approval records, dispatch brokerage, verification, and audit. Each service component has a narrow service-to-service scope. | A Core service identity does not imply user intent or human approval; a component cannot skip another required control. |
| **Agent** | Core-issued immutable agent ID and version, plus a short-lived run identity bound to one owner/request, declared role, tool set, data scope, policy version, and resource envelope. | The agent does not inherit the user's session, credentials, all connected accounts, or authority from its model/instructions. It cannot grant or expand its permissions. |
| **Plugin** | Publisher identity, immutable plugin ID/version and artifact digest, and a distinct installation identity. A call receives a narrow, short-lived broker capability for one declared purpose/scope. | Installation, review score, signature, Marketplace presence, or user-connected account is not runtime permission. Plugin code never receives PARMAR session or general-purpose credentials. |
| **Workflow definition/run** | Definition ID/version is distinct from each run ID, owner, trigger, and step identity. The orchestrator delegates a per-step capability only after current policy checks. | A shared template does not carry creator secrets, private data, permissions, approvals, or owner identity into another user's run. |
| **Integration / connected account** | Integration ID and external account/credential reference are separately bound to an owner, environment, destination, and explicitly granted scopes. Secrets remain in an approved server-side secret boundary. | Connection or successful authentication to a third party is not consent to every operation, resource, destination, or future use. |
| **Independent verifier** | Separate verifier identity and narrowly scoped read/evidence permissions for the action being checked. Verification records identify evidence source and method. | Agent agreement, executor self-report, provider repetition, or shared uncorroborated telemetry is not independent verification. |

### 2.1 Authorization decision

For every operation, PARMAR Core evaluates all applicable predicates before dispatch and rechecks mutable state immediately before the side effect:

`allow = valid_server_principal AND active_session AND resource_authorization AND exact_permission AND purpose/data_consent AND current_policy/risk_allow AND valid_approval_if_required AND valid_actor_capability AND audit_available`

For an external transfer, destination/provider authorization and data-minimization rules also apply. A permission or approval cannot override a policy denial, missing resource ownership, security gate, or platform boundary. The decision records the policy/version and reason. If any required predicate is unknown, the result is deny.

## 3. Permission model

Scopes are explicit, resource- and purpose-bound capabilities. These names describe semantic scope classes; they do not prescribe a production token format or authorize a particular provider.

| Scope class | Example bounded meaning | Default / required checks |
|---|---|---|
| **Read** | Read an identified resource or approved data class for a stated purpose. | Deny unless the server confirms ownership or an active operation-specific grant. Sensitive data may require additional policy/consent or human approval. |
| **Write** | Create or change a named resource/data class within a bounded owner, field, or operation set. | Deny unless explicitly granted. Destructive, shared, security/privacy-sensitive, or externally visible writes require human approval. |
| **Execute** | Invoke a named, reviewed operation through the PARMAR broker with fixed argument schema and limits. | Deny direct model/plugin calls. Core checks authorization, policy/risk, approval, quotas, idempotency, and stop state before dispatch. |
| **Communicate** | Send a specified message/content class to a named recipient or channel. | No general send scope. Preview the actual content, recipient, and channel; explicit approval is required for consequential, externally visible, or bulk communication. |
| **External action** | Cause an effect outside PARMAR, including a third-party API mutation, purchase/payment, account change, publication, or irreversible operation. | Deny by default; exact destination, operation, parameters, user authority, current consent, and explicit human approval are required. Separate legal/security/provider gates still apply. |

Every grant must bind: subject identity and actor type; grantor/authoritative source; resource and data class; allowed action; purpose; destination/environment where relevant; limits; issued and expiry times; policy and contract version; and revocation/consent state. No wildcard or “all future actions” grant is valid unless separately and explicitly specified by an approved policy; this contract provides no such default.

- Grant only the narrow operation and data needed; do not infer scope from account connection, plugin installation, agent role, workflow trigger, or model selection.
- Every call checks current policy and grant state. Recheck immediately before external egress or side effect; stale caches cannot extend a grant.
- Expiry is mandatory and bounded by an approved policy. No universal TTL is selected here. An absent, invalid, or unapproved expiry denies issuance/use.
- Revocation stops new calls immediately at the authoritative boundary, invalidates derived capabilities, cancels queued/unstarted work, and initiates cancellation/reconciliation for in-flight work. Report already-sent data/effects honestly.
- Permission verification checks issuer, subject, audience, resource, action, purpose, environment, time, revocation, and integrity. A signed but overbroad or stale grant still fails.
- Authorization to read a credential-backed service never authorizes reading or exporting the credential itself.

## 4. Human approval contract

Approval is required for at least:

- Any external or irreversible side effect, payment or financial action, purchase, commitment, or change affecting another person or organization.
- Sending/publishing content outside PARMAR; changing recipients, destination, visibility, or material content after review.
- Destructive or hard-to-reverse deletion, account/security/privacy changes, permission changes, credential or integration changes, and sensitive data export.
- A consequential write or execution the current policy classifies as high risk, ambiguous, novel, or outside a previously granted bounded scope.

Low-risk, reversible operations inside an explicit user-granted scope may proceed without per-action human approval only when the current policy explicitly allows them. If consequence classification is absent or uncertain, require approval or deny. No agent, plugin, workflow, API client, or model may self-approve or waive a required approval.

An approval record is server-side, authenticated/integrity-protected, expiring, single-use, replay-resistant, and bound to:

- approving principal and originating authenticated session/context;
- exact operation, normalized parameters or a cryptographic parameter digest, resource, recipient/destination, and environment;
- the requesting agent/plugin/workflow/integration identity and exact version/run/step;
- permission and consent references, policy/risk decision and version, consequence preview, and approval requirement;
- unique nonce/idempotency binding, creation/expiry, state, and audit correlation.

Changing the actor, resource, destination, data, parameters, environment, policy-relevant context, or material consequence invalidates the approval and requires a new review. Approval authorizes only the described dispatch—not unrelated future actions, retries with changed parameters, later workflow runs, or another actor. Recurring/standing approvals are not granted by this contract. Expiry durations are policy decisions; no numeric value is assumed. Users can reject or cancel before dispatch and revoke where the action semantics permit; cancellation after dispatch is reported as requested, confirmed, or unknown—not falsely as stopped.

## 5. Execution lifecycle contract

| State | Required operation and transition rule |
|---|---|
| **REQUESTED** | Authenticate server-side principal; validate request, actor, schema, size, correlation ID, and environment. Invalid input fails with a bounded error. |
| **POLICY_REVIEWED** | PARMAR Core evaluates intent, risk, data flow, purpose, applicable policy, resource ownership, allowed tools, and required human approval. Agent/provider output is untrusted input. |
| **APPROVAL_PENDING** | Show the user the actual operation, resource/data, destination, consequence, scope, and expiry. Reject, timeout, or cancellation causes no dispatch. Approval alone is not dispatch. |
| **AUTHORIZED** | After any required human approval is valid, confirm every permission, consent, actor capability, expiry, revocation, destination, and limit. Persist the exact action and parameters. |
| **DISPATCHED / RUNNING** | Immediately before dispatch, recheck policy, session, permissions, consent, approval, stop state, and idempotency. Send only the authorized parameters to an isolated least-privilege executor. |
| **VERIFYING** | A distinct verifier obtains action-appropriate evidence correlated to the authorized operation. Executor response alone is not proof. |
| **REPORTED** | Report verified success, failure, cancellation, blocked, or unknown. Unknown remains unknown until reconciled; never turn timeout or missing evidence into success. |

**Timeout, error, and retry rules**

- Before dispatch, timeout or dependency failure means no action was sent; record and report blocked/failed.
- After dispatch, timeout or disconnect means **unknown** unless independent evidence proves the actual outcome. Do not blindly retry.
- Retry a consequential action only after reconciliation proves the prior effect did not occur and a fresh policy/permission/approval check permits the same idempotent operation, or after obtaining a new approval for a new operation.
- Cancellation prevents new dispatches and attempts supported downstream stop; record whether stop was confirmed. A late result cannot bypass verification.
- Emergency stop disables new dispatch for the declared authority/scope, cancels queued work and requests cancellation of active work, revokes relevant run capabilities, and reconciles each in-flight outcome. It is not proof that external systems stopped.
- Audit/event-store unavailability before a consequential dispatch fails closed. Post-dispatch audit failure creates an explicit integrity/unknown incident and blocks further related dispatch until reconciliation; never silently drop the event.

## 6. Agent contract

Each agent definition declares immutable ID, publisher/owner, version and digest, role/purpose, system instructions and their provenance, approved model/provider class, tools and exact scopes, permitted data/memory classes, output schema, destination rules, and resource envelope (time, steps, concurrency, tokens/cost where relevant). Agent run identity is distinct from its owner and from PARMAR Core.

- Only a Core-approved model/provider route may be used. This is a contract requirement, not provider activation.
- Instructions can constrain the agent but cannot grant authority. Tool/model output cannot change the manifest, permission set, policy, approvals, or run identity.
- Memory is owner-scoped, purpose-limited, consented, and read/write-separated. No implicit cross-user, cross-profile, cross-workflow, or cross-run memory.
- Each tool call is independently authorized by Core. Agents cannot mint scopes, access raw credentials/sessions, invoke unreviewed tools, or delegate beyond their bounded scope.
- Enforce declared resource ceilings and stop conditions server-side. A budget/step/deadline exhaustion is a failure/partial/unknown result, not a reason to expand limits.
- Before promotion or version change, test the exact immutable artifact in an isolated sandbox against policy-denial, prompt-injection, secret-canary, scope-escalation, malformed-output, resource-exhaustion, cancellation, and cross-owner cases. Production use requires separate review and explicit release authorization.

## 7. Plugin contract

Every plugin manifest declares immutable plugin ID, publisher identity, version and artifact digest/signature; API compatibility; purpose; requested read/write/execute/communicate/external-action scopes; data classes and destinations; network/resource behavior; dependencies; storage/memory behavior; support/update/removal policy; and test/security-review evidence.

- A manifest is a request for review, not authority. Reject malformed, unsigned/untrusted, incompatible, overbroad, or unreviewed artifacts. No code executes merely because metadata is listed or installation is requested.
- Review the exact artifact and permission set before enabling it. An update that changes code, digest, dependencies, endpoint, or scope requires revalidation and any newly required user consent/approval.
- Run code in an isolated least-privilege sandbox with resource/network/filesystem limits and no PARMAR credential/session access. Any integration credential is held by a broker and used only for the authorized operation; it is never returned to plugin code.
- Plugin output is untrusted data. It cannot become privileged instructions, policy, approval, executable arguments, or trusted audit evidence without schema validation and a fresh Core decision.
- Disable/revoke on user request, policy change, security finding, expiry, incompatible version, or integrity failure. Revoke broker capabilities, stop new work, attempt cancellation, preserve necessary redacted evidence, and report uncertain external effects.
- Reviews, ratings, and “security verified” labels must be attributable and evidence-backed; no review substitutes for code/artifact security acceptance.

## 8. Workflow and automation contract

A workflow definition is versioned and immutable per run. It declares owner, trigger, inputs/data classes, destinations, conditions, ordered steps, each step’s actor/tool/scopes, approval checkpoints, error/timeout paths, retry rules, and enforced ceilings for steps, duration, concurrency, and resource/cost use. Limits must be approved per deployment; absent limits prevent activation.

- Triggers are explicit, authenticated, abuse-limited, and revocable. Scheduled/event triggers do not imply user presence or approval.
- Evaluate each step against current policy and authority; an earlier step or approval cannot authorize later, changed, or unrelated steps.
- Consequential operations require a fresh exact human approval at the point defined by policy. Record the approved step and arguments; changed data/recipient/parameters require new approval.
- Retry only safe/idempotent steps under an explicit bounded policy. For uncertain side effects, pause for reconciliation and human decision; never auto-replay.
- Provide visible run state, pause, stop/cancel, emergency-stop integration, and per-step audit. Partial work is reported with completed, failed, cancelled, and unknown steps separately.
- A shared template contains no private data, credential, session, permission, approval, or implicit owner grant. On instantiation, the new owner explicitly selects data and grants scopes; the template publisher cannot read the resulting run.

## 9. API and integration contract

- Every protected API authenticates at a trusted server boundary using an explicitly approved method; authentication and resource/action authorization are separate. Client-provided identities, endpoint URLs, scopes, roles, and approval claims are never authoritative.
- Each API/integration declares audience, owner, environment, scopes, version, data classes, destination, rate/size/concurrency limits, error semantics, webhook behavior, and revocation procedure. Unknown versions/scopes fail closed.
- Keep credentials in an approved server-side secret boundary. Use per-integration, least-privilege credentials; redact them from models, agents, plugins, clients, audit, logs, and support exports. Rotation/revocation invalidates dependent capabilities.
- Webhooks must authenticate the sender using an approved method and validate timestamp/freshness, payload schema/size, destination binding, and replay/idempotency key. Invalid or repeated deliveries do not create duplicate consequential actions.
- Rate/resource limits are enforced server-side with bounded queues and explicit rejection/backpressure. Numeric values remain deployment-specific approval decisions.
- Sandbox and production are separate trust domains: distinct credentials, data stores, endpoints, allowlists, signing/deployment identities, and audit partitions. Environment is server-selected, never a request parameter that upgrades authority. Sandbox tests cannot reach production effects; production credentials never enter tests.
- External integrations remain disabled until product, security, privacy/legal, operations, and provider gates for the specific integration pass.

## 10. Independent verification and audit contract

### 10.1 Verification evidence

For each claim, retain a verification record linked to the request and exact action: verifier identity/version; evidence source and acquisition time; expected postcondition; observed result; correlation/action/parameter digest; policy and permission decision references; method/tool version; result (`verified`, `failed`, `unknown`, or `disputed`); limitations and reviewer. Evidence must be appropriate to the action and independently obtained from the executor/agent where practicable.

- Agent consensus, multiple calls to the same model/provider, a successful HTTP response, or executor self-report is not independent proof.
- If independent evidence is unavailable, conflicting, stale, or ambiguous, report unknown/disputed and block success claims and unsafe retries.
- Verification of permission checks requires negative tests showing unauthorized actors/resources/actions are denied, not merely a positive allow.

### 10.2 Audit evidence

Create a correlated lifecycle event for request, policy/risk result, authorization/denial, permission/consent reference, approval request/decision/expiry, dispatch, retry/cancel/stop, verifier evidence, and user-facing outcome. Each event includes unique event/correlation IDs; trusted UTC timestamp plus ordering sequence; actor and actor type/version; target resource/action and destination/environment; policy/contract version; scope and approval references; redacted parameter digest; decision/reason; and outcome/evidence pointer.

Audit records are append-only or tamper-evident, access-controlled, integrity-checked, and retained/deleted under an approved policy. Do not log secrets, tokens, raw private content, or unnecessary prompts. An integrity failure, missing mandatory pre-action record, or unverifiable chronology is surfaced as a security event and fails closed for consequential work. Retention period, storage technology, cryptographic mechanism, and independent audit access remain design decisions; this contract does not claim they are implemented.

## 11. Lifecycle diagram

```mermaid
sequenceDiagram
  actor U as User
  participant C as PARMAR Core
  participant P as Policy and permission checks
  participant A as Approval record
  participant X as Isolated executor or integration broker
  participant V as Independent verifier
  participant L as Tamper-evident audit

  U->>C: Request bounded action
  C->>L: Record request and actor context
  C->>P: Evaluate identity, ownership, scopes, consent, risk and policy
  P-->>C: Deny, or decision plus approval requirement
  C->>L: Record decision
  alt Denied or evidence unavailable
    C-->>U: Denied/blocked; no dispatch
  else Human approval required
    C-->>U: Exact action, parameters, destination, consequence, expiry
    U->>A: Approve or reject exact action
    A->>L: Record decision and bound approval reference
  else Approval not required by policy
    Note over C,A: Only a bounded low-risk operation may use this path
  end
  C->>C: Recheck policy, scope, expiry, revocation, stop and idempotency
  C->>L: Record authorization before consequential dispatch
  C->>X: Dispatch exact authorized operation
  X-->>C: Outcome or timeout/unknown
  C->>V: Obtain independent evidence
  V-->>C: Verified, failed, unknown or disputed
  C->>L: Append verification and final state
  C-->>U: Truthful outcome; unknown is not success
```

## 12. Threat and failure-case checklist

These are required design/test cases before enabling any corresponding capability; a documentation contract is not evidence that they pass.

- [ ] Forged client user/account/role/profile/workspace identity; expired, revoked, or wrong-audience session.
- [ ] Connected account or installed plugin treated as blanket permission; cross-owner/resource read/write; wildcard or privilege escalation.
- [ ] Grant/consent revoked between policy check and egress/dispatch; stale cached grant; expired approval or actor-version change.
- [ ] Approval replay, duplicate redemption, changed parameters/recipient/destination/environment, wrong user/session, cancellation/expiry race.
- [ ] Agent prompt injection, poisoned memory, output-as-instruction, unauthorized tool call, self-grant, model/provider change, resource exhaustion.
- [ ] Malicious/altered plugin manifest, signature/digest mismatch, dependency compromise, scope change on update, sandbox escape, secret/session canary access.
- [ ] Workflow template containing creator data/credentials/approval; trigger forgery, loop/step-limit bypass, retry duplication, stale approval across steps or runs.
- [ ] API/webhook forgery, stale timestamp, replay, oversized/malformed payload, wrong tenant/environment, rate-limit bypass, credential leakage.
- [ ] Executor timeout/crash after side effect, lost acknowledgement, cancellation race, duplicate retry, partial completion, emergency stop with active child.
- [ ] Verifier collusion or dependence on executor output; fabricated, stale, missing, or conflicting evidence; agent consensus mistaken for proof.
- [ ] Audit store unavailable, event reorder/drop/alteration, timestamp skew, unauthorized read, raw secret/content leakage, retention/deletion failure.
- [ ] AETHER boundary crossing, credential/session exposure to browser content or plugin, desktop remote access enabled without independent isolation review, or Android network access.

## 13. Testable acceptance criteria

An implementation claiming conformance must attach exact test commands, commit/artifact identifiers, environment, expected/actual results, pass/fail/skip accounting, and independent review as applicable. A skipped mandatory case is not a pass.

| ID | Acceptance criterion |
|---|---|
| GC-01 | For every protected request, client-supplied principal/role/resource owner is ignored or rejected; missing, expired, malformed, or wrong-audience identity is denied. |
| GC-02 | User, Core service, agent, plugin, workflow run, integration, and verifier identities are distinct in persisted decisions; no actor can impersonate another by changing request fields. |
| GC-03 | Unlisted, wildcard, expired, revoked, wrong-resource, wrong-purpose, wrong-environment, and wrong-destination scopes are denied. A connected account and plugin installation alone authorize zero operations. |
| GC-04 | Read/write/execute/communicate/external-action decisions are separately tested; resource ownership and operation-specific grants are checked at the server boundary. |
| GC-05 | Every consequential-action class listed in §4 requires human approval. A missing, invalid, or unavailable approval record fails closed; changed parameters, actor, resource, destination, or environment invalidate the approval. |
| GC-06 | Approvals expire, are one-use and replay-resistant, and authorize only the bound operation. A previous approval cannot authorize a different action, retry, workflow run, or actor. |
| GC-07 | The lifecycle audit proves no dispatch occurs before policy, permission, consent, and required approval checks; all denied/cancelled/failed/unknown states are truthful. |
| GC-08 | Injected timeout/crash immediately before and after dispatch produces no unauthorized retry; consequential duplicate prevention and unknown-outcome reconciliation are exercised. |
| GC-09 | Cancellation and emergency stop block queued work, attempt active cancellation, revoke run capabilities, and report confirmed versus unknown outcomes without claiming external rollback. |
| GC-10 | Agent sandbox tests prove model/instruction/output cannot grant scope, access unapproved memory, invoke unlisted tools, exceed server-enforced limits, or read credentials/session canaries. |
| GC-11 | Plugin verification pins artifact/version/digest and scopes; altered or unreviewed versions are not activated; malicious output cannot become privileged instruction; sandbox secret and filesystem/network tests pass. |
| GC-12 | Two users instantiate the same workflow template; tests prove no private data, credential, permission, approval, or run output crosses owners. Step limit, deadline, retry, stop, and approval gates are enforced server-side. |
| GC-13 | API and webhook tests deny unauthenticated, wrong-scope, wrong-environment, forged, replayed, expired, oversized, malformed, and rate-exceeding requests; sandbox credentials cannot invoke production effects. |
| GC-14 | For each consequential operation, independent verification records evidence and can return failed/unknown/disputed; executor self-report or agent consensus alone cannot produce verified success. |
| GC-15 | Audit events are correlated, ordered, integrity-checked, redacted, and access-controlled; tampering or mandatory pre-dispatch audit failure is detected and blocks consequential execution. |
| GC-16 | Negative tests prove policy denial, permission revocation, consent revocation, and stop state prevent new egress/dispatch. Logs and plugin/model contexts contain no PARMAR credential/session canary. |
| GC-17 | AETHER desktop security flag remains `REMOTE_BROWSING_ENABLED=false`; Android AETHER retains its offline-only boundary; no browser-content or untrusted-plugin path receives PARMAR credentials/sessions. |

## 14. Decisions still open

- Authentication provider/protocol, production session design, and independent service identities/credential issuance.
- Exact risk taxonomy, approval TTLs, sensitive-read thresholds, and which reversible low-risk writes may be pre-authorized within bounded scopes.
- Scope vocabulary/schema, maximum grant lifetimes, revocation propagation targets, and consent record/versioning.
- Agent/model/provider allowlist, agent artifact review owner, sandbox implementation, per-agent resource ceilings, and memory retention.
- Plugin manifest/signature and compatibility standards, marketplace review/appeal policy, update/revocation response, and payment rules. Paid-plugin renewal counting, refunds/chargebacks, and commission calculation require later confirmation plus legal/payment-provider review; no payments are authorized.
- Workflow trigger policy, per-step approval UX, recovery semantics, approved numeric limits, and emergency-stop authority/availability.
- API authentication method, webhook cryptography and replay window, quotas, compatibility guarantees, and integration credential rotation/incident ownership.
- Verifier independence criteria and evidence standards by action type; audit storage, integrity mechanism, access model, retention, privacy review, and recovery objectives.
- Security/privacy/legal/operations owners and per-platform acceptance responsibilities.

An unresolved decision keeps the affected capability disabled or restricted to an explicitly non-consequential simulation. Do not infer a permissive default.

## 15. Related architecture and security records

- [PARMAR Infinite Master Vision and roadmap](./PARMAR-INFINITE-MASTER-VISION.md) — consolidated scope, traceability, roadmap, and non-negotiable boundaries.
- [VOKKI Master PRD](./VOKKI-MASTER-PRD.md) — product requirements, PARMAR Core authority, action modes, plugin/integration and release criteria.
- [Parallel Development Master Plan](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md) — Core dependencies, governance boundaries, testing/release gates.
- [PARMAR Core Identity Contracts](./PARMAR-CORE-IDENTITY-CONTRACTS.md) — identity principal, product context, owner-only deny-by-default authorization baseline.
- [PARMAR Identity Architecture Specification](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md) — proposed identity trust boundaries and deferred technical decisions.
- [VOKKI Identity/Tenancy ADR](./VOKKI-IDENTITY-TENANCY-ADR.md) and [traceability matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md) — approved IT-01–IT-15 requirements and implementation gaps.
- [Account Provisioning Approval Register](./PARMAR-ACCOUNT-PROVISIONING-APPROVAL-REGISTER.md) — APR-01–APR-20 proposed policy-baseline approval and non-waivable implementation gates.
- [AETHER Security Gates](./AETHER-SECURITY-GATES.md) and [AETHER Master Roadmap](./AETHER-MASTER-ROADMAP.md) — independent security boundary, NO-GO status, and remote-browsing release gates.
- [VOKKI Privacy/Security Governance Report](./VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md) — documented privacy/security gaps and evidence limits.

## 16. Scope and approval boundary

This document defines architecture contracts only. It changes no application code, authentication, provider, plugin, workflow, integration, webhook, payment, feature flag, deployment, or service state. Production authentication is not implemented or authorized here. This task does not activate external providers, payments, plugins, or integrations; their runtime state was not assessed. Unrestricted agent execution is prohibited. PARMAR Core governance, human oversight for consequential actions, AETHER separation, Android AETHER offline-only behavior, and desktop `REMOTE_BROWSING_ENABLED=false` remain mandatory.
