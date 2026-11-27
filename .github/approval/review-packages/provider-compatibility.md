# Independent Provider Compatibility Review Package

**Status:** Review-ready; no approval.

## Digest binding

The exact SHA-256 values for the Provider Compatibility scope, this package and
its invitation are recorded under `roles.Provider Compatibility` in
[`specialist-handoff-artifacts.json`](../specialist-handoff-artifacts.json).
They represent the current candidate worktree, not a commit-bound approval.
Recompute and rebind after any artifact changes.

## Exact artifacts

- `PARMAR/oidc.py`
- `PARMAR/tests/test_oidc_authentication.py`
- `.github/workflows/parmar-keycloak-oidc-e2e.yml`
- `.github/scripts/parmar-keycloak-oidc-e2e-infra.sh`
- `.github/e2e/keycloak/parmar-e2e-realm.json`
- `PARMAR/tests/test_keycloak_oidc_live_e2e.py`
- `PARMAR/ACCOUNT-BINDING-B2-SCHEMA-DESIGN.md`
- `PARMAR/ACCOUNT-BINDING-B3-IMPLEMENTATION-PLAN.md`
- `PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md`

Baseline commit: `cbca03c03ae5c4c541666e102b9ee4a62aa91a86`; rebind to the
eventual merge commit and exact file SHA-256 values.

## Questions

1. Decide exact issuer, subject, audience, azp and claim semantics.
2. Verify provider logout and revocation behavior; preserve PARMAR-local authority.
3. Decide NFC/NFD and embedded-NUL handling.
4. Verify live Keycloak scenarios, TLS, cleanup and account-binding purpose.
5. Define outage and subject-change behavior.

## Acceptance criteria

APPROVED requires exact provider/configuration provenance and live isolated
evidence. No production provider or production OIDC activation is authorized.
