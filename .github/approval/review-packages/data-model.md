# Independent Data Model Review Package

**Status:** Review-ready; no approval.

## Digest binding

The exact SHA-256 values for the Data Model scope, this package and its
invitation are recorded under `roles.Data Model` in
[`specialist-handoff-artifacts.json`](../specialist-handoff-artifacts.json).
They represent the current candidate worktree, not a commit-bound approval.
Recompute and rebind after any artifact changes.

## Exact artifacts

- `PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md`
- `PARMAR/ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md`
- `PARMAR/ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md`
- `PARMAR/identity_contracts.py`
- `PARMAR/identity_store.py`
- `PARMAR/tests/account_binding_b2_schema_validation.py`
- `PARMAR/tests/test_identity_contracts.py`
- `PARMAR/tests/test_identity_store.py`
- `PARMAR/tests/test_account_registry.py`
- `PARMAR/tests/test_account_binding_atomic_rehearsal.py`
- `PARMAR/tests/test_account_binding_migration_rehearsal.py`

Baseline commit: `cbca03c03ae5c4c541666e102b9ee4a62aa91a86`; rebind to the
eventual merge commit and exact file SHA-256 values.

## Decision register for reviewer disposition

No option below is selected by this package. Product Owner D2/PO-02 already
selects issuer+subject as the ownership tuple regardless of adapter. That
limited approval does not decide canonicalization, storage, verifier
provenance, migration or production topology.

| ID | Exact decision question | Technically viable alternatives | Consequence / risk | Responsible authority | Required evidence before disposition |
|---|---|---|---|---|---|
| DM-01 | What exact issuer representation is the ownership key? | Exact configured issuer string; standards-based URI canonicalization; provider-specific canonical form. | URI rewriting can merge distinct configurations or split an existing provider key; OIDC issuer claim matching has separate exact-validation requirements. | Identity/Data Model + Provider Compatibility + Security. | Provider discovery/issuer claims for the exact proposed configuration; current `OIDCConfiguration` and callback tests; migration collision report for any rewrite; approval of matching semantics. |
| DM-02 | Are subject values compared as exact Unicode code-point strings, NFC, NFD, or provider-specific canonical values? | Exact code points; NFC; NFD; provider-specific mapping; quarantine values that cannot be represented unambiguously. | Canonically equivalent strings can become one key under normalization; normalization may merge existing owners or change uniqueness. Exact matching may preserve visually equivalent but distinct subjects. | Identity/Data Model + Provider Compatibility; Security and Privacy/Legal review. | Synthetic NFC/NFD pair tests; provider claim evidence; source inventory collision analysis; explicit acceptance of migration/quarantine handling. |
| DM-03 | Is embedded U+0000 rejected, or must an accepted provider subject containing it be preserved? | Reject in Python and SQL; accept with explicit length/serialization rules; quarantine incompatible legacy/provider values. | SQLite `length(TEXT)` stops at NUL; accepting it requires length/compare parity and safe logging/serialization. Current application and proposed SQL both reject it; this is behavior, not policy approval. | Product Owner for policy if needed + Identity/Data Model + Provider Compatibility + Security. | Existing `ProviderIdentity`/synthetic SQL parity cases; provider subject compatibility evidence; explicit max-length and migration treatment. |
| DM-04 | How are issuer/subject values protected at rest while preserving equality and uniqueness? | Encrypted canonical value with controlled decrypt-and-compare; deterministic encryption; keyed HMAC index plus encrypted recoverable value; external tokenization; approved plaintext only if explicitly risk-accepted. | Randomized encryption cannot directly enforce equality uniqueness. Deterministic values leak equality. Keyed indexes introduce collision, rotation, backup, restore, dual-index migration and key-loss risks. Plaintext exposes provider identifiers. | Identity/Data Model + Security + Privacy/Legal + Operations/key custodian. | Data classification and threat model; exact uniqueness/lookup design; key generation/storage/rotation/recovery/backup test plan; ciphertext/index migration and collision tests; access-control evidence. |
| DM-05 | What verifier provenance is retained when multiple adapters assert the same issuer/subject tuple? | Ownership independent of adapter with a set of approved verifier/configuration references; one canonical verifier per issuer; adapter-specific evidence linked to authentication events; quarantine conflicting verifier claims. | Adapter ID must not split D2 ownership. Trusting an unapproved adapter can nevertheless authenticate a forged/less-assured claim. Provenance can itself reveal configuration and needs retention/access controls. | Provider Compatibility + Identity/Data Model + Security; Privacy/Legal for retention. | Inventory current adapters/configuration; threat analysis of issuer pinning and claim provenance; tests that same tuple cannot create two owners and unapproved verifier cannot authenticate; retention decision. |
| DM-06 | What SQLite/process/filesystem topology is supported for lifecycle writes? | Single-host single-writer service on local filesystem; supported multi-process SQLite on a specified local filesystem; transactional database service with documented isolation; no production topology until selected. | SQLite serializes writers per database but per-object locks do not coordinate stores or hosts. Network/synchronized filesystems and crash durability are unproven. | Operations + Security + Release Authority. | Exact OS/SQLite/filesystem/process profile; per-connection PRAGMA and FK checks; independent-process races/failover tests; verified backup/restore; RPO/RTO and monitoring ownership. |
| DM-07 | Who may modify schema, triggers, migration state, or database files? | Separate OS identity/container and migration role; one trusted process with audited offline migration; externally managed transactional database roles. | SQLite has no native users/GRANTs. Any principal with file-write/schema access may alter triggers and bypass database invariants. A connection inside the same process does not become a separate privilege domain merely because the application labels it a runtime writer. | Operations + Security + named Migration Authority. | Process/service identity inventory; owner/mode and access tests for the database, parent directory, journal/WAL/SHM files and backups; explicit runtime-versus-migration OS/process boundary; prove unrelated principals cannot replace the database or modify schema; all-writer quiescence and old-process exclusion; migration/rollback/restore rehearsal. If runtime and migration share file/schema privileges, record the trusted-process limitation instead of claiming role isolation. |
| DM-08 | How are account status, binding epoch, sessions, approvals and reconciliation made consistent? | One transactional authority for all authorization-relevant facts and local effects; one authority plus transactional outbox and idempotent/fenced consumers; distributed coordinator/linearizable fence supported by all participants; retain separate stores and keep protected operations disabled. | Separate SQLite transactions plus revalidation have check-to-effect races. Outbox gives durable intent and generally at-least-once delivery, not atomic external effects. Version fencing works only where the effect executor checks it atomically or downstream enforces it. | Security + Operations + Identity/Data Model + Product Owner; Release Authority for activation. | Review the disposable reference test `python -m pytest -q PARMAR/tests/test_account_binding_atomic_rehearsal.py`; prove topology, all-writer adoption, revocation/effect orderings, stale-worker rejection, idempotency, external acknowledgement behavior, crash recovery and failure policy. This test is not production evidence. |
| DM-09 | What migration and rollback disposition is permitted for duplicate, conflicting, orphaned or ambiguous historical bindings? | Quarantine all duplicates; preserve verified unique owner rows for explicit review; approved conflict-resolution process with per-record evidence; no migration until source inventory and authority exist. | Selecting a winner can silently transfer ownership. Restoring an old snapshot can resurrect sessions/approvals or stale identity state. | Product Owner within D1/D2/D6 scopes + Identity/Data Model + Security + Operations + Privacy/Legal + named Migration Authority. | Source/destination synthetic rehearsal, exact key-set/count manifest, idempotent restart, interruption, backup/restore/rollback and post-rollback session/approval checks; explicit quarantine and authority rules. |

## Reproducible evidence

Current code and synthetic evidence can be checked with:

```sh
python -m pytest -q PARMAR/tests/test_identity_contracts.py PARMAR/tests/test_identity_store.py PARMAR/tests/test_account_registry.py
python -m pytest -q PARMAR/tests/account_binding_b2_schema_validation.py
python -m pytest -q PARMAR/tests/test_account_binding_atomic_rehearsal.py PARMAR/tests/test_account_binding_migration_rehearsal.py
```

These are local synthetic/application regression checks. They do not prove
provider compatibility, protected subject storage, independent specialists,
multi-host behavior, power-loss durability, a real migration, or operational
backup/restore. Provider-specific questions require an authorized isolated
provider and exact configuration; do not replace them with mocked claims.

## Acceptance criteria

Disposition each item by a named authorized reviewer, with option, rationale,
scope, limitations, timestamp and artifact hashes. Gate 2 remains blocked until
DM-01–DM-09 are resolved or explicitly deferred with accepted fail-closed
behavior, migration/rollback authority and evidence. Approval requires an
exact-commit review and attributable formal approval record; a test result,
review package or Agent assessment is not approval.
