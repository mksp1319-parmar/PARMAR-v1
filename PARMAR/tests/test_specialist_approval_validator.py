import io
import hashlib
import importlib.util
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / ".github/scripts/validate-specialist-approvals.py"
MANIFEST_VALIDATOR = ROOT / ".github/scripts/verify-review-artifact-manifest.py"
ROLE_REVIEWERS = {
    "Security": ("security-reviewer", 123456),
    "Data Model": ("data-model-reviewer", 123457),
    "Operations": ("operations-reviewer", 123458),
    "Privacy/Legal": ("privacy-reviewer", 123459),
    "Provider Compatibility": ("provider-reviewer", 123460),
    "Release Authority": ("release-reviewer", 123461),
}
SPEC = importlib.util.spec_from_file_location("parmar_approval_validator", VALIDATOR)
assert SPEC is not None and SPEC.loader is not None
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)
MANIFEST_SPEC = importlib.util.spec_from_file_location("parmar_manifest_validator", MANIFEST_VALIDATOR)
assert MANIFEST_SPEC is not None and MANIFEST_SPEC.loader is not None
manifest_validator = importlib.util.module_from_spec(MANIFEST_SPEC)
MANIFEST_SPEC.loader.exec_module(manifest_validator)


def head_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def approval(role="Security", decision="APPROVED", status="CURRENT", expires_at=None, supersedes=None):
    path = "README.md"
    target = ROOT / path
    reviewer_login, reviewer_id = ROLE_REVIEWERS[role]
    record = {
        "record_id": role.upper().replace(" ", "").replace("/", "") + "-0001",
        "reviewer": {
            "identity": "Verified Specialist",
            "github_login": reviewer_login,
            "github_user_id": reviewer_id,
            "verified_affiliation": "Independent Test Authority",
            "authority_id": "AUTH-TEST-1",
            "authority_basis": "Verified independent specialist authority",
            "verified_at": "2026-11-25T00:00:00+00:00",
        },
        "role": role,
        "scope": "Independent specialist review of the exact B2 artifact.",
        "artifact": {
            "commit_sha": head_commit(),
            "files": [{"path": path, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}],
        },
        "decision": decision,
        "rationale": "Independent review evidence supports this test decision.",
        "evidence": ["Independent test evidence"],
        "timestamp": "2026-11-25T00:00:00+00:00",
        "conflicts": [],
        "conditions": [],
        "limitations": [],
        "status": status,
        "implementation_author_logins": ["implementation-author"],
        "github_review": {
            "repository": "mksp1319-parmar/PARMAR-v1",
            "pull_request_number": 7,
            "review_id": 123456,
            "commit_sha": head_commit(),
        },
    }
    if expires_at:
        record["expires_at"] = expires_at
    if supersedes:
        record["supersedes"] = supersedes
    return record


def register(*records):
    return {"format": "parmar-specialist-approval-register-v1", "records": list(records)}


def authorize(monkeypatch, register_value, stage="gate2", author="external-release-actor", commit=None):
    monkeypatch.setattr(validator, "verified_github_reviewer", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(validator, "verified_github_review", lambda *_args, **_kwargs: True)
    return validator.authorize_stage(
        register_value,
        ROOT,
        stage,
        commit or head_commit(),
        author,
        datetime.now(timezone.utc),
        "test-token",
    )


def test_empty_specialist_register_is_valid():
    result = subprocess.run(
        ["python3", str(VALIDATOR)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "validated 0 formal" in result.stdout


def test_missing_specialist_approval_blocks(monkeypatch):
    allowed, errors = authorize(monkeypatch, register())
    assert not allowed
    assert "missing valid approvals" in " ".join(errors)


def test_unverified_reviewer_identity_blocks(monkeypatch):
    monkeypatch.setattr(validator, "verified_github_reviewer", lambda *_args, **_kwargs: False)
    records = register(approval("Security"))
    allowed, errors = validator.authorize_stage(
        records, ROOT, "gate3", head_commit(), "implementation-author",
        datetime.now(timezone.utc), None,
    )
    assert not allowed
    assert errors


def test_missing_github_review_blocks(monkeypatch):
    record = approval("Security")
    record.pop("github_review")
    monkeypatch.setattr(validator, "verified_github_reviewer", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(validator, "verified_github_review", lambda *_args, **_kwargs: False)
    allowed, errors = validator.authorize_stage(
        register(record), ROOT, "gate3", head_commit(), "external-release-actor",
        datetime.now(timezone.utc), "test-token",
    )
    assert not allowed
    assert errors


def test_nominee_must_exist_in_authority_register(monkeypatch):
    monkeypatch.setattr(validator, "verified_github_reviewer", lambda *_args, **_kwargs: False)
    record = approval("Security")
    allowed, errors = validator.authorize_stage(
        register(record), ROOT, "gate3", head_commit(), "external-release-actor",
        datetime.now(timezone.utc), "test-token",
    )
    assert not allowed
    assert errors


def test_wrong_specialist_role_blocks(monkeypatch):
    allowed, errors = authorize(monkeypatch, register(approval("Data Model")), stage="gate6")
    assert not allowed
    assert "missing valid approvals" in " ".join(errors)


def test_approval_for_changed_artifact_blocks(monkeypatch):
    record = approval("Security")
    record["artifact"]["files"] = [{"path": "README.md", "sha256": "0" * 64}]
    allowed, errors = authorize(monkeypatch, register(record), stage="gate3")
    assert not allowed
    assert errors


def test_approval_for_another_commit_blocks(monkeypatch):
    record = approval("Security")
    record["artifact"]["commit_sha"] = "0" * 40
    allowed, errors = authorize(monkeypatch, register(record), stage="gate3")
    assert not allowed
    assert errors


def test_revoked_expired_and_superseded_approvals_block(monkeypatch):
    revoked = approval("Security", status="REVOKED")
    revoked["revoked_at"] = "2026-11-25T00:00:00+00:00"
    revoked["revocation_reason"] = "Reviewer revoked the decision."
    expired = approval("Operations", expires_at="2020-01-01T00:00:00+00:00")
    expired["status"] = "EXPIRED"
    superseded = approval("Data Model", status="SUPERSEDED")
    superseded["superseded_by"] = "DM-9999"
    allowed, errors = authorize(monkeypatch, register(revoked, expired, superseded), stage="gate2")
    assert not allowed
    assert "missing valid approvals" in " ".join(errors)


def test_approval_history_statuses_and_supersession_links_are_validated():
    revoked = approval("Security", status="REVOKED")
    revoked["revoked_at"] = "2026-11-25T00:00:00+00:00"
    revoked["revocation_reason"] = "Reviewer revoked the decision."
    errors = []
    validator.validate_record(
        revoked, ROOT, datetime.now(timezone.utc), errors, None
    )
    assert not any("approval must be CURRENT" in error for error in errors)

    previous = {"record_id": "SECURITY-0001", "status": "SUPERSEDED", "superseded_by": "SECURITY-0002"}
    successor = {"record_id": "SECURITY-0002", "status": "CURRENT", "supersedes": "SECURITY-0001"}
    errors = []
    validator.validate_supersession_links([previous, successor], errors)
    assert errors == []
    successor["supersedes"] = "SECURITY-9999"
    validator.validate_supersession_links([previous, successor], errors)
    assert errors


def test_rejection_and_needs_changes_block(monkeypatch):
    rejected = approval("Security", decision="REJECTED")
    needs = approval("Operations", decision="NEEDS_CHANGES")
    allowed, _ = authorize(monkeypatch, register(rejected, needs), stage="gate2")
    assert not allowed


def test_rejected_and_needs_changes_require_changes_requested_review_state():
    assert validator.required_github_review_state("APPROVED") == "APPROVED"
    assert validator.required_github_review_state("REJECTED") == "CHANGES_REQUESTED"
    assert validator.required_github_review_state("NEEDS_CHANGES") == "CHANGES_REQUESTED"


def test_self_approval_is_rejected(monkeypatch):
    record = approval("Security")
    record["implementation_author_logins"] = ["Security-Reviewer"]
    allowed, _ = authorize(monkeypatch, register(record), stage="gate3", author="security-reviewer")
    assert not allowed


def test_all_required_valid_approvals_authorize_gate(monkeypatch):
    records = register(
        approval("Data Model"),
        approval("Security"),
        approval("Operations"),
    )
    allowed, errors = authorize(monkeypatch, records, stage="gate2")
    assert allowed, errors
    assert errors == []


def test_one_reviewer_cannot_satisfy_multiple_required_roles(monkeypatch):
    records = [
        approval("Data Model"),
        approval("Security"),
        approval("Operations"),
    ]
    for record in records:
        record["reviewer"]["github_user_id"] = 123456
        record["reviewer"]["github_login"] = "one-reviewer"
    allowed, errors = authorize(monkeypatch, register(*records), stage="gate2")
    assert not allowed
    assert "distinct role-authorized reviewers" in " ".join(errors)


def test_invalid_unrelated_record_blocks_stage_authorization(monkeypatch):
    records = register(
        approval("Data Model"),
        approval("Security"),
        approval("Operations"),
        {"record_id": "INVALID-0001"},
    )
    allowed, errors = authorize(monkeypatch, records, stage="gate2")
    assert not allowed
    assert any("missing reviewer" in error for error in errors)


def test_review_from_another_repository_is_rejected_without_api_call(monkeypatch):
    record = approval("Security")
    record["github_review"]["repository"] = "another-owner/another-repo"
    monkeypatch.setattr(
        validator.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected network request")),
    )
    assert not validator.verified_github_review(record, record["reviewer"], "test-token")


def test_github_review_must_bind_the_pull_request_and_commit_authors(monkeypatch):
    record = approval("Security")
    responses = [
        {
            "user": {"login": "implementation-author"},
            "base": {"repo": {"full_name": "mksp1319-parmar/PARMAR-v1"}},
        },
        [
            {
                "sha": head_commit(),
                "author": {"login": "implementation-author"},
                "committer": {"login": "implementation-author"},
            }
        ],
        {
            "id": 123456,
            "state": "APPROVED",
            "user": {"id": 123456, "login": "security-reviewer"},
            "commit_id": head_commit(),
        },
    ]

    def fake_urlopen(*args, **kwargs):
        return io.BytesIO(json.dumps(responses.pop(0)).encode("utf-8"))

    monkeypatch.setattr(validator.urllib.request, "urlopen", fake_urlopen)
    assert validator.verified_github_review(record, record["reviewer"], "test-token")

    responses.extend(
        [
            {
                "user": {"login": "unrecorded-author"},
                "base": {"repo": {"full_name": "mksp1319-parmar/PARMAR-v1"}},
            }
        ]
    )
    assert not validator.verified_github_review(record, record["reviewer"], "test-token")

    responses.extend(
        [
            {
                "user": {"login": "implementation-author"},
                "base": {"repo": {"full_name": "mksp1319-parmar/PARMAR-v1"}},
            },
            [
                {
                    "sha": head_commit(),
                    "author": {"login": "security-reviewer"},
                    "committer": {"login": "implementation-author"},
                }
            ],
        ]
    )
    assert not validator.verified_github_review(record, record["reviewer"], "test-token")

    responses.extend(
        [
            {
                "user": {"login": "implementation-author"},
                "base": {"repo": {"full_name": "mksp1319-parmar/PARMAR-v1"}},
            },
            [
                {
                    "sha": head_commit(),
                    "author": {"login": "implementation-author"},
                    "committer": {"login": "implementation-author"},
                }
            ],
            {
                "id": 999999,
                "state": "APPROVED",
                "user": {"id": 123456, "login": "security-reviewer"},
                "commit_id": head_commit(),
            },
        ]
    )
    assert not validator.verified_github_review(record, record["reviewer"], "test-token")


def test_reviewer_must_be_authorized_for_the_recorded_role(monkeypatch, tmp_path):
    register_path = tmp_path / "reviewers.json"
    register_path.write_text(
        json.dumps(
            {
                "format": "parmar-specialist-reviewer-register-v1",
                "reviewers": [
                    {
                        "github_login": "security-reviewer",
                        "github_user_id": 123456,
                        "verified_affiliation": "Independent Test Authority",
                        "authority_id": "AUTH-TEST-1",
                        "authority_basis": "Verified independent specialist authority",
                        "verified_at": "2026-11-25T00:00:00+00:00",
                        "roles": ["Security"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(validator, "REVIEWER_REGISTER_PATH", register_path)
    monkeypatch.setattr(
        validator.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: io.BytesIO(b'{"id":123456,"login":"security-reviewer"}'),
    )
    reviewer = {
        "github_login": "security-reviewer",
        "github_user_id": 123456,
        "verified_affiliation": "Independent Test Authority",
        "authority_id": "AUTH-TEST-1",
        "authority_basis": "Verified independent specialist authority",
    }
    assert validator.verified_github_reviewer(reviewer, "test-token", "Security")
    assert not validator.verified_github_reviewer(reviewer, "test-token", "Operations")


def test_artifact_path_traversal_is_rejected(monkeypatch):
    record = approval("Security")
    record["artifact"]["files"] = [{"path": "../README.md", "sha256": "0" * 64}]
    monkeypatch.setattr(validator, "verified_github_reviewer", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(validator, "verified_github_review", lambda *_args, **_kwargs: True)
    errors = []
    validator.validate_record(
        record, ROOT, datetime.now(timezone.utc), errors, "test-token"
    )
    assert any("path is unsafe" in error for error in errors)


def test_malformed_record_values_fail_closed_without_type_error(monkeypatch):
    record = approval("Security")
    record["scope"] = []
    record["rationale"] = None
    monkeypatch.setattr(validator, "verified_github_reviewer", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(validator, "verified_github_review", lambda *_args, **_kwargs: True)
    errors = []
    validator.validate_record(
        record, ROOT, datetime.now(timezone.utc), errors, "test-token"
    )
    assert any("scope is missing" in error for error in errors)
    assert any("rationale is missing" in error for error in errors)


def test_unrelated_change_does_not_invalidate_reviewed_artifact(monkeypatch):
    record = approval("Security")
    allowed, _ = authorize(monkeypatch, register(record), stage="gate3")
    assert allowed


def test_workflow_paths_cannot_bypass_protection():
    specialist = (ROOT / ".github/workflows/parmar-specialist-approvals.yml").read_text(encoding="utf-8")
    keycloak = (ROOT / ".github/workflows/parmar-keycloak-oidc-e2e.yml").read_text(encoding="utf-8")
    javascript = (ROOT / ".github/workflows/parmar-javascript-tests.yml").read_text(encoding="utf-8")
    visual = (ROOT / ".github/workflows/parmar-visual-acceptance.yml").read_text(encoding="utf-8")
    assert "pull_request_target:" not in specialist
    assert "pull_request_target:" not in keycloak
    assert "environment: parmar-keycloak-e2e" in keycloak
    assert "--stage gate6" in keycloak
    assert "cancel-in-progress: false" in specialist
    assert "github.ref != 'refs/heads/main'" in keycloak
    assert "pull-requests: read" in specialist
    assert "pull-requests: read" in keycloak
    assert "GITHUB_TOKEN: ${{ github.token }}" in specialist
    assert "Repository JavaScript tests (Node 24)" in javascript
    assert "VOKKI browser acceptance (Playwright 1.65.1)" in visual
    assert "paths:" not in javascript.split("jobs:", 1)[0]
    assert "paths:" not in visual.split("jobs:", 1)[0]


def test_activation_and_review_packages_are_complete():
    approval_dir = ROOT / ".github/approval"
    activation = (approval_dir / "GITHUB-GOVERNANCE-ACTIVATION-PACKAGE.md").read_text(encoding="utf-8")
    assert "POST" in activation
    assert "parmar-keycloak-e2e" in activation
    assert "no bypass actor" in activation.lower()
    assert "--data-binary @environment-request.json" in activation
    assert '"reviewers":[]' not in activation.replace(" ", "")
    assert "never submit an empty reviewer list" in activation.lower()
    assert "only one of them" in " ".join(activation.lower().split())
    environment = json.loads((ROOT / ".github/parmar-keycloak-e2e-environment.json").read_text(encoding="utf-8"))
    assert "one listed reviewer only" in environment["required_attestation"]
    packages = {p.stem for p in (approval_dir / "review-packages").glob("*.md")}
    assert {
        "security",
        "data-model",
        "operations",
        "privacy-legal",
        "provider-compatibility",
        "release-authority",
    }.issubset(packages)
    assert {
        "security-invitation",
        "data-model-invitation",
        "operations-invitation",
        "privacy-legal-invitation",
        "provider-compatibility-invitation",
        "release-authority-invitation",
    }.issubset(packages)
    manifest = json.loads((approval_dir / "review-artifact-manifest.json").read_text(encoding="utf-8"))
    assert manifest
    assert all("__pycache__" not in path for path in manifest)
    for path, digest in manifest.items():
        assert len(digest) == 64
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest


def test_duplicate_approval_record_ids_fail_closed(tmp_path):
    path = tmp_path / "records.json"
    path.write_text(
        json.dumps(register({"record_id": "SECURITY-0001"}, {"record_id": "SECURITY-0001"})),
        encoding="utf-8",
    )
    result = subprocess.run(
        ["python3", str(VALIDATOR), "--register", str(path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "duplicate approval record_id" in result.stdout


def test_duplicate_json_keys_fail_closed(tmp_path):
    path = tmp_path / "records.json"
    path.write_text(
        '{"format":"parmar-specialist-approval-register-v1",'
        '"format":"parmar-specialist-approval-register-v1","records":[]}',
        encoding="utf-8",
    )
    result = subprocess.run(
        ["python3", str(VALIDATOR), "--register", str(path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "duplicate JSON key" in result.stdout


def test_manifest_validator_rejects_tampering_and_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(manifest_validator, "ROOT", tmp_path)
    monkeypatch.setattr(manifest_validator, "REPOSITORY_ROOT", tmp_path.resolve())
    artifact = tmp_path / "artifact.txt"
    artifact.write_text("changed", encoding="utf-8")
    errors = []
    assert not manifest_validator.verify_digest("artifact.txt", "0" * 64, errors, "test")
    assert any("digest is stale" in error for error in errors)
    assert manifest_validator.repository_file("../outside.txt") is None


def test_po13_option_a_is_recorded_and_framework_is_digest_bound_to_all_roles():
    framework_path = "PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md"
    framework = (ROOT / framework_path).read_text(encoding="utf-8")
    packet = (ROOT / "PARMAR/ACCOUNT-BINDING-CONSOLIDATED-APPROVAL-PACKET.md").read_text(
        encoding="utf-8"
    )
    po13_row = next(line for line in framework.splitlines() if line.startswith("| **PO-13"))
    assert "APPROVED — OPTION A (2026-11-26)" in po13_row
    assert "withdraw the phrase as non-operative" in po13_row
    assert "No additional scope" in po13_row
    assert "APPROVED — OPTION A" in packet
    assert "does not add," in packet
    assert "PARMAR Premium" in packet

    handoffs = json.loads(
        (ROOT / ".github/approval/specialist-handoff-artifacts.json").read_text(
            encoding="utf-8"
        )
    )
    for role, entry in handoffs["roles"].items():
        indexed_paths = {item["path"] for item in entry["artifacts"]}
        assert framework_path in indexed_paths, role
        package = (ROOT / entry["package"]["path"]).read_text(encoding="utf-8")
        heading = manifest_validator.SCOPE_HEADINGS[role]
        section = package.split(heading, 1)[1].split("\n## ", 1)[0]
        assert f"- `{framework_path}`" in section, role
