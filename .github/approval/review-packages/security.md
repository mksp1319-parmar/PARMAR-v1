# Independent Security Review Package

**Status:** Review-ready; no approval.

## Digest binding

The exact SHA-256 values for the Security scope, this package and its invitation
are recorded under `roles.Security` in
[`specialist-handoff-artifacts.json`](../specialist-handoff-artifacts.json).
They represent the current candidate worktree, not a commit-bound approval.
Recompute and rebind after any artifact changes.

## Exact artifact baseline

- Repository: `mksp1319-parmar/PARMAR-v1`
- Baseline commit: `cbca03c03ae5c4c541666e102b9ee4a62aa91a86`
- Working-tree governance/implementation changes require review after the
  exact merge commit is created.

## Required artifacts

- `.github/approval/approval-record.schema.json`
- `.github/approval/records.json`
- `.github/approval/reviewer-identity-register.json`
- `.github/approval/reviewer-identity-register.schema.json`
- `.github/approval/specialist-roles.json`
- `.github/approval/GITHUB-GOVERNANCE-ACTIVATION-PACKAGE.md`
- `.github/approval/SPECIALIST-ONBOARDING.md`
- `.github/approval/ACTION-REGISTER.md`
- `.github/CODEOWNERS`
- `.github/governance-ruleset.json`
- `.github/parmar-keycloak-e2e-environment.json`
- `.github/scripts/validate-specialist-approvals.py`
- `.github/scripts/verify-review-artifact-manifest.py`
- `PARMAR/tests/test_specialist_approval_validator.py`
- `.github/workflows/parmar-keycloak-oidc-e2e.yml`
- `.github/workflows/parmar-javascript-tests.yml`
- `.github/workflows/parmar-visual-acceptance.yml`
- `.github/workflows/parmar-specialist-approvals.yml`
- `PARMAR/ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md`
- `PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md`
- `PARMAR/ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md`
- `PARMAR/ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md`
- `PARMAR/PARMAR-RUNTIME-NO-GO-INDEPENDENT-AUDIT.md`
- `PARMAR/SECURITY-TRUST-BOUNDARY.md`

## Questions

1. Does the approval record require and verify genuine reviewer authority?
2. Is the reviewer identity register protected by independently verified
   authorities rather than treated as self-authenticating?
3. Are all protected stages fail closed for missing, stale or changed evidence?
4. Are workflow dispatch, pull-request and environment bypass routes blocked?
5. Does the GitHub review binding resist forged JSON, wrong repository, author,
   commit and review ID?
6. Is cross-store and protected-operation fencing unambiguously NO-GO?
7. Are audit, replay, session revocation and recovery threats mitigated?

## Atomic-fence evidence required before any NO-GO change

The current separate identity, session, approval and effect stores do not
provide an atomic authorization fence. Security approval must not treat a
version recheck, approval claim, lease, or outbox intent as sufficient by
itself. Before any protected-operation gate is reconsidered, the exact
supported topology must demonstrate:

- one authoritative transaction covering authorization state, security
  version, approval consumption, and every local protected effect;
- serialized effect-first and revocation-first outcomes under independent
  concurrent writers, including disable/reactivation races;
- a monotonic fencing value enforced at the actual effect executor, not only
  by the caller or work-queue worker;
- duplicate request/delivery idempotency, stale-worker rejection, and crash
  recovery before and after each commit/effect boundary;
- explicit handling for an ambiguous external acknowledgement, without
  claiming exactly-once behavior unless the receiver enforces the idempotency
  or fence; and
- retained runtime NO-GO controls whenever any participant cannot enforce the
  accepted transaction/fence.

The synthetic single-SQLite rehearsal is a reference test only; it is not
evidence that the PARMAR runtime or an external effect sink satisfies these
criteria.

## Acceptance criteria

APPROVED only when residual-risk disposition is recorded, exact commit/file
digests are recorded, and no code, configuration or policy bypass remains.
NEEDS_CHANGES or REJECTED must identify exact evidence or code changes.
