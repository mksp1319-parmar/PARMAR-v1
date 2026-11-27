# PARMAR — Account Binding B3 Implementation Plan

> **IMPLEMENTATION BLUEPRINT ONLY — NOT IMPLEMENTATION AUTHORIZATION**
>
> B2 architecture status: **PROPOSED DESIGN BASELINE; FORMAL ACCEPTANCE IS NOT
> EVIDENCED IN THE REVIEWED REPOSITORY RECORDS**. Option B is used here as a
> planning assumption only. Gate 2 approval remains required before
> implementation. This plan does not authorize code/schema/migration changes,
> clear the existing protected-operation runtime NO-GO, select a provider,
> enable OIDC, or establish production readiness.
>
> The exact historical phrase “fully primium type” is preserved as evidence
> but is withdrawn as non-operative by Product Owner Option A, recorded
> 2026-11-26. PO-13 does not cancel or define PARMAR Premium and authorizes no
> subscription, billing or entitlement implementation.

## 1. Purpose, authority and repository baseline

This plan reviews the B2 design as the repository's proposed architecture
baseline and turns it into an ordered implementation blueprint. It is not
evidence that any planned component exists or works. Implementation begins
only after Gates 1–3 and applicable approvals in §11 are passed and recorded.
Preserve the current account/session/approval security gates and keep
`PARMAR_OIDC_ENABLED` false.

Repository evidence used:

- The existing identity registry is `SQLiteIdentityRepository` schema v3,
  with immutable account IDs and exact `(issuer, subject)` provider bindings
  ([identity_store.py](./identity_store.py#L92),
  [identity_store.py](./identity_store.py#L310)).
- The account-registry migration validates and transactionally rebuilds its
  existing binding table; every identity connection enables and verifies
  foreign keys ([identity_store.py](./identity_store.py#L421),
  [identity_store.py](./identity_store.py#L520)).
- Provider lookup is read-only and existing-binding based
  ([identity_store.py](./identity_store.py#L652),
  [identity_contracts.py](./identity_contracts.py#L211)).
- OIDC has a verifier, state store and login-only start/callback. It is
  disabled by default; the callback rejects an active account session
  ([oidc.py](./oidc.py#L578), [oidc.py](./oidc.py#L719),
  [interface/futuristic_app.py](./interface/futuristic_app.py#L1281)).
- Session/evidence persistence is separate from identity
  ([sessions.py](./sessions.py#L511),
  [sessions.py](./sessions.py#L1696)).
- Pending approvals are a separate store with their own claim, authorization
  and completion transitions ([interface/approvals.py](./interface/approvals.py#L570),
  [interface/approvals.py](./interface/approvals.py#L1323)).
- The current JSONL decision logger is not a lifecycle audit system
  ([audit/decision_logs.py](./audit/decision_logs.py#L19)).
- The core identity contract declares authenticated chat, approval execution,
  protected memory writes, profile/workspace writes and profile selection
  runtime NO-GO until a genuine atomic execution fence exists
  ([PARMAR-CORE-IDENTITY-CONTRACTS.md](./PARMAR-CORE-IDENTITY-CONTRACTS.md#L152),
  [safety/runtime_no_go.py](./safety/runtime_no_go.py#L29)).
- Existing unit and HTTP tests cover registry, session, approval and OIDC
  behavior; they do not prove account-binding lifecycle behavior
  ([tests/test_account_registry.py](./tests/test_account_registry.py#L181),
  [tests/test_sessions.py](./tests/test_sessions.py#L499),
  [tests/test_approval_integrity.py](./tests/test_approval_integrity.py#L1242),
  [tests/test_oidc_authentication.py](./tests/test_oidc_authentication.py#L892)).

## 2. Architecture decision and boundaries

### 2.1 Canonical ownership

If separately approved through Gate 2 and authorized for implementation, use
B2 Option B as the sole proposed ownership model:

- `provider_identity` stores the exact provider namespace/subject identity.
- `account_identity_binding` is the only authoritative owner/lifecycle row.
- A partial unique index reserves a provider identity for `ACTIVE` and
  `PENDING_UNLINK`.
- A revoked row retains historical ownership; ordinary lifecycle operations
  never reassign or merge it.
- Do not add or retain `active_provider_binding` as a competing canonical
  owner table.

The existing `provider_account_bindings` table is a migration input and
current resolver dependency, not a second long-term authority. Cut the
resolver over atomically as part of the approved schema/version change. No
dual-writer period is permitted. Preserve old rows as read-only migration
evidence or archive only as authorized by the retention decision; do not
continue resolving identities from both old and new representations.

### 2.2 Module ownership

| Responsibility | Existing owner/boundary | Planned change |
|---|---|---|
| Account/provider persistence and schema version | `identity_store.py`, `SQLiteIdentityRepository` | Own new binding/provider/lifecycle tables, constraints, guarded transactions, schema preflight and migration. It is the only writer of ownership. The disposable DDL stores subject text in plaintext for constraint testing; approved at-rest protection and a compatible exact-match uniqueness strategy are prerequisites to production schema acceptance. |
| Typed account/provider identity and resolution | `identity_contracts.py`, `identity.py` | Preserve immutable value objects and exact existing-binding lookup. Add typed lifecycle commands/results only after policy approval; never accept browser-supplied account identity as proof. |
| OIDC assertion validation/state | `oidc.py` | Reuse verifier and one-time state mechanisms where their contract fits. Add a distinct link-purpose transaction and purpose binding; do not turn the login callback into a link callback. Provider assurance additions depend on the provider/security gate. |
| HTTP routing and CSRF/session integration | `interface/futuristic_app.py` | Thin route orchestration only. Enforce authenticated session, session-bound CSRF, origin policy, transaction ownership and generic conflict responses. Delegate lifecycle decisions to services. |
| Trusted session/evidence lifecycle | `sessions.py` | Add version snapshot/revalidation and idempotent account-wide invalidation hooks. Preserve current evidence binding, expiry, logout and rotation behavior. |
| Pending approval lifecycle | `interface/approvals.py` | Add account/binding security-version snapshot and stale-approval denial/cancellation. Keep the existing per-store exclusive execution claim; it is not an execution fence. |
| Audit | `audit/decision_logs.py` is currently generic JSONL | Do not extend it by assumption into security audit. Implement the separately approved lifecycle audit boundary and integrity/access/retention contract. |
| Reconciliation and notifications | No lifecycle outbox/worker exists | Add durable intent/effect records and workers only after audit, notification and operational policies are approved. |
| Protected side-effect execution | `safety/runtime_no_go.py` and guarded routes/services | Preserve existing NO-GO. A separate authoritative execution-fencing design must clear its own review gate; B2 version checks do not clear it. |

Keep Local Demo identities, legacy `user_id`, profile/workspace IDs, and
PARMAR `AccountIdentity` distinct. Do not migrate by UUID equality, email,
name, phone or profile similarity. Do not wire binding ownership into VOKKI,
Home or AETHER legacy data as part of this plan.

## 3. Persistence and migration sequence

No schema version, SQL, migration, or dependency change is authorized by this
plan. The implementation sequence, once approved, is:

1. **Preflight and backup:** stop/gate binding writes; inventory schema
   versions and counts; take a consistent SQLite backup including committed
   WAL state; restore it in isolation and verify `integrity_check`,
   `foreign_key_check`, counts and readability.
2. **Resolve key mapping:** obtain approved provider/adapter and
   issuer/subject handling. Do not invent normalization. Inventory every old
   `(issuer, subject, account_id)` row; quarantine duplicates, orphans,
   ambiguous ownership and any mapping without approved evidence.
3. **Add schema transactionally:** extend the identity-store migration using
   its existing schema-version/`BEGIN IMMEDIATE`/rollback pattern. Create
   `provider_identity`, `account_identity_binding`, lifecycle transaction
   records and durable reconciliation intent in the authoritative identity
   store. Keep schema changes additive until cutover validation succeeds.
4. **Install integrity controls:** add the B2 primary/unique keys, foreign
   keys to actual parent keys, `CHECK` state constraint, exact partial index
   predicate (`state IN ('ACTIVE', 'PENDING_UNLINK')`), insert/update/delete
   and immutable-key triggers. Run `PRAGMA foreign_keys=ON` and verify it on
   every opened identity connection before a transaction. Fail closed if
   SQLite is older than 3.8.0, foreign-key support is absent, or schema
   validation fails.
5. **Backfill under evidence rules:** map an existing binding to `ACTIVE`
   only when approved evidence authorizes that mapping. Never choose a
   “winning” owner for a collision. Keep ambiguous records quarantined and
   non-operational.
6. **Verify before cutover:** compare source/destination manifests, exact
   provider uniqueness, ownership history, account and provider foreign keys,
   active index creation, state/version invariants and quarantine totals.
   Migration code must be idempotent by a stable migration/step identifier.
7. **Atomic resolver cutover:** update the registry lookup to resolve only
   `ACTIVE` rows in the canonical Option B model. No dual resolver and no
   dual writer. Keep the legacy table unavailable to ordinary binding writes.
8. **Revalidate security state:** existing sessions and pending approvals
   without verifiable account/binding security snapshots are revoked,
   invalidated or quarantined and require fresh trusted authentication.
9. **Reopen only with authority:** the named migration authority records
   success, quarantine totals, backup verification and post-migration checks.
   Operations and Security authorize reopening; product/data and
   privacy/legal approvals apply where their decisions require them.

### 3.1 Rollback and interrupted migration

- Migration state and manifest are durable; process memory is never recovery
  authority. On interruption, stop writers and resume or restore only from
  persisted step state plus the verified backup.
- Rollback is not an automatic response to uniqueness conflict, worker error
  or provider outage. It requires the named authority, written runbook and
  explicit Operations/Security approval.
- Restore and verify backup integrity, foreign keys, schema, counts and
  manifest. Quarantine ambiguous ownership; never infer or transfer it.
- Revoke sessions/evidence whose post-rollback security state cannot be
  proven. Quarantine pending approvals until account, binding and security
  versions are verified. Require fresh authentication before restoring
  protected access.
- Re-verify uniqueness and immutable ownership before reopening writes.
  Preserve the previous schema and user data; do not use a destructive
  downgrade or automatic reassignment.

## 4. Lifecycle service and API design

Build a provider-neutral application service over one identity-store
transaction boundary. Proposed service responsibilities:

- `begin_link`: require a trusted active account session, account proof
  reference, independent provider-proof transaction, CSRF/session binding,
  replay nonce and explicit intent. Create a non-owning `PENDING` attempt.
- `confirm_link`: revalidate both proof references, freshness policy,
  transaction/session ownership, account status, confirmation and conflict
  state. Under `BEGIN IMMEDIATE`, activate or reactivate only the same
  immutable owner; increment account security version and add one stable
  reconciliation intent in the same commit.
- `begin_unlink` / `confirm_unlink`: require fresh proof and explicit
  confirmation; protect the last usable method. `ACTIVE -> PENDING_UNLINK`
  retains ownership. Finalization consumes the same confirmed transaction,
  rechecks method availability atomically and commits
  `PENDING_UNLINK -> REVOKED`.
- `cancel_unlink`: require fresh proof and cancellation confirmation;
  transition `PENDING_UNLINK -> ACTIVE` only if its transaction is current.
- `begin_recovery` / `verify_recovery` / `confirm_recovery`: keep recovery
  separate from login and support claims. No target account or ownership
  assignment before independently approved evidence reaches `VERIFIED`.
- `disable_account` / `reactivate_account`: keep authority separate, preserve
  ownership on disablement, increment security version and require fresh
  authentication after reactivation. Do not implement `SUSPENDED` binding
  state without policy approval.

Candidate HTTP resources (exact routes and UX require Product Owner/security
approval):

| Operation | Suggested authenticated API boundary | Key requirements |
|---|---|---|
| Start link | `POST /api/account/bindings/link-intents` | Existing session + CSRF; create transaction only; no ownership yet |
| Provider proof | Dedicated link-purpose OIDC start/callback | State/nonce/PKCE; transaction purpose and account/session binding; no use of login callback as link callback |
| Confirm link | `POST /api/account/bindings/link-intents/{id}/confirm` | Freshness and exact transaction confirmation; server-resolved actor |
| Start/cancel unlink | `POST /api/account/bindings/{id}/unlink-intents` and `.../cancel` | Fresh proof, explicit confirmation, last-method checks |
| Recovery | Separate recovery endpoints and case service | Independent proof and approved authority; generic responses; no profile matching |
| Read bindings | `GET /api/account/bindings` | Return only current account's safe metadata; no raw subject/token; no cross-account existence oracle |

Use typed request/response models and generic conflict/error outcomes. Never
include provider secrets, raw tokens, subject values or proof material in
responses, audit messages or logs. Add routes only after the approved
authenticated POST CSRF and origin contract is specified; current login-flow
controls alone do not establish link-route CSRF safety.

### 4.1 Binding lifecycle transition implementation contract

| Transition | Required service authority | Proof/confirmation | Ownership result |
|---|---|---|---|
| no row → `PENDING` | Authenticated lifecycle service | Transaction-bound intent; no ownership proof yet | Not reserved |
| `PENDING` → `ACTIVE` | User-initiated link service | Fresh account proof + independent provider proof + explicit confirmation | Reserved on commit |
| `PENDING` → `FAILED` | User cancellation or lifecycle service expiry/rejection | No proof replay; record terminal reason | Not reserved |
| `ACTIVE` → `PENDING_UNLINK` | Account owner service | Fresh account proof + explicit confirmation + last-method precheck | Still reserved |
| `PENDING_UNLINK` → `REVOKED` | Authorized lifecycle worker/service consuming confirmed transaction | Recheck last method in same commit; no new proof only while original approved transaction remains valid | Released on commit |
| `PENDING_UNLINK` → `ACTIVE` | Account owner cancellation service | Fresh proof + cancellation confirmation | Remains reserved |
| `REVOKED` → `PENDING` | Same immutable account owner only | New transaction, fresh account/provider proof and confirmation; recovery additionally needs approved recovery evidence | Not reserved until activation |
| `FAILED` → `PENDING` | Lifecycle service on a new attempt | New transaction and proofs | Not reserved |

The database triggers/index enforce data shape, allowed transitions, version
increments and uniqueness. Only application authorization can establish
proof, user presence, confirmation, recovery authority, last-method
eligibility or support role. SQL access is not an authorization boundary.

## 5. OIDC, session and approval integration

### 5.1 OIDC boundary

- Keep current OIDC login disabled by default and production disabled.
- Reuse the verifier only for claims it actually validates. Current
  `authenticated_at` derives from `iat`; `auth_time`, `max_age`, `acr`,
  issuer-specific freshness semantics and provider capability must not be
  assumed.
- Implement linking as a separate purpose-bound transaction with the target
  account/session, nonce, PKCE verifier, callback route and one-time
  consumption. A link callback must reject login-purpose state and vice versa.
- Do not provision unknown identities, infer account ownership from claims,
  or expose provider conflict details.
- Provider choice, issuer/client/audience, exact claim requirements and
  provider-side logout/revocation remain approval gates.

### 5.2 Session and approval invalidation

- Add account/binding security-version snapshots only after selecting the
  authoritative version semantics. Update session and approval schema
  transactionally and preserve their existing HMAC/integrity and ownership
  checks.
- Session resolution must compare current authoritative status/version and
  fail closed on unavailable or inconsistent identity state. Revocation and
  evidence lifecycle remain idempotent and account-scoped.
- Approval creation binds account/security version. Redemption rejects stale
  version, inactive account, revoked/expired session/evidence, changed action
  binding, wrong actor/session or changed resource scope; invalidate pending
  approvals after binding/recovery/security changes.
- Preserve the existing exclusive `EXECUTING` claim and terminal completion
  behavior, but never treat it as atomic with a provider call or another
  database write.

### 5.3 Disablement, reactivation, closure and recovery boundaries

These are implementation requirements derived from the limited approved
policy outcomes; they do not choose a lifecycle authority, grant an actor
authority, or approve storage/retention policy.

- **Disablement:** deny new authentication and protected authorization,
  preserve binding/history rows, and advance the authoritative account
  security version. Existing sessions and approvals must be rejected or
  invalidated within the approved consistency boundary. Current code has
  account status reads and session revocation but no supported lifecycle
  disablement writer spanning the separate stores.
- **Reactivation:** require a separately approved authority and evidence
  policy. Preserve the same owner and binding history; do not restore old
  sessions, identity evidence, approvals or browser credentials. Require fresh
  authentication. No reactivation route or authority is implemented.
- **Closure/deletion:** keep closure, binding revocation, data deletion and
  retention reporting distinct. No closure state, grace period, tombstone
  retention, or deletion behavior is selected here. Do not delete/reassign
  bindings or identities as a side effect of account closure.
- **Recovery/restoration:** independent evidence and explicit confirmation are
  required by the approved outcome. Restore only the same proven account;
  ambiguous ownership stays quarantined. No profile, email, legacy ID, support
  assertion or prior session is sufficient evidence.
- **Last usable method:** perform the availability check and the unlink state
  transition in the same authoritative transaction. A preflight read followed
  by a separate write is raceable. Concurrent link/unlink operations must be
  serialized against the same account/provider and method set.
- **Retries and terminal outcomes:** every request and durable effect uses a
  stable operation/effect identifier. Replay returns the recorded outcome,
  never repeats proof consumption or ownership mutation. Distinguish retryable
  failure from terminal failure and indeterminate external acknowledgement.
  An indeterminate irreversible effect requires operator evidence and a
  separate recovery authority; it is not safe to retry blindly.
- **Audit and notice:** bind durable audit/outbox intent to the authoritative
  lifecycle commit. Do not treat queued as delivered. The required-audit
  failure mode, notification channels, retention and exception authority
  remain specialist decisions.

### 5.4 Cross-store consistency alternatives and rehearsal boundary

Current PARMAR account status, sessions, pending approvals, audit and
notifications use separate repositories/databases. Independent transactions,
revalidation calls, version snapshots or a per-approval `EXECUTING` claim do
not make the account change and downstream effects atomic.

| Approach | What it can guarantee | Limit / decision needed |
|---|---|---|
| Current separate stores plus request-time version checks | Detect some stale state and fail closed when a dependency is unavailable. | Check-to-effect races and partial invalidation remain. Not an atomic fence; cannot authorize protected effects. |
| One transactional authority for account/binding status, epoch, session/approval authorization, operation claim, local effect and outbox intent | A single database transaction can serialize local authorization/effect commits against disablement, provided every writer and executor uses that authority and validates the expected epoch. | Requires topology and schema migration decisions; does not make an external provider, email service, or arbitrary API call atomic. No current PARMAR service has this complete contract. |
| Transactional outbox plus idempotent/fenced consumers | The authority can atomically persist state and intent; consumers can retry delivery with stable IDs and reject stale fencing epochs. | Delivery is generally at-least-once. Exactly-once external effects require the receiver to enforce idempotency/fencing or an explicit reconciliation path. Ambiguous acknowledgements need operations policy. |
| Distributed transaction/coordinator or linearizable external authorization service | May coordinate separately hosted participants if every participant supports the protocol and failure semantics. | Infrastructure and protocol are absent; cannot be inferred from SQLite or selected without Operations/Security approval. |

No production option is selected in this blueprint. The new
`tests/test_account_binding_atomic_rehearsal.py` fixture models one
disposable SQLite authority and an idempotent local sink. It is an executable
reference experiment only: it is not the PARMAR runtime, does not include
external systems or real account data, and does not prove a supported
deployment topology or protected-operation atomic fence.

### 5.5 Hard execution-fence boundary

The current core contract and `runtime_no_go.py` keep protected side-effect
paths blocked. Version revalidation before a later write still has a
check-to-effect race. Do not relax any runtime gate when adding bindings.
Clearing a gate requires a separate authoritative execution service or
linearizable store, monotonic fence enforced by each executor, and defined
downstream idempotency/cancellation/in-flight semantics. Prove both
revocation-first and effect-first orderings, storage failures, retries and
crashes. No user/account/session version check alone qualifies.

## 6. Reconciliation, audit and notifications

### 6.1 Reconciliation contract

The identity transaction must atomically commit the lifecycle outcome,
account security-version change and one durable reconciliation intent. The
intent ID is stable across retries; individual effects have unique stable
effect IDs.

- Workers have a service identity that confers no account-ownership or
  recovery authority.
- Claim ready/retryable/expired work under `BEGIN IMMEDIATE`; update owner,
  expiry and monotonic fencing epoch conditionally and require exactly one
  changed row.
- Every renewal/progress/completion write checks work ID, owner, epoch,
  expected state and lease validity. Stale workers cannot advance.
- Expired lease takeover increments the epoch. It does not repeat proof,
  confirmation or ownership mutation.
- Every local effect deduplicates by stable effect ID. External delivery is
  not exactly-once unless the endpoint supports idempotency; ambiguous
  acknowledgements require visible operator resolution rather than blind
  duplicate delivery.
- A pre-commit crash leaves neither lifecycle mutation nor work intent. A
  post-commit crash leaves both for replay. A crash after an effect retries
  the same idempotency key.
- Terminal failure is distinct from completion. Operator recovery needs
  separately approved authority and a new audited recovery action.
- `COMPLETE` requires persisted evidence of the committed lifecycle/version,
  each required invalidation or fail-closed revalidation, approved audit
  state, required outbox records, delivery acknowledgement where applicable,
  and completing worker/lease epoch/effect IDs.
- Retry, lease, expiry, alert and completion thresholds remain pending
  Security/Operations approval.

### 6.2 Audit and notice policy

Preserve `Option A`, `Option B` and `Option C` as B2 alternatives; none is
selected or approved as audit-failure policy.

| Option | Ordering and crash behavior | Authorization restriction |
|---|---|---|
| A — fail closed | Required audit durable in authoritative transaction before success; audit failure rolls back/withholds lifecycle commit. Separate-store audit cannot claim atomicity. | Deny activation, reactivation, recovery consumption and ownership change until audit evidence is durable. |
| B — controlled pending | Commit non-operational pending-audit state, intent and work together; audit completes before activation/privilege increase. Crash resumes from persisted state. | No active binding, recovery consumption or privilege increase until audit completes; any emergency disable exception needs separate review. |
| C — separately authoritative side store | Commit lifecycle plus audit intent/work; a durable authorization hold blocks protected use until side-store audit evidence or approved terminal outcome. | Never clear the hold through ordinary worker error handling; release requires separately approved, audited authority. |

Security/Operations must select the required event set, integrity and access
controls, key custody, ordering, retention, audit-outage behavior and recovery
authority. Privacy must approve data minimization/retention. The current JSONL
logger is not a substitute.

Notifications use durable outbox IDs and distinct `QUEUED`, `DELIVERING`,
`DELIVERED`, `FAILED` and `CANCELLED` states. Queueing is not delivery.
Whether enqueue failure blocks a lifecycle operation, exact events/channels,
retry and notice privacy are deferred. Never log destinations or message
content.

## 7. Backward compatibility and product separation

- Preserve existing account IDs and account status semantics; do not convert
  profile/workspace identifiers or legacy `user_id` to accounts.
- Unknown provider identities continue to fail closed. No JIT account
  creation, attribute matching, automatic merge, reassignment, or support-only
  ownership assertion.
- Existing binding rows require manifest-backed owner review before
  activation in the new model. Conflicts and unverified rows are quarantined.
- Sessions without verifiable security-version snapshots and approvals with
  stale/unbound identity state cannot be grandfathered into trusted access.
- Local Demo remains anonymous/local and never acquires production account
  identity or a provider binding. Keep provider configuration and production
  OIDC gates unchanged.
- No shared account/session claim is added to Home, VOKKI, AETHER Desktop or
  AETHER Android in this work. Each consumer requires its own approved
  resolver/resource-authorization boundary.

## 8. Verification strategy

Tests below are future required evidence, not tests run in this planning task.

### 8.1 Local pytest / GitHub Actions / Codespaces

Use temporary SQLite files and deterministic fake provider/session/audit
adapters for ordinary CI:

| Area | Required cases |
|---|---|
| State machine | Every allowed transition succeeds only with required actor/proof/confirmation; every omitted, skipped, replayed or invalid transition fails without partial mutation. |
| Ownership | Partial-index predicate reserves ACTIVE and PENDING_UNLINK only; non-owning PENDING rows do not reserve the provider identity; two accounts cannot activate the same issuer/subject regardless of adapter; revoked historical owner cannot transfer; same-owner reactivation requires new proof. |
| SQLite constraints | Parent keys and FK column definitions match; FK pragma is on and verified per connection; missing/old SQLite feature fails closed; issuer/subject SQL validation preserves the current application bounds for ordinary non-NUL values and rejects empty/edge-whitespace values without normalization; current application and SQL checks reject embedded U+0000, while final provider-facing acceptance remains a data-model/provider decision; inserting the same issuer/subject under a different adapter cannot create a second identity row; direct active insert, reassignment, arbitrary version, skipped transition and delete are rejected. |
| Concurrency | Independent connections contend for activation; exactly one owner succeeds; stale expected version loses; uniqueness remains valid after rollback and restart. |
| Lifecycle security | Cross-account IDOR, CSRF/origin failure, transaction/session mismatch, nonce replay, provider proof replay, unknown account, disabled account and support-only claims fail closed. |
| Unlink/recovery | Last usable method cannot be removed; count is rechecked in final transaction; recovery cannot bind before `VERIFIED`; duplicate/replayed recovery confirmation is denied. |
| Session/approval | Binding/security version change invalidates sessions/evidence and pending approvals; wrong account/session/action binding denied; approval claim is single-use; existing runtime NO-GO still precedes every protected side effect. |
| Reconciliation | Crash before/after lifecycle commit; crash after effect/before checkpoint; duplicate worker; lease expiry/takeover; stale epoch; duplicate effect; terminal failure; operator recovery; false-completion attempts. |
| Audit/notice | A/B/C ordering tests; audit outage behavior matches selected approval; outbox duplicate and ambiguous external acknowledgement do not claim delivery; sensitive fields are absent. |
| Migration/rollback | Duplicate/conflicting/orphan inventory; verified backup restore; every migration failpoint; repeat/resume idempotency; index/FK verification; rollback authority; post-rollback session/approval invalidation. |
| Backward compatibility | Existing account IDs unchanged; legacy profiles/workspaces unmapped; Local Demo remains separate; old resolver does not provide fallback ownership. |

Extend focused existing tests in `tests/test_identity_store.py`,
`tests/test_account_registry.py`, `tests/test_sessions.py`,
`tests/test_approval_integrity.py`, `tests/test_approval_persistence.py`,
`tests/test_oidc_authentication.py`, and `tests/test_identity_http.py`.
Add new lifecycle/migration/reconciliation test modules only if no existing
test file owns the contract. Keep tests isolated; do not use production
credentials or persistent user databases.

### 8.2 Live provider and operational evidence

The existing manual workflow
[`parmar-keycloak-oidc-e2e.yml`](../.github/workflows/parmar-keycloak-oidc-e2e.yml)
uses a pinned Keycloak image, disposable realm, loopback TLS, isolated
databases and live authorization-code/PKCE/login tests. It is suitable for
approved test-provider E2E in GitHub Actions with Docker and the reviewed
runner environment. Extend it for link-purpose callback isolation, binding
conflict, confirmation, unlink/recovery and restart/replay only after those
flows and policy are implemented and approved. Current workflow execution
does not test account binding.

Codespaces can run unit/SQLite tests; live Keycloak requires available Docker,
network/loopback/TLS capability and isolated disposable resources. Production
provider claim semantics, real notification channels, production key custody,
multi-host behavior, network filesystems, backup restoration at scale,
operational failover and incident response require separately controlled
external infrastructure and accountable reviewers. Never use live customer
identities for these tests.

### 8.3 Production-readiness gate

Production stays disabled until all required product/security/privacy/
operations/provider approvals are recorded; code review, threat model,
independent security review, migration/restore rehearsal, live provider
capability validation, alert/runbook ownership, key management, rollback
drill, authorization-fence evidence and final release sign-off pass. Passing
unit or mocked E2E tests is not production evidence.

## 9. D1–D16 decision traceability

This plan preserves the limited-scope Product Owner decisions recorded in
framework §§C.1–C.16 without extending them to the broader worksheet defaults
or deferred implementation details. The policy-decisions document remains a
proposal for those unresolved details. Gate 1 remains open because the
framework records required Security/Operations review and other §D disposition
work as outstanding; the conflicting status wording between §§C and E has
been corrected.

| Decision | Proposed outcome tracked | Still requires approval/evidence |
|---|---|---|
| D1 | Provider-neutral account ownership and identity linking | Provider, issuer, client, audience, region and deployment selection |
| D2 | One external identity has at most one PARMAR owner; multiple identities per account; no automatic merge/reassignment | Exceptional correction and exact key normalization |
| D3 | Existing-account proof, independent provider proof, explicit transaction confirmation; fail closed | Provider assurance, proof-freshness thresholds, CSRF/replay implementation review |
| D4 | Freshness/reauthentication principles; `iat` alone is not a product-approved freshness rule | `auth_time`, `max_age`, `acr`, thresholds and provider capability |
| D5 | Sensitive identity changes require explicit confirmation | UX content and operation-specific confirmation/freshness details |
| D6 | Ownership conflicts fail closed; no automatic owner transfer | Any exceptional migration/correction authority |
| D7 | Unlink proof/confirmation and last-usable-method protection | Usable-method definition and approved recovery exception |
| D8 | Independent recovery evidence; not profile similarity or support assertion alone | Evidence, delays, abuse limits, appeal and support roles |
| D9 | Disablement/closure and reauthorization remain separately authorized | States, authority, grace periods, reactivation and closure details |
| D10 | Support cannot establish ownership or change bindings unilaterally | Any exceptional staff workflow and dual-control model |
| D11 | Lifecycle/security notification outcomes distinguish queued, delivered and failed | Events, channels, failure policy, privacy and retention |
| D12 | Lifecycle audit needs restricted access, integrity and retention handling | Audit technology, access, retention, failure policy and key custody |
| D13 | Binding/recovery/security changes invalidate affected sessions and approvals | Exact scope/latency and implementation; atomic fencing remains a distinct gate |
| D14 | PARMAR local logout is authoritative; no provider logout promise | Provider logout/back-channel/revocation behavior |
| D15 | Closure, binding revocation, deletion and retention reporting remain distinct | Tombstones, data classes, retention periods and backup expiry |
| D16 | Legacy/Local Demo records remain unmapped until approved owner verification | Mapping evidence, migration procedure, collision handling and rollback |

Managed/family/organization ownership remains deferred; delegation cannot
grant account ownership. PO-13 is approved as Option A and the exact historical
phrase “fully primium type” is withdrawn as non-operative. It does not alter
PARMAR Premium or future product scope and authorizes no subscription,
billing, entitlement or access-control implementation.

## 10. Repository-grounded implementation sequence

The ordering below follows the requested delivery sequence. Dependencies that
cross stages are explicit: implement fail-closed primitives before exposing a
workflow; verify each stage as it is built, then run the complete security
suite in stage 7. Gate 1–3 approval is a prerequisite to all implementation.

| Stage | Work and dependencies | Acceptance criteria | Planned verification |
|---|---|---|---|
| 1. Database schema and migration | After Gates 1–3 and data-model approval. Extend only the authoritative identity SQLite store; follow its schema-version, `BEGIN IMMEDIATE`, FK verification and rollback patterns. | Option B invariants; no dual-writer/resolver; durable migration manifest; exact uniqueness/FKs/indexes/triggers; issuer/subject input constraints preserve current application bounds without normalization; the current prototype rejects embedded U+0000, but its final provider-facing policy remains for authority decision; provider subject at-rest protection and an approved exact-match uniqueness strategy; ambiguous legacy rows quarantined; backup/restore, idempotent resume and rollback evidence; no inferred ownership. | `python -m pytest PARMAR/tests/test_identity_store.py PARMAR/tests/test_account_registry.py -q` plus `python -m pytest PARMAR/tests/account_binding_b2_schema_validation.py -q` (synthetic prototype already separately authorized; passing it is not Gate 2 acceptance); migration cases and isolated backup/restore rehearsal remain required. |
| 2. Account-binding lifecycle service | After stage 1. Keep ownership writes in one identity-store transaction; proof verification is supplied through typed, provider-neutral interfaces. | Allowed transitions only; expected-state/version checks; no reassignment; same-owner reactivation requires new proof; no partial mutation on denial/failure; stable lifecycle/reconciliation ID committed atomically. | Focused lifecycle/state-machine tests and direct-write/constraint tests in the identity-store and lifecycle test modules. |
| 3. OIDC linking and identity verification | After stage 2 and approved provider/assurance contract. Add a link-purpose flow distinct from login; current login remains disabled by default and production-disabled. | Link/login purpose separation; account/session-bound state, nonce and PKCE; approved freshness claims; one-time consumption; conflict-safe generic outcomes; unknown identities do not provision accounts; secrets/proof excluded from outputs/logs. | `python -m pytest PARMAR/tests/test_oidc_authentication.py PARMAR/tests/test_identity_http.py -q`; live-provider checks are deferred to stage 8. |
| 4. Session and approval invalidation | Security-version definition is part of stage 1; lifecycle commits in stage 2 increment it. Implement version snapshot, resolution and idempotent invalidation before any link workflow is considered usable. | Stale sessions/evidence/approvals fail closed across restart; relevant account/binding changes invalidate by approved scope; unavailable authoritative state denies; ownership/integrity checks remain; no claim that version check is an atomic side-effect fence. | `python -m pytest PARMAR/tests/test_sessions.py PARMAR/tests/test_approval_integrity.py PARMAR/tests/test_approval_persistence.py -q` plus account/version race tests. |
| 5. Reconciliation, audit and notifications | After stages 1–4 and specialist decisions select audit/notification failure behavior. | Fenced leases; stable idempotency IDs; crash recovery; audit/notice states are truthful; terminal failure is not completion; operator recovery is separately authorized; no cross-database atomicity claim. | Focused reconciliation/audit/outbox tests with crash, duplicate-effect, stale-lease, unavailable-store and ambiguous-ack failure injection. |
| 6. Recovery, unlinking and account lifecycle | After stages 2–5 and explicit D7–D15 lifecycle, recovery, support, retention, notice and audit decisions. | Last usable method is rechecked in the final transaction; recovery evidence is independent; disable/closure/reactivation authority is explicit; binding history/retention is preserved; support cannot assert ownership; no automatic deletion or reassignment. | Focused recovery/unlink/state tests; repeat session/approval and reconciliation tests for each lifecycle transition. |
| 7. Security, concurrency and failure-injection tests | Test design accompanies stages 1–6; this is the integrated pre-E2E acceptance gate. Never use production credentials or persistent user databases. | Gate 5 test matrix passes, including IDOR/CSRF/replay, uniqueness races, migration failpoints, rollback, stale versions, last-method, outages, crash/retry and no false completion. Existing protected-operation NO-GO assertions still precede side effects. | `python -m pytest PARMAR/tests/test_identity_store.py PARMAR/tests/test_account_registry.py PARMAR/tests/test_identity_http.py PARMAR/tests/test_oidc_authentication.py PARMAR/tests/test_sessions.py PARMAR/tests/test_approval_integrity.py PARMAR/tests/test_approval_persistence.py -q` plus all new account-binding tests. |
| 8. Live Keycloak E2E and operational readiness | After stages 1–7 and Gate 6 provider/security review. The current workflow is manual (`workflow_dispatch`) and exercises login, not binding. Extend it only after approved binding flows exist. | Disposable isolated realm; live binding cases pass; cleanup/provenance verified; provider behavior documented. Separately complete backup restore/rollback, key custody, alert/runbook, incident/recovery, topology and release reviews. OIDC remains production-disabled until separate production approval. | Run `.github/workflows/parmar-keycloak-oidc-e2e.yml` manually on its approved isolated runner; current workflow command is `python3 -m pytest PARMAR/tests/test_keycloak_oidc_live_e2e.py -q -ra --tb=short` with its bootstrap and `PARMAR_LIVE_KEYCLOAK_E2E=1` setup. |

Stages 1–8 are blocked on the approvals named in §11. Planning and test
design may proceed; implementation authorization cannot be inferred. The
separate protected-operation atomic-fence NO-GO is not a stage in this plan
and is not cleared by passing these acceptance criteria. Its separate
architecture, race/crash evidence and approval remain prerequisites to
enabling affected protected operations.

## 11. Remaining approvals and explicit blockers

The governing framework says Gates 1–3 are **NOT PASSED**. The corrections in
this review resolve a documentation inconsistency only; they grant no
approval. Gate acceptance criteria, current evidence and the decision needed
are:

| Gate | Exact acceptance criteria | Evidence verified in this review | Status and decision material |
|---|---|---|---|
| 1 — Policy approval (Product Owner) | All 16 decisions and every §D matter have a disposition, named owner, required approvers and recorded status; no recommendation is mislabeled approved. Record required Security/Operations reviews. | Framework §§C.1–C.16 record limited-scope Product Owner decisions as approved. The approval register and user approval review record APR-01–APR-20 as approved proposed-policy baseline on 2026-11-13. The framework and consolidated packet record additional limited Product Owner choices on 2026-11-25. No separate attributable Security/Operations review or complete named-owner assignment was found. | **NOT PASSED.** Preserve D1–D16 and APR-01–APR-20 within their recorded scopes and do not request reapproval. Retain the 2026-11-25 bounded choices; complete the remaining details and named-owner assignments, and record required Security/Operations reviews. Provider selection, exact assurance, recovery thresholds/assisted routes, notification events/channels beyond durable enqueue for ownership changes, audit architecture, transition authorities beyond the current states, class-specific retention, exceptional correction, schema and migration details remain gated. |
| 2 — Identity/binding data-model approval (Identity/data-model owner) | After Gate 1: approve cardinality, exact issuer/subject normalization independent of adapter ID, verifier-provenance semantics, binding ownership/immutability, lifecycle states, audit history, session invalidation and cross-store failure semantics. Evidence must include reviewed schema/migration/rollback, invariant checks and independent-connection concurrency showing at most one mapping and no partial second mapping. Product Owner and Security approve the model; Operations reviews operational/cross-store semantics where applicable. | B2 supplies a proposed Option B schema, invariants, transactions, migration/rollback and failure model. The Product Owner has selected issuer+subject as the identity tuple regardless of adapter, but exact canonicalization/migration and multiple-verifier provenance retention are deferred. The authorized synthetic harness executes the proposed DDL and covers constraints, transitions, version guards, adapter-independent uniqueness and races using separate SQLite connections in one process. It does not execute the application migration, verify an independent-process or production topology, or exercise backup/restore recovery. The live working tree's B2 test run is recorded in the consolidated packet; no B2 acceptance or independent reviewer record exists. | **NOT PASSED.** The Product Owner's limited decisions do not accept the full B2 model. Security and the identity/data-model owner must approve the schema contract, with Operations approval for operational failure/topology choices. Remaining evidence includes migration and rollback mechanics, independent-process/supported-topology behavior, backup/restore recovery, and explicit review of whether current NUL rejection is an accepted policy. Do not start any real-data migration unless separately authorized after Gate 2. |
| 3 — Threat model and abuse-case review (Security) | After Gates 1–2: assign a mitigation and owner for takeover, session theft, replay, CSRF, provider compromise, duplicate/concurrent binding, recovery abuse, last-method unlink, insider abuse, notification/audit outage and state races; Security records the review and the Product Owner accepts residual risks. | B2 §8 lists relevant threats and proposed controls, and B3 §8.1 proposes tests. The broad identity architecture review and runtime NO-GO audit are not a completed account-binding threat/abuse matrix. No approved Security review or Product Owner residual-risk disposition for this model was found. The separate Local Demo dispatch path now has current-source mitigation and focused-test evidence; independent Security/deployment closure remains pending. | **NOT PASSED.** Security must review a threat-to-control-to-test-to-owner matrix and document mitigations and residual risks; the Product Owner must explicitly accept or reject each residual risk, with Operations owning operational mitigations. Track the Local Demo verification separately; it does not substitute for this gate. |

### Gate decision packet

- **Product Owner:** preserve, without reopening or expanding, the recorded
  D1–D16 limited-scope decisions and APR-01–APR-20 proposed-policy-baseline
  approval. Disposition only the residual §D matters with named owners,
  required approvers and explicit deferred/approved status; record the
  required Security/Operations reviews. The B3 proposal is not the decision
  record. See the [consolidated approval packet](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md).
- **Identity/data-model owner:** B2 Option B entity/invariant and transaction
  model; accept the Product Owner's issuer+subject identity tuple (adapter ID
  does not split ownership) while reviewing exact canonicalization, embedded
  U+0000 handling, immutable history, lifecycle transitions, cross-store failure
  behavior, audit model and migration/rollback acceptance. Resolve the
  pre-Gate-2 SQLite/concurrency evidence method; the current registry test is
  not equivalent. Product Owner
  and Security approval is required, with Operations approval for operational
  failure/topology choices. No schema or migration approval is inferred.
- **Security:** threat/abuse cases covering the full Gate 3 list, with
  mitigations, implementing/operating owners, test evidence plan and explicit
  Product Owner residual-risk acceptance. Require separate Security review
  for freshness, proof/CSRF/replay, audit integrity, recovery abuse and
  runtime-fence claims.

Before implementation, obtain and record the residual decisions and approvals
in the [consolidated approval packet](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md);
do not request approval again for D1–D16 or APR-01–APR-20 within their recorded
scopes. These include:

- **Product Owner:** PO-02–PO-08, PO-10 and PO-14 have bounded decisions
  recorded on 2026-11-25; no reapproval is requested. Remaining technical
  details depend on the reviews/evidence listed in the consolidated packet.
  Per-threat residual-risk disposition is still required after Security
  review. PO-01, PO-09, PO-11 and PO-12 record already-approved current
  deferrals/boundaries; PO-13 is resolved by Product Owner Option A and its
  exact phrase remains historical only.
- **Security:** threat model; proof/replay/CSRF requirements; `auth_time`,
  `max_age`, `acr` and assurance policy; recovery evidence/abuse controls;
  writer/file access controls; audit integrity/failure policy; reconciliation
  threat model; atomic execution-fence architecture and race/crash evidence.
- **Privacy/legal:** provider subject/evidence data classification, lawful
  purpose, minimization, access, notices, retention, deletion/backup handling
  and recovery/support data.
- **Operations:** owner for identity lifecycle and reconciliation; lease,
  retry, timeout and stuck-work thresholds; alert/runbook/escalation;
  backup/restore and rollback authority; deployment topology and
  multi-host/network-filesystem support.
- **Provider review:** approved provider/issuer/client/audience and verified
  claim, logout, revocation and outage semantics.
- **Migration authority:** named individual/role, dual authorization,
  approved manifest and backup verification, quarantine disposition, rollback
  decision and post-rollback reauthentication policy.

The limited-scope D1–D16 approvals recorded in framework §§C.1–C.16 and
APR-01–APR-20 proposed-policy-baseline approval remain bounded by their stated
scopes and exclusions. Their unresolved details and §D matters remain
unapproved until separately dispositioned. Numeric freshness, lease,
retry, deadline, retention and propagation thresholds must not be invented
by implementation. Neither B2 nor B3 authorizes implementation or production
OIDC.

## 12. Delivery evidence

### Agent B3 documentation review

**Documentation corrections accepted — ready for authority review with
explicit blockers.** This is an agent review of the plan, not an independent
specialist approval and not a framework-gate decision. The plan distinguishes
proposed B2 from approved ADR/policy
scopes, preserves recorded D1–D16 approvals without expanding them, maps Gates
1–3 to their exact criteria and evidence gaps, and gives the requested ordered
implementation sequence with dependencies, acceptance criteria, future test
commands and live-infrastructure conditions. This is a documentation review
result only; it does not pass a framework gate or authorize implementation.

The review also retains the separate protected-operation atomic-fence
NO-GO and OIDC production-disabled status. Current source and focused tests
mitigate the anonymous Local Demo external-dispatch path; independent
Security/deployment closure and all framework gate clearances remain pending.

### Validation and scope

The original B3 review changed planning documentation only and ran no tests.
On 2026-11-25, the follow-up approval-to-completion task recorded limited
Product Owner choices and corrected the B2 issuer/subject uniqueness proposal;
that pass changed documentation only. Later work prepared and executed the
synthetic schema harness under prototype authorization
`3509b65517d31ed63c2c2f50c22c0fc8f8d7cb140ad5487cbad7bc4b19180ea8`.
The probe confirmed SQLite `length(TEXT)` stops at embedded U+0000 while
Python `len()` counts remaining characters. The current Python value object
and B2 SQL constraint both reject embedded U+0000, so that SQLite behavior
does not establish an acceptance mismatch in the prototype; the final
provider-facing policy remains deferred. The initial 53-test harness was
expanded to 58 passing cases against the disposable temporary SQLite database,
including race, interrupted-transaction/process-exit and backup/restore
checks. No application lifecycle code,
migration, dependency, provider setting or runtime gate was changed. No
real-data migration, restore rehearsal, live provider operation or deployment
test was run.

The continuation added a disposable single-database disablement/outbox
reference rehearsal (13 passing tests) and a synthetic migration classification,
interruption/restart and backup/restore rehearsal (4 passing tests). It also
added live-gated checks for disabled-account session revocation, issuer and
audience mismatch, and an unpublished JWKS key ID. Because no authorized live
environment is configured, those scenarios remain unexecuted. These are
prototype and gated-test artifacts, not implementation or production
guarantees.
