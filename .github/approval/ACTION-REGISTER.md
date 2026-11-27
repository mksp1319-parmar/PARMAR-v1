# PARMAR External Action Register

| ID | Owner role | Category | Prerequisite | Required evidence | Completion condition | Status |
|---|---|---|---|---|---|---|
| ACT-01 | Repository administrator | Repository administrator | Admin scope and maintainer recovery account | API POST result and returned ruleset ID | `main` ruleset API includes only main, no bypass, stale dismissal, last-push approval and required checks | EXTERNAL PENDING |
| ACT-02 | Repository administrator | Repository administrator | Real specialist teams | CODEOWNERS file and team membership evidence | Sensitive paths resolve to real independent teams | EXTERNAL PENDING |
| ACT-03 | Repository administrator | Repository administrator | Verified independent reviewer IDs | Environment API response | `parmar-keycloak-e2e` exists with protected branches and required independent reviewers | EXTERNAL PENDING |
| ACT-04 | Organization owner | Organization-owner | Organization-level rules and team permissions | Nomination records and team settings | Required teams have repository permissions and no owner-only bypass | EXTERNAL PENDING |
| ACT-05 | Security specialist | Independent specialist | Approved nomination and conflict disclosure | GitHub APPROVED review, artifact SHA-256 and review record | Security stage has a current valid approval | EXTERNAL PENDING |
| ACT-06 | Data Model specialist | Independent specialist | Approved nomination and conflict disclosure | GitHub APPROVED review, normalization/migration decisions | Data Model approval bound to exact merge commit | EXTERNAL PENDING |
| ACT-07 | Operations specialist | Independent specialist | Approved nomination and topology evidence | GitHub APPROVED review and operational evidence | Operations approval bound to exact commit/topology | EXTERNAL PENDING |
| ACT-08 | Privacy/Legal specialist | Independent specialist | Approved nomination and legal scope | GitHub APPROVED review and retention/disposal disposition | Privacy/Legal stage approval has no unresolved class ambiguity | EXTERNAL PENDING |
| ACT-09 | Provider Compatibility specialist | Independent specialist | Provider and exact configuration scope | GitHub APPROVED review and isolated compatibility evidence | Provider approval identifies exact issuer/claims/configuration | EXTERNAL PENDING |
| ACT-10 | Release Authority | Independent specialist | All prior gates and effective GitHub controls | GitHub APPROVED review and exact deployment/change record | Exact release scope approved; no blanket approval | EXTERNAL PENDING |
| ACT-11 | Product Owner | Product policy | Record Option A for PO-13: no product requirement; withdraw “fully primium type” as non-operative | Decision supplied in the current authorized task; 2026-11-26; exact historical phrase preserved; no Premium cancellation or future-scope inference | Option A recorded in every authoritative decision artifact and digests refreshed; no subscription/entitlement behavior introduced | COMPLETE — PO-13 policy disposition |
| ACT-12 | Operations plus Security | Future production | Restore drill, topology and migration authority | Restore comparison and incident evidence | Gate 7 operational readiness passes | EXTERNAL PENDING |
| ACT-13 | Provider owner plus Release Authority | Future production | Isolated live evidence and exact provider approval | Live run and cleanup evidence | Gate 6 provider lifecycle acceptance passes | EXTERNAL PENDING |

Agent-completed locally:

- ruleset and Environment proposal package;
- fail-closed record validator;
- role-specific reviewer eligibility and distinct-reviewer enforcement;
- exact repository, PR author, commit author/committer, review ID and commit binding;
- six review packages and invitation drafts;
- role-scoped SHA-256 handoff index and verified artifact manifest;
- governance negative tests;
- least-privilege read-only workflow token permissions and test suites.

## Latest live evidence

Checked 2026-11-26: repository rulesets returned HTTP 200 with `[]`;
Environments returned HTTP 200 with `total_count: 0`; unauthenticated branch
protection and Actions permissions lookups returned HTTP 401. The Actions API
listed seven active remote workflows. The remote Keycloak workflow has zero
runs; `parmar-specialist-approvals.yml` is not present remotely. No remote
CODEOWNERS file was found. The local reviewer register and formal approval
register are both empty.

- ACT-01: **EXTERNAL BLOCKED** — an authenticated repository administrator
  must create the main-only ruleset and provide API evidence plus a negative
  merge/push enforcement test.
- ACT-02 and ACT-04: **EXTERNAL BLOCKED** — an organization owner must nominate
  role-authorized reviewers, create real specialist teams, verify memberships
  and provide CODEOWNERS resolution evidence.
- ACT-03: **EXTERNAL BLOCKED** — an authorized administrator must create the
  protected Environment with independent verified reviewers and provide the
  authenticated API response.
- ACT-05 through ACT-10: **EXTERNAL BLOCKED** — there are no nominated,
  authority-verified specialist identities or attributable GitHub review
  records. Each reviewer must review the digest-bound package and exact
  committed artifacts before submitting a decision.
- ACT-11 through ACT-13: **EXTERNAL PENDING** — no attributable product,
  operations or provider completion evidence.

The local approval workflow and current worktree handoffs are not active GitHub
controls or formal approvals. The empty approval register validates as zero
records; it does not satisfy any specialist gate.
