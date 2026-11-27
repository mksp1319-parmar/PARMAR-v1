# PARMAR GitHub Governance Activation Package

**Status:** Prepared, not active. Live activation requires repository-administrator
authorization. The available integration token currently cannot modify branch
protection or Actions settings.

## 1. Prerequisites

1. An administrator with repository administration and Environment administration
   access.
2. A real maintainer recovery account. Do not apply rules before confirming the
   administrator can edit/delete a ruleset.
3. Verified real teams for specialist ownership. A user fallback is not specialist
   authority.
4. The exact commit containing the governance files is merged and visible at
   `main`.
5. Required workflow names are active on `main`.
6. Live provider credentials and production OIDC settings remain disabled.
7. Minimum administrator permission: fine-grained token with Repository
   Administration: Read and Write, Actions: Read, Environments: Read and Write,
   Contents: Read, and Pull Requests: Read. Rulesets require repository
   administration. Do not grant organization administration or workflow secrets.

## 2. Repository ruleset

Activate the exact proposal in
[`.github/governance-ruleset.json`](../governance-ruleset.json) as a repository
ruleset targeting `main`.

API operation:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $GITHUB_ADMIN_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X POST \
  "https://api.github.com/repos/mksp1319-parmar/PARMAR-v1/rulesets" \
  --data-binary @.github/governance-ruleset.json
```

Required effective values:

- target: `branch`;
- include only `refs/heads/main`;
- deletion blocked;
- non-fast-forward blocked;
- pull requests required;
- stale reviews dismissed on push;
- last-push approval required;
- code-owner review required;
- unresolved review threads block merge;
- all three contexts are required:
  `Validate formal specialist approval records`,
  `Repository JavaScript tests (Node 24)`, and
  `VOKKI browser acceptance (Playwright 1.65.1)`;
- strict required-status policy enabled;
- no bypass actor.

Do not add repository administrators as bypass actors. If GitHub reports that
no bypass actors cannot satisfy recovery policy, stop and have the
administrator use a scoped emergency ruleset procedure rather than weakening
normal protection.

## 3. CODEOWNERS

Create real specialist teams before activation. Replace owner fallback entries
in [`.github/CODEOWNERS`](../CODEOWNERS) with:

```text
.github/approval/** @mksp1319-parmar/<security-team>
.github/approval/** @mksp1319-parmar/<data-model-team>
.github/approval/** @mksp1319-parmar/<operations-team>
PARMAR/identity_contracts.py @mksp1319-parmar/<data-model-team>
PARMAR/identity_store.py @mksp1319-parmar/<data-model-team>
PARMAR/oidc.py @mksp1319-parmar/<provider-team>
.github/workflows/parmar-keycloak-oidc-e2e.yml @mksp1319-parmar/<operations-team>
.github/workflows/parmar-keycloak-oidc-e2e.yml @mksp1319-parmar/<security-team>
.github/workflows/parmar-specialist-approvals.yml @mksp1319-parmar/<security-team>
```

Team names are placeholders until a real organization team is created and
verified. Do not use repository owner, implementation author or Agent as a
specialist substitute.

GitHub UI: Settings -> Rules -> Rulesets -> `PARMAR protected main` -> Code
owners. Also verify CODEOWNERS resolves for every changed sensitive path.

## 4. Protected Environment

Create `parmar-keycloak-e2e` only after the non-production test scope and
eligible independent reviewers are confirmed. Gate 6 provider/image approval
is a separate prerequisite to dispatching live tests; environment creation
does not imply provider acceptance.

GitHub UI: Settings -> Environments -> `parmar-keycloak-e2e`.

- required reviewers: verified Security, Operations and Release authorities.
  GitHub permits at most six listed reviewers and requires approval from only
  one of them; this is a dispatch safeguard, not multi-role specialist
  approval. Formal role decisions must be independently recorded and validated;
- wait timer: 0 only after independent reviewers approve; no wait timer is a
  substitute for reviewers;
- deployment branch policy: protected branches only;
- deployment tags: none;
- secrets: none by default;
- variables: no provider image or production endpoint.

The exact live environment shape is in
[`.github/parmar-keycloak-e2e-environment.json`](../parmar-keycloak-e2e-environment.json).
Before creation, administrators must populate a non-empty `reviewers` list
with immutable GitHub user or team IDs only after identity and authority
verification. GitHub allows at most six entries and only one listed reviewer
must approve a job. Never submit an empty reviewer list: that would create an
environment without the intended approval gate. Do not treat this one-of-N
environment approval as a substitute for any specialist role decision; see
GitHub's [required reviewer semantics](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments#required-reviewers).

API operation requires numeric reviewer IDs. Prepare
`environment-request.json` with the verified reviewers and the branch policy
above; do not include secrets or provider credentials:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $GITHUB_ADMIN_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -X PUT \
  "https://api.github.com/repos/mksp1319-parmar/PARMAR-v1/environments/parmar-keycloak-e2e" \
  --data-binary @environment-request.json
```

Do not add secrets or variables to this Environment until provider Security,
Operations and Release approval are recorded and the exact image is approved.
The workflow deliberately has `PARMAR_KEYCLOAK_IMAGE=""`.

## 5. Workflow permissions

The specialist-approval and Keycloak validators need only `contents: read` and
`pull-requests: read` to verify repository artifacts and submitted GitHub
reviews. The validator step must receive `${{ github.token }}` explicitly as
`GITHUB_TOKEN`. These are read-only permissions. No workflow may add:

- `contents: write`;
- `actions: write`;
- `administration: write`;
- `id-token: write`;
- `pull-requests: write`;
- broad `secrets` access;
- unbounded repository dispatch access.

Repository Actions policy may remain restricted to local actions and pinned
third-party action SHAs. Add no reusable workflow or `pull_request_target`
route.

The JavaScript and visual-acceptance workflows are required status contexts in
the proposed ruleset. Their former workflow-level path filters could omit the
checks on documentation/governance-only PRs and leave required contexts
pending. They now trigger on every push and pull request so the named checks
are always emitted; this intentionally increases CI runs and must be retained
if those contexts remain required.

## 8. Observed live baseline (not activated)

The public GitHub API returned HTTP 200 and an empty array for repository
rulesets, and HTTP 200 with `total_count: 0` for Environments. Unauthenticated
requests for `main` branch protection and Actions permissions returned HTTP
401, so those settings are not verified. The Actions API listed seven active
workflows: the remote Keycloak workflow exists but has no runs, and the
specialist-approval workflow is not present remotely. No remote CODEOWNERS file
or formal approval records were found. These facts do not prove protection or
reviewer eligibility; authenticated administrator evidence is still required.

The local CODEOWNERS file currently uses repository-owner fallback rather than
verified specialist teams. The local ruleset, Environment and workflow files
are proposals only. No GitHub settings were changed in this task.

## 6. Post-activation verification

Verify with an administrator token:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $GITHUB_ADMIN_TOKEN" \
  "https://api.github.com/repos/mksp1319-parmar/PARMAR-v1/rulesets" \
  | python3 -m json.tool

curl --fail-with-body \
  -H "Authorization: Bearer $GITHUB_ADMIN_TOKEN" \
  "https://api.github.com/repos/mksp1319-parmar/PARMAR-v1/environments/parmar-keycloak-e2e" \
  | python3 -m json.tool
```

Confirm:

1. only `main` is included;
2. no bypass actor exists;
3. stale dismissal and last-push approval are enabled;
4. code-owner review and thread resolution are enabled;
5. exact required contexts are listed;
6. Environment has protected-branch policy and independent required reviewers;
7. no Environment secret or production OIDC value exists;
8. an isolated test PR cannot merge with missing status/check approval;
9. direct push to `main` is blocked.

## 7. Safe recovery

Keep the administrator account and ruleset edit URL outside the ruleset scope.
Before activation, test ruleset deletion/edit access with a disposable throwaway
ruleset. After activation, do not weaken the ruleset merely to unblock an urgent
change. Revert work through a new PR, fresh specialist review and required
checks.
