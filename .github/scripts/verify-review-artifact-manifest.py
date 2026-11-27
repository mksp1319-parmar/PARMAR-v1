#!/usr/bin/env python3
"""Verify every review-manifest path and digest, including required package coverage."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path.cwd()
MANIFEST = ROOT / ".github/approval/review-artifact-manifest.json"
REQUIRED = (
    ".github/approval/GITHUB-GOVERNANCE-ACTIVATION-PACKAGE.md",
    ".github/approval/SPECIALIST-ONBOARDING.md",
    ".github/approval/ACTION-REGISTER.md",
    ".github/approval/reviewer-identity-register.json",
    ".github/approval/reviewer-identity-register.schema.json",
    ".github/approval/approval-record.schema.json",
    ".github/approval/specialist-handoff-artifacts.json",
    "PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md",
)
POLICY_FRAMEWORK = "PARMAR/ACCOUNT-BINDING-PRODUCT-OWNER-DECISION-FRAMEWORK.md"
ROLE_FILES = {
    "Security": ("security", "security-invitation"),
    "Data Model": ("data-model", "data-model-invitation"),
    "Operations": ("operations", "operations-invitation"),
    "Privacy/Legal": ("privacy-legal", "privacy-legal-invitation"),
    "Provider Compatibility": ("provider-compatibility", "provider-compatibility-invitation"),
    "Release Authority": ("release-authority", "release-authority-invitation"),
}
SCOPE_HEADINGS = {
    "Security": "## Required artifacts",
    "Data Model": "## Exact artifacts",
    "Operations": "## Exact artifacts",
    "Privacy/Legal": "## Exact artifacts",
    "Provider Compatibility": "## Exact artifacts",
    "Release Authority": "## Exact artifact baseline",
}
HANDOFF_DIGESTS = ROOT / ".github/approval/specialist-handoff-artifacts.json"
REPOSITORY_ROOT = ROOT.resolve()


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
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fail(errors: list[str], path_text: Any, reason: str) -> None:
    errors.append(f"{reason}: {path_text}")


def repository_file(path_text: Any) -> Path | None:
    if not isinstance(path_text, str) or not path_text or "\\" in path_text or "\0" in path_text:
        return None
    path = Path(path_text)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        return None
    candidate = ROOT
    for part in path.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            return None
    resolved = candidate.resolve()
    if resolved == REPOSITORY_ROOT or REPOSITORY_ROOT not in resolved.parents:
        return None
    return resolved


def verify_digest(path_text: Any, expected: Any, errors: list[str], source: str) -> bool:
    path = repository_file(path_text)
    if path is None:
        fail(errors, path_text, f"{source} path is unsafe")
        return False
    if not path.is_file():
        fail(errors, path_text, f"{source} file is missing")
        return False
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        fail(errors, path_text, f"{source} digest is invalid")
        return False
    if sha256(path) != expected:
        fail(errors, path_text, f"{source} digest is stale")
        return False
    return True


def verify_handoff_digests(manifest: dict[str, Any], errors: list[str]) -> int:
    try:
        handoffs = load_json(HANDOFF_DIGESTS)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"cannot read specialist handoff digest index: {error}")
        return 0
    if not isinstance(handoffs, dict):
        errors.append("specialist handoff digest index must be an object")
        return 0
    if (
        handoffs.get("format") != "parmar-specialist-handoff-artifact-digests-v1"
        or handoffs.get("repository") != "mksp1319-parmar/PARMAR-v1"
        or handoffs.get("snapshot_type") != "uncommitted-worktree-candidate"
        or handoffs.get("approval_status") != "none"
        or not isinstance(handoffs.get("snapshot_head"), str)
        or not re.fullmatch(r"[0-9a-f]{40}", handoffs["snapshot_head"])
    ):
        errors.append("specialist handoff digest index metadata is invalid")
        return 0
    head = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if head.returncode != 0 or head.stdout.strip() != handoffs["snapshot_head"]:
        errors.append("specialist handoff digest index is bound to a different HEAD")

    roles = handoffs.get("roles")
    if not isinstance(roles, dict) or set(roles) != set(ROLE_FILES):
        errors.append("specialist handoff digest index does not contain exactly the six roles")
        return 0

    verified = 0
    for role, (package_stem, invitation_stem) in ROLE_FILES.items():
        entry = roles.get(role)
        if not isinstance(entry, dict) or set(entry) != {"package", "invitation", "artifacts"}:
            errors.append(f"{role}: digest entry has an invalid shape")
            continue
        expected_package = f".github/approval/review-packages/{package_stem}.md"
        expected_invitation = f".github/approval/review-packages/{invitation_stem}.md"
        for field, expected_path in (("package", expected_package), ("invitation", expected_invitation)):
            item = entry.get(field)
            if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
                errors.append(f"{role}: {field} digest entry is invalid")
                continue
            if item.get("path") != expected_path:
                errors.append(f"{role}: {field} path does not match the role")
            if verify_digest(item.get("path"), item.get("sha256"), errors, role):
                verified += 1
            item_path = item.get("path")
            if isinstance(item_path, str) and manifest.get(item_path) != item.get("sha256"):
                errors.append(f"{role}: {field} digest is absent or mismatched in the artifact manifest")

        artifacts = entry.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            errors.append(f"{role}: reviewed artifact digest list is missing")
            continue
        seen_paths: set[str] = set()
        for item in artifacts:
            if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
                errors.append(f"{role}: reviewed artifact digest entry is invalid")
                continue
            path_text = item.get("path")
            digest = item.get("sha256")
            if not isinstance(path_text, str):
                errors.append(f"{role}: reviewed artifact path is invalid")
                continue
            if path_text in seen_paths:
                errors.append(f"{role}: duplicate reviewed artifact path: {path_text}")
                continue
            seen_paths.add(path_text)
            if verify_digest(path_text, digest, errors, role):
                verified += 1
            if manifest.get(path_text) != digest:
                errors.append(f"{role}: artifact digest is absent or mismatched in the artifact manifest: {path_text}")

        package_path = ROOT / f".github/approval/review-packages/{package_stem}.md"
        package_text = package_path.read_text(encoding="utf-8") if package_path.is_file() else ""
        invitation_path = ROOT / f".github/approval/review-packages/{invitation_stem}.md"
        invitation_text = invitation_path.read_text(encoding="utf-8") if invitation_path.is_file() else ""
        if "specialist-handoff-artifacts.json" not in package_text or role not in package_text:
            errors.append(f"{role}: package is not bound to its digest-index role")
        if "specialist-handoff-artifacts.json" not in invitation_text or role not in invitation_text:
            errors.append(f"{role}: invitation is not bound to its digest-index role")
        heading = SCOPE_HEADINGS[role]
        if heading not in package_text:
            errors.append(f"{role}: package is missing its exact-artifact section")
        else:
            section = package_text.split(heading, 1)[1].split("\n## ", 1)[0]
            listed_paths = re.findall(r"^- `([^`]+)`$", section, flags=re.MULTILINE)
            indexed_paths = {
                item.get("path")
                for item in artifacts
                if isinstance(item, dict) and isinstance(item.get("path"), str)
            }
            if POLICY_FRAMEWORK not in indexed_paths:
                errors.append(f"{role}: decision framework missing from role digest scope")
            if len(listed_paths) != len(set(listed_paths)) or set(listed_paths) != indexed_paths:
                errors.append(f"{role}: package artifact list does not exactly match its digest entry")
    return verified


def main() -> int:
    try:
        manifest = load_json(MANIFEST)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"NOT PASSED: cannot read manifest: {error}")
        return 2
    if not isinstance(manifest, dict):
        print("NOT PASSED: manifest must be a JSON object")
        return 1

    errors = []
    duplicates = len(manifest) != len(set(manifest))
    if duplicates:
        errors.append("manifest contains duplicate paths")

    for path_text, digest in manifest.items():
        path = repository_file(path_text)
        if path is None:
            errors.append(f"unsafe manifest path: {path_text}")
            continue
        if not path.is_file():
            errors.append(f"missing: {path_text}")
            continue
        if path_text == ".github/approval/review-artifact-manifest.json":
            continue
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            errors.append(f"invalid digest: {path_text}")
            continue
        actual = sha256(path)
        if actual != digest:
            errors.append(f"stale digest: {path_text}")

    for path_text in REQUIRED:
        if path_text not in manifest:
            errors.append(f"required path omitted: {path_text}")

    packages = ROOT / ".github/approval/review-packages"
    if not packages.is_dir():
        errors.append("missing review-packages directory")
    else:
        expected_packages = {
            f"{stem}.md"
            for package, invitation in ROLE_FILES.values()
            for stem in (package, invitation)
        }
        actual_packages = {path.name for path in packages.glob("*.md")}
        for name in sorted(expected_packages - actual_packages):
            errors.append(f"missing review package: {name}")
        for name in sorted(expected_packages):
            path_text = f".github/approval/review-packages/{name}"
            if path_text not in manifest:
                errors.append(f"review package omitted from artifact manifest: {name}")

    verified_handoff_digests = verify_handoff_digests(manifest, errors)
    if errors:
        print("NOT PASSED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(
        f"PASSED: verified {len(manifest)} review manifest entries and "
        f"{verified_handoff_digests} role-bound handoff digests"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
