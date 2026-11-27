# PARMAR SQLite Runtime and Durability Evidence Report

**Original scope:** Static inspection only. At the time of the original audit, no SQLite database, runtime process, environment override, filesystem mount, or device was queried and no tests were run. This report separates repository behavior from environment/runtime behavior.

## Executive finding

**SQLite durability: PARTIALLY PROVEN at source-configuration level; effective durability and supported process/filesystem profile are NOT PROVEN.** The inspected Python repositories enable and verify foreign-key enforcement on each connection. They do not set or verify journal mode or synchronous level. Tests cover selected migration, restart, corruption, and same-process concurrency behavior, not power-loss or supported-topology durability.

## Repository configuration and connection ownership

| Repository / schema | Connection and transaction source evidence | PRAGMAs / constraints |
|---|---|---|
| `SQLiteSessionRepository`, v4 — [sessions.py](./sessions.py) | `PARMAR_SESSION_DB_PATH` or `~/.local/share/parmar/sessions.sqlite3`; `_connection` opens a connection per operation with `timeout=5`, `isolation_level=None`, and closes it. Each repository object has a `threading.RLock`; write calls use `BEGIN IMMEDIATE`. | Enables and reads back `foreign_keys=ON`; no explicit `journal_mode` or `synchronous`; sessions/evidence lack SQL FKs between session/evidence/account. |
| `SQLiteIdentityRepository`, v3 — [identity_store.py](./identity_store.py) | `PARMAR_IDENTITY_DB_PATH` or `~/.local/share/parmar/identity.sqlite3`; connection uses `timeout=5`, `isolation_level=None`. Multi-statement account/workspace/share operations use `BEGIN IMMEDIATE`; `create_profile` is a single autocommit insert. Per-object `RLock`. | Enables and reads back `foreign_keys=ON`; explicitly sets `busy_timeout=5000`. |
| `SQLitePendingApprovalStore`, v3 — [interface/approvals.py](./interface/approvals.py) | `PARMAR_APPROVAL_DB_PATH` or `~/.local/share/parmar/approvals.sqlite3`; per-operation connection, `timeout=5`, `isolation_level=None`; write paths use `BEGIN IMMEDIATE`; per-object `RLock`. | Enables and reads back `foreign_keys=ON`; no explicit `journal_mode` or `synchronous`; approval table has no FK to session/account. |
| `SQLiteConversationRepository`, v3 — [conversations.py](./conversations.py) | `PARMAR_CONVERSATION_DB_PATH` or `~/.local/share/parmar/conversations.sqlite3`; per-operation connection, `timeout=5`, `isolation_level=None`; write paths use `BEGIN IMMEDIATE`; per-object `RLock`. | Enables and reads back `foreign_keys=ON`; validates schema and existing FK integrity. No explicit journal/synchronous settings. |
| `SQLiteMemoryRepository`, v1 — [memories.py](./memories.py) | `PARMAR_MEMORY_DB_PATH` or `~/.local/share/parmar/memories.sqlite3`; per-operation connection, `timeout=5`, `isolation_level=None`; starts `BEGIN IMMEDIATE` for writes and `BEGIN` for reads; per-object `RLock`. | Enables and reads back `foreign_keys=ON`; memory/consent tables have no FK between them or to accounts; no explicit `journal_mode` or `synchronous`. |

All five code paths create parent directories with requested mode 0700, reject a database symlink, chmod the database file to 0600, and retain a `(device, inode)` identity per repository object to detect replacement after initialization. This does not identify the filesystem type, prove access-control semantics across platforms, prevent other processes running as the same user, or bind multiple database paths into one authority set. Environment overrides can select paths outside the documented local defaults.

## Revalidation — 2026-11-26

- Current source inspection confirms that identity, session, approval, conversation and memory repository connections all enable and verify `PRAGMA foreign_keys=ON`. OIDC state connections do likewise. This does not add cross-store foreign keys or make independent databases atomic.
- The latest full offline Python suite passed **1071 tests**, with **12
  live-Keycloak-only skips** and **5 passing subtests**. The first run exposed
  a stale review-artifact digest; after refreshing the manifest, the full
  suite rerun passed. The B2 synthetic DDL harness passed **58 tests**. The
  new same-database atomic/fencing and migration/recovery rehearsals passed
  **13** and **4 tests**, respectively. These results validate tested
  behavior only.
- A local SQLite 3.45.1 probe observed fresh in-memory connection values `foreign_keys=0`, `journal_mode=memory`, and `synchronous=2`; partial-index support was available. These are local runtime observations, not a deployment profile or durability guarantee.
- The tests include synthetic backup/restore primitives and child-process exit before commit; they do not establish power-loss durability, supported filesystem behavior, independent-host contention, or operational restore readiness.
- The report's original static-inspection statements remain historical. Current deployment topology, effective file-backed PRAGMAs, filesystem support and recovery guarantees remain unverified.

## SQLite version, runtime, and storage environment

- The repositories use Python’s standard-library `sqlite3`; the project [requirements.txt](./requirements.txt) lists pytest only. No application requirement, startup check, or test establishes a supported SQLite version range or captures `sqlite3.sqlite_version`/compile options.
- [README.md](./README.md) describes Ubuntu 24.04 as a candidate desktop target and states packaging/runtime behavior has not been verified across supported OSes. It documents local database paths and a guarded loopback Python server; it does not define a SQLite version, durable storage class, mount, journal profile, or multi-process production deployment.
- The SQLite repositories do not set or verify `PRAGMA journal_mode` or `PRAGMA synchronous`. Effective values and SQLite defaults are environment/build-dependent and were not read. Do not infer a WAL profile, power-loss guarantee, or durability level.
- Connection `timeout=5` configures lock-wait behavior for these connections; identity additionally sets `busy_timeout=5000`. SQLite serializes writers to one database, but the per-instance Python `RLock` only coordinates calls using that repository object. It is not a cross-process/shared-authority coordinator.
- No source validates local/network/synchronized filesystem type or storage hardware. `os.chmod`, symlink checks, and private path defaults are safeguards, not proof of persistence or power-failure behavior.
- The separate Android `SQLiteOpenHelper` database is an AETHER app-local schema, not a shared-authority database; [android/PERSISTENCE-ARCHITECTURE.md](./android/PERSISTENCE-ARCHITECTURE.md) states device/runtime verification remains outstanding. The Android instrumentation workflow is not evidence for Python database settings or the proposed shared authority.

## Backup, restore, and failure evidence

- [scripts/parmar_backup.py](../scripts/parmar_backup.py) creates a worktree archive and explicitly excludes `.db`, `.sqlite`, and `.sqlite3`. [docs/backup-recovery.md](../docs/backup-recovery.md) documents verification and a read-only restore plan; it states no restore-write command exists. It does not use SQLite’s online backup API or capture a consistent SQLite/WAL snapshot.
- Existing Python tests (names inspected, not run) cover repository reopen/restart, schema migration/rollback, corrupted/incompatible/missing storage, and some lock/concurrency cases: e.g. `test_sqlite_cancel_and_consume_are_serialized`, `test_sqlite_approval_execution_claim_is_exclusive_and_cancellation_fences_retries`, `test_concurrent_evidence_revocation_and_rotation_leave_no_active_session`, `test_v2_migration_failure_is_atomic_and_reopen_completes_migration`, and conversation migration rollback tests.
- The examples above describe test coverage, not guarantees. Current relevant suites have been run as recorded in the dated revalidation below. They do not establish independently launched process behavior beyond the specific synthetic process-exit case, termination at commit boundaries, OS/power-loss durability, filesystem behavior, disk-full handling, read-only filesystem/database behavior, WAL recovery, or operational backup/restore correctness for SQLite files.
- SQLite in-process schema migrations are per-repository and may run on initialization; they are not an offline coordinated authority migration.

## Required tests and configuration before reliance

1. Define and enforce exact SQLite and Python versions; record and validate effective journal mode, synchronous level, foreign-key state, and busy timeout on every relevant connection.
2. Declare the supported filesystem, storage, OS, and process model. Test the actual supported filesystems rather than extrapolating from a worktree archive workflow.
3. Add a consistent database backup/restore procedure using a reviewed SQLite backup method and verify snapshots including journal/WAL state.
4. Test independent processes and repository instances under reader/writer contention, and inject process termination before/during/after commit. Verify disk-full, read-only, corrupt-page, unavailable-path, and restore outcomes.
5. Validate complete recovery from frozen source backups and a destination authority copy. Keep the existing runtime NO-GO gate enforced throughout.

**Conclusion:** Source-level connection/transaction behavior is **PARTIALLY PROVEN**. Effective SQLite configuration, supported durability profile, multi-process model, and power-loss guarantees are **NOT PROVEN**. No production or cross-process durability claim is supported.
