# Independent Operations Review Package

**Status:** Review-ready; no approval.

## Digest binding

The exact SHA-256 values for the Operations scope, this package and its
invitation are recorded under `roles.Operations` in
[`specialist-handoff-artifacts.json`](../specialist-handoff-artifacts.json).
They represent the current candidate worktree, not a commit-bound approval.
Recompute and rebind after any artifact changes.

## Exact artifacts

- `.github/workflows/parmar-keycloak-oidc-e2e.yml`
- `.github/scripts/parmar-keycloak-oidc-e2e-infra.sh`
- `.github/parmar-keycloak-e2e-environment.json`
- `.github/workflows/parmar-specialist-approvals.yml`
- `PARMAR/PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md`
- `PARMAR/PARMAR-SHARED-AUTHORITY-MIGRATION-DESIGN.md`
- `PARMAR/ACCOUNT-BINDING-MIGRATION-RECOVERY-RUNBOOK.md`
- `PARMAR/PARMAR-SQLITE-DURABILITY-EVIDENCE-REPORT.md`
- `PARMAR/identity_store.py`
- `PARMAR/tests/test_account_binding_atomic_rehearsal.py`
- `PARMAR/tests/test_account_binding_migration_rehearsal.py`
- `PARMAR/tests/test_keycloak_oidc_live_e2e.py`
- `docs/backup-recovery.md`
- `PARMAR/ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md`
- `PARMAR/ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md`
- `PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md`

Baseline commit: `cbca03c03ae5c4c541666e102b9ee4a62aa91a86`; rebind to the
eventual merge commit and exact file SHA-256 values.

## Questions

1. Approve only one supported SQLite process/topology or document why none is.
2. Verify backup, restore, migration, rollback and forward-recovery evidence.
3. Verify reconciliation leases, idempotency and stale-worker fencing.
4. Verify Environment isolation, runner cleanup and secret/network controls.
5. Verify monitoring, incident response and emergency pause ownership.

## SQLite privilege-boundary evidence

SQLite does not enforce database users or `GRANT` roles. Approval must identify
the OS/service identity that owns each database and demonstrate, on the
declared supported filesystem and process topology, access controls for the
database, parent directory, rollback journal or WAL/SHM sidecars, and backups.
It must distinguish the runtime writer from the migration/schema-changing
authority and document whether those are actually separate processes and OS
identities. If they share a principal or writable file, schema-trigger
invariants are protected only by the trusted-process boundary; do not describe
them as database-enforced privilege separation.

Evidence must include database replacement/symlink and unauthorized
schema-write attempts, file/directory permissions before and after restart,
all-writer quiescence and old-process exclusion, and backup/restore behavior
for the selected journal profile. A worktree archive or a temporary SQLite
fixture is not production-topology evidence.

## Acceptance criteria

APPROVED requires a supported topology, isolated restore evidence and
measurable RPO/RTO/latency commitments. No migration or live E2E is authorized
by this package alone.
