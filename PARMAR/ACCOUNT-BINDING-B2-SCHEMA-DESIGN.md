# PARMAR B2 Account-Binding Schema and Data Architecture Design

> **UNAPPROVED DESIGN — NOT IMPLEMENTATION AUTHORIZATION**
>
> This document defines a proposed schema and operational architecture. It does not modify a database, approve a migration, select a provider, authorize account-binding workflows, or enable production authentication.

## 1. Purpose and policy basis

This design is informed by the approved tenancy ADR, the limited-scope
Product Owner decisions recorded in the decision framework, the separately
recorded APR-01–APR-20 proposed-policy-baseline approval, and the account-
binding policy proposal. The APR approval settles only its stated policy
direction; it does not approve this schema or any implementation. It
distinguishes:

- **Approved ADR requirements:** immutable PARMAR account identity, fresh proof before optional login-method linking, no automatic link/merge, secure recovery outcomes, per-device sessions, and secure closure without standing support access.
- **Product-owner approvals recorded in the framework:** provider-neutral account ownership, no unknown-identity account creation, one external identity at most per account, multiple verified identities per account, no automatic reassignment or merge, fail-closed conflicts, fresh/independent proof and transaction-bound confirmation for sensitive identity changes, unlink/last-method protection, independent recovery outcomes, lifecycle invalidation principles, and delegated permissions without account ownership. These are limited policy scopes, not implementation authorization; details remain subject to the stated gates.
- **Additional limited Product Owner decisions recorded 2026-11-25:** the provider identity key is the issuer/subject tuple regardless of adapter; exact canonicalization and migration remain deferred. The Product Owner also selected last-method, recovery, current lifecycle-state, staff-guidance, durable-notification-enqueue, affected-session/approval-revocation, retention-deferral and fail-closed cross-store outcome directions. See the [consolidated approval packet](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md) for exact scopes. These decisions do not accept this schema or authorize implementation.
- **Implementation behavior verified in source:** existing account/status/binding records, OIDC state cookies and JWT validation, session/evidence persistence, approval persistence, and append-style audit logging.
- **Proposed B2 architecture:** the records and transactions below.
- **Deferred policy:** exact freshness windows, `auth_time`/`max_age`/`acr` thresholds, recovery evidence, managed-account ownership, retention periods, provider logout guarantees, verifier-configuration provenance across adapters, and product-packaging entitlements.

Primary sources:

- [VOKKI-IDENTITY-TENANCY-ADR.md:39–127](./VOKKI-IDENTITY-TENANCY-ADR.md#L39)
- [PARMAR-ACCOUNT-BINDING-POLICY-DECISIONS.md:34–145](./PARMAR-ACCOUNT-BINDING-POLICY-DECISIONS.md#L34)
- [ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md:61–365](./ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md#L61)

## 2. Current repository evidence

### 2.1 Existing account and binding store

The identity store persists:

- immutable canonical UUIDv4 account IDs;
- `ACTIVE` and `DISABLED` account status;
- provider bindings keyed by exact `(issuer, subject)`; and
- account foreign-key restriction on binding deletion.

The account ID trigger protects account ID updates and account deletion ([identity_store.py:310–394](./identity_store.py#L310)). The binding table itself has uniqueness and a foreign key but no lifecycle state or binding immutability trigger ([identity_store.py:341–369](./identity_store.py#L341)).

`ProviderIdentity` rejects empty issuer/subject values, values over 2048/1024
Python characters, and leading/trailing Python whitespace; the current SQLite
binding table applies corresponding `length()` and edge-whitespace checks
([identity_contracts.py:89–103](./identity_contracts.py#L89),
[identity_store.py:341–369](./identity_store.py#L341)). These checks validate ordinary non-NUL values without selecting
provider-specific canonicalization. The current `ProviderIdentity` contract
and both the existing and proposed SQL checks reject embedded U+0000. SQLite
`length(TEXT)` does stop at U+0000, but that behavior is not reachable for
values accepted by these checks. Whether rejection is the final provider-facing
identity policy remains deferred; the current behavior is technical evidence,
not Product Owner or data-model approval. The Python value object also rejects
non-string inputs; SQLite TEXT affinity can coerce some numeric bindings before
a CHECK sees the stored value. The database invariant is therefore a
stored-value constraint, while the application boundary remains responsible
for typed provider input.

The internal provisioner directly inserts an active account ([identity_store.py:603–637](./identity_store.py#L603)); it does not represent a public enrollment authorization boundary ([identity_store.py:828–830](./identity_store.py#L828)).

Existing lookup resolves only an active account through an exact existing binding ([identity_store.py:652–680](./identity_store.py#L652)); unknown identities fail closed ([identity_contracts.py:211–230](./identity_contracts.py#L211)).

### 2.2 Existing OIDC implementation

OIDC is disabled unless explicitly enabled ([oidc.py:715–724](./oidc.py#L715)). When enabled, the adapter uses state, nonce, PKCE and hardened issuer/audience/JWKS verification ([oidc.py:578–692](./oidc.py#L578)).

The current implementation requires `iat` and maps it to authentication time. It does not implement a product-policy `auth_time`, `max_age`, or `acr` contract ([oidc.py:615–620](./oidc.py#L615), [oidc.py:665–692](./oidc.py#L665)).

The current callback rejects an active session and therefore is a login flow, not a link or recovery flow ([interface/futuristic_app.py:1281–1315](./interface/futuristic_app.py#L1281)). OIDC start and callback persist durable, one-time transaction state ([oidc.py:225–350](./oidc.py#L225)).

### 2.3 Existing session and approval stores

Trusted sessions contain canonical account identity and authentication evidence, but no binding version or account-security epoch ([sessions.py:53–80](./sessions.py#L53)). Account-wide session revocation exists ([sessions.py:1310–1347](./sessions.py#L1310)). Session and identity-evidence records use SQLite transactions and integrity tags ([sessions.py:793–885](./sessions.py#L793)).

Pending approvals are persisted separately with expiry and integrity tags ([interface/approvals.py:658–792](./interface/approvals.py#L658)). Approval redemption is bound to the trusted caller/session in application logic. It has no binding or account-security version dependency in the existing schema.

### 2.4 Existing audit store

The current audit utility is JSONL append with selected-field sanitization ([audit/decision_logs.py:19–56](./audit/decision_logs.py#L19)). It is not evidence of:

- append-only tamper evidence;
- access control;
- retention enforcement;
- integrity checkpoints;
- notification durability;
- cross-store atomicity; or
- production delivery.

### 2.5 Persistence limitations

Existing stores use separate SQLite databases and `BEGIN IMMEDIATE`/integrity checks. OIDC state uses WAL and FULL synchronous mode ([oidc.py:220–222](./oidc.py#L220)). Multi-host, network-filesystem and cross-database atomicity are not established by current source or tests.

### 2.6 Existing protected-operation runtime NO-GO

The repository's core identity contract explicitly records a runtime-enforced
NO-GO for authenticated chat, approval continuation, protected memory writes,
profile/workspace writes and profile selection. Their authorization state and
side effects use separate repositories/databases, and current repository APIs
do not share an authorization transaction or fencing token
([PARMAR-CORE-IDENTITY-CONTRACTS.md:152–225](./PARMAR-CORE-IDENTITY-CONTRACTS.md#L152)).
The approval store's `EXECUTING` claim is atomic only within that store; it is
not atomic with session revocation or a later provider/write operation.

The proposed account-security version and reconciliation contract do not
themselves remove this check-to-effect race. B3 must preserve the existing
runtime NO-GO gates and may not treat a successful version recheck, approval
claim, or session revocation as an atomic execution fence. Clearing a NO-GO
requires the separately reviewed authoritative execution/fencing architecture,
including race, retry, crash and downstream side-effect evidence. No
environment setting, route option, account-binding change, or provider
configuration may bypass the gate. This is a hard prerequisite for enabling
the affected protected operations, not a claim that the B2 schema solves it.

## 3. Design goals

The B2 design must ensure:

1. A provider identity cannot bind to two PARMAR accounts.
2. A direct database update cannot silently reassign binding ownership.
3. No unknown provider identity can create or activate an account.
4. Linking requires verified existing-account evidence, independent provider evidence and explicit confirmation.
5. Unlinking protects the last usable authentication method.
6. Recovery does not rely on profile similarity and must remain a separate lifecycle.
7. Account disablement fails closed for trusted operations.
8. Binding or account-security changes invalidate stale sessions and approvals.
9. Delegated permissions cannot confer account ownership or identity lifecycle authority.
10. Audit and notification behavior is specified as reviewed alternatives; the selected failure policy, retry limits and operational thresholds remain subject to Security/Operations approval.

## 3.1 Independent-review correction summary

This document resolves the Batch 22.12.32 review findings as follows:

1. **Cross-store atomicity:** authoritative account/binding state is separated from best-effort revocation, audit and notification state; no cross-SQLite distributed atomicity is claimed.
2. **Binding integrity:** `account_identity_binding` is the sole canonical owner; a partial unique index covers `ACTIVE` and `PENDING_UNLINK`, and state/ownership/version guards reject invalid writes.
3. **Recovery:** the binding state machine and recovery transaction prevent account assignment before independent ownership verification and prevent replay; evidence/authority remain application and policy gates.
4. **Audit and notification:** proposes enqueue, ordering and integrity semantics, and records alternative failure behaviors without selecting or approving one.
5. **Disablement/reactivation:** authority references, reason codes, security invalidation and reactivation evidence are specified while unresolved authority remains deferred.
6. **Migration/rollback:** backup, manifest, inventory, quarantine, rollback and post-rollback revocation revalidation are specified.
7. **Sensitive data:** a field-level classification table defines plaintext, protected, hash/reference-only and logging restrictions.

## 4. Entity model

The following is a logical design. It does not prescribe the SQL implementation or migration tool.

### 4.1 AccountIdentity

**Purpose:** Canonical server-owned PARMAR account identity.

| Field | Type | Required | Notes |
|---|---|---:|---|
| account_id | UUIDv4 canonical string | Yes | Immutable; not derived from email, phone or provider subject |
| status | enum | Yes | `ACTIVE`, `DISABLED`; future states require separate policy approval |
| security_version | integer or monotonic counter | Yes | Incremented for approved account-security lifecycle changes |
| created_at | UTC timestamp | Yes | Server-generated |
| disabled_at | UTC timestamp | No | Set on disablement |
| disabled_reason_code | opaque enum | No | Do not store free-text in a lifecycle key |
| closing_at | UTC timestamp | No | Future state/closure support only if approved |
| closure_state | enum | No | Deferred; `CLOSING`, `CLOSED` are not currently approved |
| retention_until | UTC timestamp | No | Deferred and policy-dependent |

**Primary key:** `account_id`.

**Foreign keys:** None at creation.

**Unique constraints:** Account ID only.

**Indexes:** `(status)`, `(security_version)`.

**Sensitive classification:** Internal identifier; account lifecycle metadata may be security-sensitive.

**Retention:** Account records are not normally deleted while the ADR blocks standing account deletion. Final retention/tombstone behavior remains deferred.

**Invariants:**

- Account ID never changes.
- Account status and security version transition only through a reviewed lifecycle operation.
- Direct reassignment or delete operations fail closed.

### 4.2 ProviderIdentity

**Purpose:** Canonical exact external identity namespace and subject.

| Field | Type | Required | Notes |
|---|---|---:|---|
| provider_identity_id | UUID opaque | Yes | Internal stable key |
| adapter_id | canonical string | Yes | Verifier-configuration reference only; not an identity namespace or ownership key |
| issuer_namespace | canonical string | Yes | Exact canonical issuer namespace; normalization is deferred |
| subject_key | protected string | Yes | Exact provider subject; never email-derived |
| created_at | UTC timestamp | Yes | Server-generated |
| last_verified_at | UTC timestamp | No | Provider-proof verification record |

**Primary key:** `provider_identity_id`.

**Unique constraints:** `(issuer_namespace, subject_key)`. `adapter_id` identifies the verifier configuration; it does not create a second ownership namespace for the same issuer and subject. If multiple configurations verify the same tuple, they must resolve to this one identity row. Whether and how to retain multiple verifier-provenance references is deferred to data-model/provider review and must not change the ownership key.

**Indexes:** The unique issuer/subject constraint supports exact identity lookup; `(adapter_id)`, `(last_verified_at)`.

**Sensitive classification:** High; provider subject may be identity data.

**Retention:** Retain only as needed for binding/lifecycle/audit; exact periods require privacy review.

**Invariant:** A provider identity key maps to at most one active or lifecycle-bound account context.

### 4.3 AccountIdentityBinding

**Purpose:** Immutable normal binding relationship between canonical account and provider identity.

| Field | Type | Required | Notes |
|---|---|---:|---|
| binding_id | UUID opaque | Yes | Internal lifecycle record key |
| account_id | canonical UUID | Yes | FK to AccountIdentity |
| provider_identity_id | UUID | Yes | FK to ProviderIdentity |
| state | enum | Yes | `PENDING`, `ACTIVE`, `PENDING_UNLINK`, `REVOKED`, `FAILED` |
| proof_event_id | UUID | No | Opaque reference to proof/audit evidence; cross-store FK is not assumed |
| binding_version | integer | Yes | Incremented for lifecycle changes |
| created_at | UTC timestamp | Yes | |
| activated_at | UTC timestamp | No | |
| revoked_at | UTC timestamp | No | |
| revoked_reason_code | enum | No | |

**Primary key:** `binding_id`.

**Canonical architecture decision: Option B**

`account_identity_binding` is the sole canonical ownership record. `active_provider_binding` is not part of the selected model. Option A adds a second representation that must be synchronized on every activation and revocation, with trigger-order, delete-guard and direct-write failure modes. Option B derives ownership from binding state and uses one partial unique index. It has fewer synchronization dependencies and makes revocation one state transition in the same row.

The partial unique index covers both `ACTIVE` and `PENDING_UNLINK`: ownership is reserved when a binding becomes `ACTIVE`, remains reserved while unlink is pending, and is released only when transition to `REVOKED` commits. Pending link attempts do not reserve provider ownership. A second account cannot activate a binding for a provider identity with a different historical owner, even after revocation; exceptional reassignment is not an ordinary lifecycle operation and remains separately gated by approved policy.

| Concern | Option A: separate active-owner table | Option B: binding row plus partial unique index (selected) |
|---|---|---|
| Ownership uniqueness | Owner-table primary key enforces one row, but lifecycle and owner rows must stay synchronized | One index predicate covers `ACTIVE` and `PENDING_UNLINK`; uniqueness is checked on the authoritative row |
| Revocation | Requires coordinated lifecycle update and owner-row deletion; trigger ordering can reject the deletion | One `PENDING_UNLINK -> REVOKED` state update releases ownership atomically |
| Pending unlink | Owner row must remain while lifecycle state is pending | Predicate explicitly retains ownership through `PENDING_UNLINK` |
| Reactivation | Requires reinserting/synchronizing a second row | Same immutable binding returns `REVOKED -> PENDING -> ACTIVE` after fresh proof and confirmation |
| Direct writes | Can create stale or mismatched copies unless every path is correctly guarded | Trigger constrains transitions and immutable keys; app authorization remains necessary for valid transitions |
| Concurrency | Owner-table primary key plus writer serialization | SQLite writer serialization plus partial unique index; losing activation has no partial ownership |
| Migration | Must construct and reconcile two representations and quarantine mismatches | Validate rows, quarantine conflicts, then create the predicate index against the canonical table |
| SQLite compatibility | Avoids partial-index feature dependency but has more trigger synchronization | Requires SQLite 3.8.0+; supported by the selected SQLite family when version-pinned/verified |
| Failure recovery | Must detect and repair lifecycle/owner divergence | One row is authoritative; durable reconciliation is still needed for cross-store effects |

**Keys and referential requirements**

- `provider_identity.provider_identity_id` is the primary key; `(issuer_namespace, subject_key)` is unique regardless of adapter.
- `account_identity_binding.binding_id` is the primary key; `(account_id, provider_identity_id)` is unique, preserving one lifecycle row per pair and permitting same-owner reactivation of that row.
- `account_identity_binding.account_id` references the existing SQLite `accounts.account_id` primary key (the logical `AccountIdentity` entity); this parent key is present in the current identity-store schema.
- `account_identity_binding.provider_identity_id` references `provider_identity.provider_identity_id`, which is its primary key.
- No active-owner composite foreign key is needed: the authoritative binding row contains both owner and provider identity. The synthetic disposable DDL below does not create or redefine the existing account table.
- Account and provider deletion are restricted while bindings refer to them. A closed account or revoked binding is not deleted by ordinary lifecycle operations.

**Synthetic SQLite prototype DDL — disposable execution only**

The excerpt shows the binding-integrity tables, index and triggers only; non-key timestamps, proof references, audit entities and reconciliation-work schema are described separately and are not implied to have been created.

```sql
CREATE TABLE provider_identity (
    provider_identity_id TEXT NOT NULL PRIMARY KEY
        CHECK(typeof(provider_identity_id) = 'text'),
    adapter_id TEXT NOT NULL
        CHECK(typeof(adapter_id) = 'text'),
    issuer_namespace TEXT NOT NULL
        CHECK (
            typeof(issuer_namespace) = 'text'
            AND instr(issuer_namespace, char(0)) = 0
            AND length(issuer_namespace) BETWEEN 1 AND 2048
            AND issuer_namespace = trim(
                issuer_namespace,
                char(9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760,
                     8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
                     8201, 8202, 8232, 8233, 8239, 8287, 12288)
            )
        ),
    subject_key TEXT NOT NULL
        CHECK (
            typeof(subject_key) = 'text'
            AND instr(subject_key, char(0)) = 0
            AND length(subject_key) BETWEEN 1 AND 1024
            AND subject_key = trim(
                subject_key,
                char(9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760,
                     8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
                     8201, 8202, 8232, 8233, 8239, 8287, 12288)
            )
        ),
    UNIQUE (issuer_namespace, subject_key)
);

CREATE TABLE account_identity_binding (
    binding_id TEXT NOT NULL PRIMARY KEY
        CHECK(typeof(binding_id) = 'text'),
    account_id TEXT NOT NULL
        CHECK(typeof(account_id) = 'text')
        REFERENCES accounts(account_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    provider_identity_id TEXT NOT NULL
        CHECK(typeof(provider_identity_id) = 'text')
        REFERENCES provider_identity(provider_identity_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    state TEXT NOT NULL CHECK(typeof(state) = 'text'),
    binding_version INTEGER NOT NULL
        CHECK (typeof(binding_version) = 'integer' AND binding_version >= 1),
    UNIQUE (account_id, provider_identity_id),
    CHECK (state IN (
        'PENDING',
        'ACTIVE',
        'PENDING_UNLINK',
        'REVOKED',
        'FAILED'
    ))
);

CREATE UNIQUE INDEX one_owned_binding_per_provider_identity
ON account_identity_binding(provider_identity_id)
WHERE state IN ('ACTIVE', 'PENDING_UNLINK');

CREATE TRIGGER binding_insert_pending_only
BEFORE INSERT ON account_identity_binding
WHEN NEW.state <> 'PENDING'
  OR NEW.binding_version <> 1
BEGIN
    SELECT RAISE(ABORT, 'binding must start pending at version one');
END;

CREATE TRIGGER binding_update_guard
BEFORE UPDATE ON account_identity_binding
WHEN NEW.binding_id <> OLD.binding_id
  OR NEW.account_id <> OLD.account_id
  OR NEW.provider_identity_id <> OLD.provider_identity_id
  OR NEW.binding_version <> OLD.binding_version + 1
  OR (
      NEW.state IN ('ACTIVE', 'PENDING_UNLINK')
      AND EXISTS (
          SELECT 1
          FROM account_identity_binding
          WHERE provider_identity_id = NEW.provider_identity_id
            AND account_id <> NEW.account_id
            AND state IN ('ACTIVE', 'PENDING_UNLINK', 'REVOKED')
      )
  )
  OR NOT (
      (OLD.state = 'PENDING'
       AND NEW.state IN ('ACTIVE', 'FAILED'))
      OR (OLD.state = 'ACTIVE'
          AND NEW.state = 'PENDING_UNLINK')
      OR (OLD.state = 'PENDING_UNLINK'
          AND NEW.state IN ('ACTIVE', 'REVOKED'))
      OR (OLD.state = 'REVOKED'
          AND NEW.state = 'PENDING')
      OR (OLD.state = 'FAILED'
          AND NEW.state = 'PENDING')
  )
BEGIN
    SELECT RAISE(ABORT, 'invalid binding update or lifecycle transition');
END;

CREATE TRIGGER binding_delete_rejected
BEFORE DELETE ON account_identity_binding
BEGIN
    SELECT RAISE(ABORT, 'binding history is retained; transition state instead');
END;

CREATE TRIGGER binding_reject_provider_delete
BEFORE DELETE ON provider_identity
WHEN EXISTS (
    SELECT 1
    FROM account_identity_binding
    WHERE provider_identity_id = OLD.provider_identity_id
)
BEGIN
    SELECT RAISE(ABORT, 'provider identity has binding history');
END;

CREATE TRIGGER provider_identity_key_immutable
BEFORE UPDATE OF provider_identity_id, adapter_id, issuer_namespace, subject_key
ON provider_identity
BEGIN
    SELECT RAISE(ABORT, 'provider identity key is immutable');
END;

```

The issuer/subject checks preserve the current `ProviderIdentity` bounds and edge-whitespace rejection for ordinary non-NUL values. The SQL `instr(..., char(0)) = 0` condition rejects every value containing U+0000 before it can satisfy the full check; such over-limit values do not pass the illustrated SQL constraint. Although SQLite `length(TEXT)` stops at U+0000 while Python `len()` counts beyond it, this does not create an acceptance mismatch while both boundaries reject U+0000. The synthetic DDL and current value object demonstrate that rejection behavior, but the final provider-facing policy remains for the identity/data-model and provider authorities to decide. If a future policy accepts U+0000, its length semantics must be specified and tested consistently. No trimming, rewriting or provider-specific canonicalization is proposed.

The synthetic validation compares application and SQL acceptance for empty and over-limit strings, embedded U+0000, leading/trailing whitespace, internal whitespace, and the same exact issuer/subject tuple presented through different adapter IDs. Current tests show both application and SQL reject embedded U+0000; they do not decide whether that restriction is accepted provider policy. Application rejection of non-string values and SQLite TEXT-affinity behavior for direct numeric/BLOB bindings are tested/documented separately; do not claim identical acceptance for those direct inputs unless the data-model owner defines that contract.

**At-rest protection boundary:** the synthetic DDL stores `subject_key` as ordinary SQLite `TEXT` so the prototype can exercise exact-tuple uniqueness. This does not implement the logical model's protected/reference-only treatment for provider subjects and is not an acceptable production storage decision. Before schema acceptance or migration, Security, Privacy/Legal and the identity/data-model owner must approve a representation, key custody/rotation and backup handling, and an exact-match uniqueness/lookup strategy that preserves the issuer/subject ownership key. No encryption or keyed-index design is selected here.

The triggers are deliberately validation-only: they do not write to another ownership table, so there is no synchronization loop or trigger-recursion dependency. Pending attempts do not reserve ownership. On activation, the transition trigger rejects another account if the provider identity is currently owned or has a revoked owner. The unique pair constraint rejects a duplicate lifecycle row for the same pair. These checks prevent ordinary reassignment while allowing multiple non-owning pending attempts; concurrent activation is still protected by the partial unique index. Any exceptional correction requires a separately approved migration path, not a bypassing lifecycle update.

SQLite cannot distinguish an authorized application transition from an otherwise valid direct SQL transition made by a process with write access to the database. Triggers reject invalid shapes and transitions, but the lifecycle writer must authorize valid state transitions. Direct INSERT is limited to `PENDING`; direct UPDATE on the illustrated core columns is limited to the transition table below and must increment the version exactly once; direct DELETE always aborts. Any additional metadata column must be immutable or have transition-specific validation in the same guarded write. Protect database-file access and expose only the authorized lifecycle writer.

`PRAGMA foreign_keys=ON` is connection-scoped and must be applied and verified on every identity-store connection before any transaction. Parent columns must be primary/unique keys with compatible collations. Foreign keys and the partial index enforce referential and uniqueness properties; they do not prove identity, provider possession, confirmation, recovery authority, last-method eligibility, or notification delivery.

**SQLite compatibility assumption:** SQLite 3.8.0 or later is required for partial indexes. The deployed/runtime SQLite library must be pinned or checked at startup; older or incompatible builds must fail closed rather than silently omit the index. Foreign-key enforcement must be compiled in and verified on every opened connection. The synthetic DDL was executed only in an isolated disposable prototype and remains unapproved for application or production use.

**Database/application guarantee matrix**

| Invariant | Database guarantee | Application/operational guarantee |
|---|---|---|
| At most one active or pending-unlink owner per provider identity | Partial unique index over provider identity for `ACTIVE` and `PENDING_UNLINK` | Transaction logic returns generic conflict; no ownership details leak |
| One lifecycle row per account/provider pair | Composite `UNIQUE(account_id, provider_identity_id)` | Only authorized linking/recovery flow may create or reactivate a row |
| No ordinary historical reassignment | Activation guard rejects a provider identity with a different active or revoked owner; updates cannot change identity columns | Exceptional correction requires separate authority, review and audited migration |
| Valid state transitions/version changes | State `CHECK`, transition trigger, immutable IDs/owner columns, exact `binding_version + 1`, delete-rejection trigger | Proof, confirmation, actor authority and reason are checked by the lifecycle writer |
| Account/provider referential integrity | Foreign keys to account/provider primary or compatible unique keys | `PRAGMA foreign_keys=ON` verified for every connection; schema migration validates existing rows |
| Session/approval invalidation and reconciliation | Not guaranteed by binding-table constraints | Identity-store transaction, durable reconciliation work, fail-closed resolution and operational recovery |

**Direct-write cases**

| Direct operation | Database result | Application control still required |
|---|---|---|
| Insert binding directly as `ACTIVE` or another non-`PENDING` state | Rejected by insert trigger | A `PENDING` insert still requires authorized link/recovery entry |
| Update owner IDs or binding ID | Rejected by update guard | Exceptional correction only through approved migration |
| Skip or invent a state transition, or rewrite binding version arbitrarily | Rejected by transition/version guard | A syntactically valid transition still requires proof, confirmation and actor authorization |
| Revoke without unlink workflow | Direct `ACTIVE -> REVOKED` rejected; `PENDING_UNLINK -> REVOKED` has a valid shape | Only authorized unlink consumer may finalize after confirmation and last-method recheck |
| Delete lifecycle binding or referenced identity | Binding delete trigger/FK restriction rejects | Retention/closure policy remains separate |
| Change provider identity tuple or key | Provider-key trigger rejects | Provider-key migration needs a separately approved migration |

The account parent is the existing `accounts` table, whose `account_id` is a primary key and whose account-ID update/delete protections already exist in the source schema ([identity_store.py:310–394](./identity_store.py#L310)). The provider table and its unique tuple are proposed additions. Provider namespace and subject changes require a separately approved migration; they cannot be applied as ordinary updates.

**Sensitive classification:** High.

### 4.5 Identity validation and type policy

**Embedded U+0000:** the current value object and proposed SQL adapter reject this character before persistence. This is the tested technical behavior, not an approved provider-facing identity policy; final acceptance remains with the Product Owner, identity/data-model owner and provider-capability review.

**Unicode:** do not normalize NFC/NFD automatically. A future canonicalization policy requires provider, identity, migration and compatibility approval. Current SQL and application behavior preserve Unicode code points and thus treat canonical equivalents as distinct until an authority approves normalization.

**Type boundary:** issuer and subject must be exact Python `str` values. `None`, `bytes`, `bool`, integers and floats are invalid before SQL binding. Direct SQLite adapters must use parameter binding and must not rely on TEXT affinity to convert input types.

**Binding version:** the application adapter must require exact Python `int` values with `type(value) is int`, reject booleans and values below one, and pass each lifecycle update as `old_version + 1`. SQLite INTEGER affinity and the trigger provide a second defensive boundary but cannot recover the original storage class of an already-coerced parameter.

**Connection trust boundary:** only application-owned connections may enable foreign keys and open the B2 schema. Every connection must execute `PRAGMA foreign_keys=ON` and verify `PRAGMA foreign_keys` returns `1` before use. Raw, test or administrator connections are untrusted and must not write lifecycle tables.

**Schema privilege boundary:** deployment must use separate read/write roles or a least-privilege application role that cannot `DROP` or replace tables, indexes or triggers. Schema migrations and trigger changes require a separately authorized migration role and all-writer quiescence. SQLite files require filesystem permissions that prevent untrusted processes from replacing or modifying the database.

SQLite itself has no native database users or role/GRANT isolation. “Roles” below must be implemented as separate OS processes/users, containers, file permissions, deployment credentials and migration tooling, not by SQLite statements. A process with write access to the SQLite file can ordinarily alter schema; therefore the application process must not share schema-write capability with untrusted code, and migration code must run only under a separately controlled authority.

**Invariants:**

- `binding_id`, `account_id` and `provider_identity_id` never change in-place.
- No automatic reassignment or merge.
- An account may have multiple active bindings.
- One external identity may have only one account binding in active state.
- Revocation is a state transition, not deletion or silent ownership update.

### 4.4 Binding lifecycle state

The binding state machine is `PENDING`, `ACTIVE`, `PENDING_UNLINK`, `REVOKED` and `FAILED`. `PENDING_LINK` in earlier drafts is renamed `PENDING`. Binding-level `SUSPENDED` is not supported: approved account lifecycle currently distinguishes `ACTIVE` and `DISABLED`, and disabling an account blocks authentication without releasing provider ownership. A future binding suspension state requires separate approval and defined ownership semantics.

| From | To | Requesting authority and required checks | Ownership reservation |
|---|---|---|---|
| No row | `PENDING` | Authenticated lifecycle writer creates a transaction-bound attempt; no ownership is granted | None |
| `PENDING` | `ACTIVE` | User-initiated link: fresh proof of existing PARMAR account, independent fresh provider proof, explicit transaction-bound confirmation, active-account check, conflict check | Reserved atomically when ACTIVE commits |
| `PENDING` | `FAILED` | User may cancel; lifecycle service may record expiry, rejection or irrecoverable failure. Only the lifecycle writer commits the transition; no identity proof is replayed | None |
| `ACTIVE` | `PENDING_UNLINK` | Account owner requests unlink; fresh account proof, explicit confirmation and atomic last-usable-method check required | Retained |
| `PENDING_UNLINK` | `REVOKED` | Authorized lifecycle worker consumes the same confirmed unlink transaction, rechecks the last-usable-method rule atomically, and records revocation; no second proof is required if the original proof/confirmation remains valid under the approved transaction | Released atomically on commit |
| `PENDING_UNLINK` | `ACTIVE` | Account owner cancels unlink with fresh account proof and explicit cancellation confirmation; current transaction state is rechecked | Retained |
| `REVOKED` | `PENDING` | New link/reactivation attempt for the same immutable owner; fresh account proof, independent provider proof and explicit confirmation; recovery additionally requires its separately approved independent evidence | None until ACTIVE |
| `FAILED` | `PENDING` | New user-authorized link attempt; a new lifecycle transaction and proofs are required | None until ACTIVE |

`REVOKED` and `FAILED` are not deletable. A technical failure before commit rolls back both the state change and version increment. A durable unlink intent remains `PENDING_UNLINK` (and continues reserving the identity) until it is safely completed or explicitly cancelled. The lifecycle writer serializes state changes with `BEGIN IMMEDIATE`, verifies the expected old state/version, and updates state/version atomically. Concurrent activation is finally arbitrated by the partial unique index; losers fail without partial ownership or account disclosure.

Freshness windows, provider assurance claims and numeric thresholds remain deferred. SQL constraints cannot validate proof freshness, user presence, confirmation content, recovery evidence or actor authority; those checks belong to approved application workflows. The state-transition trigger restricts possible transitions but is not an authorization boundary.

### 4.5 LinkingTransaction

**Purpose:** Durable, one-time, replay-safe binding transaction.

| Field | Type | Required | Notes |
|---|---|---:|---|
| link_transaction_id | UUID opaque | Yes | One-time server record |
| account_id | canonical UUID | Yes | Existing target account |
| provider_identity_id | UUID | No | Provider identity established by new proof |
| state | enum | Yes | `PENDING`, `CONFIRMED`, `CONSUMED`, `EXPIRED`, `REJECTED`, `FAILED` |
| account_proof_ref | UUID/hashes | Yes | Reference to verified account proof; no secret |
| provider_proof_ref | UUID/hashes | Yes | Reference to verified provider proof |
| confirmation_digest | string | Yes | Hash of transaction-bound confirmation payload |
| nonce_hash | string | Yes | CSRF/replay nonce digest |
| csrf_binding_hash | string | Yes | Bound authenticated session/context |
| created_at | UTC timestamp | Yes | |
| expires_at | UTC timestamp | Yes | Numeric TTL requires Security/Operations approval |
| consumed_at | UTC timestamp | No | |
| actor_session_id | UUID | Yes | Existing-account session |
| proof_freshness_policy_id | string | No | Deferred policy/configuration reference |
| proof_assurance_level | opaque enum | No | No deferred provider-specific value approved here |

**Primary key:** `link_transaction_id`.

**Unique constraints:**

- a transaction cannot be confirmed and consumed twice;
- `(account_id, provider_identity_id, nonce_hash)` uniqueness may prevent duplicate active intent.

**Indexes:** `(state, expires_at)`, `(account_id, state)`, `(provider_identity_id, state)`.

**Sensitive classification:** High; store proof references and hashes, never provider secrets or raw authentication tokens.

**Retention:** Short pending lifetime; terminal record retention deferred.

### 4.6 UnlinkingTransaction

**Purpose:** Durable unlink intent and confirmation.

| Field | Type | Required | Notes |
|---|---|---:|---|
| unlink_transaction_id | UUID opaque | Yes | |
| account_id | canonical UUID | Yes | |
| binding_id | UUID | Yes | Binding proposed for unlink |
| state | enum | Yes | `PENDING`, `CONFIRMED`, `CONSUMED`, `EXPIRED`, `REJECTED`, `FAILED` |
| proof_ref | UUID/hashes | Yes | Operation-appropriate proof |
| remaining_usable_method_count | integer snapshot | Yes | Revalidated atomically at commit |
| confirmation_digest | string | Yes | |
| nonce_hash | string | Yes | |
| created_at | UTC timestamp | Yes | |
| expires_at | UTC timestamp | Yes | Numeric TTL deferred |
| consumed_at | UTC timestamp | No | |

**Primary key:** `unlink_transaction_id`.

**Identity-store references:** `account_id` and `binding_id` can be enforced as SQLite foreign keys because this transaction is owned by the identity store.

**Indexes:** `(account_id, state)`, `(binding_id, state)`, `(state, expires_at)`.

**Invariant:** Commit is denied if the operation would remove the last usable authentication method outside an approved recovery workflow.

### 4.7 RecoveryTransaction

**Purpose:** Explicit independent-evidence and account-restoration workflow.

| Field | Type | Required | Notes |
|---|---|---:|---|
| recovery_transaction_id | UUID opaque | Yes | |
| account_id | canonical UUID | No until verified | Must be null until independent ownership verification succeeds |
| state | enum | Yes | Recovery state-machine state |
| evidence_refs | list/reference IDs | Yes | Independent evidence references, not profile attributes |
| confirmation_digest | string | Yes | |
| nonce_hash | string | Yes | |
| created_at | UTC timestamp | Yes | |
| expires_at | UTC timestamp | Yes | Numeric TTL deferred |
| recovery_case_ref | UUID | No | Support/exception case reference |
| attempts | integer | No | Numeric limits deferred |
| consumed_at | UTC timestamp | No | |

**Primary key:** `recovery_transaction_id`.

**Identity-store reference:** `account_id` may be a SQLite foreign key after independent verification. Evidence references are opaque identifiers; they are not cross-database foreign keys.

**Sensitive classification:** Very high.

**Invariants:**

- No account lookup solely from email, name, phone or profile similarity.
- No provider identity alone grants ownership of an existing account.
- Recovery may restore a method only under separately approved evidence.
- Confirmed recovery increments binding/account security versions and invalidates stale sessions/approvals.
- Account assignment is forbidden until the `VERIFIED` state.

**Required state machine:**

```text
REQUESTED
  -> UNDER_REVIEW
  -> VERIFIED
  -> CONFIRMED
  -> CONSUMED

REQUESTED/UNDER_REVIEW/VERIFIED/CONFIRMED may transition to:
  REJECTED
  EXPIRED
  CANCELLED
  FAILED
```

Permitted transitions:

- `REQUESTED -> UNDER_REVIEW`: an owner-verification process has started.
- `UNDER_REVIEW -> VERIFIED`: independent evidence verifies the existing account owner or an approved account-restoration authority. Verification evidence is retained by reference.
- `VERIFIED -> CONFIRMED`: operation-appropriate proof and explicit transaction-bound confirmation succeed.
- `CONFIRMED -> CONSUMED`: exactly one atomic consume operation creates/restores the approved binding and increments security state.
- `REQUESTED/UNDER_REVIEW/VERIFIED/CONFIRMED -> REJECTED/CANCELLED/EXPIRED/FAILED`: only the lifecycle writer records the terminal outcome.

Consumption invariants:

- `account_id` is set only after `VERIFIED`.
- `CONFIRMED -> CONSUMED` and binding activation occur in one authoritative identity transaction.
- Consumption compares and sets the expected state in an atomic `UPDATE ... WHERE state='CONFIRMED'`.
- Concurrent consumers must produce exactly one success and generic replay/terminal conflict responses.
- Replay never changes account, binding or security state.
- `FAILED` must not imply a binding was restored.

### 4.8 SecurityVersion / AuthenticationEpoch

**Purpose:** Monotonic invalidation state for account and binding security changes.

Two options can be represented; the design recommends a combined account security version until a separate binding version is approved:

| Field | Type | Required | Notes |
|---|---|---:|---|
| account_id | canonical UUID | Yes | |
| account_security_version | integer | Yes | Increment on disablement, recovery, binding lifecycle or closure |
| binding_security_version | integer | No | Optional future targeted invalidation |
| updated_at | UTC timestamp | Yes | |
| reason_code | enum | Yes | |
| lifecycle_event_id | UUID | Yes | Audit reference |

**Primary key:** `account_id`.

**Foreign key/reference:** `account_id` is a local identity-store foreign key. `lifecycle_event_id` is a logical audit reference and is not a SQLite foreign key when audit is stored separately.

**Index:** `(account_security_version)`.

**Invariant:** Session and approval records snapshot the version(s) relevant at creation and must reject stale versions atomically or at resolution.

### 4.9 SessionAssociation

Existing session records should add only the fields required for lifecycle invalidation:

| Field | Type | Required | Notes |
|---|---|---:|---|
| session_id | UUID | Yes | Existing key |
| account_id | canonical UUID | No | Existing trusted account identity |
| account_security_version | integer | No | Snapshot |
| binding_security_version | integer | No | Future targeted version |
| identity_evidence_id | UUID | No | Existing evidence key |

**References:** Account/evidence identifiers are logical references; enforce SQLite foreign keys only when the referenced rows share this session database. Otherwise, trusted resolution must revalidate them against authoritative state.

**Index:** `(account_id, status)`, `(account_security_version)`.

**Invariant:** Resolution fails closed if account status unavailable, evidence invalid or snapshots are stale according to approved policy.

### 4.10 ApprovalAssociation

Existing pending approvals should add:

| Field | Type | Required | Notes |
|---|---|---|---|
| approval_id/token_hash | existing key | Yes | |
| account_id | canonical UUID | Yes for trusted approvals | |
| session_id | UUID | Yes | |
| account_security_version | integer | Yes | Snapshot |
| binding_security_version | integer | No | Optional |
| identity_evidence_id | UUID | No | |

**References:** Account/session/evidence identifiers are logical references. Enforce SQLite foreign keys only for rows in the same approval database; cross-store validity is application-enforced at redemption.

**Invariants:** A stale or revoked session, evidence or account security version cannot redeem the approval.

### 4.11 AuditEvent

**Purpose:** Durable security/lifecycle evidence.

| Field | Type | Required | Notes |
|---|---|---|---|
| audit_event_id | UUID | Yes | |
| event_type | enum | Yes | Link, unlink, conflict, recovery, disable, reactivate, closure, grant revoke |
| account_id | canonical UUID | No | Set only where account is known |
| actor_type | enum | Yes | USER, SYSTEM, ADMIN, RECOVERY_SERVICE |
| actor_id | opaque UUID | No | Avoid unnecessary personal data |
| session_id | UUID | No | |
| transaction_id | UUID | No | |
| provider_identity_id | UUID | No | Protected identity reference |
| binding_id | UUID | No | |
| security_version_before/after | integer | No | |
| outcome | enum | Yes | SUCCEEDED, DENIED, FAILED |
| reason_code | enum | Yes | |
| event_digest | string | Yes | Integrity checksum/chain field |
| previous_event_digest | string | No | Tamper-evidence chain |
| occurred_at | UTC timestamp | Yes | |
| integrity_key_version | integer | No | Future key management |

**Primary key:** `audit_event_id`.

Account, session, provider, binding and transaction IDs are logical references. Add a SQLite foreign key only when the referenced entity is in the same audit database; no cross-database foreign-key guarantee is claimed.

**Indexes:** `(account_id, occurred_at)`, `(event_type, occurred_at)`, `(outcome, occurred_at)`, `(transaction_id)`.

**Sensitive classification:** Very high.

**Retention:** Exact periods require privacy/legal/operations approval.

**Guarantees to define before implementation:**

- access control;
- append-only enforcement;
- chain/checkpoint model;
- key custody;
- backup integrity;
- audit outage handling.

### 4.12 Notification / Outbox Event

**Purpose:** Durable lifecycle notification delivery.

| Field | Type | Required | Notes |
|---|---|---:|---|
| notification_id | UUID | Yes | |
| event_type | enum | Yes | Binding, unlink, recovery, disable, closure |
| account_id | canonical UUID | Yes | |
| audit_event_id | UUID | Yes | Reference to source audit |
| channel | enum | Yes | Defined only after approved policy |
| destination_ref | opaque ID | No | Never store secret or unnecessary raw contact |
| payload_digest | string | Yes | Payload may be encrypted or external |
| payload | encrypted blob | No | Avoid if not required |
| state | enum | Yes | `QUEUED`, `DELIVERING`, `DELIVERED`, `FAILED`, `CANCELLED` |
| attempt_count | integer | Yes | |
| next_attempt_at | UTC timestamp | No | |
| delivered_at | UTC timestamp | No | |
| created_at | UTC timestamp | Yes | |

**Primary key:** `notification_id`.

**References:** Account and audit event IDs are logical references. Add SQLite foreign keys only when both parents are in the same notification database; cross-store existence is reconciled by stable event IDs.

**Indexes:** `(state, next_attempt_at)`, `(account_id, created_at)`.

**Sensitive classification:** High.

**Retention:** Exact delivery and failure records require privacy/operations approval.

### 4.13 DelegatedPermissionGrant

**Purpose:** Explicit scoped delegation; never account ownership.

| Field | Type | Required | Notes |
|---|---|---|---|
| grant_id | UUID | Yes | |
| account_id | canonical UUID | Yes | Grant owner/target account |
| grantee_principal_id | UUID/opaque | Yes | Separate principal type |
| scope | enum/set | Yes | Approved resource/action scopes |
| permission_state | enum | Yes | `PENDING`, `ACTIVE`, `REVOKED`, `EXPIRED` |
| owner_confirmation_ref | UUID | Yes | Proof of explicit owner grant |
| identity_lifecycle_allowed | boolean | Yes | Must be false unless separately approved |
| recovery_allowed | boolean | Yes | Must be false unless separately approved |
| reassignment_allowed | boolean | Yes | Must remain false |
| created_at | UTC timestamp | Yes | |
| expires_at | UTC timestamp | No | |
| revoked_at | UTC timestamp | No | |

**Primary key:** `grant_id`.

**References:** Account and owner-confirmation IDs. Enforce SQLite foreign keys only when each parent is in the same grant database; otherwise validate the references in the authorized grant workflow.

**Indexes:** `(account_id, permission_state)`, `(grantee_principal_id, permission_state)`.

**Invariants:**

- Delegation cannot alter account ownership or binding ownership.
- Workspace membership alone is not a grant.
- Grant scope cannot implicitly include linking, unlinking, reassignment or recovery.
- Revocation fails closed for protected operations.

## 5. Entity relationship model

```text
AccountIdentity 1 ─── 0..* AccountIdentityBinding ─── 1 ProviderIdentity
       │                         │
       │                         └── 0..* BindingLifecycleEvent
       │
       ├── 1 ─── SecurityVersion
       ├── 0..* SessionAssociation
       ├── 0..* ApprovalAssociation
       ├── 0..* AuditEvent
       ├── 0..* NotificationOutboxEvent
       └── 0..* DelegatedPermissionGrant

LinkingTransaction ──1 account ──1 provider ──1 binding optional
UnlinkingTransaction ──1 account ──1 binding
RecoveryTransaction ──0..1 account ──0..* evidence refs
AuditEvent ──0..1 account/provider/binding/session/transaction
NotificationOutboxEvent ──1 audit event ──1 account
```

### Cardinalities

- One account: zero or more provider bindings.
- One provider identity: zero or one account in `ACTIVE` or `PENDING_UNLINK`; a revoked historical owner remains immutable.
- A provider identity with a historical `ACTIVE`/`REVOKED` owner cannot be assigned to a different account by ordinary lifecycle operations.
- One account: one security-version row.
- One session: one account and optional binding/evidence snapshot.
- One approval: one account/session/evidence snapshot when trusted.
- One grant: one account owner context and one external/managed grantee.
- One audit event: optional account/provider/binding/transaction context.
- One notification: exactly one source audit event and account.

### Deletion behavior

- Account deletion is not ordinary binding deletion. Accounts remain blocked until a separately approved closure/deletion policy exists.
- Binding revocation is a lifecycle state transition, not a silent reassignment.
- Provider identity records may be retained as a tombstone or deleted only under the approved lifecycle.
- Recovery records, audit events and notifications are retained independently of active session records.
- Legacy records remain unmapped and never derive account ownership from profile attributes.

## 6. Transaction design

The design separates:

1. **identity store**;
2. **session store**;
3. **approval store**;
4. **audit store**;
5. **notification/outbox store**.

Cross-store atomicity is not guaranteed by current SQLite architecture. Every lifecycle operation must define which stores are authoritative and which are verified in an outbox or compensation step.

### 6.0 Authoritative persistence topology

**Authoritative account/binding store**

The identity SQLite store owns:

- account records;
- account status;
- provider identities;
- binding lifecycle records;
- account security version;
- lifecycle transaction states.

This store is also the authority for provider-identity uniqueness and binding ownership. No session or approval store may create or reassign a binding.

**Authoritative security state**

The identity store is the authority for `account_security_version`. Binding and account lifecycle mutations update it in the same local identity-store transaction that commits the ownership/lifecycle change.

**Secondary stores**

Session, approval, audit and notification stores are secondary for lifecycle authorization:

- sessions contain an account/security snapshot and evidence state;
- approvals contain an account/security snapshot and must revalidate account state;
- audit is a security lifecycle evidence store;
- notifications are a durable outbox.

**No distributed transaction claim**

No shared SQLite transaction is claimed across separate databases. A lifecycle mutation is successful only after:

1. the identity-store transaction commits;
2. security-version state is readable by protected operations;
3. required audit event status is durable; and
4. the notification outbox is enqueued if notification is required.

Secondary revocation is reconciliation state:

- **Transaction committed:** identity/binding/security state changed.
- **Revocation requested:** affected sessions/approvals were durably marked for invalidation or an invalidation outbox/event was created.
- **Revocation enforced:** session/evidence/approval resolution rejects stale records.
- **Notification queued:** notification was durably added to the outbox.
- **Notification delivered:** external delivery acknowledgement was recorded.

A crash after commit does not retroactively undo the identity state. It starts reconciliation and stale session/approval resolution fails closed.

**Unavailable-store behavior**

- Account/binding store unavailable: deny the sensitive operation.
- Audit unavailable when audit is policy-required: roll back or withhold commit as approved; never report success.
- Session store unavailable: deny protected operations that require trusted session resolution.
- Approval store unavailable: deny approval redemption.
- Notification store unavailable: if notice is policy-required, lifecycle mutation may remain pending or fail according to the approved notification policy; it must not report notification delivered.

**Reconciliation and idempotency**

The lifecycle transaction ID is the stable reconciliation work ID and primary idempotency key. A lifecycle retry must compare the same expected binding state/version and may not repeat a committed ownership or security-version change. Each secondary effect has a stable effect key derived from the lifecycle transaction ID and effect type; audit and outbox stores must enforce uniqueness for those keys before implementation. External delivery is not described as exactly-once unless the selected delivery endpoint honors the stable notification ID as an idempotency key.

The identity-store transaction atomically commits the binding transition, account security-version change, lifecycle outcome, and exactly one durable reconciliation-intent row. No work exists only in memory or solely in a secondary store. A pre-commit crash leaves neither mutation nor intent; a post-commit crash leaves both for replay.

**Reconciliation work and lease contract**

Each work row records lifecycle transaction ID, operation, account/binding, expected and committed versions, required effects, next step, lease owner, lease epoch, lease expiry, progress, terminal reason, completion evidence and operator acknowledgement reference. Work states are `READY`, `LEASED`, `RETRYABLE`, `COMPLETE` and `TERMINAL_FAILURE`. Retry counts, lease duration, retry ceilings and deadlines remain **TBD pending Security/Operations approval**.

- Workers run under a named reconciliation-service identity; that role does not grant binding or account ownership authority.
- Lease acquisition runs under `BEGIN IMMEDIATE`: conditionally claim only ready/retryable work or work whose lease is expired, increment `lease_epoch`, set owner/expiry, and proceed only if exactly one row changed.
- Lease renewal, progress and terminal updates are conditional on the same work ID, owner, epoch, non-expired lease and expected work state. A stale epoch cannot advance or complete work.
- Takeover is permitted only after the recorded lease expires under the approved clock/lease policy. The new owner increments the epoch; it does not replay provider proof or confirmation.
- Identity-store fencing prevents stale workers from updating progress. Every secondary effect must also be idempotent by its stable effect key; a worker crash after an effect but before checkpoint safely retries the same key.
- Where an external endpoint cannot deduplicate by notification ID, a lost acknowledgement is an ambiguous outcome: do not claim delivery or blindly replay. Record a blocked/terminal item for operator reconciliation under the approved notification policy. Exactly-once external delivery is not claimed.

**Crash, failure and operator recovery**

- Before authoritative commit: transaction rollback leaves no binding/security mutation and no reconciliation work.
- After commit but before a secondary effect: lease takeover resumes at the persisted next step.
- After an effect but before progress commit: retry uses the same effect key and must be deduplicated by the receiving store.
- Session/approval-store unavailability never reverses committed ownership; protected resolution rechecks authoritative account/security state and fails closed.
- Audit and notification failures follow their separately pending policies. A terminal failure records the failed effect, error class, last successful step, lease epoch and evidence; it never masquerades as completion.
- Terminal work cannot be reopened by a worker. A named operator with separately approved authority may acknowledge and create an audited recovery action; that action gets a new identifier and cannot alter binding ownership without the normal lifecycle proof/confirmation requirements.
- Stuck-work alert thresholds and operator response times remain pending Operations approval. Stuck work does not release an identity, reverse a committed lifecycle transition, or authorize ownership.

**Completion evidence**

Mark work `COMPLETE` only after durable evidence proves: authoritative lifecycle transaction and security version committed; all required session/approval invalidation or fail-closed revalidation effects are enforced; required audit status is recorded under the approved audit option; required notification outbox records exist; any `DELIVERED` status has an external acknowledgement; and the completing worker identity, lease epoch, timestamp and effect references are persisted. A timer, expired lease, queued notification or audit intent alone is not completion evidence. An approved terminal failure remains visibly distinct from completion.

Numeric retry, lease, completion and alert thresholds are **TBD pending Security/Operations approval**.

### 6.1 Identity linking

Atomic boundary:

1. Validate existing account status and target account proof.
2. Validate provider proof and proof freshness through a provider-neutral interface.
3. Recheck provider identity conflict and account binding cardinality under `BEGIN IMMEDIATE`.
4. Insert or transition the binding to `ACTIVE`; the binding state and partial unique index are the only ownership authority.
5. Increment the account security version and insert the durable reconciliation intent in the same identity-store transaction.
6. Record the required audit intent and notification intent in that transaction when their authoritative records are in the identity store; otherwise reconcile them using stable IDs.
7. Revalidate/invalidate sessions and approvals as secondary effects; protected resolution fails closed against the committed account security version until invalidation or authoritative revalidation is evidenced.

Safe failure:

- If provider claim, account proof or confirmation fails: no account/binding mutation.
- If a unique constraint is violated: fail closed and expose no account ownership details.
- If audit cannot be durably written and audit is required: roll back the binding/account-security mutation.
- If notification enqueue fails and notice is required: use a fail-closed or approved pending state; never claim success.

### 6.2 Identity unlinking

Atomic boundary:

1. Revalidate account status and actor authority.
2. Revalidate fresh proof and confirmation.
3. Count usable methods inside the identity transaction.
4. Deny if the operation would remove the last usable method outside approved recovery.
5. Transition `ACTIVE -> PENDING_UNLINK` while retaining provider ownership, or finalize `PENDING_UNLINK -> REVOKED` only by consuming the same confirmed unlink transaction and rechecking the last-usable-method rule in that final transaction.
6. Commit the binding transition, account security-version increment and reconciliation intent atomically in the identity store.
7. Revoke affected sessions and approvals as reconciled secondary effects; protected resolution fails closed meanwhile.
8. Record audit/notification intent atomically where stored with identity state; otherwise reconcile it by stable ID.

Every denied operation leaves binding and session state unchanged.

### 6.3 Recovery

Atomic boundary:

1. Create or update a recovery transaction in a non-authenticated, abuse-controlled state.
2. Record independent evidence references.
3. Require approved confirmation/step-up.
4. Resolve or create the target account only under separately approved rules.
5. Add/reactivate the verified method as a lifecycle binding only after the approved recovery verification and confirmation.
6. Commit binding/security-version state and reconciliation intent atomically in the identity store.
7. Revoke existing sessions and pending approvals as secondary effects; they remain unusable while authoritative security-version revalidation fails.
8. Record audit and notification intent in the authoritative transaction where supported, otherwise reconcile by stable identifiers.

Profile similarity, email, name or legacy UUID alone cannot establish recovery ownership.

### 6.4 Account disablement/reactivation

Atomic boundary:

1. Validate transition authority and reason code.
2. Transition account status.
3. Increment account security version.
4. Revoke account sessions and evidence.
5. Cancel or invalidate pending approvals.
6. Write audit and notification records.

`ACTIVE` resolution must fail closed if account status or status storage is unavailable.

**Disablement authority**

Authority is an opaque role/actor reference and must be separately approved. B2 does not assign a product role or infer administrator, support or managed-account privilege.

Required disable fields:

- actor principal ID;
- authority reference;
- reason code;
- independent approval reference if required;
- security-version before/after;
- audit event;
- notification outcome.

**Reactivation**

- Reactivation is not allowed merely because a disabled record is deleted or reopened.
- Reactivation requires a separately approved authority and reactivation proof.
- Reactivation increments the account security version and creates a new lifecycle audit event.
- Existing sessions and approvals remain revoked and require new trusted authentication and approval creation.

**Authority separation**

- Disablement and reactivation are separate authority decisions. It is not safe to infer reactivation authority solely from disablement authority.
- Any role or actor reference used for disablement/reactivation remains TBD pending product/security/operations approval.
- No support, administrator, family, guardian or organization role is granted authority by this design.
- Reactivation must require an approved verification/re-authentication record and an authority reference.
- Reactivation evidence content and assurance thresholds remain deferred.

**Failure semantics**

- If authority cannot be verified: deny.
- If status cannot be updated: report no disable/reactivate success.
- If session/approval invalidation is unavailable: account resolution still fails closed using the authoritative security/version state.

### 6.5 Security-version increment

A security-version increment is the atomic account-security commit marker. It must be updated in the same lifecycle transaction that changes the account/binding state.

Session and approval invalidation should:

- update server state;
- mark evidence/approvals stale or revoked;
- and reject stale records before authorization.

### 6.6 Session invalidation

Existing session revocation can use account identity and evidence state. B2 adds binding/account security version checks. If session and account stores are in separate SQLite files, a crash between the state change and session revocation requires re-resolution against the authoritative account/binding version and fail-closed handling.

### 6.7 Pending-approval invalidation

An approval must revalidate:

- approval state;
- account status;
- session status;
- identity evidence status;
- account/binding security version;
- active profile and resource scope.

If a check fails closed, the approval is denied and no protected action executes.

### 6.8 Audit and notification outbox

The recommended model is:

- lifecycle mutation and audit/outbox creation in one store transaction where possible;
- durable outbox delivery with idempotent notification IDs;
- no claim of notification delivery before the delivery state is verified;
- separate audit and notification failure policy.

Cross-store fail behavior remains implementation-specific and must be threat-reviewed.

**Audit durability policy**

Before implementation:

- specify append-only storage or access-control enforcement;
- specify event sequence/checkpoint integrity;
- specify actor and key custody;
- specify whether audit persistence failure blocks a sensitive lifecycle mutation;
- specify sensitive event fields and access controls.

Recommended default for review: required security/lifecycle mutations do not report success until their audit event is durably committed in the authoritative lifecycle transaction or into a separately authoritative audit store with a documented compensating state. This is a policy recommendation requiring security/operations approval.

**Required-audit policy alternatives**

Options A, B and C below remain alternatives, not selected/approved policy. In every option, an audit or reconciliation role may record evidence but cannot establish account ownership, approve its own recovery case, or bypass the binding transition/proof requirements. Operator recovery needs a separately authorized and audited action. No option is exactly atomic across independent SQLite databases.

### Option A — Fail closed

- A required lifecycle mutation is rejected if its audit event cannot be durably recorded.
- Security/lifecycle state does not commit.
- Session, approval and notification state remain unchanged unless a separately approved status transition is already terminal.
- **Authorization restriction:** lifecycle activation, reactivation, recovery consumption and ownership change are denied until the required event is durable.
- **Security consequence:** strongest audit completeness when lifecycle and audit completion share one authoritative transaction.
- **Availability consequence:** account operations stop during required audit outage.
- **Crash behavior:** an uncommitted audit/lifecycle transaction leaves no active binding or security-version mutation.
- **Evidence/recovery:** transaction ID, audit write error, authoritative rollback state and reconciliation record.
- **Risk:** possible denial of service during an audit outage.

**Exact proposed ordering**

1. In one identity-store transaction, create the lifecycle/audit intent, perform the binding and security-version mutation, and persist reconciliation work.
2. Commit only when the required integrity-protected audit event is durable in that same authoritative transaction.
3. If audit is a separate store, do not claim Option A's atomic guarantee; use the approved pending or side-store alternative and keep ownership-changing work non-operational until audit evidence is verified.
4. Reconcile session/approval invalidation and notification outbox effects from the durable work record.

No audit intent may exist as an external claim of audit completion. If the audit commit fails, the lifecycle transaction rolls back or remains uncommitted. An orphan audit intent is reconciled and cannot be mistaken for audit completion.

Audit intent and required audit completion evidence are transaction references. Revocation is not considered enforced until stale session/approval resolution is verified or an independently authoritative fail-closed revalidation record exists.

### Option B — Controlled pending state

- The lifecycle mutation may enter a narrowly defined `PENDING_AUDIT` state and be non-operational.
- The identity store atomically commits the pending lifecycle transaction, pending-audit record and reconciliation intent; the binding must not enter `ACTIVE`.
- No binding activation, account reactivation, recovery or privilege increase is allowed until audit is durably completed.
- Disablement or closure that is already effective for security may remain effective, but requires separate threat review.
- **Authorization restriction:** only an explicitly approved security-hold authority may request the disablement/closure exception; it cannot grant access or binding ownership.
- **Security consequence:** bounded but requires strict state restrictions.
- **Availability consequence:** improved availability for emergency security holds, but controlled actions can remain pending.
- **Crash behavior:** reconciliation resumes solely from persisted transaction and audit state.
- **Evidence/recovery:** pending-audit record, rollback/compensation record and audit-gap acknowledgement.
- **Risk:** accidental broadening of pending state or incomplete audit gap recovery.

**Exact proposed ordering**

1. Commit a lifecycle transaction, `PENDING_AUDIT` state, audit intent and reconciliation work together in the authoritative identity store.
2. Prohibit binding activation, account reactivation, recovery consumption or privilege increase.
3. Write a durable audit gap/reconciliation record.
4. Complete the integrity-protected audit record.
5. After audit completion, in one identity-store transaction transition the lifecycle transaction to committed operational state, increment security version and advance the existing reconciliation work.
6. Reconcile revocation/outbox effects from that durable work; do not report completion before required effects are evidenced.

Disablement or closure may remain security-effective only under a separately reviewed exception. Audit completion must precede all ownership-changing transitions.

### Option C — Audit after commit as a separately authoritative side store

- The lifecycle mutation commits to the identity store, while audit writes to a separately authoritative audit store.
- Protected operations require revalidation of identity/security state, but they do not depend on an ordinary append call.
- Reconciliation records the audit gap and blocks reporting success until an integrity-protected audit record is committed or a separately approved terminal failure is recorded.
- **Authorization restriction:** the identity store must persist an audit-reconciliation hold that protected resolution checks; a committed binding cannot authorize use while required audit evidence is outstanding.
- **Security consequence:** strong identity state with explicit audit reconciliation.
- **Availability consequence:** less coupling than a shared transaction.
- **Crash behavior:** crash after lifecycle commit starts reconciliation and stale authorization remains fail closed.
- **Evidence/recovery:** lifecycle/audit/compensating transaction IDs and integrity checkpoints.
- **Risk:** audit gap between commit and reconciliation; not acceptable unless the separate store and recovery path are independently designed.

**Exact proposed ordering**

1. In one identity-store transaction, commit the identity/binding/security lifecycle transaction, audit intent and reconciliation work.
2. Write to the separate audit store using the stable audit-event ID.
3. Reconcile and verify audit ordering/checkpoint evidence.
4. Mark audit completion.
5. Mark revocation requested, then enforce stale session/approval rejection.
6. Mark reconciliation complete only after required audit and revocation evidence exist.

This ordering permits no false audit completion. A crash after identity-store commit leaves the audit intent and work row for takeover; a crash before commit leaves neither. If audit evidence is lost or unavailable, the lifecycle state remains committed but the persisted authorization hold blocks protected use and success reporting until reconciliation is resolved. This is not a claim of distributed atomicity.

An approved terminal audit failure remains a distinct failure outcome; it does not become an audit success or automatically clear the authorization hold. Any exceptional release requires an explicit Security/Operations-approved decision, durable reason and audit evidence.

**Recommended policy**

Audit Option A is recommended for binding activation, exceptional recovery/support changes and account closure. Audit Options B or C may be considered only for narrowly defined security holds or account disablement after Security/Operations approval. Ordinary JSONL append or best-effort notification is not an integrity-protected audit record.

The Product Owner approved a fail-closed/no-success user-impact default on
2026-11-25, with narrowly scoped pending outcomes only after independent
approval. The required-audit storage option, ordering, authorization-hold
mechanics and technical failure policy remain **PENDING Security/Operations
APPROVAL**; this bounded Product Owner choice does not select Option A, B or C.

**Notification outbox policy**

- `QUEUED` means durable enqueue only.
- `DELIVERING`, `DELIVERED`, `FAILED` and `CANCELLED` have separate semantics.
- Delivery acknowledgement is idempotent by `notification_id`.
- Retries preserve the original lifecycle event and payload reference.
- Terminal failure is reconciled and observed; it does not imply that the lifecycle mutation failed.
- Notification failure policy must be approved separately from notification delivery.

## 7. Concurrency and replay protection

### 7.1 Concurrent linking

The binding write and provider identity uniqueness constraint must be serialized. SQLite `BEGIN IMMEDIATE` with a busy timeout is suitable for same-host/same-database operation. The writer compares the expected state and `binding_version`; activation changes the binding state and version in one transaction. The partial unique index over `ACTIVE` and `PENDING_UNLINK` is the final arbiter if concurrent requests target one identity. No second ownership record or trigger synchronization step exists.

Conflict outcomes:

- duplicate same provider/account: same transaction ID is idempotent; a distinct in-flight transaction is a deterministic conflict or is coalesced by the application without creating another binding row;
- duplicate provider/different account: generic conflict and no reassignment;
- concurrent target/account proof: pending attempts do not reserve ownership, but at most one can commit as active; loser state remains non-owning and is rejected/reconciled;
- stale transaction: no mutation.

No unique-constraint error may disclose unrelated account information.

### 7.2 Replay

All three transaction types use:

- opaque ID;
- random nonce;
- transaction cookie/hash or server-side transaction binding;
- one-time state transition;
- expiration check;
- confirmation digest;
- actor/session binding.

First valid submission consumes the transaction. Replay returns a generic expired/already-used result and performs no mutation.

### 7.3 Partial failures

Safe handling:

- database rollback on identity mutation failure;
- no success response unless required audit/outbox state is complete;
- stale in-flight session records fail closed against updated security versions;
- pending approvals cannot execute after lifecycle state changes;
- notification can retry only when an outbox transaction is durable.

### 7.4 Process crashes

Crash windows must leave:

- no implicit active binding;
- no consumed transaction that never committed;
- no reused provider identity mapping;
- no approval usable after an identity/security change.

Crash recovery must use persisted state and idempotent lifecycle operations, not an in-memory assumption.

### 7.5 Multi-worker SQLite

Existing same-host worker tests share persistence, but there is no evidence for multi-host/network SQLite. B2 must require an approved topology and independent-host persistence design before production.

## 8. Security model

### 8.1 Threat model

Required mitigations:

- account takeover through provider control;
- linking to a different account;
- replay of proof or confirmation;
- duplicate/concurrent binding;
- session theft;
- stale session or approval redemption;
- CSRF and cross-origin initiation;
- provider compromise;
- recovery/social-engineering abuse;
- insider/support reassignment;
- audit deletion or substitution;
- notification leakage;
- legacy UUID misassignment;
- database substitution/corruption;
- partial cross-store failure.

### 8.2 Authorization boundaries

Only separate, approved workflows may:

- provision an account;
- add a binding;
- revoke a binding;
- reassign or merge ownership;
- recover an account;
- disable/reactivate/close an account;
- grant delegated permissions;
- revoke delegated permissions.

Delegated permission grant records are never authorization to link or recover an identity.

### 8.3 Proof freshness interface

B2 should define a provider-neutral interface:

```text
ProofContext:
  proof_type
  account_id or provider_identity_id
  operation
  verified_at
  expires_at
  assurance_reference (opaque)
  evidence_ref
  nonce / transaction_digest
```

Numeric freshness and provider claim semantics remain configuration/security decisions. The schema does not encode provider-specific `acr` or claim values as mandatory constants.

### 8.4 Provider claim validation interface

The provider adapter remains outside the identity store and must return verified evidence only. It must not pass raw subject claims or tokens into account resolution.

Existing OIDC verification may continue to provide:

- issuer/audience/expiry/signature validation;
- nonce validation;
- algorithm restrictions;
- subject validation;
- one-time state/PKCE context.

The implementation gap is the absence of operation-specific `auth_time`, `max_age`, `acr` and provider capability policy.

### 8.5 CSRF and transaction binding

Link, unlink and recovery operations require:

- authenticated target-account context where applicable;
- `X-CSRF-Token` or an equivalent approved session-bound mechanism;
- exact origin or a separately hardened equivalent;
- transaction nonce and confirmation digest;
- one-time server state;
- TLS enforcement.

Existing login callback state/cookie protections are not sufficient proof that a future link flow is safe.

### 8.6 Fail-closed behavior

Unknown account status, storage outage, evidence outage, stale security version or audit requirement failure denies the protected action. Generic responses must not reveal whether a provider identity is bound elsewhere.

## 9. Migration strategy

### 9.1 Existing account table

The migration may add lifecycle/version columns to the existing account table only after backup and review.

Required invariants:

- existing canonical account IDs remain unchanged;
- account status values remain valid;
- no account is automatically created for unknown bindings;
- no existing profile or workspace record is reassigned.

Pre-migration procedure:

1. stop or gate lifecycle binding writes;
2. create a consistent backup of each SQLite database, including committed WAL content (or quiesce/checkpoint under an approved procedure);
3. record database sizes, cryptographic checksums, schema versions and source counts; restore the backup to an isolated location and verify `integrity_check`, `foreign_key_check`, expected counts and readability before migration;
4. inventory accounts, bindings, sessions, approvals and evidence;
5. generate a migration manifest with source counts and destination counts;
6. validate the exact canonical `(issuer_namespace, subject_key)` identity tuple and account/provider parent keys against the selected Option B constraints;
7. quarantine duplicate issuer/subject tuples, any provider identity associated with different accounts, orphaned rows, and unverified ownership; do not select a winning owner automatically;
8. migrate only rows with approved ownership evidence, using the canonical binding table and its defined lifecycle transitions;
9. create and validate the partial unique index for `ACTIVE` and `PENDING_UNLINK`; do not create or retain `active_provider_binding`;
10. execute each bounded migration step transactionally with a stable idempotency key and migration-authority record;
11. verify source/destination counts, uniqueness, all foreign keys, binding state/version consistency and that no account/binding/security version was reassigned;
12. revalidate sessions and approvals against the new security state before reopening lifecycle writes.

**Migration state and interrupt recovery**

Migration state is owned by a durable migration transaction or manifest record in the identity/migration authority. Each migration step has a stable step ID and idempotency key.

If interrupted:

1. stop lifecycle writers;
2. read the last committed migration step;
3. restore or resume only from the manifest and backup;
4. quarantine incomplete or ambiguous identity mappings;
5. revalidate security versions, sessions and approvals;
6. prevent stale migration work from being replayed as a new ownership decision.

**Migration state ownership**

The migration state and manifest are owned by the migration identity store or a separate migration authority record. No migration process may infer ownership from profile or legacy identity attributes.

### 9.2 Existing provider bindings

Existing `(issuer, subject, account_id, created_at)` rows may be copied into lifecycle bindings in `ACTIVE` state only after:

- exact uniqueness validation;
- account foreign-key validation;
- collision reporting;
- explicit evidence that they represent approved binding state.

The migration must not infer account ownership from email, display name, legacy UUID or profile similarity.

The migration must map existing rows to one immutable account/provider pair. Multiple rows for the same canonical issuer/subject tuple and same account may be reconciled only under the approved manifest rule; any tuple with multiple accounts is quarantined. Adapter differences do not split ownership of an identical canonical issuer/subject tuple. Migration may activate a row only after evidence review and must prove the selected partial unique index can be created with no conflicting owner. Unverified or ambiguous rows remain quarantined and non-active.

### 9.3 Legacy profiles and workspaces

Legacy `owner_user_id` and profile/workspace records remain unmapped until separate owner verification. The migration must produce counts for:

- unmapped records;
- ambiguous records;
- successfully mapped synthetic/test records;
- collisions;
- orphaned records.

Rollback must restore the prior schema and leave no partial account/binding assignment.

### 9.4 OIDC state and sessions

Existing active trusted sessions should be migrated only with a reviewed security-version snapshot. Existing sessions lacking usable evidence must remain revoked or require reauthentication.

OIDC state records are ephemeral transaction records and should not be conflated with account bindings.

### 9.5 Rollback procedure

Rollback begins only if:

- backup integrity fails;
- migration manifest counts do not reconcile;
- duplicate provider identities or ambiguous ownership remain;
- foreign-key or binding invariant validation fails;
- or post-migration security/session/approval revalidation fails.

Rollback is never an automatic response to a uniqueness conflict or worker failure. Before execution, a named migration authority must have a written rollback runbook and explicit Operations and Security authorization; the accountable product/data owner must be notified and the decision recorded. Exact organizational roles and escalation timing remain pending approval. Interrupted rollback recovery resumes from the migration transaction ID and manifest state. No migration step is replayed from in-memory state.

Rollback procedure:

1. stop lifecycle writes;
2. prevent stale transactions from consuming;
3. restore the backed-up prior database state;
4. verify restored checksums, schema versions, `integrity_check`, `foreign_key_check` and manifest/source counts;
5. re-revoke or require reauthentication for sessions whose security snapshot cannot be verified;
6. deny and quarantine pending approvals whose account/security binding cannot be proven;
7. leave legacy profiles and unmapped identities untouched;
8. record rollback/audit outcome and migration residual state.

Rollback must not infer ownership or silently merge/reassign a binding.

**Post-rollback state handling**

- Increment or invalidate the account security state where rollback uncertainty could make a session or approval stale.
- Revoke sessions and evidence when their post-migration security snapshot cannot be revalidated.
- Quarantine pending approvals until account, binding and security state are proven.
- Require fresh trusted authentication before restoring protected authorization.
- Revalidate `ACTIVE` bindings, provider uniqueness and account foreign keys before reopening lifecycle writes.
- Verify the Option B partial unique index and immutable account/provider ownership for every retained binding; quarantine any row whose owner cannot be proven.
- Record rollback, identity inventory and reauthentication requirements in lifecycle audit.

**Migration state ownership and interrupted rollback**

The migration authority owns a durable migration-state record and manifest, separate from the ordinary identity lifecycle writer.

Interrupted migration or rollback work resumes only from persisted migration state and manifest evidence. It is never inferred from a partially restored database or in-memory process state.

Before reopening writes, the migration authority must prove provider uniqueness, binding/account referential consistency, security-version state and session/approval revalidation.

## 10. Operational model

### 10.1 Backups and restoration

Backups must cover:

- accounts and bindings;
- lifecycle transactions;
- security versions;
- sessions/evidence;
- pending approvals;
- audit events;
- notification outbox;
- delegated grants.

Restore exercise must prove:

- no duplicate provider identity;
- no account/binding reassignment;
- no stale approval becomes redeemable;
- no session survives a security change unless policy requires it;
- audit/notification state remains internally consistent.

### 10.2 Database corruption

Before accepting service, run schema/integrity validation and quarantine ambiguous states. Corrupt or unavailable account/status/binding resolution must fail closed.

### 10.3 Partial failure recovery

Document a job for:

- pending lifecycle transactions;
- stale security-version records;
- orphaned sessions;
- stale approvals;
- audit gap detection;
- notification retries;
- provider state cleanup.

No compensating action may silently merge or reassign ownership.

### 10.4 Retention and deletion

Retention periods remain TBD. The design separates:

- account closure;
- binding revocation;
- data deletion;
- tombstone retention;
- audit retention;
- notification retention;
- backup expiry.

No deletion guarantee may be claimed until the associated store and backup lifecycle is verified.

### 10.5 Observability

Security metrics should be privacy-conscious and include:

- conflict and replay counts;
- failed proof counts;
- unlink last-method denials;
- recovery requests/rejections;
- session and approval invalidations;
- audit write failures;
- notification backlog and delivery failures;
- migration ambiguity counts;
- cross-store partial-failure indicators.

No provider subject or secret belongs in logs or metrics.

### 10.6 Monitoring and alerts

Alerts require an accountable owner for:

- repeated ownership conflicts;
- repeated recovery or support attempts;
- audit/outbox write failures;
- stale approval/session redemption attempts;
- binding uniqueness violations;
- database integrity failure;
- backup/restore failure;
- provider outage if provider is selected.

### 10.7 Multi-host limitations

Current same-host SQLite evidence does not establish production multi-host or network-filesystem guarantees. A production topology requires independent persistence, failover and concurrency evidence.

## 10.8 Field-level sensitive-data classification

| Field or field group | Classification | Treatment | Index/logging requirements |
|---|---|---|---|
| `account_id` | Internal identifier, potentially sensitive | Plaintext canonical UUID or protected reference; never derived from provider identity | Indexable; do not expose in public URLs/log fields without a redaction policy |
| `issuer_namespace` | Identity routing data | Plaintext canonical namespace; protected if provider metadata is sensitive | Indexable as a provider key component; do not log full discovery secrets |
| `subject_key` | High sensitivity | Protected/reference-only representation; never log or expose | Hash only for opaque lookup if approved; exact uniqueness requires a protected exact-match value |
| Provider/client secret | Secret | Not stored in identity entities | Never indexed or logged; remain provider configuration secret storage |
| Raw id token/access/refresh token | Secret | Not stored in identity records | Never indexed or logged |
| `account_proof_ref` / `provider_proof_ref` | High sensitivity | Reference-only opaque IDs or protected digests | Indexed for transaction lookup only; no proof content or personal-data copy |
| `confirmation_digest` | Security-sensitive | Protected digest/hash reference | Index only in transaction key/context; never log confirmation text |
| `nonce_hash` / `csrf_binding_hash` | Security-sensitive | Protected digest | Index/transaction lookup only; never log raw nonce or cookie |
| `link_transaction_id`, `unlink_transaction_id`, `recovery_transaction_id` | Internal security identifier | Plain/opaque UUID | Indexable; minimize in application logs |
| `evidence_refs` | High sensitivity | Reference-only IDs | Index transaction relationship only; do not copy evidence content |
| `actor_id` / `grantee_principal_id` | Sensitive authorization identity | Opaque reference or protected canonical principal ID | Role/actor indexes only; no unnecessary profile attributes |
| `security_version` | Security-sensitive state | Plain integer | Indexable; never treated as secret |
| Audit `reason_code` / event type | Operational security metadata | Plain allowlisted enum | Indexable; no free-text personal data |
| Audit `event_digest` / previous digest | Integrity metadata | Protected digest | Index only as integrity/ordering data; access to audit service required |
| Notification destination reference | High sensitivity | Protected or reference-only | No raw contact details in indexes/logs |
| Notification payload | Sensitive lifecycle data | Minimize or encrypted payload only if reviewed | Log only digest/event ID/state, never destination or content |
| Delegated grant scope | Authorization data | Protected structured scope | Index account/grantee/state; restrict grant enumeration |
| Binding/lifecycle reason codes | Security metadata | Plain allowlisted enum | Indexable; no free text |

## 11. Deferred policy boundary

This design leaves the following configurable or unresolved:

- exact freshness windows;
- `auth_time`, `max_age`, `acr` provider semantics;
- adapter-configuration provenance when multiple adapters verify the same issuer/subject tuple;
- recovery evidence levels and support authority;
- managed-account/family/organization ownership;
- retention periods;
- audit implementation technology;
- notification channels and delivery guarantees;
- provider logout/back-channel behavior;
- account closure grace period;
- exact session revocation latency;
- PO-13 is resolved as **Option A**: the exact historical phrase
  “fully primium type” is withdrawn as non-operative. See the
  [Product Owner decision framework](./ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md)
  §D and [PO-13 decision brief](./ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md#po-13-decision-brief).
  This does not cancel or define PARMAR Premium and does not approve a
  subscription, billing provider, plan, entitlement or access-control change.

**Pending Security/Operations approvals**

- reconciliation retry count and deadline policy;
- stuck-reconciliation detection thresholds;
- required-audit fail-open/fail-closed policy;
- audit append-only/ordering/key implementation;
- disablement/reactivation actor authority;
- exact reactivation evidence and freshness;
- migration execution and rollback completion criteria.

None is stored as an inferred permanent default.

## 11.1 Finding-resolution matrix

| Batch 22.12.32 finding | Correction in this revision | Resolution status | Remaining approval/evidence |
|---|---|---|---|
| Cross-store atomicity | Identity lifecycle mutation and durable reconciliation intent commit together; secondary effects use stable IDs, fenced leases and fail-closed revalidation | RESOLVED as a design contract; no worker is implemented | Security/Operations approval for lifecycle success/failure, retry and reconciliation thresholds |
| Binding integrity | Replaced duplicate active-owner table with authoritative binding row, precise partial index, immutable keys, state guard and delete rejection | RESOLVED as a design contract; the separate authorized synthetic DDL prototype has executed and passed its current tests | Independent data-model/security review and application integration evidence remain before Gate 2 |
| Provider subject confidentiality | Classified provider subjects as high-sensitivity and protected/reference-only | NOT RESOLVED: disposable DDL uses ordinary TEXT for exact-tuple testing; no production protection or key design exists | Security/Privacy/Legal/data-model approval of storage, exact-match lookup, key custody, rotation and backup handling before schema acceptance |
| Recovery state machine | Preserved `REQUESTED -> UNDER_REVIEW -> VERIFIED -> CONFIRMED -> CONSUMED` and ties binding activation to verified recovery | RESOLVED for state flow; evidence and authority remain deferred | Product/Security/Privacy/Operations approval |
| Audit/notification durability | Kept Options A/B/C, clarified crash behavior, stable event IDs and authorization holds | NOT APPROVED as policy | Security/Operations approval of required-audit failure and delivery behavior |
| Disablement/reactivation | Separate authority, security-version increment, revalidation and non-operational pending behavior remain explicit | PARTIALLY RESOLVED; authority/evidence are not selected | Product/Security/Operations approval |
| Migration/rollback | Added Option B index creation/validation, conflict quarantine, verified backup/restore, stop/resume and post-rollback invalidation | PARTIALLY RESOLVED; execution authority and exact accountable roles remain pending | Operations/Security approval and named migration authority |
| Sensitive-data classification | Preserved field-level classification and minimized references/logging | RESOLVED as documentation only | Security/Privacy review of storage/key implementation |
| HIGH-1: lifecycle/active-owner trigger conflict | Removed the competing active-owner table and its synchronization/delete-trigger path; unlink is a single authoritative state transition | RESOLVED in the design and synthetic DDL tests | Independent review and eventual application-schema integration validation remain |
| HIGH-2: unauthorized/stale ownership paths | Direct insert is limited to PENDING; immutable owner keys, valid-transition/version trigger, historical-owner check and partial index protect stored invariants. Valid transitions still require an authorized lifecycle writer | RESOLVED as a documented database/application boundary; an unrestricted SQL writer is not an authorization boundary | Implement and independently test writer authorization, file access and every direct-write path |
| MEDIUM-1: binding-version rewrite | Every allowed state update requires exactly `OLD.binding_version + 1`; other updates are rejected | RESOLVED in the design and synthetic DDL tests | Application lifecycle implementation and independent review remain |
| MEDIUM-2: stale/duplicate reconciliation workers | Atomic lease claim, monotonic fencing epoch, conditional progress updates and stable per-effect idempotency keys are specified | RESOLVED as a design contract; not executable evidence | Implement worker schema/effects and test crash/takeover behavior; thresholds remain pending |
| MEDIUM-3: migration/rollback authority and compatibility | Option B index validation, named migration authority, independent Operations/Security authorization and post-rollback revalidation are required | PARTIALLY RESOLVED; organization-specific authority is not named | Name authority and approve runbook before migration |
| HIGH-3: existing protected-operation atomic-fence NO-GO | Added the repository's runtime-enforced NO-GO and the limit of B2 version checks/approval claims; B3 must preserve the gate until an authoritative execution-fencing design is independently proven | RESOLVED as a documented implementation boundary; protected operations remain blocked | Security/Operations approval and race/crash evidence before any NO-GO gate is cleared |

## 11.2 Policy traceability

The design preserves:

- Decisions 1–3: provider-neutral ownership, one external identity per account, multiple identities per account, no reassignment/merge, fresh proof and transaction-bound confirmation.
- Decisions 4–5: freshness principles and confirmation; numeric/provider thresholds remain deferred.
- Decision 6: conflict fail-closed behavior.
- Decision 7: unlink proof/confirmation and last-method protection.
- Decision 8: independent recovery evidence; detailed recovery authority remains deferred.
- Decision 9: disablement/closure/reauthorization principles.
- Decision 10: support cannot establish ownership or change bindings unilaterally.
- Decision 11: lifecycle notification principles.
- Decision 12: lifecycle audit principles.
- Decision 13: account/binding security invalidation of sessions and approvals.
- Decision 14: local logout authority; provider logout remains deferred.
- Decision 15: separate closure, binding, deletion and retention reporting.
- Decision 16: unmapped legacy/Local Demo identities until ownership verification.

Managed/family/organizational delegated authority is not converted into account ownership. It remains delegated-permissions-only with separately approved managed ownership.

## 12. Acceptance criteria assessment

| Criterion | Design result |
|---|---|
| Unknown identity cannot create account | Linking/recovery requires existing/independently verified account context; unknown callback resolver still fails closed |
| Provider identity cannot bind two accounts | `(issuer_namespace, subject_key)` is unique independent of adapter; the partial unique index over `ACTIVE`/`PENDING_UNLINK` plus activation-time historical-owner guard prevents competing owners; pending attempts do not reserve ownership |
| Provider identity input validation | Ordinary non-NUL issuer/subject values enforce existing non-empty length bounds and edge-whitespace validation without normalization; current application and SQL checks reject embedded U+0000, while final provider-facing acceptance remains deferred |
| No automatic ownership transfer | Binding owner keys are immutable; historical owner is retained after revocation; exceptional correction requires a separately approved migration |
| Linking needs account proof, provider proof, confirmation | LinkingTransaction records all three as required |
| Unlink protects last method | Commit rechecks usable methods and denies last-method removal outside approved recovery |
| Recovery not profile-based | Independent evidence references; no attribute matching |
| Disabled accounts cannot act | Account status/security version and trusted resolution checks |
| Stale sessions/approvals fail | Proposed security-version snapshots and re-resolution/re-redemption checks; design only. Existing protected operations remain runtime NO-GO until a separately reviewed atomic execution fence is implemented and verified (§2.6). |
| Delegation cannot become ownership | Separate grant entity with ownership flags prohibited for identity lifecycle |
| Audit/notification failures have handling | Proposed A/B/C audit alternatives and durable notification states; no success-shaped result on required-audit failure is the default direction, while store ordering, exception handling, retry policy and thresholds remain unapproved |
| Deferred policy remains uncommitted | No numeric/retention/provider/managed-account constants |
| OIDC limitations represented | Existing `iat`-only/disabled state and login-only callback flow identified |

## 13. Known implementation gaps

The B2 design does not exist in current source:

- no external identity lifecycle writer;
- no binding lifecycle state or binding immutability;
- no linking/unlinking/recovery transaction entities;
- no binding/account security version;
- no session snapshot of binding version;
- no approval snapshot/revalidation of binding version;
- no atomic authorization fence joining current identity/session/approval checks to protected side effects; the existing protected-operation runtime NO-GO remains in force;
- no durable lifecycle audit system;
- no lifecycle notification outbox;
- no managed/family/organization account authority;
- no legacy migration ownership procedure;
- no provider logout/revocation contract;
- no live production evidence.

## 14. Status and implementation boundary

This document is a proposed B2 architecture for review.

It does not authorize:

- SQL migration;
- schema creation;
- application code;
- route/API changes;
- application or integration tests against non-disposable data;
- provider activation;
- account binding/recovery operations;
- admin actions;
- production deployment.

A separate recorded authorization covers only execution of the disposable
synthetic SQLite DDL/test harness. That limited prototype authorization does
not approve the schema or authorize application/production DDL, migration,
provider operation, or Gate 1–7 clearance.
