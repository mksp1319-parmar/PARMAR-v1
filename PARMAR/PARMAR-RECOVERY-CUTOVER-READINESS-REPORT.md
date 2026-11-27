# PARMAR Recovery and Cutover Readiness Report

**Original scope:** Static inspection of the design, prior evidence/review documents, current runtime gates, per-store schema initialization, backup tooling, tests, and AETHER boundary docs. At that review, no database or process was touched and no tests or migrations were run.

## Executive finding

**Recovery/cutover readiness: NOT PROVEN.** Most controls are specified only in design proposals. There is no shared migration implementation, global writer quiescence mechanism, authority identifier/manifest startup gate, old-binary exclusion, approved/implemented/exercised SQLite backup/restore procedure, or `RECOVERY_REQUIRED` approval state.

## Revalidation — 2026-11-25

The current [B2 design](./ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md) §§9–10 and
[shared-authority migration design](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md)
§§5–8 specify proposed backup, restore, rollback, recovery, and monitoring
controls. This corrects any reading of the original finding as claiming no
design proposal exists; these proposals are not approved operational
procedures, implemented controls, or exercised evidence, so the NOT PROVEN
status is unchanged.

The later PARMAR offline regression run passed 954 tests. The manual live
Keycloak module reported 2 passed and 8 skipped with live mode disabled. No
B2 prototype, DDL, migration, restore rehearsal, or live provider operation
was run; the original audit's test statement remains an accurate historical
scope description.

## Revalidation — 2026-11-26

- The latest full offline Python suite passed **1071 tests**, with **12
  live-Keycloak-only skips** and **5 passing subtests**. Its first run exposed
  a stale review-artifact digest for the changed Data Model package; the
  manifest was refreshed and the full suite rerun passed. The account-binding
  synthetic DDL harness passed **58 tests**. The new synthetic atomic/fencing
  rehearsal passed **13 tests** and the migration/recovery rehearsal passed
  **4 tests**.
- These newer prototype results supersede the earlier statement that no B2
  prototype had run. They do **not** implement or rehearse a source/destination
  data migration, an operational backup/restore, or a rollback.
- The GitHub read-only integration found no open pull requests, confirmed the
  Keycloak workflow is active, and reported no runs for that workflow. Direct
  unauthenticated REST checks were rate-limited; live ruleset and Environment
  configuration could not be reverified in this continuation. The local
  approval records and reviewer identity register remain empty.
- No migration, restore-write operation, live provider request, or production
  activation was executed. Recovery/cutover readiness remains **NOT PROVEN**.

## Control-by-control evidence

| Requirement | Implemented evidence | Assessment |
|---|---|---|
| Quiesce application and workers | [interface/futuristic_app.py](./interface/futuristic_app.py) runs a guarded local server; [README.md](./README.md) says supported entry points use the guarded factory and custom embedding is unsupported. Repository objects use local locks and per-call SQLite connections. No maintenance/drain mode or coordinator was found to stop every app instance, worker, or writer and prevent new opens. | **NOT PROVEN.** Operator shutdown could be attempted, but the repository cannot establish exclusive quiescence or prove no process retains an open writer. |
| Revoke old database write access | Repositories request mode 0600 on database files and mode 0700 on parent directories. The same service identity can reopen these files; no service-account privilege revocation or archival read-only cutover tool exists. | **NOT PROVEN.** File modes are not an old-process/version fence. |
| Prevent stale binaries or mixed paths | Each store independently accepts `PARMAR_*_DB_PATH`; per-object `(device, inode)` checks detect replacement of that store’s file after initialization. Each store checks its own `PRAGMA user_version`. There is no shared authority ID, expected path-set check, or old-binary startup rejection. | **NOT PROVEN.** Independent valid database paths can still form a mixed authority set. |
| Reject incomplete migration manifests | `migration_manifest` is specified in [PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md) §3. No runtime table, writer, or startup check implements it. Search of source found no authority ID or manifest verification. | **NOT PROVEN.** |
| Backup and restore source/destination SQLite | [scripts/parmar_backup.py](../scripts/parmar_backup.py) excludes SQLite/database suffixes. [docs/backup-recovery.md](../docs/backup-recovery.md) describes a Linux worktree archive, verification, and a dry-run restore plan; it explicitly offers no restore-write command. B2 and the shared-authority migration design specify proposed SQLite backup/restore steps, but no approved operational procedure or implemented path exists. | **NOT PROVEN.** Database snapshot consistency, restoration, and RPO/RTO are untested. |
| Represent ambiguous in-flight approval | [interface/approvals.py](./interface/approvals.py), `ApprovalState`, `_APPROVAL_TRANSITIONS`, and `pending_approvals` state constraint include `EXECUTING` but not `RECOVERY_REQUIRED`. Current `EXECUTING` transitions include `CONSUMED`, `CANCELLED`, and `EXPIRED`; cancellation audit is included in the current HMAC-protected payload. The execution claim is stored separately from any provider/effect. | **NOT PROVEN.** Current state cannot represent a terminal indeterminate outcome in the proposed migration semantics. |
| Make `RECOVERY_REQUIRED` terminal and non-executable | Design §§4 and 7 specify a future state and behavior. No implementation or test path for the state was found. | **NOT PROVEN.** It cannot currently be stored or verified as terminal. |
| Safely limit rollback | Design §6 permits source restore only before the new authority accepts an operation and requires forward recovery afterwards. No cutover/rollback code, authority-write sentinel, migration controller, or tested rollback exists. | **NOT PROVEN.** This is a rule in a proposal, not an enforceable runtime boundary. |
| Forward recovery and interruption handling | Design §§5–8 prescribe frozen backups, destination reconciliation, crash tests, and forward recovery. Existing store migrations are independent startup upgrades; tests cover some per-store rollback/reopen behavior but not shared migration interruption or commit-boundary crashes. | **NOT PROVEN.** |

## In-flight approval integrity and recovery semantics

The current approval schema HMAC covers the token hash, current state, expiry, and current payload. Cancellation evidence is nested in that payload and is re-signed when the state changes. It is not an append-only lifecycle log. The current `EXECUTING` claim may outlive the external call/effect and does not establish whether an effect or response occurred. The existing cancellation method can transition an `EXECUTING` row to `CANCELLED`; that behavior is not a substitute for an indeterminate recovery disposition.

The design’s rule to migrate `EXECUTING` approvals to terminal `RECOVERY_REQUIRED`, deny every authorization/claim/consume path, and expose only a redacted audit status is appropriate as a requirement, but it is not implemented. No approval may be treated as safely recoverable or retryable based on the design text alone.

## Phase 3G.1 and cross-phase boundaries

- [safety/runtime_no_go.py](./safety/runtime_no_go.py), `require_atomic_authorization_fence`, always raises for known unfenced operations. Current call sites in [chat/service.py](./chat/service.py) and [interface/futuristic_app.py](./interface/futuristic_app.py) cover authenticated/approved chat, protected memory mutations, profile/workspace writes, and session-profile selection; HTTP handling sends 503. Related source tests assert no-go behavior. These tests were not run in this audit.
- [interface/futuristic_app.py](./interface/futuristic_app.py) disables production startup because production authentication/trusted account resolution are not implemented. [README.md](./README.md) documents only local development authentication, explicitly unverified. No production identity-provider path was found configured.
- The memory, identity, approval, and session repositories retain direct write methods and separate files. The routes/services presently checked are NO-GO, but repository methods are not themselves a shared transaction fence. The design correctly requires eliminating or disabling direct legacy effect paths before any future protected operation is enabled.
- The proposed schema places account/binding, session/evidence, approval/generation, selected consent/effect, and outbox facts in one database. It is only a design. The API/caller inventory and proof that every mutable authorization predicate is included are still required.
- AETHER source and docs remain separate and unchanged in the initial worktree status. [AETHER-SECURITY-GATES.md](./AETHER-SECURITY-GATES.md) keeps remote browsing NO-GO; desktop `REMOTE_BROWSING_ENABLED` remains false. [android/app/src/main/AndroidManifest.xml](./android/app/src/main/AndroidManifest.xml) has no Internet permission, and [android/PERSISTENCE-ARCHITECTURE.md](./android/PERSISTENCE-ARCHITECTURE.md) describes inert local URL metadata and an offline store. No AETHER browsing or network boundary was changed by this audit.

## Required readiness gates

Before any prototype that reads or writes real source data, connects to current
stores or production runtime, or before cutover: establish verified per-record
key and owner mappings from controlled source backups; approve and test an
explicit `RECOVERY_REQUIRED` schema/transition invariant; implement an offline
migration manifest and exact key-set/relationship reconciliation; add
fail-closed authority-ID/path/schema startup checks; implement all-writer
quiescence and old-writer exclusion; test SQLite backups and restores; and run
concurrency, interruption, storage-fault, and recovery tests on the declared
deployment profile.

A separate synthetic-only offline experiment is not a migration or production
prototype. It may be considered only under the isolation and explicit human
authorization requirements in
[PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md](./PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md),
which are requirements and are not currently implemented or verified. Keep
Phase 3G.1 NO-GO unconditional in either case.

**Conclusion:** Required migration, recovery, and cutover behaviors are **NOT PROVEN**. Documentation is not an operational control, and no rollback, restore, or in-flight approval recovery guarantee should be claimed.
