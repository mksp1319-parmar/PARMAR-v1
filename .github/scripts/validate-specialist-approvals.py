#!/usr/bin/env python3
"""Fail closed validation for formal PARMAR specialist approval records."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any


REPOSITORY = "mksp1319-parmar/PARMAR-v1"
REVIEWER_REGISTER_PATH = Path(__file__).resolve().parents[1] / "approval/reviewer-identity-register.json"
RECORD_FIELDS = {
    "record_id", "reviewer", "role", "scope", "artifact", "decision", "rationale",
    "evidence", "implementation_author_logins", "github_review", "timestamp",
    "conflicts", "conditions", "limitations", "status", "supersedes",
    "superseded_by", "expires_at", "revoked_at", "revocation_reason",
}
REVIEWER_FIELDS = {
    "identity", "github_login", "github_user_id", "verified_affiliation",
    "authority_id", "authority_basis", "verified_at",
}
ALLOWED_ROLES = {
    "Security",
    "Data Model",
    "Operations",
    "Privacy/Legal",
    "Provider Compatibility",
    "Release Authority",
}
ALLOWED_DECISIONS = {"APPROVED", "REJECTED", "NEEDS_CHANGES"}
STAGE_REQUIREMENTS = {
    "gate2": {"Data Model", "Security", "Operations"},
    "gate3": {"Security"},
    "gate4": {"Data Model", "Security", "Operations"},
    "gate5": {"Security", "Operations"},
    "gate6": {"Provider Compatibility", "Security", "Operations"},
    "gate7": {"Release Authority", "Security", "Operations", "Privacy/Legal", "Data Model", "Provider Compatibility"},
}


def required_github_review_state(decision: str) -> str | None:
    if not isinstance(decision, str):
        return None
    return {
        "APPROVED": "APPROVED",
        "REJECTED": "CHANGES_REQUESTED",
        "NEEDS_CHANGES": "CHANGES_REQUESTED",
    }.get(decision)


def parse_timestamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp must include a timezone")
    return parsed


def reject_duplicate_object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> Any:
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicate_object_pairs,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_at_commit(root: Path, commit_sha: str, path_text: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "show", f"{commit_sha}:{path_text}"],
            capture_output=True,
            check=False,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return hashlib.sha256(result.stdout).hexdigest()


def github_get_json(url: str, token: str) -> Any | None:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def safe_artifact_path(root: Path, path_text: str) -> Path | None:
    if not path_text or "\0" in path_text or "\\" in path_text:
        return None
    relative = PurePosixPath(path_text)
    if (
        relative.is_absolute()
        or str(relative) != path_text
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        return None

    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            return None
    root_resolved = root.resolve()
    resolved = path.resolve(strict=False)
    if resolved == root_resolved or root_resolved not in resolved.parents:
        return None
    return path


def verified_github_reviewer(
    reviewer: dict[str, Any],
    token: str | None = None,
    role: str | None = None,
) -> bool:
    login = reviewer.get("github_login")
    github_user_id = reviewer.get("github_user_id")
    affiliation = reviewer.get("verified_affiliation")
    authority_id = reviewer.get("authority_id")
    authority_basis = reviewer.get("authority_basis")
    if (
        not isinstance(login, str)
        or not re.fullmatch(r"[A-Za-z0-9-]+", login)
        or type(github_user_id) is not int
        or github_user_id < 1
        or role not in ALLOWED_ROLES
    ):
        return False
    if not isinstance(affiliation, str) or len(affiliation) < 3:
        return False
    if not isinstance(authority_id, str) or len(authority_id) < 3:
        return False
    if not token:
        return False
    try:
        identity_register = load_json(REVIEWER_REGISTER_PATH)
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    if (
        not isinstance(identity_register, dict)
        or set(identity_register) != {"format", "reviewers"}
        or identity_register.get("format") != "parmar-specialist-reviewer-register-v1"
        or not isinstance(identity_register.get("reviewers"), list)
    ):
        return False
    reviewer_entries = identity_register["reviewers"]
    seen_logins: set[str] = set()
    seen_user_ids: set[int] = set()
    for entry in reviewer_entries:
        if not isinstance(entry, dict):
            return False
        if set(entry) != {
            "github_login",
            "github_user_id",
            "verified_affiliation",
            "authority_id",
            "authority_basis",
            "verified_at",
            "roles",
        }:
            return False
        entry_login = entry.get("github_login")
        entry_user_id = entry.get("github_user_id")
        roles = entry.get("roles")
        if (
            not isinstance(entry_login, str)
            or not re.fullmatch(r"[A-Za-z0-9-]+", entry_login)
            or type(entry_user_id) is not int
            or entry_user_id < 1
            or not isinstance(roles, list)
            or not roles
            or any(not isinstance(item, str) or item not in ALLOWED_ROLES for item in roles)
            or len(roles) != len(set(roles))
            or entry_login.lower() in seen_logins
            or entry_user_id in seen_user_ids
            or not isinstance(entry.get("verified_affiliation"), str)
            or not isinstance(entry.get("authority_id"), str)
            or not isinstance(entry.get("authority_basis"), str)
            or len(entry["authority_basis"]) < 10
        ):
            return False
        try:
            if parse_timestamp(entry.get("verified_at")) > datetime.now().astimezone():
                return False
        except (TypeError, ValueError, AttributeError):
            return False
        seen_logins.add(entry_login.lower())
        seen_user_ids.add(entry_user_id)
    nominated = [
        entry for entry in reviewer_entries
        if isinstance(entry, dict)
        and entry.get("github_login", "").lower() == login.lower()
        and entry.get("github_user_id") == github_user_id
        and entry.get("authority_id") == authority_id
        and entry.get("authority_basis") == authority_basis
        and entry.get("verified_affiliation") == affiliation
        and role in entry.get("roles", [])
    ]
    if len(nominated) != 1:
        return False
    user = github_get_json(f"https://api.github.com/users/{login}", token)
    return (
        isinstance(user, dict)
        and type(user.get("id")) is int
        and user.get("id") == github_user_id
        and isinstance(user.get("login"), str)
        and user["login"].lower() == login.lower()
    )


def verified_github_review(record: dict[str, Any], reviewer: dict[str, Any], token: str | None) -> bool:
    review = record.get("github_review")
    if not isinstance(review, dict) or not token:
        return False
    repository = review.get("repository")
    pull_request_number = review.get("pull_request_number")
    review_id = review.get("review_id")
    commit_sha = review.get("commit_sha")
    if (
        repository != REPOSITORY
        or type(pull_request_number) is not int
        or pull_request_number < 1
        or type(review_id) is not int
        or review_id < 1
        or not isinstance(commit_sha, str)
        or not re.fullmatch(r"[0-9a-f]{40}", commit_sha)
    ):
        return False
    authors = record.get("implementation_author_logins")
    if (
        not isinstance(authors, list)
        or not authors
        or any(not isinstance(login, str) or not re.fullmatch(r"[A-Za-z0-9-]+", login) for login in authors)
    ):
        return False
    author_logins = {login.lower() for login in authors}
    reviewer_login = reviewer.get("github_login")
    if not isinstance(reviewer_login, str) or reviewer_login.lower() in author_logins:
        return False
    pull_url = f"https://api.github.com/repos/{repository}/pulls/{pull_request_number}"
    pull_request = github_get_json(pull_url, token)
    if not isinstance(pull_request, dict):
        return False
    pull_author = pull_request.get("user")
    base = pull_request.get("base")
    base_repository = base.get("repo") if isinstance(base, dict) else None
    if (
        not isinstance(pull_author, dict)
        or not isinstance(pull_author.get("login"), str)
        or pull_author["login"].lower() not in author_logins
        or not isinstance(base_repository, dict)
        or base_repository.get("full_name") != REPOSITORY
    ):
        return False
    commit_authors: set[str] = set()
    reviewed_commit_found = False
    for page in range(1, 11):
        commits = github_get_json(
            f"https://api.github.com/repos/{repository}/pulls/{pull_request_number}/commits?per_page=100&page={page}",
            token,
        )
        if not isinstance(commits, list):
            return False
        for commit in commits:
            if not isinstance(commit, dict):
                return False
            if commit.get("sha") == commit_sha:
                reviewed_commit_found = True
            for field in ("author", "committer"):
                identity = commit.get(field)
                if (
                    not isinstance(identity, dict)
                    or not isinstance(identity.get("login"), str)
                    or not re.fullmatch(r"[A-Za-z0-9-]+", identity["login"])
                ):
                    return False
                commit_authors.add(identity["login"].lower())
        if len(commits) < 100:
            break
    else:
        return False
    if not reviewed_commit_found or not commit_authors.issubset(author_logins):
        return False
    submitted = github_get_json(
        f"https://api.github.com/repos/{repository}/pulls/{pull_request_number}/reviews/{review_id}",
        token,
    )
    if not isinstance(submitted, dict):
        return False
    user = submitted.get("user")
    artifact = record.get("artifact")
    required_state = required_github_review_state(record.get("decision", ""))
    return (
        type(submitted.get("id")) is int
        and submitted.get("id") == review_id
        and submitted.get("state") == required_state
        and isinstance(user, dict)
        and type(user.get("id")) is int
        and type(reviewer.get("github_user_id")) is int
        and user.get("id") == reviewer.get("github_user_id")
        and isinstance(user.get("login"), str)
        and user["login"].lower() == str(reviewer.get("github_login", "")).lower()
        and submitted.get("commit_id") == commit_sha
        and isinstance(artifact, dict)
        and artifact.get("commit_sha") == commit_sha
    )


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validate_record(
    record: dict[str, Any],
    root: Path,
    now: datetime,
    errors: list[str],
    github_token: str | None,
) -> None:
    record_id = record.get("record_id", "<missing>")
    prefix = f"{record_id}: "
    require(not (set(record) - RECORD_FIELDS), prefix + "record contains unsupported fields", errors)
    role = record.get("role")
    decision = record.get("decision")
    status = record.get("status")

    require(
        isinstance(record_id, str) and re.fullmatch(r"[A-Z]+-[0-9]{4,}", record_id),
        prefix + "missing or invalid record_id",
        errors,
    )
    require(isinstance(role, str) and role in ALLOWED_ROLES, prefix + "invalid or missing role", errors)
    require(isinstance(decision, str) and decision in ALLOWED_DECISIONS, prefix + "invalid or missing decision", errors)
    require(isinstance(status, str) and status in {"CURRENT", "SUPERSEDED", "REVOKED", "EXPIRED"}, prefix + "invalid status", errors)

    reviewer = record.get("reviewer")
    require(isinstance(reviewer, dict), prefix + "missing reviewer", errors)
    if isinstance(reviewer, dict):
        require(not (set(reviewer) - REVIEWER_FIELDS), prefix + "reviewer contains unsupported fields", errors)
        identity = reviewer.get("identity")
        authority_basis = reviewer.get("authority_basis")
        login = reviewer.get("github_login")
        affiliation = reviewer.get("verified_affiliation")
        authority_id = reviewer.get("authority_id")
        require(isinstance(identity, str) and len(identity) >= 3, prefix + "reviewer identity is not verified", errors)
        require(
            isinstance(login, str) and re.fullmatch(r"[A-Za-z0-9-]+", login),
            prefix + "reviewer GitHub login is invalid",
            errors,
        )
        require(
            type(reviewer.get("github_user_id")) is int and reviewer["github_user_id"] > 0,
            prefix + "reviewer immutable GitHub user ID is invalid",
            errors,
        )
        require(isinstance(affiliation, str) and len(affiliation) >= 3, prefix + "reviewer affiliation is missing", errors)
        require(isinstance(authority_id, str) and len(authority_id) >= 3, prefix + "reviewer authority ID is missing", errors)
        require(isinstance(authority_basis, str) and len(authority_basis) >= 10, prefix + "reviewer authority is not recorded", errors)
        require(verified_github_reviewer(reviewer, github_token, role if isinstance(role, str) else None), prefix + "reviewer identity/authority is not verified with GitHub for this role", errors)
        require(verified_github_review(record, reviewer, github_token), prefix + "actual GitHub review is missing or mismatched", errors)
        try:
            parse_timestamp(reviewer["verified_at"])
        except (KeyError, TypeError, ValueError, AttributeError):
            errors.append(prefix + "reviewer verification timestamp is missing or invalid")
        else:
            require(
                parse_timestamp(reviewer["verified_at"]) <= now,
                prefix + "reviewer verification timestamp is in the future",
                errors,
            )

    try:
        reviewed_at = parse_timestamp(record["timestamp"])
        require(reviewed_at <= now, prefix + "decision timestamp is in the future", errors)
    except (KeyError, TypeError, ValueError, AttributeError):
        errors.append(prefix + "decision timestamp is missing or invalid")

    scope = record.get("scope")
    rationale = record.get("rationale")
    evidence = record.get("evidence")
    require(isinstance(scope, str) and len(scope) >= 10, prefix + "scope is missing", errors)
    require(isinstance(rationale, str) and len(rationale) >= 20, prefix + "rationale is missing", errors)
    require(
        isinstance(evidence, list)
        and len(evidence) >= 1
        and all(isinstance(item, str) and len(item) >= 3 for item in evidence),
        prefix + "evidence is missing or invalid",
        errors,
    )
    for field in ("conflicts", "conditions", "limitations"):
        value = record.get(field)
        require(
            isinstance(value, list) and all(isinstance(item, str) for item in value),
            prefix + f"{field} must be a string array",
            errors,
        )
    implementation_authors = record.get("implementation_author_logins")
    require(
        isinstance(implementation_authors, list)
        and len(implementation_authors) >= 1
        and all(
            isinstance(login, str) and re.fullmatch(r"[A-Za-z0-9-]+", login)
            for login in implementation_authors
        ),
        prefix + "implementation author identities are missing or invalid",
        errors,
    )

    artifact = record.get("artifact")
    require(isinstance(artifact, dict), prefix + "missing artifact", errors)
    if isinstance(artifact, dict):
        require(
            set(artifact) == {"commit_sha", "files"},
            prefix + "artifact fields do not match the approval schema",
            errors,
        )
        commit_sha = artifact.get("commit_sha")
        valid_commit_sha = isinstance(commit_sha, str) and re.fullmatch(r"[0-9a-f]{40}", commit_sha)
        commit_exists = False
        require(valid_commit_sha, prefix + "exact commit SHA is missing or invalid", errors)
        if valid_commit_sha:
            try:
                subprocess.run(
                    ["git", "-C", str(root), "cat-file", "-e", commit_sha + "^{commit}"],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.CalledProcessError):
                errors.append(prefix + "reviewed commit SHA does not exist in the repository")
            else:
                commit_exists = True
        files = artifact.get("files")
        require(isinstance(files, list) and len(files) >= 1, prefix + "reviewed files are missing", errors)
        if isinstance(files, list):
            seen_paths: set[str] = set()
            for item in files:
                if not isinstance(item, dict):
                    errors.append(prefix + "reviewed file entry is invalid")
                    continue
                require(
                    set(item) == {"path", "sha256"},
                    prefix + "reviewed file fields do not match the approval schema",
                    errors,
                )
                path_text = item.get("path")
                expected = item.get("sha256")
                require(isinstance(path_text, str) and len(path_text) > 0, prefix + "reviewed file path is missing", errors)
                require(
                    isinstance(expected, str) and re.fullmatch(r"[0-9a-f]{64}", expected),
                    prefix + "reviewed file digest is missing or invalid",
                    errors,
                )
                if not isinstance(path_text, str) or not isinstance(expected, str):
                    continue
                require(path_text not in seen_paths, prefix + f"duplicate reviewed file path: {path_text}", errors)
                seen_paths.add(path_text)
                path = safe_artifact_path(root, path_text)
                if path is None:
                    errors.append(prefix + f"reviewed file path is unsafe: {path_text}")
                    continue
                require(path.is_file(), prefix + f"reviewed file does not exist: {path_text}", errors)
                if path.is_file():
                    require(sha256(path) == expected, prefix + f"artifact changed since approval: {path_text}", errors)
                if commit_exists:
                    commit_digest = sha256_at_commit(root, commit_sha, path_text)
                    require(
                        commit_digest == expected,
                        prefix + f"artifact digest does not match reviewed commit: {path_text}",
                        errors,
                    )

    github_review = record.get("github_review")
    require(isinstance(github_review, dict), prefix + "missing GitHub review reference", errors)
    if isinstance(github_review, dict):
        require(
            set(github_review) == {"repository", "pull_request_number", "review_id", "commit_sha"},
            prefix + "GitHub review fields do not match the approval schema",
            errors,
        )

    expires_at = record.get("expires_at")
    if expires_at is not None:
        try:
            if parse_timestamp(expires_at) <= now:
                require(status in {"EXPIRED", "SUPERSEDED", "REVOKED"}, prefix + "expired approval is not marked expired", errors)
        except (TypeError, ValueError, AttributeError):
            errors.append(prefix + "expires_at is invalid")

    if status == "REVOKED":
        try:
            parse_timestamp(record.get("revoked_at"))
        except (TypeError, ValueError, AttributeError):
            errors.append(prefix + "revocation timestamp is missing or invalid")
        reason = record.get("revocation_reason")
        require(isinstance(reason, str) and len(reason) >= 10, prefix + "revocation reason is missing", errors)
    elif "revoked_at" in record or "revocation_reason" in record:
        errors.append(prefix + "revocation fields are only valid for a revoked record")
    if status == "SUPERSEDED":
        superseded_by = record.get("superseded_by")
        require(
            isinstance(superseded_by, str) and re.fullmatch(r"[A-Z]+-[0-9]{4,}", superseded_by),
            prefix + "superseded_by is missing or invalid",
            errors,
        )
    elif "superseded_by" in record:
        errors.append(prefix + "superseded_by is only valid for a superseded record")
    if "supersedes" in record:
        supersedes = record.get("supersedes")
        require(
            isinstance(supersedes, str) and re.fullmatch(r"[A-Z]+-[0-9]{4,}", supersedes),
            prefix + "supersedes is invalid",
            errors,
        )
    if isinstance(decision, str) and decision in {"REJECTED", "NEEDS_CHANGES"}:
        require(status in {"CURRENT", "SUPERSEDED", "REVOKED"}, prefix + "non-approval status is invalid", errors)
    if status == "EXPIRED":
        if expires_at is None:
            errors.append(prefix + "expired record has no expires_at timestamp")
        else:
            try:
                require(parse_timestamp(expires_at) <= now, prefix + "expired status is premature", errors)
            except (TypeError, ValueError, AttributeError):
                pass


def validate_supersession_links(records: list[Any], errors: list[str]) -> None:
    by_id: dict[str, dict[str, Any]] = {}
    duplicate_ids: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        record_id = record.get("record_id")
        if not isinstance(record_id, str):
            continue
        if record_id in by_id:
            duplicate_ids.add(record_id)
        else:
            by_id[record_id] = record
    for record_id in sorted(duplicate_ids):
        errors.append(f"duplicate approval record_id: {record_id}")

    for record_id, record in by_id.items():
        if record_id in duplicate_ids:
            continue
        previous_id = record.get("supersedes")
        if isinstance(previous_id, str):
            previous = by_id.get(previous_id)
            require(
                previous_id not in duplicate_ids
                and previous is not None
                and previous.get("status") == "SUPERSEDED"
                and previous.get("superseded_by") == record_id,
                f"{record_id}: supersedes link does not match a superseded record",
                errors,
            )
        if record.get("status") == "SUPERSEDED":
            successor_id = record.get("superseded_by")
            successor = by_id.get(successor_id) if isinstance(successor_id, str) else None
            require(
                isinstance(successor_id, str)
                and successor_id not in duplicate_ids
                and successor is not None
                and successor.get("supersedes") == record_id,
                f"{record_id}: superseded_by link does not match a successor record",
                errors,
            )


def relevant_artifacts_unchanged(record: dict[str, Any], root: Path, target_commit: str) -> tuple[bool, list[str]]:
    artifact = record.get("artifact")
    if not isinstance(artifact, dict):
        return False, ["artifact is missing"]
    reviewed_commit = artifact.get("commit_sha")
    files = artifact.get("files")
    if not isinstance(reviewed_commit, str) or not isinstance(files, list):
        return False, ["artifact commit or file list is missing"]
    if target_commit == reviewed_commit:
        return True, []

    relevant_paths = []
    for item in files:
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            relevant_paths.append(item["path"])
    if not relevant_paths:
        return False, ["no relevant artifacts were listed"]

    try:
        diff = subprocess.run(
            ["git", "-C", str(root), "diff", "--name-only", reviewed_commit, target_commit, "--", *relevant_paths],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return False, ["could not compare reviewed and target commits"]
    if diff.returncode != 0:
        return False, ["could not compare reviewed and target commits"]
    if diff.stdout.strip():
        return False, [f"relevant artifact changed: {line}" for line in diff.stdout.splitlines() if line]
    return True, []


def authorize_stage(
    register: dict[str, Any],
    root: Path,
    stage: str,
    commit: str,
    author_login: str,
    now: datetime,
    github_token: str | None,
) -> tuple[bool, list[str]]:
    errors: list[str] = []
    if stage not in STAGE_REQUIREMENTS:
        return False, [f"unknown protected stage: {stage}"]
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        return False, ["target commit SHA is invalid"]
    if not isinstance(author_login, str) or not re.fullmatch(r"[A-Za-z0-9-]+", author_login):
        return False, ["implementation author login is invalid"]
    if not isinstance(register, dict):
        return False, ["approval register must be an object"]
    records = register.get("records")
    if not isinstance(records, list):
        return False, ["approval records must be an array"]
    validate_supersession_links(records, errors)

    approved_reviewers: dict[str, set[int]] = {}
    author_login_normalized = author_login.lower()
    for record in records:
        if not isinstance(record, dict):
            continue
        record_errors: list[str] = []
        validate_record(record, root, now, record_errors, github_token)
        if record_errors:
            errors.extend(record_errors)
            continue
        expires_at = record.get("expires_at")
        if expires_at is not None:
            try:
                if parse_timestamp(expires_at) <= now:
                    continue
            except (TypeError, ValueError, AttributeError):
                continue

        reviewer = record.get("reviewer")
        if not isinstance(reviewer, dict):
            continue
        implementation_authors = record.get("implementation_author_logins", [])
        if any(
            isinstance(login, str) and login.lower() == author_login_normalized
            for login in implementation_authors
        ):
            continue
        reviewer_login = reviewer.get("github_login")
        if not isinstance(reviewer_login, str) or reviewer_login.lower() == author_login_normalized:
            continue

        if record.get("decision") != "APPROVED" or record.get("status") != "CURRENT":
            continue
        unchanged, _ = relevant_artifacts_unchanged(record, root, commit)
        role = record.get("role")
        reviewer_id = reviewer.get("github_user_id")
        if (
            unchanged
            and role in STAGE_REQUIREMENTS[stage]
            and type(reviewer_id) is int
        ):
            approved_reviewers.setdefault(role, set()).add(reviewer_id)

    required_roles = STAGE_REQUIREMENTS[stage]
    assigned: dict[int, str] = {}

    def assign_reviewer(role: str, seen: set[int]) -> bool:
        for reviewer_id in sorted(approved_reviewers.get(role, set())):
            if reviewer_id in seen:
                continue
            seen.add(reviewer_id)
            assigned_role = assigned.get(reviewer_id)
            if assigned_role is None or assign_reviewer(assigned_role, seen):
                assigned[reviewer_id] = role
                return True
        return False

    missing = {
        role
        for role in sorted(required_roles, key=lambda item: len(approved_reviewers.get(item, set())))
        if not assign_reviewer(role, set())
    }
    if missing:
        errors.append(
            "missing valid approvals from distinct role-authorized reviewers: "
            + ", ".join(sorted(missing))
        )
    return not errors, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--register", default=".github/approval/records.json")
    parser.add_argument("--stage", choices=sorted(STAGE_REQUIREMENTS))
    parser.add_argument("--commit")
    parser.add_argument("--author-login")
    args = parser.parse_args()
    root = Path.cwd()
    register_path = root / args.register
    errors: list[str] = []
    github_token = os.environ.get("GITHUB_TOKEN")

    try:
        register = load_json(register_path)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"NOT PASSED: unable to read approval register: {error}")
        return 2

    if not isinstance(register, dict):
        print("NOT PASSED: approval register must be a JSON object")
        return 2
    require(
        set(register) == {"format", "records"},
        "approval register fields do not match the register format",
        errors,
    )
    require(register.get("format") == "parmar-specialist-approval-register-v1", "approval register format is invalid", errors)
    records = register.get("records")
    require(isinstance(records, list), "approval records must be an array", errors)
    if not isinstance(records, list):
        return 2

    now = datetime.now().astimezone()
    for record in records:
        if not isinstance(record, dict):
            errors.append("approval record is not an object")
            continue
        validate_record(record, root, now, errors, github_token)

    if not args.stage:
        validate_supersession_links(records, errors)

    if args.stage:
        if not args.commit or not args.author_login:
            print("NOT PASSED: --commit and --author-login are required for stage authorization")
            return 2
        commit_probe = subprocess.run(
            ["git", "-C", str(root), "cat-file", "-e", args.commit + "^{commit}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if commit_probe.returncode != 0:
            print("NOT PASSED: target commit does not exist")
            return 1
        allowed, stage_errors = authorize_stage(
            register,
            root,
            args.stage,
            args.commit,
            args.author_login,
            now,
            github_token,
        )
        if not allowed or errors:
            print("NOT PASSED")
            for error in errors + stage_errors:
                print(f"- {error}")
            return 1
        print(f"PASSED: stage {args.stage} is authorized for commit {args.commit}")
        return 0

    if errors:
        print("NOT PASSED")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"PASSED: validated {len(records)} formal specialist approval records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
