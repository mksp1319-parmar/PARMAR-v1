# PARMAR Independent Specialist Onboarding

This is an onboarding and decision-submission package. It does not appoint
any reviewer and does not contain or grant formal approval.

## 1. Required specialist roles

Six decisions must remain separate:

1. **Security** - identity proof, threat model, trust boundaries, foreign-key
   and trigger boundaries, audit integrity, concurrency and residual risk.
2. **Data Model** - B2 cardinality, issuer/subject normalization, embedded
   U+0000, NFC/NFD, TEXT affinity, migration and concurrency invariants.
3. **Operations** - supported SQLite topology, isolation, migration, backup,
   restore, rollback, reconciliation, monitoring and incident response.
4. **Privacy/Legal** - identity data, audit and tombstone retention, deletion,
   backup expiry, notices, recovery and legal basis.
5. **Provider Compatibility** - exact issuer/subject behavior, claims, logout,
   subject changes, provider outage behavior and live interoperability evidence.
6. **Release Authority** - exact deployment/change scope after Gates 1-7.

No implementation author or prior Agent review may approve their own work.
A reviewer must be independent, able to verify the cited evidence and named
with a verifiable organization affiliation or authority basis.

## 2. Nomination and conflict procedure

The organization administrator or accountable authority must:

1. Record the candidate's legal/handle identity and organization role.
2. Verify and record the candidate's authority separately for each role and
   exact scope. Populate `roles` and the matching affiliation, authority ID and
   authority basis, with a UTC `verified_at` timestamp, in
   `reviewer-identity-register.json` only after that check. Validate the
   register against `reviewer-identity-register.schema.json`.
3. Record professional relationship, implementation ownership and financial,
   employment or other conflicts.
4. Reject or document as a condition any conflict that prevents independent
   review.
5. Grant repository read access and only the write permissions needed for the
   review record.

The GitHub Users API verifies login and immutable user ID only. It does not
verify affiliation, specialist qualifications or organizational authority;
those remain an administrator's evidenced responsibility. One immutable GitHub
user ID cannot satisfy multiple required roles within the same protected stage.

## 3. Required repository permissions

- **All reviewers:** read access, pull-request visibility and ability to submit
  a GitHub pull-request review.
- **Approval validator workflow token:** `contents: read` and
  `pull-requests: read` only, to read the exact commit, PR author and submitted
  review. The workflow must pass `GITHUB_TOKEN` explicitly to the validator.
- **Decision submitter:** write permission to
  `.github/approval/records.json`, or delegated commit/PR authority to submit
  an attributed record. Repository administrators must prevent direct bypass
  of the approval-record pull-request path.
- **Operations migration approvers:** no production credentials or migration
  access are granted by this package.
- **Release Authority:** no deployment credentials are granted merely by
  repository write access.

No personal access token or secret belongs in a review record or repository.

## 4. Required GitHub configuration

An organization administrator must prepare, but must not infer approval from:

1. A repository ruleset or branch protection for `main` requiring pull-request
   review before merge and blocking direct pushes.
2. A CODEOWNERS file that names the reviewer or qualified team for
   `.github/approval/**`, security-critical source, identity schema and
   workflow files. Teams must be real organization teams; do not substitute
   Agent accounts or placeholders.
3. Required CODEOWNERS review and at least one independent review by a user
   outside the change author team.
4. Required status checks:
   `Validate formal specialist approval records`,
   `Repository JavaScript tests (Node 24)`, and
   `VOKKI browser acceptance (Playwright 1.65.1)`. The two path-scoped
   application workflows have been changed to trigger on every push and pull
   request so required contexts are not omitted on governance-only changes.
5. The protected GitHub Environment `parmar-keycloak-e2e` with required
   reviewers who are independent of the implementation team and limited
   deployment/dispatch branches.
6. Environment secrets and image configuration only after provider, Security,
   Operations and Release approval. The environment must not expose production
   credentials.

Apply these exact changes only after confirming the rules cannot lock out
repository maintainers. Protected operations and production OIDC remain
disabled regardless of repository configuration.

## 5. Exact artifacts requiring review

Each role's exact reviewed file list and current worktree SHA-256 values are
bound in its package and in
[`specialist-handoff-artifacts.json`](./specialist-handoff-artifacts.json):

- [Security package](./review-packages/security.md) and
  [invitation](./review-packages/security-invitation.md)
- [Data Model package](./review-packages/data-model.md) and
  [invitation](./review-packages/data-model-invitation.md)
- [Operations package](./review-packages/operations.md) and
  [invitation](./review-packages/operations-invitation.md)
- [Privacy/Legal package](./review-packages/privacy-legal.md) and
  [invitation](./review-packages/privacy-legal-invitation.md)
- [Provider Compatibility package](./review-packages/provider-compatibility.md)
  and [invitation](./review-packages/provider-compatibility-invitation.md)
- [Release Authority package](./review-packages/release-authority.md) and
  [invitation](./review-packages/release-authority-invitation.md)

## 6. Evidence required for a formal decision

Every record must include:

- reviewer identity and verified authority basis;
- exact role and review scope;
- exact commit SHA and SHA-256 digest for every reviewed file;
- `APPROVED`, `REJECTED` or `NEEDS_CHANGES`;
- rationale and external or repository evidence;
- UTC timestamp;
- conflicts of interest;
- conditions and limitations;
- expiry, supersession or revocation history.

The six role packages link to
[`specialist-handoff-artifacts.json`](./specialist-handoff-artifacts.json),
which lists the exact current worktree SHA-256 values for each role's review
scope, package and invitation. The generic
[`review-artifact-manifest.json`](./review-artifact-manifest.json) also hashes
the handoff files and verifies the digest index. These are candidate-worktree
digests, not commit-bound approval evidence; regenerate after any file change
and rebind all approval records to the exact reviewed commit.
The generic manifest does not hash itself; it is independently validated by its
verifier and must itself be included in the eventual exact-commit review.

The approval register must use the
[record schema](./approval-record.schema.json) and pass:

`python3 .github/scripts/validate-specialist-approvals.py`

The validator rejects unstamped, unidentified or stale records. Changes to a
reviewed file invalidate prior approval unless a new record is attributable
to the current artifact.

## 7. Submission procedure

1. Reviewer creates a pull request containing only the decision record and
   supporting evidence URL/path approved for repository storage.
2. The pull-request author and implementation team do not submit the
   reviewer-only decision on the reviewer’s behalf.
3. The reviewer submits a GitHub review and the JSON record under
   `.github/approval/records.json`.
4. A second repository maintainer verifies the JSON is attributable and
   conflicts/authority fields are complete.
5. The approval workflow validates the commit and file digests.
6. Organization rules require the applicable CODEOWNERS team to approve.
7. On `APPROVED`, release remains blocked until every separate required role
   is approved for the exact artifacts.
8. `REJECTED` or `NEEDS_CHANGES` requires implementation or documentation
   correction and a new record; supersession must not erase the original.
9. Revocation or expiry changes status and invalidates all dependent gates.

A formal JSON record must include `github_review` with:

- the exact repository;
- pull-request number;
- immutable GitHub review ID;
- exact reviewed commit SHA.

The validator retrieves that review through GitHub and requires
`state: APPROVED`, the exact reviewer login and immutable GitHub user ID, and
a `commit_id` equal to the record's artifact commit. It also checks that the
PR targets this repository, the PR creator and commit author/committer are
listed as implementation authors, and the reviewer is not one of them. A
comment or ordinary issue approval does not satisfy this field.

GitHub merge, ordinary review comments, workflow success or Agent output do
not themselves constitute formal specialist approval.

## 8. Outstanding administrator actions

- Install GitHub CLI or grant API access to inspect organization/repository
  capabilities in a future authorized session.
- Nominate and verify the six specialist reviewers.
- Create real organization teams and CODEOWNERS entries.
- Create `main` ruleset/branch protection with required independent reviews.
- Protect `.github/approval/**` and approval workflow status.
- Create and protect the `parmar-keycloak-e2e` Environment.
- Add required environment reviewers and restricted deployment branches.
- Obtain provider/image and live-E2E approval before any live workflow dispatch.
- Do not enable production OIDC or clear the atomic-fence NO-GO. PO-13 is
  resolved only as Product Owner Option A (2026-11-26); it creates no
  subscription or entitlement scope and must not be used to decide another role.

## 9. Current API-verification status

The public GitHub API and Actions API checks at
`2026-11-26T17:22:44Z` verified:

- repository and `main` are reachable;
- repository rulesets endpoint returned HTTP 200 with an empty list;
- Environments endpoint returned HTTP 200 with `total_count: 0`;
- unauthenticated branch-protection lookup requires authentication;
- unauthenticated Actions permissions lookup requires authentication;
- the Actions API listed seven active remote workflows; Keycloak E2E is present
  but has zero runs, while `parmar-specialist-approvals.yml` is not present
  remotely (its local workflow is only a proposal);
- no remote `.github/CODEOWNERS` file was found;
- no formal approval records were found remotely.

The local CODEOWNERS proposal still falls back to the repository owner and does
not verify specialist team ownership. This environment has no authenticated
administration scope. Therefore branch protection, Actions policy, collaborators,
teams, required checks and Environment reviewers are not fully verifiable and
cannot be changed here. The administrator must use a short-lived credential
with the minimum repository administration/Environment scope and recovery
access, then record authenticated API responses and a negative enforcement
test.
