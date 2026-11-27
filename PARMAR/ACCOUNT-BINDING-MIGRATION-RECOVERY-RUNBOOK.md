# PARMAR Account-Binding Migration and Recovery Runbook

**Status: REVIEW-READY, STOP-GATED, NOT AUTHORIZED FOR EXECUTION.**

This document records the minimum safe operator sequence for a future,
separately approved migration. It is not a migration program, a restore
command, approval to access a configured database, or evidence of operational
readiness. No B2 lifecycle schema migration or restore-write implementation
currently exists. Do not execute against production, real-user data, or any
configured application database.

The [worktree backup runbook](../docs/backup-recovery.md) excludes SQLite
databases and must not be used as their backup or restore procedure. Existing
synthetic B2 DDL and backup/restore tests are prototype evidence only.

## Required authority and change record

Before any real migration or restore, create an attributable change record
containing all of the following:

- named Product Owner decision(s) within the existing D1–D16 scope;
- accepted B2 data-model and threat-model reviews;
- named Identity/Data Model owner and independent Security reviewer;
- named Operations/data custodian and migration operator;
- explicit migration or restore authorization, environment, database
  identities, time window, allowed operations, stop conditions and expiry;
- approved provider/subject representation, key custody/rotation and
  normalization policy;
- approved source/destination SQLite version, filesystem and process
  topology;
- verified rollback authority, recovery owner, RPO/RTO and incident escalation;
- separate Privacy/Legal disposition for data classes, manifests, retention,
  backup expiry and cleanup;
- Release Authority approval before any production change.

If any prerequisite is missing, stop. A test passing or a package being
review-ready does not satisfy this authorization.

## 1. Pre-migration checks and source inventory

1. Confirm the change record and exact source/destination identifiers. Record
   the source database schema version, SQLite library version, file/device
   identity, journal mode, synchronous setting, foreign-key state, storage
   location and owning service identity. Do not infer these from defaults.
2. Obtain an all-writer maintenance window. Stop or drain every application,
   worker, administrative client and scheduled task that can write the source.
   The current repository does not implement a global quiescence control; a
   deployment-specific operator must prove it, including absence of stale
   processes and old binaries. If this cannot be proven, stop.
3. Inventory accounts, legacy bindings, sessions, identity evidence, pending
   approvals, lifecycle history and relevant audit/outbox state. Keep raw
   issuer/subject values and account mappings in an access-controlled,
   encrypted evidence location; reports should contain counts and keyed
   references, not raw subjects or tokens.
4. Compute source counts, primary-key sets, foreign-key checks, exact
   `(issuer, subject)` duplicate groups, owner conflicts, missing parents,
   invalid values, unknown statuses and active sessions/approvals. Record
   canonicalization and type-validation versions. Never normalize or infer
   owners during inventory.
5. Produce a source manifest with migration ID, source identity/schema,
   sorted record-key digests, counts by classification, query/tool versions,
   timestamps, operator identity and manifest digest. Protect the manifest
   under the same data classification as its contents.

## 2. Duplicate and ambiguous ownership disposition

Classify every source binding before destination writes:

- **Unique, well-formed tuple and existing account:** `REVIEW_REQUIRED`;
  requires record-specific approved ownership evidence before activation.
- **Repeated exact tuple, same account:** quarantine all duplicates unless an
  approved migration rule explicitly establishes how to reconcile them.
- **Repeated tuple with multiple accounts:** quarantine every row; never pick
  a winner or automatically merge/reassign.
- **Missing account, orphan or malformed identity:** quarantine; do not infer
  identity from email, name, profile, legacy UUID or provider display value.
- **Unicode-normalization collision:** quarantine the complete collision set
  until the authorized canonicalization decision and per-record ownership
  review exist.
- **Value containing U+0000 or otherwise outside current validation:** record
  as policy-review quarantine; current rejection behavior is not itself
  provider-policy approval.

Quarantine is non-operational: it cannot authenticate, own a provider key, or
be resolved by ordinary retry. A separate attributed decision is required to
change its disposition.

## 3. SQLite backup and restore verification

1. Use a separately reviewed SQLite backup implementation that uses SQLite's
   online backup API or an explicitly approved quiesce/checkpoint procedure.
   A raw copy of only the main file is not accepted while WAL/journal state may
   contain committed data.
2. Write the backup to approved storage outside the source failure domain.
   Record source and backup database identities, byte sizes, file hashes,
   SQLite/schema versions, journal state, backup tool/version, integrity
   results, and operator/time. A checksum proves integrity against the
   recorded digest, not author identity.
3. Restore the backup to a new, empty, isolated destination. Do not overwrite
   the source or the only backup. Run and record `PRAGMA integrity_check`,
   `PRAGMA foreign_key_check`, expected `user_version`, required schema/index/
   trigger inventory, row counts, source-manifest key-set reconciliation, and
   application read-only smoke tests.
4. Verify session and approval records in the restored copy are either
   revalidatable against the same authoritative account/security state or
   fail closed. An old backup must not silently restore usable stale sessions
   or approvals.
5. Obtain custodian and Operations sign-off on restore evidence before
   migration authorization. The current B2 `Connection.backup()` prototype
   tests do not replace this exercise.

## 4. Migration execution and idempotent restart

No production migration command is currently available. A future tool must
be reviewed and tested before any operator runs it. It must:

1. accept explicit allowlisted source/destination identities and a stable
   migration ID; reject unexpected paths, schema versions and modified source
   digests;
2. run a dry-run first and emit only protected manifests plus redacted
   summaries; refuse conflicts unless they are quarantined;
3. persist migration state, source digest, step IDs and row dispositions in
   durable migration state; never use process memory as recovery authority;
4. create destination state transactionally and ensure an interrupted step
   either rolls back fully or can resume exactly once from its durable step
   record;
5. never activate an identity without approved per-record ownership evidence;
   never add a dual-writer or dual-resolver period;
6. commit lifecycle/security version changes and durable reconciliation
   intents together in the selected authoritative transaction;
7. fail closed on FK violations, duplicate active ownership, invalid type or
   normalization, unexpected row counts, schema drift, integrity failures,
   failed audit requirements or incomplete manifests.

On interruption, block all writers, preserve source and destination for
forensics, inspect the committed migration ID/step manifest, and either resume
with the exact same source digest or obtain explicit stop/rollback/forward
recovery authorization. Never rerun with a new ID to bypass a partial
migration.

The disposable
`python -m pytest -q PARMAR/tests/test_account_binding_migration_rehearsal.py`
test classifies synthetic rows, tests atomic rollback/restart and prevents
migration-ID reuse with changed source evidence. It intentionally stages
`REVIEW_REQUIRED`/quarantine classifications only; it is not the B2 schema
migration or a production migration rehearsal.

## 5. Cutover verification

Before reopening any writer, reconcile:

- source and destination counts and exact key sets, including all quarantine
  classes;
- account/provider references, exact tuple uniqueness and binding ownership
  history;
- schema version, indexes, triggers, constraints and FK enforcement on every
  application connection;
- migration run/step IDs, source and destination digests, audit continuity,
  durable outbox IDs and worker fencing state;
- session/evidence status and account security-version snapshots;
- approval state, ownership, expiry, action binding and stale/indeterminate
  execution handling;
- application and worker versions, paths and startup rejection of stale or
  mixed authority configuration.

Each measure needs a machine-readable result plus responsible reviewer.
Reopening writes requires named Operations and Security authorization and the
other approvals required by the accepted change scope.

## 6. Rollback and post-rollback consistency

Rollback is never automatic on uniqueness conflict, worker error, provider
outage or missing evidence.

1. Stop all writers and preserve current source, destination, logs and
   manifests.
2. Obtain explicit Operations and Security rollback authorization from the
   named migration authority. Record whether the destination has accepted any
   authentication, ownership, approval or external side effect.
3. If no authoritative write/effect occurred on the destination and the
   approved plan permits it, restore the verified pre-migration backup into a
   new isolated source copy. Do not overwrite the only original.
4. If any destination authorization or external effect may have occurred,
   do not roll back to stale state; invoke the approved forward-recovery and
   reconciliation procedure.
5. Verify the restored schema, integrity, FK state, counts and key sets.
   Preserve every ambiguous mapping in quarantine. No owner may be inferred or
   reassigned.
6. Revoke sessions and evidence whose account/security state cannot be
   re-proven. Deny or quarantine pending approvals whose owner, session,
   security version or execution outcome is uncertain. Require fresh
   authentication before restoring authorization.
7. Reconcile audit/outbox events and external acknowledgements. An ambiguous
   external acknowledgement is terminally indeterminate until an authorized
   operator resolves it; do not blind-retry.
8. Reopen only after independent verification and recorded authorization.

## 7. Evidence package and sign-off

Retain an access-controlled evidence bundle containing:

- authorization/change record and named accountable roles;
- source/destination identities, topology, binaries and schema versions;
- backup/restore hashes and integrity/FK/schema/count results;
- source inventory and migration manifest digests;
- duplicate/conflict/orphan/invalid/quarantine disposition totals;
- dry-run, migration step, interruption/restart and verification outputs;
- session/evidence/approval invalidation and audit/outbox reconciliation;
- rollback or forward-recovery record, including why the chosen path was safe;
- incident/alert outcomes, cleanup and data-retention disposition;
- independent reviewer decisions bound to exact commit and artifact digests.

Never include credentials, tokens, raw provider subjects or unnecessary
personal data in ordinary logs or the release report. Formal specialist
approval and operational acceptance must be attributable and recorded by the
established governance process.

## Current execution status

- Production migration and restore-write: **not implemented and not
  authorized**.
- Synthetic B2 DDL test: 58 passing cases; prototype-only.
- Synthetic atomic/fencing rehearsal: 13 passing cases; single-database
  reference model only.
- Synthetic migration classification/restart/backup snapshot rehearsal: 4
  passing cases; no binding activation and no real source data.
- Operational backup/restore rehearsal, supported production topology,
  cross-host fencing, and power-loss guarantee: **not established**.
- Production OIDC and protected-operation atomic fence remain **NO-GO**.
