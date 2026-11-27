# Independent Release Authority Review Package

**Status:** Review-ready; no approval.

## Digest binding

The exact SHA-256 values for the Release Authority scope, this package and its
invitation are recorded under `roles.Release Authority` in
[`specialist-handoff-artifacts.json`](../specialist-handoff-artifacts.json).
They represent the current candidate worktree, not a commit-bound approval.
Recompute and rebind after any artifact changes.

## Required gate evidence

- Gate 1 policy and residual-risk dispositions;
- Gate 2 schema/model acceptance;
- Gate 3 threat/abuse review;
- Gate 4 implementation authorization;
- Gate 5 focused security evidence;
- Gate 6 isolated live E2E evidence;
- Gate 7 production readiness evidence;
- exact GitHub ruleset, Environment and required-check verification.

## Exact artifact baseline

- `.github/approval/approval-record.schema.json`
- `.github/approval/records.json`
- `.github/approval/reviewer-identity-register.json`
- `.github/approval/reviewer-identity-register.schema.json`
- `.github/approval/specialist-roles.json`
- `.github/approval/GITHUB-GOVERNANCE-ACTIVATION-PACKAGE.md`
- `.github/approval/SPECIALIST-ONBOARDING.md`
- `.github/approval/ACTION-REGISTER.md`
- `.github/governance-ruleset.json`
- `.github/parmar-keycloak-e2e-environment.json`
- `.github/CODEOWNERS`
- `.github/scripts/validate-specialist-approvals.py`
- `.github/scripts/verify-review-artifact-manifest.py`
- `.github/workflows/parmar-specialist-approvals.yml`
- `.github/workflows/parmar-keycloak-oidc-e2e.yml`
- `.github/workflows/parmar-javascript-tests.yml`
- `.github/workflows/parmar-visual-acceptance.yml`
- `PARMAR/ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md`
- `PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md`
- `PARMAR/ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md`
- `PARMAR/ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md`
- `PARMAR/PARMAR-RUNTIME-NO-GO-INDEPENDENT-AUDIT.md`
- `PARMAR/PARMAR-RECOVERY-CUTOVER-READINESS-REPORT.md`
- `PARMAR/PARMAR-SQLITE-DURABILITY-EVIDENCE-REPORT.md`
- `PARMAR/tests/test_specialist_approval_validator.py`
- `PARMAR/tests/test_account_binding_atomic_rehearsal.py`
- `PARMAR/tests/test_account_binding_migration_rehearsal.py`
- `.github/approval/review-packages/security.md`
- `.github/approval/review-packages/data-model.md`
- `.github/approval/review-packages/operations.md`
- `.github/approval/review-packages/privacy-legal.md`
- `.github/approval/review-packages/provider-compatibility.md`

The specialist package, invitation and exact path-to-SHA-256 mapping for this
scope are recorded under `roles.Release Authority` in the digest index above.
The generic artifact manifest is verified separately; it is excluded from
role-specific digest lists to avoid a self-referential hash.

Baseline commit: `cbca03c03ae5c4c541666e102b9ee4a62aa91a86`; rebind to the
eventual merge commit and exact file SHA-256 values.

## Questions

1. Is every required specialist approval attached to the exact release commit?
2. Are revocation, expiry and stale-review behavior effective in GitHub?
3. Is the protected atomic-fence NO-GO still intact?
4. Is production OIDC still disabled?
5. Confirm PO-13 is recorded as approved Option A (2026-11-26), does not
   cancel or define future PARMAR Premium, and introduces no entitlement gate.
6. Is rollback and incident authority complete?

## Acceptance criteria

APPROVED only for an exact change/deployment scope after all prior gates and
GitHub controls are API-verified. No blanket or future release approval.
