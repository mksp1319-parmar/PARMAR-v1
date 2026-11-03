#!/usr/bin/env python3
"""Create a private, versioned PARMAR worktree backup."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import gzip
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tarfile
import time
import unicodedata
import uuid
import zlib
from typing import BinaryIO


FORMAT_NAME = "parmar-worktree-backup"
FORMAT_VERSION = 1
ROOT = pathlib.Path(__file__).resolve().parents[1]
APPROVED_IGNORED_PATHS = frozenset({"PARMAR/audit/decision_log.jsonl"})
EXCLUDED_DIRECTORIES = frozenset(
    {
        ".git",
        ".cache",
        ".aws",
        ".env",
        ".gnupg",
        ".mypy_cache",
        ".nox",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
        ".venv",
        ".ssh",
        "__pycache__",
        "build",
        "coverage",
        "credentials",
        "dist",
        "env",
        "htmlcov",
        "logs",
        "node_modules",
        "out",
        "secrets",
        "site",
        "test-results",
        "temp",
        "tmp",
        "target",
        "venv",
    }
)
EXCLUDED_SUFFIXES = frozenset(
    {
        ".api",
        ".bak",
        ".cer",
        ".credentials",
        ".crt",
        ".db",
        ".der",
        ".jks",
        ".key",
        ".log",
        ".orig",
        ".p12",
        ".p8",
        ".password",
        ".passwd",
        ".pem",
        ".pfx",
        ".rej",
        ".secret",
        ".sqlite",
        ".sqlite3",
        ".swo",
        ".swp",
        ".temp",
        ".tmp",
        ".token",
    }
)
PRIVATE_KEY_RE = re.compile(
    rb"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----"
)
KNOWN_TOKEN_RE = re.compile(
    rb"(?:AKIA[0-9A-Z]{16}|"
    rb"ASIA[0-9A-Z]{16}|"
    rb"AIza[0-9A-Za-z_-]{35}|"
    rb"gh[pousr]_[A-Za-z0-9_]{30,}|"
    rb"github_pat_[A-Za-z0-9_]{30,}|"
    rb"glpat-[A-Za-z0-9_-]{20,}|"
    rb"npm_[A-Za-z0-9]{36}|"
    rb"xox[baprs]-[A-Za-z0-9-]{10,}|"
    rb"ya29\.[A-Za-z0-9._-]{30,})"
)
ASSIGNMENT_SECRET_RE = re.compile(
    rb"""(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|"""
    rb"""client[_-]?secret|password|passwd|secret(?:[_-]access[_-]?key)?|"""
    rb"""credentials?|token)\b"""
    rb"""\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{24,})"""
)
PLACEHOLDER_RE = re.compile(
    rb"(?i)^(?:example|sample|test|dummy|placeholder|changeme|redacted|"
    rb"none|undefined|<[^>]+>|\$\{[A-Za-z_][A-Za-z0-9_]*\}|"
    rb"process\.env\.[A-Za-z_][A-Za-z0-9_]*)$"
)
SECRET_WINDOW = 1024
CHUNK_SIZE = 1024 * 1024
MAX_ARCHIVE_BYTES = 20 * 1024**3
MAX_MEMBER_BYTES = 8 * 1024**3
MAX_TOTAL_MEMBER_BYTES = 40 * 1024**3
MAX_MANIFEST_BYTES = 16 * 1024**2
MAX_LEGACY_METADATA_BYTES = 4 * 1024**2
MAX_ARCHIVE_MEMBERS = 100_000
MAX_PATH_COMPONENT_BYTES = 255
MAX_ARCHIVE_PATH_BYTES = 4095
MAX_PAX_EXTENSION_BYTES = 64 * 1024
MAX_PAX_EXTENSION_RECORDS = 8
MAX_TOTAL_PAX_BYTES = 1024 * 1024
MAX_TOTAL_PAX_RECORDS = 4096
BACKUP_STEM_RE = re.compile(r"^PARMAR-v1-worktree-backup-\d{8}T\d{6}Z(?:-\d+)?$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SIDE_CAR_RE = re.compile(rb"^([0-9a-f]{64})  ([^\r\n]+)\n$")
MANIFEST_MEMBER = "metadata/manifest.json"
PATCH_MEMBERS = {
    "staged": "metadata/staged.patch",
    "unstaged": "metadata/unstaged.patch",
}
PAYLOAD_CATEGORIES = {
    "tracked",
    "modified",
    "untracked",
    "explicitly included ignored",
}
LEGACY_FIXED_FILES = {
    "README.txt",
    "tracked-changes.patch",
    "source-status.txt",
    "source-branch.txt",
    "source-head.txt",
    "untracked-files.txt",
    "preserved-ignored/README.txt",
}
LEGACY_AUDIT_MEMBER = "preserved-ignored/PARMAR/audit/decision_log.jsonl"


class BackupError(Exception):
    """A safety or consistency check prevented backup creation."""


def _git(root: pathlib.Path, *args: str) -> bytes:
    env = _git_environment()
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise BackupError(
            f"Git command failed ({result.returncode}): "
            f"{' '.join(args)}{': ' + detail if detail else ''}"
        )
    return result.stdout


def _git_environment() -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_LITERAL_PATHSPECS": "1",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.fsmonitor",
            "GIT_CONFIG_VALUE_0": "false",
        }
    )
    return env


def _repo_relative_path(path: bytes) -> tuple[str, tuple[bytes, ...]]:
    if not path or path.startswith(b"/") or b"\0" in path or b"\\" in path:
        raise BackupError("Git returned an unsafe or empty source path")
    parts = tuple(path.split(b"/"))
    if any(part in (b"", b".", b"..") for part in parts):
        raise BackupError(f"Git returned a traversal path: {path!r}")
    if b".git" in parts:
        raise BackupError("Refusing to include .git internals")
    try:
        display_path = path.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise BackupError(
            "Refusing a source path that is not valid UTF-8; "
            "its archive representation is uncertain"
        ) from error
    return display_path, parts


def _excluded_reason(display_path: str) -> str | None:
    path = pathlib.PurePosixPath(display_path)
    parts = tuple(part.lower() for part in path.parts)
    if any(part in EXCLUDED_DIRECTORIES for part in parts):
        return "disposable cache, dependency, or build-output directory"

    name = path.name.lower()
    if name == ".env" or name.startswith(".env.") or name.endswith(".env"):
        return "environment file may contain credentials"
    if (
        name == "secrets"
        or name.startswith("secrets.")
        or name in {"credential", "credentials", "credentials.json", "secret.json"}
        or name.startswith(("client_secret.", "credentials."))
    ):
        return "secret-related filename"
    if name.startswith("api_keys") or name.startswith("api-keys"):
        return "API-key-related filename"
    if name.endswith(tuple(EXCLUDED_SUFFIXES)):
        return "credential, local-data, log, or temporary-file extension"
    if name in {".ds_store", "thumbs.db"}:
        return "operating-system metadata file"
    return None


def _check_path_permissions(mode: int, display_path: str) -> int:
    if mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        raise BackupError(f"Privileged permission bits are not allowed: {display_path}")
    return stat.S_IMODE(mode)


def _open_source_file(
    root_fd: int, parts: tuple[bytes, ...], display_path: str
) -> tuple[int, os.stat_result]:
    _require_secure_open_flags()
    directory_fd = os.dup(root_fd)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    directory_flags = flags | getattr(os, "O_DIRECTORY", 0) | getattr(
        os, "O_NOFOLLOW", 0
    )
    try:
        for component in parts[:-1]:
            next_fd = os.open(component, directory_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
            _check_path_permissions(
                os.fstat(directory_fd).st_mode, display_path
            )
        path_stat = os.stat(
            parts[-1], dir_fd=directory_fd, follow_symlinks=False
        )
        if not stat.S_ISREG(path_stat.st_mode):
            raise BackupError(f"Unsupported non-regular source file: {display_path}")
        _check_path_permissions(path_stat.st_mode, display_path)
        file_flags = flags | getattr(os, "O_NOFOLLOW", 0)
        file_fd = os.open(parts[-1], file_flags, dir_fd=directory_fd)
    except FileNotFoundError:
        raise
    except OSError as error:
        raise BackupError(f"Cannot safely open source file {display_path}: {error}") from error
    finally:
        os.close(directory_fd)

    source_stat = os.fstat(file_fd)
    if (
        not stat.S_ISREG(source_stat.st_mode)
        or (source_stat.st_dev, source_stat.st_ino)
        != (path_stat.st_dev, path_stat.st_ino)
    ):
        os.close(file_fd)
        raise BackupError(f"Source file changed during safe open: {display_path}")
    try:
        _check_path_permissions(source_stat.st_mode, display_path)
    except BackupError:
        os.close(file_fd)
        raise
    return file_fd, source_stat


def _require_secure_open_flags() -> None:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise BackupError(
            "This platform lacks the no-follow directory-open flags required "
            "for safe backup creation"
        )


def _scan_chunk(data: bytes, display_path: str) -> None:
    if PRIVATE_KEY_RE.search(data) or KNOWN_TOKEN_RE.search(data):
        raise BackupError(
            f"Potential private key or credential detected in {display_path}; "
            "no backup was published"
        )
    for match in ASSIGNMENT_SECRET_RE.finditer(data):
        value = match.group(1)
        if not PLACEHOLDER_RE.search(value):
            raise BackupError(
                f"Potential credential assignment detected in {display_path}; "
                "no backup was published"
            )


def _hash_source_file(
    root_fd: int, parts: tuple[bytes, ...], display_path: str
) -> tuple[int, str, int]:
    file_fd, before = _open_source_file(root_fd, parts, display_path)
    digest = hashlib.sha256()
    size = 0
    carry = b""
    try:
        with os.fdopen(file_fd, "rb") as source:
            while True:
                chunk = source.read(CHUNK_SIZE)
                if not chunk:
                    break
                digest.update(chunk)
                size += len(chunk)
                scan_data = carry + chunk
                _scan_chunk(scan_data, display_path)
                carry = scan_data[-SECRET_WINDOW:]
            _scan_chunk(carry, display_path)
            after = os.fstat(source.fileno())
    except OSError as error:
        raise BackupError(f"Cannot read source file {display_path}: {error}") from error
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise BackupError(f"Source file changed while being inspected: {display_path}")
    return size, digest.hexdigest(), _check_path_permissions(
        before.st_mode, display_path
    )


class _VerifiedReader:
    def __init__(self, source: BinaryIO, expected_size: int, expected_hash: str):
        self.source = source
        self.expected_size = expected_size
        self.expected_hash = expected_hash
        self.digest = hashlib.sha256()
        self.size = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self.source.read(size)
        self.digest.update(chunk)
        self.size += len(chunk)
        return chunk

    def verify(self) -> None:
        if self.size != self.expected_size or self.digest.hexdigest() != self.expected_hash:
            raise BackupError("Source contents changed while the archive was written")


def _porcelain_metadata(root: pathlib.Path) -> tuple[bytes, bytes, bytes, set[bytes], set[bytes]]:
    head = _git(root, "rev-parse", "--verify", "HEAD").strip()
    branch = _git(root, "branch", "--show-current").rstrip(b"\n")
    status = _git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    staged = _git(
        root, "diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD", "--"
    )
    unstaged = _git(root, "diff", "--name-only", "-z", "--no-renames", "--")
    staged_paths = {path for path in staged.split(b"\0") if path}
    unstaged_paths = {path for path in unstaged.split(b"\0") if path}
    return head, branch, status, staged_paths, unstaged_paths


def _tracked_paths(root: pathlib.Path) -> tuple[list[bytes], dict[bytes, int]]:
    records = _git(root, "ls-files", "--stage", "-z").split(b"\0")
    paths: list[bytes] = []
    modes: dict[bytes, int] = {}
    for record in records:
        if not record:
            continue
        try:
            metadata, path = record.split(b"\t", 1)
            mode_text, _object_id, stage_text = metadata.split(b" ", 2)
            mode = int(mode_text, 8)
            stage = int(stage_text)
        except (ValueError, TypeError) as error:
            raise BackupError("Cannot parse Git index entries safely") from error
        if stage != 0:
            raise BackupError("Unmerged Git index entries are not supported")
        if mode == 0o160000:
            raise BackupError(f"Git submodules are not supported: {path!r}")
        if mode == 0o120000:
            raise BackupError(f"Tracked symlinks are not supported: {path!r}")
        if mode not in (0o100644, 0o100755):
            raise BackupError(f"Unsupported tracked Git file mode: {mode:o}")
        paths.append(path)
        modes[path] = mode
    return paths, modes


def _ignored_paths(root: pathlib.Path) -> list[bytes]:
    result = _git(
        root,
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
    )
    return [path.rstrip(b"/") for path in result.split(b"\0") if path]


def _deleted_tracked_paths(root: pathlib.Path) -> list[str]:
    unstaged = _git(root, "ls-files", "--deleted", "-z")
    staged = _git(
        root,
        "diff",
        "--cached",
        "--diff-filter=D",
        "--name-only",
        "-z",
        "HEAD",
        "--",
    )
    paths = {path for path in unstaged.split(b"\0") if path}
    paths.update(path for path in staged.split(b"\0") if path)
    return sorted(_repo_relative_path(path)[0] for path in paths)


def _validate_ignored_selection(root: pathlib.Path, selected: str | None) -> bytes | None:
    if selected is None:
        return None
    if selected not in APPROVED_IGNORED_PATHS:
        raise BackupError(f"Ignored path is not on the explicit allowlist: {selected}")
    path_bytes = selected.encode("utf-8")
    _repo_relative_path(path_bytes)
    if path_bytes in _tracked_paths(root)[0]:
        raise BackupError(f"Allowlisted path is tracked, not ignored: {selected}")
    check = subprocess.run(
        ["git", "check-ignore", "--quiet", "--no-index", "--", selected],
        cwd=root,
        env=_git_environment(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check.returncode == 1:
        raise BackupError(f"Allowlisted path is not ignored: {selected}")
    if check.returncode != 0:
        detail = check.stderr.decode("utf-8", "replace").strip()
        raise BackupError(f"Cannot validate ignored path {selected}: {detail}")
    return path_bytes


def _create_temp_file(
    backup_dir: pathlib.Path, label: str
) -> tuple[pathlib.Path, int, tuple[int, int]]:
    _require_secure_open_flags()
    path = backup_dir / f".{label}-{uuid.uuid4().hex}.tmp"
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    info = os.fstat(fd)
    try:
        os.fchmod(fd, 0o600)
        info = os.fstat(fd)
        if stat.S_IMODE(info.st_mode) != 0o600:
            raise BackupError(f"Could not enforce private file permissions: {path}")
    except BaseException:
        os.close(fd)
        try:
            path_info = path.lstat()
            if (path_info.st_dev, path_info.st_ino) == (info.st_dev, info.st_ino):
                path.unlink()
        except FileNotFoundError:
            pass
        except OSError as cleanup_error:
            raise BackupError(
                f"Temporary file cleanup failed for {path}: {cleanup_error}"
            ) from cleanup_error
        raise
    return path, fd, (info.st_dev, info.st_ino)


def _capture_patch(
    root: pathlib.Path,
    backup_dir: pathlib.Path,
    label: str,
    args: tuple[str, ...],
    display_name: str,
    created_paths: list[tuple[pathlib.Path, tuple[int, int]]],
) -> tuple[pathlib.Path, int, str, tuple[int, int]]:
    path, fd, identity = _create_temp_file(backup_dir, label)
    created_paths.append((path, identity))
    digest = hashlib.sha256()
    size = 0
    with os.fdopen(fd, "w+b") as target:
        process = subprocess.run(
            ["git", *args],
            cwd=root,
            env=_git_environment(),
            stdout=target,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode:
            detail = process.stderr.decode("utf-8", "replace").strip()
            raise BackupError(
                f"Git patch creation failed ({process.returncode}): "
                f"{detail or display_name}"
            )
        target.flush()
        os.fsync(target.fileno())
        target.seek(0)
        carry = b""
        while True:
            chunk = target.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            scan_data = carry + chunk
            _scan_chunk(scan_data, display_name)
            carry = scan_data[-SECRET_WINDOW:]
        _scan_chunk(carry, display_name)
    return path, size, digest.hexdigest(), identity


def _write_tar_bytes(archive: tarfile.TarFile, name: str, data: bytes, mode: int = 0o600) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.mtime = int(time.time())
    archive.addfile(info, io.BytesIO(data))


def _write_tar_directory(archive: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name.rstrip("/") + "/")
    info.type = tarfile.DIRTYPE
    info.size = 0
    info.mode = 0o700
    info.mtime = int(time.time())
    archive.addfile(info)


def _cleanup_created(
    paths: list[tuple[pathlib.Path, tuple[int, int]]],
    directory: tuple[pathlib.Path, tuple[int, int]] | None,
) -> list[str]:
    errors: list[str] = []
    for path, identity in reversed(paths):
        try:
            info = path.lstat()
            if (info.st_dev, info.st_ino) == identity:
                path.unlink()
        except FileNotFoundError:
            pass
        except OSError as error:
            errors.append(f"{path}: {error}")
    if directory is not None:
        path, identity = directory
        try:
            info = path.lstat()
            if (info.st_dev, info.st_ino) == identity:
                path.rmdir()
        except FileNotFoundError:
            pass
        except OSError as error:
            errors.append(f"{path}: {error}")
    return errors


def _inside(path: pathlib.Path, parent: pathlib.Path) -> bool:
    try:
        return os.path.commonpath((str(path), str(parent))) == str(parent)
    except ValueError:
        return False


def create_backup(output_dir: pathlib.Path, include_ignored: str | None) -> pathlib.Path:
    root = ROOT.resolve(strict=True)
    output_lstat = output_dir.lstat()
    if not stat.S_ISDIR(output_lstat.st_mode) or stat.S_ISLNK(output_lstat.st_mode):
        raise BackupError("--output-dir must be an existing, non-symlink directory")
    output_dir = output_dir.resolve(strict=True)
    if _inside(output_dir, root):
        raise BackupError("Backup output directory must be outside the repository")

    ignored_selection = _validate_ignored_selection(root, include_ignored)
    head, branch, status, staged_changed, unstaged_changed = _porcelain_metadata(root)
    tracked, index_modes = _tracked_paths(root)
    untracked = [
        path
        for path in _git(root, "ls-files", "--others", "--exclude-standard", "-z").split(
            b"\0"
        )
        if path
    ]
    ignored = _ignored_paths(root)
    ignored_set = set(ignored)
    if ignored_selection is not None and ignored_selection not in ignored_set:
        raise BackupError(
            f"Allowlisted ignored path is not present as an ignored worktree file: "
            f"{include_ignored}"
        )

    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_name = f"PARMAR-v1-worktree-backup-{timestamp}"
    backup_dir: pathlib.Path | None = None
    backup_dir_identity: tuple[int, int] | None = None
    created_paths: list[tuple[pathlib.Path, tuple[int, int]]] = []
    published_paths: list[tuple[pathlib.Path, tuple[int, int]]] = []

    for suffix in range(10000):
        name = base_name if suffix == 0 else f"{base_name}-{suffix:02d}"
        candidate = output_dir / name
        try:
            os.mkdir(candidate, 0o700)
        except FileExistsError:
            continue
        backup_dir = candidate
        try:
            info = candidate.lstat()
            backup_dir_identity = (info.st_dev, info.st_ino)
            os.chmod(candidate, 0o700)
            if stat.S_IMODE(candidate.lstat().st_mode) != 0o700:
                raise BackupError(
                    f"Could not enforce private backup-directory permissions: {candidate}"
                )
        except (OSError, BackupError):
            if backup_dir_identity is not None:
                cleanup_errors = _cleanup_created([], (backup_dir, backup_dir_identity))
                if cleanup_errors:
                    raise BackupError(
                        "Could not set private backup-directory permissions and "
                        "cleanup failed: " + "; ".join(cleanup_errors)
                    )
            else:
                try:
                    candidate.rmdir()
                except FileNotFoundError:
                    pass
                except OSError as cleanup_error:
                    raise BackupError(
                        f"Could not inspect or clean new directory {candidate}: "
                        f"{cleanup_error}"
                    ) from cleanup_error
            raise
        break
    if backup_dir is None:
        raise BackupError("Could not reserve a unique timestamped backup directory")
    if backup_dir_identity is None:
        raise BackupError("Could not verify the reserved backup directory")

    try:
        archive_name = f"{backup_dir.name}.tar.gz"
        archive_final = backup_dir / archive_name
        sidecar_final = backup_dir / f"{archive_name}.sha256"
        root_fd = os.open(
            root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        _check_path_permissions(os.fstat(root_fd).st_mode, ".")

        exclusions: dict[str, str] = {
            ".git": "Git internals are never included"
        }
        source_candidates: dict[bytes, str] = {}
        changed_paths = staged_changed | unstaged_changed

        for raw_path in tracked:
            display_path, _ = _repo_relative_path(raw_path)
            reason = _excluded_reason(display_path)
            if reason:
                exclusions[display_path] = reason
                if raw_path in changed_paths:
                    raise BackupError(
                        f"Modified tracked path is excluded by policy and cannot be "
                        f"captured safely: {display_path}"
                    )
                continue
            source_candidates[raw_path] = (
                "modified" if raw_path in changed_paths else "tracked"
            )

        for raw_path in untracked:
            display_path, _ = _repo_relative_path(raw_path)
            reason = _excluded_reason(display_path)
            if reason:
                exclusions[display_path] = reason
                continue
            source_candidates[raw_path] = "untracked"

        if ignored_selection is not None:
            display_path, _ = _repo_relative_path(ignored_selection)
            reason = _excluded_reason(display_path)
            if reason:
                raise BackupError(
                    f"Allowlisted path is also excluded by the credential/data policy: "
                    f"{display_path}"
                )
            source_candidates[ignored_selection] = "explicitly included ignored"

        for raw_path in ignored:
            display_path, _ = _repo_relative_path(raw_path)
            if raw_path != ignored_selection:
                exclusions.setdefault(display_path, "ignored by Git; not explicitly selected")

        changed_excluded: list[str] = []
        for raw_path in changed_paths:
            if raw_path in source_candidates:
                continue
            display_path, _ = _repo_relative_path(raw_path)
            if _excluded_reason(display_path) is not None:
                changed_excluded.append(display_path)
                exclusions.setdefault(
                    display_path, _excluded_reason(display_path) or "excluded by policy"
                )
        changed_excluded.sort()
        if changed_excluded:
            raise BackupError(
                "Tracked changes touch paths excluded by policy: "
                + ", ".join(changed_excluded)
            )

        payload_entries: list[dict[str, object]] = []
        deleted_tracked_paths = _deleted_tracked_paths(root)
        for raw_path in sorted(source_candidates):
            display_path, parts = _repo_relative_path(raw_path)
            try:
                size, digest, mode = _hash_source_file(root_fd, parts, display_path)
            except FileNotFoundError:
                if (
                    source_candidates[raw_path] in {"tracked", "modified"}
                    and raw_path in changed_paths
                ):
                    continue
                raise BackupError(
                    f"Source file disappeared unexpectedly: {display_path}"
                )
            file_fd, source_stat = _open_source_file(root_fd, parts, display_path)
            os.close(file_fd)
            expected_index_mode = index_modes.get(raw_path)
            category = source_candidates[raw_path]
            if expected_index_mode is not None and (
                bool(expected_index_mode & 0o111) != bool(mode & 0o111)
            ):
                category = "modified"
            payload_entries.append(
                {
                    "relative_path": display_path,
                    "archive_path": f"payload/{display_path}",
                    "size": size,
                    "sha256": digest,
                    "mode": f"{mode:04o}",
                    "category": category,
                    "_raw_path": raw_path,
                    "_parts": parts,
                    "_device": source_stat.st_dev,
                    "_inode": source_stat.st_ino,
                    "_mtime_ns": source_stat.st_mtime_ns,
                }
            )

        staged_temp, staged_size, staged_hash, staged_identity = _capture_patch(
            root,
            backup_dir,
            "staged",
            (
                "diff",
                "--cached",
                "--binary",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "HEAD",
                "--",
            ),
            "staged patch",
            created_paths,
        )
        unstaged_temp, unstaged_size, unstaged_hash, unstaged_identity = _capture_patch(
            root,
            backup_dir,
            "unstaged",
            (
                "diff",
                "--binary",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--",
            ),
            "unstaged patch",
            created_paths,
        )

        head_after, branch_after, status_after, staged_after, unstaged_after = (
            _porcelain_metadata(root)
        )
        if (
            head,
            branch,
            status,
            staged_changed,
            unstaged_changed,
        ) != (head_after, branch_after, status_after, staged_after, unstaged_after):
            raise BackupError("Git state changed while the backup was being prepared")

        file_manifest: list[dict[str, object]] = []
        for entry in payload_entries:
            file_manifest.append(
                {
                    key: value
                    for key, value in entry.items()
                    if not key.startswith("_")
                }
            )
        file_manifest.extend(
            [
                {
                    "relative_path": "metadata/staged.patch",
                    "archive_path": "metadata/staged.patch",
                    "size": staged_size,
                    "sha256": staged_hash,
                    "mode": "0600",
                    "category": "metadata",
                },
                {
                    "relative_path": "metadata/unstaged.patch",
                    "archive_path": "metadata/unstaged.patch",
                    "size": unstaged_size,
                    "sha256": unstaged_hash,
                    "mode": "0600",
                    "category": "metadata",
                },
            ]
        )
        manifest = {
            "format": FORMAT_NAME,
            "version": FORMAT_VERSION,
            "created_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source": {
                "repository": str(root),
                "head": head.decode("ascii"),
                "branch": branch.decode("utf-8", "strict") or None,
                "deleted_tracked_paths": deleted_tracked_paths,
                "git_status_porcelain_v1_z_base64": base64.b64encode(status).decode(
                    "ascii"
                ),
                "git_status_sha256": hashlib.sha256(status).hexdigest(),
            },
            "patches": {
                "staged": {
                    "archive_path": "metadata/staged.patch",
                    "sha256": staged_hash,
                    "size": staged_size,
                },
                "unstaged": {
                    "archive_path": "metadata/unstaged.patch",
                    "sha256": unstaged_hash,
                    "size": unstaged_size,
                },
            },
            "files": file_manifest,
            "exclusions": [
                {"relative_path": path, "reason": reason}
                for path, reason in sorted(exclusions.items())
            ],
        }
        manifest_bytes = (
            json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
        ).encode("utf-8")

        archive_temp, archive_fd, archive_identity = _create_temp_file(
            backup_dir, "archive"
        )
        created_paths.append((archive_temp, archive_identity))
        archive_root = backup_dir.name
        with os.fdopen(archive_fd, "w+b") as archive_stream:
            with tarfile.open(
                fileobj=archive_stream, mode="w:gz", format=tarfile.PAX_FORMAT
            ) as archive:
                _write_tar_directory(archive, archive_root)
                _write_tar_directory(archive, f"{archive_root}/metadata")
                _write_tar_directory(archive, f"{archive_root}/payload")
                _write_tar_bytes(
                    archive, f"{archive_root}/metadata/manifest.json", manifest_bytes
                )
                for patch_temp, patch_name, patch_size, patch_hash in (
                    (staged_temp, "staged.patch", staged_size, staged_hash),
                    (unstaged_temp, "unstaged.patch", unstaged_size, unstaged_hash),
                ):
                    with patch_temp.open("rb") as source:
                        reader = _VerifiedReader(source, patch_size, patch_hash)
                        info = tarfile.TarInfo(
                            f"{archive_root}/metadata/{patch_name}"
                        )
                        info.size = patch_size
                        info.mode = 0o600
                        info.mtime = int(time.time())
                        archive.addfile(info, reader)
                        reader.verify()
                for entry in payload_entries:
                    raw_path = entry["_raw_path"]
                    parts = entry["_parts"]
                    if not isinstance(raw_path, bytes) or not isinstance(parts, tuple):
                        raise BackupError("Internal source-path validation failed")
                    display_path = str(entry["relative_path"])
                    file_fd, source_stat = _open_source_file(
                        root_fd, parts, display_path
                    )
                    if (
                        source_stat.st_size != entry["size"]
                        or source_stat.st_dev != entry["_device"]
                        or source_stat.st_ino != entry["_inode"]
                        or source_stat.st_mtime_ns != entry["_mtime_ns"]
                        or _check_path_permissions(
                            source_stat.st_mode, display_path
                        )
                        != int(str(entry["mode"]), 8)
                    ):
                        os.close(file_fd)
                        raise BackupError(
                            f"Source file changed before archive write: {display_path}"
                        )
                    with os.fdopen(file_fd, "rb") as source:
                        reader = _VerifiedReader(
                            source, int(entry["size"]), str(entry["sha256"])
                        )
                        info = tarfile.TarInfo(
                            f"{archive_root}/payload/{display_path}"
                        )
                        info.size = int(entry["size"])
                        info.mode = int(str(entry["mode"]), 8)
                        info.mtime = int(source_stat.st_mtime)
                        archive.addfile(info, reader)
                        reader.verify()
            archive_stream.flush()
            os.fsync(archive_stream.fileno())
        os.close(root_fd)
        root_fd = -1

        head_end, branch_end, status_end, staged_end, unstaged_end = (
            _porcelain_metadata(root)
        )
        if (
            head,
            branch,
            status,
            staged_changed,
            unstaged_changed,
        ) != (head_end, branch_end, status_end, staged_end, unstaged_end):
            raise BackupError("Git state changed while the archive was being written")

        check_paths: list[tuple[pathlib.Path, tuple[int, int]]] = []
        try:
            verify_root_fd = os.open(
                root,
                os.O_RDONLY
                | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_NOFOLLOW", 0),
            )
            try:
                for entry in payload_entries:
                    display_path = str(entry["relative_path"])
                    size, digest, mode = _hash_source_file(
                        verify_root_fd, entry["_parts"], display_path
                    )
                    if (
                        size != entry["size"]
                        or digest != entry["sha256"]
                        or f"{mode:04o}" != entry["mode"]
                    ):
                        raise BackupError(
                            f"Source file changed during backup creation: {display_path}"
                        )
            finally:
                os.close(verify_root_fd)

            (
                _check_staged,
                check_staged_size,
                check_staged_hash,
                _check_staged_identity,
            ) = _capture_patch(
                root,
                backup_dir,
                "check-staged",
                (
                    "diff",
                    "--cached",
                    "--binary",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                    "HEAD",
                    "--",
                ),
                "staged patch verification",
                check_paths,
            )
            (
                _check_unstaged,
                check_unstaged_size,
                check_unstaged_hash,
                _check_unstaged_identity,
            ) = _capture_patch(
                root,
                backup_dir,
                "check-unstaged",
                (
                    "diff",
                    "--binary",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                    "--",
                ),
                "unstaged patch verification",
                check_paths,
            )
            if (
                (check_staged_size, check_staged_hash) != (staged_size, staged_hash)
                or (check_unstaged_size, check_unstaged_hash)
                != (unstaged_size, unstaged_hash)
            ):
                raise BackupError(
                    "Git patches changed while the archive was being written"
                )
        finally:
            cleanup_errors = _cleanup_created(check_paths, None)
            created_paths.extend(check_paths)
            if cleanup_errors:
                raise BackupError(
                    "Patch-verification temporary-file cleanup failed: "
                    + "; ".join(cleanup_errors)
                )

        head_final, branch_final, status_final, staged_final, unstaged_final = (
            _porcelain_metadata(root)
        )
        if (
            head,
            branch,
            status,
            staged_changed,
            unstaged_changed,
        ) != (head_final, branch_final, status_final, staged_final, unstaged_final):
            raise BackupError("Git state changed before the backup was published")

        archive_digest = hashlib.sha256()
        with archive_temp.open("rb") as source:
            for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
                archive_digest.update(chunk)
        archive_hash = archive_digest.hexdigest()

        sidecar_temp, sidecar_fd, sidecar_identity = _create_temp_file(
            backup_dir, "checksum"
        )
        created_paths.append((sidecar_temp, sidecar_identity))
        with os.fdopen(sidecar_fd, "wb") as sidecar:
            sidecar.write(f"{archive_hash}  {archive_name}\n".encode("ascii"))
            sidecar.flush()
            os.fsync(sidecar.fileno())

        os.link(archive_temp, archive_final, follow_symlinks=False)
        published_paths.append((archive_final, archive_identity))
        os.link(sidecar_temp, sidecar_final, follow_symlinks=False)
        published_paths.append((sidecar_final, sidecar_identity))
        backup_dir_fd = os.open(
            backup_dir,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            os.fsync(backup_dir_fd)
        finally:
            os.close(backup_dir_fd)

        cleanup_errors = _cleanup_created(created_paths, None)
        if cleanup_errors:
            raise BackupError(
                "Backup was created, but temporary-file cleanup failed: "
                + "; ".join(cleanup_errors)
            )
        print(f"Backup directory: {backup_dir}")
        print(f"Archive: {archive_final}")
        print(f"SHA-256: {archive_hash}")
        print(f"Manifest files: {len(file_manifest)}")
        print(f"Excluded paths: {len(exclusions)}")
        for exclusion in manifest["exclusions"]:
            print(
                f"Excluded: {exclusion['relative_path']}: {exclusion['reason']}"
            )
        return archive_final
    except BaseException:
        if "root_fd" in locals() and root_fd >= 0:
            os.close(root_fd)
        cleanup_errors = _cleanup_created(
            created_paths + published_paths,
            (backup_dir, backup_dir_identity),
        )
        if cleanup_errors:
            print(
                "Cleanup errors for files created by this invocation: "
                + "; ".join(cleanup_errors),
                file=sys.stderr,
            )
        raise


def _safe_archive_path(value: str) -> tuple[str, ...]:
    if not value or "\x00" in value or "\\" in value:
        raise BackupError("Archive contains an empty or ambiguous path")
    if unicodedata.normalize("NFC", value) != value:
        raise BackupError("Archive contains a non-canonical Unicode path")
    if "//" in value or ":" in value:
        raise BackupError("Archive contains an ambiguous path form")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        raise BackupError("Archive contains an absolute path")
    if value.endswith("/"):
        raise BackupError("Archive contains a non-canonical trailing slash")
    try:
        path_size = len(value.encode("utf-8", "strict"))
    except UnicodeEncodeError as exc:
        raise BackupError("Archive contains a path that is not valid UTF-8") from exc
    if path_size > MAX_ARCHIVE_PATH_BYTES:
        raise BackupError("Archive path exceeds the supported total length")
    parts = value.split("/")
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise BackupError("Archive contains an unsafe path component")
    if any(len(part.encode("utf-8")) > MAX_PATH_COMPONENT_BYTES for part in parts):
        raise BackupError("Archive path component exceeds the supported length")
    if any(
        part.endswith((" ", "."))
        or part.split(".", 1)[0].upper()
        in {"CON", "PRN", "AUX", "NUL", *(f"COM{index}" for index in range(1, 10)),
             *(f"LPT{index}" for index in range(1, 10))}
        or any(unicodedata.category(character) in {"Cc", "Cf", "Cs"} for character in part)
        for part in parts
    ):
        raise BackupError("Archive contains an ambiguous path component")
    return tuple(parts)


def _validate_porcelain_path(path: bytes) -> str:
    if not path:
        raise BackupError("Manifest Git status contains an empty path")
    try:
        decoded = path.decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        raise BackupError("Manifest Git status contains a non-UTF-8 path") from exc
    parts = _safe_archive_path(decoded)
    if "/".join(parts) != decoded:
        raise BackupError("Manifest Git status contains a non-canonical path")
    return decoded


_VALID_PORCELAIN_INDEX_CODES = frozenset({" ", "M", "T", "A", "D", "R", "C"})
_VALID_PORCELAIN_WORKTREE_CODES = frozenset({" ", "M", "T", "A", "D"})
_VALID_UNMERGED_PORCELAIN_CODES = frozenset(
    {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}
)


def _parse_porcelain_v1_z(status: bytes) -> set[str]:
    if not status:
        return set()
    if not status.endswith(b"\0"):
        raise BackupError("Manifest Git status is not NUL-terminated")
    records = status[:-1].split(b"\0")
    deleted: set[str] = set()
    seen_paths: set[str] = set()
    folded_paths: set[str] = set()
    index = 0
    while index < len(records):
        record = records[index]
        if len(record) < 4 or record[2:3] != b" ":
            raise BackupError("Manifest Git status contains a malformed record")
        try:
            code = record[:2].decode("ascii", "strict")
        except UnicodeDecodeError as exc:
            raise BackupError("Manifest Git status contains an invalid status code") from exc
        if code == "??":
            index_code, worktree_code = "?", "?"
        else:
            index_code, worktree_code = code
            if index_code == "U" or worktree_code == "U":
                if code not in _VALID_UNMERGED_PORCELAIN_CODES:
                    raise BackupError(
                        "Manifest Git status contains an impossible status code"
                    )
            elif (
                index_code not in _VALID_PORCELAIN_INDEX_CODES
                or worktree_code not in _VALID_PORCELAIN_WORKTREE_CODES
            ):
                raise BackupError(
                    "Manifest Git status contains an impossible status code"
                )
        path = _validate_porcelain_path(record[3:])
        if path in seen_paths or path.casefold() in folded_paths:
            raise BackupError("Manifest Git status contains a duplicate path")
        seen_paths.add(path)
        folded_paths.add(path.casefold())
        if "D" in code:
            deleted.add(path)
        if index_code in {"R", "C"}:
            if index + 1 >= len(records):
                raise BackupError("Manifest Git status has an invalid rename/copy record")
            source = _validate_porcelain_path(records[index + 1])
            if source in seen_paths or source.casefold() in folded_paths:
                raise BackupError("Manifest Git status contains duplicate rename/copy paths")
            seen_paths.add(source)
            folded_paths.add(source.casefold())
            if index_code == "R":
                deleted.add(source)
            index += 1
        index += 1
    return deleted


def _open_readonly_regular(
    path: pathlib.Path, label: str
) -> tuple[BinaryIO, os.stat_result]:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        info = os.fstat(fd)
    except OSError as exc:
        raise BackupError(f"Unable to open {label}: {exc.strerror}") from exc
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        raise BackupError(f"{label} is not a regular file")
    return os.fdopen(fd, "rb"), info


def _same_file_state(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
        before.st_ctime_ns,
    ) == (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    )


def _open_readonly_regular_at(
    directory_fd: int, name: str, label: str
) -> tuple[BinaryIO, os.stat_result]:
    fd: int | None = None
    try:
        path_state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        fd = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        info = os.fstat(fd)
    except OSError as exc:
        if fd is not None:
            os.close(fd)
        raise BackupError(f"Unable to open {label}: {exc.strerror}") from exc
    if (
        not stat.S_ISREG(path_state.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or not _same_file_state(path_state, info)
    ):
        os.close(fd)
        raise BackupError(f"{label} changed or is not a regular file")
    return os.fdopen(fd, "rb"), info


def _sha256_stream(source: BinaryIO, limit: int, label: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = source.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise BackupError(f"{label} exceeds the supported size limit")
        digest.update(chunk)
    return digest.hexdigest(), total


def _discover_backup(
    backup_dir: pathlib.Path,
) -> tuple[int, os.stat_result, str, os.stat_result, str, os.stat_result]:
    if (
        not hasattr(os, "O_DIRECTORY")
        or not hasattr(os, "O_NOFOLLOW")
        or os.open not in os.supports_dir_fd
        or os.stat not in os.supports_dir_fd
        or os.listdir not in os.supports_fd
    ):
        raise BackupError(
            "This platform cannot pin and safely inspect the backup directory"
        )
    try:
        path_before = backup_dir.lstat()
    except OSError as exc:
        raise BackupError(f"Backup directory is unavailable: {exc.strerror}") from exc
    if not stat.S_ISDIR(path_before.st_mode) or stat.S_ISLNK(path_before.st_mode):
        raise BackupError("Backup path must be a real directory, not a symlink")
    directory_fd: int | None = None
    try:
        directory_fd = os.open(
            backup_dir,
            os.O_RDONLY
            | os.O_DIRECTORY
            | os.O_NOFOLLOW
            | getattr(os, "O_CLOEXEC", 0),
        )
        directory_state = os.fstat(directory_fd)
        path_after = backup_dir.lstat()
    except OSError as exc:
        if directory_fd is not None:
            os.close(directory_fd)
        raise BackupError(
            f"Unable to pin backup directory: {exc.strerror}"
        ) from exc
    if (
        not stat.S_ISDIR(directory_state.st_mode)
        or not _same_file_state(path_before, directory_state)
        or not _same_file_state(directory_state, path_after)
    ):
        os.close(directory_fd)
        raise BackupError("Backup directory changed while it was being pinned")
    try:
        children = os.listdir(directory_fd)
        directory_after_listing = os.fstat(directory_fd)
    except OSError as exc:
        os.close(directory_fd)
        raise BackupError(f"Unable to list backup directory: {exc.strerror}") from exc
    if not _same_file_state(directory_state, directory_after_listing):
        os.close(directory_fd)
        raise BackupError("Backup directory changed while it was being inspected")

    archives = [
        child
        for child in children
        if child.endswith(".tar.gz")
        and BACKUP_STEM_RE.fullmatch(child[:-7])
    ]
    if len(archives) != 1:
        os.close(directory_fd)
        raise BackupError(
            "Backup directory must contain exactly one timestamped PARMAR archive"
        )
    archive = archives[0]
    sidecar = f"{archive}.sha256"
    sidecars = [
        child
        for child in children
        if child.endswith(".tar.gz.sha256")
        and BACKUP_STEM_RE.fullmatch(child[: -len(".tar.gz.sha256")])
    ]
    if len(sidecars) != 1 or sidecars[0] != sidecar:
        os.close(directory_fd)
        raise BackupError(
            "Backup directory must contain exactly one matching SHA-256 sidecar"
        )
    states: dict[str, os.stat_result] = {}
    for candidate, label in ((archive, "archive"), (sidecar, "checksum sidecar")):
        try:
            info = os.stat(candidate, dir_fd=directory_fd, follow_symlinks=False)
        except OSError as exc:
            os.close(directory_fd)
            raise BackupError(
                f"{label.capitalize()} is unavailable: {exc.strerror}"
            ) from exc
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            os.close(directory_fd)
            raise BackupError(f"{label.capitalize()} must be a regular file")
        states[candidate] = info
    return directory_fd, directory_state, archive, states[archive], sidecar, states[sidecar]


def _read_sidecar(
    directory_fd: int, sidecar: str, archive: str
) -> tuple[str, os.stat_result, bytes]:
    source, before = _open_readonly_regular_at(
        directory_fd, sidecar, "checksum sidecar"
    )
    with source:
        if before.st_size > 4096:
            raise BackupError("Checksum sidecar exceeds the supported size limit")
        raw = source.read(4097)
        after = os.fstat(source.fileno())
    if not _same_file_state(before, after):
        raise BackupError("Checksum sidecar changed while being read")
    match = SIDE_CAR_RE.fullmatch(raw)
    if not match:
        raise BackupError("Checksum sidecar has an invalid format")
    expected_hash = match.group(1).decode("ascii")
    try:
        recorded_name = match.group(2).decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        raise BackupError("Checksum sidecar filename is not valid UTF-8") from exc
    if recorded_name not in (archive,):
        raise BackupError("Checksum sidecar names a different archive")
    return expected_hash, after, raw


def _revalidate_sidecar(
    directory_fd: int,
    sidecar: str,
    initial_state: os.stat_result,
    initial_raw: bytes,
) -> None:
    source, before = _open_readonly_regular_at(
        directory_fd, sidecar, "checksum sidecar"
    )
    with source:
        if before.st_size > 4096:
            raise BackupError("Checksum sidecar exceeds the supported size limit")
        raw = source.read(4097)
        after = os.fstat(source.fileno())
    if (
        not _same_file_state(initial_state, before)
        or not _same_file_state(before, after)
        or raw != initial_raw
    ):
        raise BackupError("Checksum sidecar changed during verification")


def _recheck_backup_directory(
    backup_dir: pathlib.Path, directory_fd: int, initial: os.stat_result
) -> None:
    try:
        descriptor_state = os.fstat(directory_fd)
        path_state = backup_dir.lstat()
    except OSError as exc:
        raise BackupError(f"Backup directory changed during verification: {exc.strerror}") from exc
    if (
        not stat.S_ISDIR(path_state.st_mode)
        or stat.S_ISLNK(path_state.st_mode)
        or not _same_file_state(initial, descriptor_state)
        or not _same_file_state(initial, path_state)
    ):
        raise BackupError("Backup directory changed during verification")


def _recheck_child_identity(
    directory_fd: int, name: str, initial: os.stat_result, label: str
) -> None:
    try:
        path_state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except OSError as exc:
        raise BackupError(f"{label} changed during verification: {exc.strerror}") from exc
    if not stat.S_ISREG(path_state.st_mode) or not _same_file_state(initial, path_state):
        raise BackupError(f"{label} changed during verification")


def _validate_archive_name(archive: pathlib.Path) -> str:
    stem = archive.name[:-7]
    if not BACKUP_STEM_RE.fullmatch(stem):
        raise BackupError("Archive filename is not a supported PARMAR backup name")
    return stem


def _validate_pax_records(raw: bytes, size: int) -> int:
    if len(raw) != ((size + 511) // 512) * 512:
        raise BackupError("Archive PAX extension header is truncated")
    if any(raw[size:]):
        raise BackupError("Archive PAX extension has nonzero block padding")
    records = raw[:size]
    offset = 0
    count = 0
    seen: set[bytes] = set()
    while offset < len(records):
        separator = records.find(b" ", offset)
        if separator < 0:
            raise BackupError("Archive PAX extension has a malformed record")
        length_text = records[offset:separator]
        if (
            not length_text
            or not length_text.isdigit()
            or (len(length_text) > 1 and length_text.startswith(b"0"))
        ):
            raise BackupError("Archive PAX extension has a malformed record length")
        record_length = int(length_text)
        end = offset + record_length
        if (
            record_length <= separator - offset + 3
            or end > len(records)
            or records[end - 1 : end] != b"\n"
        ):
            raise BackupError("Archive PAX extension has an invalid record boundary")
        field = records[separator + 1 : end - 1]
        key, equals, value = field.partition(b"=")
        if not equals or not key or b"\0" in value:
            raise BackupError("Archive PAX extension has an ambiguous field")
        if key != b"path":
            raise BackupError("Archive PAX extension contains an unsupported field")
        if key in seen:
            raise BackupError("Archive PAX extension contains a duplicate field")
        try:
            value.decode("utf-8", "strict")
        except UnicodeDecodeError as exc:
            raise BackupError("Archive PAX path is not valid UTF-8") from exc
        count += 1
        if count > MAX_PAX_EXTENSION_RECORDS:
            raise BackupError("Archive PAX extension has too many records")
        seen.add(key)
        offset = end
    return count


class _PaxCaptureReader:
    def __init__(self, source: BinaryIO):
        self.source = source
        self.total_bytes = 0
        self.total_records = 0
        self._capture_size: int | None = None
        self._capture_remaining = 0
        self._capture = bytearray()

    def begin_pax_extension(self, size: int) -> None:
        if (
            size < 0
            or size > MAX_PAX_EXTENSION_BYTES
            or self.total_bytes + size > MAX_TOTAL_PAX_BYTES
        ):
            raise BackupError("Archive PAX extension exceeds the supported size limit")
        self.total_bytes += size
        self._capture_size = size
        self._capture_remaining = ((size + 511) // 512) * 512
        self._capture = bytearray()

    def read(self, size: int = -1) -> bytes:
        data = self.source.read(size)
        if self._capture_size is not None:
            if len(data) > self._capture_remaining:
                raise BackupError("Archive PAX extension framing is invalid")
            self._capture.extend(data)
            self._capture_remaining -= len(data)
            if not self._capture_remaining:
                count = _validate_pax_records(bytes(self._capture), self._capture_size)
                self.total_records += count
                if self.total_records > MAX_TOTAL_PAX_RECORDS:
                    raise BackupError("Archive has too many PAX extension records")
                self._capture_size = None
                self._capture.clear()
        return data

    def __getattr__(self, name: str) -> object:
        return getattr(self.source, name)


class _LimitedPaxTarInfo(tarfile.TarInfo):
    def _proc_pax(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        if self.type != tarfile.XHDTYPE:
            raise BackupError("Archive contains an unsupported global PAX header")
        reader = archive.fileobj
        if not isinstance(reader, _PaxCaptureReader):
            raise BackupError("Archive PAX limits could not be enforced")
        reader.begin_pax_extension(self.size)
        return super()._proc_pax(archive)

    def _proc_gnulong(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        raise BackupError("Archive contains an unsupported GNU extension header")


def _stream_archive_members(
    source: BinaryIO, archive_root: str
) -> tuple[dict[str, dict[str, object]], dict[str, bytes], list[str], int]:
    members: dict[str, dict[str, object]] = {}
    folded_members: set[str] = set()
    captured: dict[str, bytes] = {}
    warnings: list[str] = []
    total_payload_size = 0
    captured_limits = {
        f"{archive_root}/{MANIFEST_MEMBER}": MAX_MANIFEST_BYTES,
        **{
            f"{archive_root}/{name}": MAX_LEGACY_METADATA_BYTES
            for name in LEGACY_FIXED_FILES | {LEGACY_AUDIT_MEMBER}
        },
    }

    source.seek(0)
    try:
        archive = tarfile.open(
            fileobj=source, mode="r|gz", tarinfo=_LimitedPaxTarInfo
        )
        archive.fileobj = _PaxCaptureReader(archive.fileobj)
        with archive:
            for member in archive:
                if len(members) >= MAX_ARCHIVE_MEMBERS:
                    raise BackupError("Archive has too many members")
                name = member.name
                if member.isdir() and name.endswith("//"):
                    raise BackupError(
                        f"Archive member has an ambiguous directory path: {name}"
                    )
                path_name = name[:-1] if member.isdir() and name.endswith("/") else name
                if not member.isdir() and name.endswith("/"):
                    raise BackupError(
                        f"Archive member has an ambiguous directory path: {name.rstrip('/')}"
                    )
                parts = _safe_archive_path(path_name)
                normalized = "/".join(parts)
                if normalized in members:
                    raise BackupError(f"Archive contains duplicate member: {normalized}")
                folded = normalized.casefold()
                if folded in folded_members:
                    raise BackupError(
                        f"Archive contains a case-ambiguous member: {normalized}"
                    )
                folded_members.add(folded)
                if parts[0] != archive_root:
                    raise BackupError(
                        "Archive member is outside its expected root directory"
                    )
                if member.pax_headers and "linkpath" in member.pax_headers:
                    raise BackupError("Archive contains an unsupported link path")
                if member.mode & 0o7000:
                    raise BackupError(
                        f"Archive member has privileged permission bits: {normalized}"
                    )
                if member.mode & 0o022:
                    warnings.append(f"group/world-writable mode: {normalized}")

                if member.isdir():
                    if member.size != 0:
                        raise BackupError(
                            f"Directory member has a nonzero size: {normalized}"
                        )
                    if normalized != archive_root and normalized not in {
                        f"{archive_root}/metadata",
                        f"{archive_root}/payload",
                        f"{archive_root}/untracked",
                        f"{archive_root}/preserved-ignored",
                    } and not normalized.startswith(
                        (
                            f"{archive_root}/payload/",
                            f"{archive_root}/untracked/",
                            f"{archive_root}/preserved-ignored/",
                        )
                    ):
                        raise BackupError(f"Unexpected directory member: {normalized}")
                    members[normalized] = {
                        "kind": "directory",
                        "size": 0,
                        "mode": member.mode,
                    }
                    continue
                if member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE):
                    raise BackupError(
                        f"Archive contains an unsupported member type: {normalized}"
                    )
                if member.size < 0 or member.size > MAX_MEMBER_BYTES:
                    raise BackupError(
                        f"Archive member has an unsupported size: {normalized}"
                    )
                total_payload_size += member.size
                if total_payload_size > MAX_TOTAL_MEMBER_BYTES:
                    raise BackupError("Archive exceeds the supported total payload size")
                reader = archive.extractfile(member)
                if reader is None:
                    raise BackupError(f"Unable to read archive member: {normalized}")
                digest = hashlib.sha256()
                read_size = 0
                captured_limit = captured_limits.get(normalized)
                capture = bytearray() if captured_limit is not None else None
                with reader:
                    while True:
                        chunk = reader.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        read_size += len(chunk)
                        if read_size > member.size:
                            raise BackupError(
                                f"Archive member exceeds its declared size: {normalized}"
                            )
                        digest.update(chunk)
                        if capture is not None:
                            if len(capture) + len(chunk) > captured_limit:
                                raise BackupError(
                                    f"Metadata member is too large: {normalized}"
                                )
                            capture.extend(chunk)
                if read_size != member.size:
                    raise BackupError(f"Archive member is truncated: {normalized}")
                members[normalized] = {
                    "kind": "file",
                    "size": read_size,
                    "sha256": digest.hexdigest(),
                    "mode": stat.S_IMODE(member.mode),
                }
                if capture is not None:
                    captured[normalized] = bytes(capture)
            trailing_size = 0
            while True:
                trailing = archive.fileobj.read(CHUNK_SIZE)
                if not trailing:
                    break
                trailing_size += len(trailing)
                if trailing_size > 32 * 1024**2 or any(trailing):
                    raise BackupError("Archive contains unexpected trailing tar data")
        ordered_members = sorted(
            (path.casefold(), path, details["kind"])
            for path, details in members.items()
        )
        for index, (folded_path, path, kind) in enumerate(ordered_members[:-1]):
            next_path = ordered_members[index + 1][0]
            if kind == "file" and next_path.startswith(folded_path + "/"):
                raise BackupError(f"Archive has a file/directory collision at {path}")
    except BackupError:
        raise
    except (
        OSError,
        EOFError,
        tarfile.TarError,
        gzip.BadGzipFile,
        zlib.error,
        ValueError,
    ) as exc:
        raise BackupError(
            f"Archive is malformed, truncated, or unreadable: {type(exc).__name__}"
        ) from exc
    return members, captured, warnings, total_payload_size


def _validate_gzip_stream(source: BinaryIO) -> None:
    source.seek(0)
    total = 0
    compressed = zlib.decompressobj(16 + zlib.MAX_WBITS)
    limit = MAX_TOTAL_MEMBER_BYTES + 32 * 1024**2
    try:
        while True:
            chunk = source.read(CHUNK_SIZE)
            if not chunk:
                break
            pending = chunk
            while pending:
                output = compressed.decompress(pending, CHUNK_SIZE)
                pending = compressed.unconsumed_tail
                total += len(output)
                if total > limit:
                    raise BackupError(
                        "Decompressed archive exceeds the supported size limit"
                    )
                if compressed.unused_data:
                    raise BackupError(
                        "Archive must contain one gzip member and no trailing bytes"
                    )
                if compressed.eof:
                    if pending or source.read(1):
                        raise BackupError(
                            "Archive must contain one gzip member and no trailing bytes"
                        )
                    return
        if not compressed.eof:
            raise BackupError("Archive gzip member is truncated")
    except BackupError:
        raise
    except (OSError, EOFError, gzip.BadGzipFile, zlib.error) as exc:
        raise BackupError(
            f"Archive gzip stream is malformed or truncated: {type(exc).__name__}"
        ) from exc


def _manifest_string(
    value: object, label: str, allow_empty: bool = False
) -> str:
    if (
        not isinstance(value, str)
        or (not value and not allow_empty)
        or "\x00" in value
    ):
        raise BackupError(f"Manifest field {label} has an invalid value")
    return value


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise BackupError("Manifest contains a duplicate JSON key")
        result[key] = value
    return result


def warnings_from_modes(members: dict[str, dict[str, object]]) -> list[str]:
    return [
        f"group/world-writable mode: {path}"
        for path, member in members.items()
        if int(member["mode"]) & 0o022
    ]


def _validate_manifest(
    manifest_bytes: bytes,
    archive_root: str,
    members: dict[str, dict[str, object]],
) -> int:
    try:
        manifest = json.loads(
            manifest_bytes.decode("utf-8"), object_pairs_hook=_unique_json_object
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupError("Manifest is not valid UTF-8 JSON") from exc
    if not isinstance(manifest, dict) or set(manifest) != {
        "format",
        "version",
        "created_at_utc",
        "source",
        "patches",
        "files",
        "exclusions",
    }:
        raise BackupError("Manifest has an unsupported structure")
    if (
        manifest["format"] != FORMAT_NAME
        or type(manifest["version"]) is not int
        or manifest["version"] != FORMAT_VERSION
    ):
        raise BackupError("Manifest format identifier or version is unsupported")
    created_at = _manifest_string(manifest["created_at_utc"], "created_at_utc")
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)",
        created_at,
    ):
        raise BackupError("Manifest creation timestamp is not in UTC ISO-8601 form")
    try:
        parsed_date = dt.datetime.fromisoformat(
            created_at[:-1] + "+00:00" if created_at.endswith("Z") else created_at
        )
    except ValueError as exc:
        raise BackupError("Manifest creation timestamp is invalid") from exc
    if parsed_date.utcoffset() != dt.timedelta(0):
        raise BackupError("Manifest creation timestamp is not UTC")

    source = manifest["source"]
    if not isinstance(source, dict) or set(source) != {
        "repository",
        "head",
        "branch",
        "deleted_tracked_paths",
        "git_status_porcelain_v1_z_base64",
        "git_status_sha256",
    }:
        raise BackupError("Manifest source metadata has an invalid structure")
    _manifest_string(source["repository"], "source.repository")
    head = _manifest_string(source["head"], "source.head")
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", head):
        raise BackupError("Manifest source HEAD is invalid")
    branch = source["branch"]
    if branch is not None:
        _manifest_string(branch, "source.branch", allow_empty=True)
    try:
        status = base64.b64decode(
            _manifest_string(
                source["git_status_porcelain_v1_z_base64"],
                "source.git_status_porcelain_v1_z_base64",
                allow_empty=True,
            ),
            validate=True,
        )
    except (ValueError, base64.binascii.Error) as exc:
        raise BackupError("Manifest Git status encoding is invalid") from exc
    status_hash = _manifest_string(
        source["git_status_sha256"], "source.git_status_sha256"
    )
    if (
        not SHA256_RE.fullmatch(status_hash)
        or hashlib.sha256(status).hexdigest() != status_hash
    ):
        raise BackupError("Manifest Git status checksum is invalid")
    status_deleted_paths = _parse_porcelain_v1_z(status)
    deleted = source["deleted_tracked_paths"]
    if not isinstance(deleted, list):
        raise BackupError("Manifest deleted path list is invalid")
    deleted_paths: set[str] = set()
    folded_deleted_paths: set[str] = set()
    for path in deleted:
        path = _manifest_string(path, "source.deleted_tracked_paths")
        canonical_parts = _safe_archive_path(path)
        canonical_path = "/".join(canonical_parts)
        if canonical_path != path:
            raise BackupError("Manifest deleted path is not canonical")
        if (
            canonical_path in deleted_paths
            or canonical_path.casefold() in folded_deleted_paths
        ):
            raise BackupError("Manifest contains duplicate deleted paths")
        deleted_paths.add(canonical_path)
        folded_deleted_paths.add(canonical_path.casefold())
    if deleted_paths != status_deleted_paths:
        raise BackupError("Manifest deleted paths disagree with Git status metadata")

    exclusions = manifest["exclusions"]
    if not isinstance(exclusions, list):
        raise BackupError("Manifest exclusions field is invalid")
    for exclusion in exclusions:
        if not isinstance(exclusion, dict) or set(exclusion) != {
            "relative_path",
            "reason",
        }:
            raise BackupError("Manifest exclusion entry is invalid")
        _safe_archive_path(
            _manifest_string(exclusion["relative_path"], "exclusions.relative_path")
        )
        _manifest_string(exclusion["reason"], "exclusions.reason")

    patches = manifest["patches"]
    if not isinstance(patches, dict) or set(patches) != set(PATCH_MEMBERS):
        raise BackupError("Manifest patch metadata has an invalid structure")
    files = manifest["files"]
    if not isinstance(files, list):
        raise BackupError("Manifest files field is invalid")
    seen_relative: set[str] = set()
    seen_archive: set[str] = set()
    folded_relative: set[str] = set()
    folded_archive: set[str] = set()
    payload_files: list[tuple[str, str]] = []
    patch_records: dict[str, tuple[str, int, str]] = {}
    for entry in files:
        expected_fields = {
            "relative_path",
            "archive_path",
            "size",
            "sha256",
            "mode",
            "category",
        }
        if not isinstance(entry, dict) or set(entry) != expected_fields:
            raise BackupError("Manifest file entry has an invalid structure")
        relative = _manifest_string(entry["relative_path"], "files.relative_path")
        archive_path = _manifest_string(entry["archive_path"], "files.archive_path")
        if relative.endswith("/") or archive_path.endswith("/"):
            raise BackupError("Manifest file path has an ambiguous trailing separator")
        category = _manifest_string(entry["category"], "files.category")
        digest = _manifest_string(entry["sha256"], "files.sha256")
        mode_value = _manifest_string(entry["mode"], "files.mode")
        size = entry["size"]
        if type(size) is not int or size < 0 or size > MAX_MEMBER_BYTES:
            raise BackupError(f"Manifest size is invalid for {relative}")
        if not SHA256_RE.fullmatch(digest):
            raise BackupError(f"Manifest SHA-256 is invalid for {relative}")
        if not re.fullmatch(r"0[0-7]{3}", mode_value):
            raise BackupError(f"Manifest permission mode is invalid for {relative}")
        mode = int(mode_value, 8)
        if mode & 0o7000:
            raise BackupError(f"Manifest has privileged permission bits for {relative}")
        _safe_archive_path(relative)
        _safe_archive_path(archive_path)
        if (
            relative in seen_relative
            or archive_path in seen_archive
            or relative.casefold() in folded_relative
            or archive_path.casefold() in folded_archive
        ):
            raise BackupError("Manifest contains duplicate file paths")
        seen_relative.add(relative)
        seen_archive.add(archive_path)
        folded_relative.add(relative.casefold())
        folded_archive.add(archive_path.casefold())
        if category == "metadata":
            matching_patch = next(
                (
                    key
                    for key, path in PATCH_MEMBERS.items()
                    if relative == path and archive_path == path
                ),
                None,
            )
            if matching_patch is None or matching_patch in patch_records:
                raise BackupError("Manifest declares unsupported metadata")
            actual_archive_path = f"{archive_root}/{archive_path}"
            patch_records[matching_patch] = (archive_path, size, digest)
        else:
            if category not in PAYLOAD_CATEGORIES:
                raise BackupError(f"Manifest file category is invalid for {relative}")
            expected_path = f"payload/{relative}"
            if archive_path != expected_path:
                raise BackupError(f"Manifest archive mapping is invalid for {relative}")
            payload_files.append((relative, archive_path))
            actual_archive_path = f"{archive_root}/{archive_path}"
        if actual_archive_path not in members:
            raise BackupError(f"Manifest member is missing: {actual_archive_path}")
        actual = members[actual_archive_path]
        if actual["kind"] != "file":
            raise BackupError(
                f"Manifest path is not a regular file: {actual_archive_path}"
            )
        if (
            actual["size"] != size
            or actual["sha256"] != digest
            or actual["mode"] != mode
        ):
            raise BackupError(
                f"Manifest size, hash, or mode mismatch: {actual_archive_path}"
            )

    if set(patch_records) != set(PATCH_MEMBERS):
        raise BackupError("Manifest is missing a required patch record")
    for name, patch_path in PATCH_MEMBERS.items():
        patch = patches[name]
        if not isinstance(patch, dict) or set(patch) != {
            "archive_path",
            "sha256",
            "size",
        }:
            raise BackupError(f"Manifest {name} patch metadata is invalid")
        record_path, record_size, record_hash = patch_records[name]
        if (
            patch["archive_path"] != patch_path
            or patch["archive_path"] != record_path
            or type(patch["size"]) is not int
            or patch["size"] != record_size
            or patch["sha256"] != record_hash
        ):
            raise BackupError(f"Manifest {name} patch metadata is inconsistent")

    relative_paths = sorted(path for path, _ in payload_files)
    folded_paths = sorted(path.casefold() for path in relative_paths)
    for index, path in enumerate(folded_paths[:-1]):
        if folded_paths[index + 1].startswith(path + "/"):
            raise BackupError(f"Manifest has a file/directory collision at {path}")
    expected_members = {
        archive_root,
        f"{archive_root}/metadata",
        f"{archive_root}/payload",
        f"{archive_root}/{MANIFEST_MEMBER}",
        *(f"{archive_root}/{path}" for path in PATCH_MEMBERS.values()),
        *(f"{archive_root}/{path}" for _, path in payload_files),
    }
    if set(members) != expected_members:
        missing = sorted(expected_members - set(members))
        if missing:
            raise BackupError(f"Archive is missing expected member: {missing[0]}")
        unexpected = sorted(set(members) - expected_members)
        raise BackupError(
            f"Archive contains an unexpected member: {unexpected[0]}"
        )
    for directory in (
        archive_root,
        f"{archive_root}/metadata",
        f"{archive_root}/payload",
    ):
        item = members.get(directory)
        if item is None or item["kind"] != "directory" or item["mode"] != 0o700:
            raise BackupError(f"Archive has an invalid required directory: {directory}")
    return len(payload_files)


def _validate_legacy_archive(
    archive_root: str,
    members: dict[str, dict[str, object]],
    captured: dict[str, bytes],
) -> int:
    prefix = f"{archive_root}/"
    relative_members = {
        ("" if name == archive_root else name[len(prefix) :]): details
        for name, details in members.items()
        if name == archive_root or name.startswith(prefix)
    }
    required = set(LEGACY_FIXED_FILES)
    if not required.issubset(relative_members):
        raise BackupError(
            "Archive has no A48 manifest and does not match the supported A47 layout"
        )
    if b"tracked-changes.patch" not in captured[f"{archive_root}/README.txt"]:
        raise BackupError("Legacy archive structure marker is missing")
    try:
        source_head = captured[f"{archive_root}/source-head.txt"].decode("ascii").strip()
        untracked_text = captured[f"{archive_root}/untracked-files.txt"].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BackupError("Legacy source metadata encoding is invalid") from exc
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", source_head):
        raise BackupError("Legacy source HEAD is invalid")
    untracked = [line for line in untracked_text.splitlines() if line]
    if len(set(untracked)) != len(untracked):
        raise BackupError("Legacy untracked manifest contains duplicate paths")
    for relative in untracked:
        _safe_archive_path(relative)
    expected_files = required | {f"untracked/{path}" for path in untracked}
    if LEGACY_AUDIT_MEMBER in relative_members:
        expected_files.add(LEGACY_AUDIT_MEMBER)
    actual_files = {
        path
        for path, details in relative_members.items()
        if details["kind"] == "file"
    }
    if actual_files != expected_files:
        missing = sorted(expected_files - actual_files)
        unexpected = sorted(actual_files - expected_files)
        raise BackupError(
            "Legacy member list mismatch: "
            + (f"missing {missing[0]}" if missing else f"unexpected {unexpected[0]}")
        )
    expected_directories = {""}
    for path in expected_files:
        parts = path.split("/")[:-1]
        for index in range(1, len(parts) + 1):
            expected_directories.add("/".join(parts[:index]))
    actual_directories = {
        path
        for path, details in relative_members.items()
        if details["kind"] == "directory"
    }
    if actual_directories != expected_directories:
        raise BackupError("Legacy archive directory structure is inconsistent")
    return len(untracked)


def verify_backup(
    backup_dir: pathlib.Path, *, include_manifest: bool = False
) -> dict[str, object]:
    result: dict[str, object] = {
        "overall": "FAIL",
        "archive_checksum": "NOT RUN",
        "manifest": "NOT RUN",
        "member_count": 0,
        "payload_count": 0,
        "per_file_hash_size": "NOT RUN",
        "path_type_permission_safety": "NOT RUN",
        "legacy_compatibility": "NOT APPLICABLE",
        "warnings": [],
        "failures": [],
    }
    directory_fd: int | None = None
    verified_manifest: dict[str, object] | None = None
    try:
        (
            directory_fd,
            directory_state,
            archive_name,
            discovered_archive_state,
            sidecar_name,
            discovered_sidecar_state,
        ) = _discover_backup(backup_dir)
        archive_root = _validate_archive_name(pathlib.Path(archive_name))
        expected_hash, sidecar_state, sidecar_raw = _read_sidecar(
            directory_fd, sidecar_name, archive_name
        )
        if not _same_file_state(discovered_sidecar_state, sidecar_state):
            raise BackupError("Checksum sidecar changed during verification")
        archive_source, archive_state = _open_readonly_regular_at(
            directory_fd, archive_name, "backup archive"
        )
        if not _same_file_state(discovered_archive_state, archive_state):
            archive_source.close()
            raise BackupError("Backup archive changed during verification")
        with archive_source:
            if archive_state.st_size > MAX_ARCHIVE_BYTES:
                raise BackupError("Archive exceeds the supported compressed size limit")
            archive_hash, archive_size = _sha256_stream(
                archive_source, MAX_ARCHIVE_BYTES, "Archive"
            )
            if archive_size != archive_state.st_size:
                raise BackupError("Archive changed size while being checksummed")
            if archive_hash != expected_hash:
                result["archive_checksum"] = "FAIL"
                raise BackupError("Archive SHA-256 does not match its sidecar")
            result["archive_checksum"] = "PASS"
            _validate_gzip_stream(archive_source)
            members, captured, warnings, _total_size = _stream_archive_members(
                archive_source, archive_root
            )
            archive_source.seek(0)
            final_hash, final_size = _sha256_stream(
                archive_source, MAX_ARCHIVE_BYTES, "Archive"
            )
            final_state = os.fstat(archive_source.fileno())
            if (
                final_hash != expected_hash
                or final_size != archive_state.st_size
                or not _same_file_state(archive_state, final_state)
            ):
                raise BackupError("Archive changed during verification")
            _recheck_child_identity(
                directory_fd,
                archive_name,
                discovered_archive_state,
                "Backup archive",
            )

        result["member_count"] = len(members)
        result["path_type_permission_safety"] = "PASS"
        result["warnings"] = sorted(set(warnings))
        manifest_name = f"{archive_root}/{MANIFEST_MEMBER}"
        if manifest_name in captured:
            result["manifest"] = "FAIL"
            result["per_file_hash_size"] = "FAIL"
            payload_count = _validate_manifest(
                captured[manifest_name], archive_root, members
            )
            if include_manifest:
                parsed_manifest = json.loads(
                    captured[manifest_name].decode("utf-8"),
                    object_pairs_hook=_unique_json_object,
                )
                if not isinstance(parsed_manifest, dict):
                    raise BackupError("Verified manifest has an invalid structure")
                verified_manifest = parsed_manifest
            result["manifest"] = "PASS"
            result["per_file_hash_size"] = "PASS"
            result["payload_count"] = payload_count
        else:
            result["legacy_compatibility"] = (
                "LEGACY_CHECKSUM_AND_STRUCTURE_ONLY"
            )
            result["manifest"] = "NOT AVAILABLE"
            result["per_file_hash_size"] = "NOT AVAILABLE"
            result["path_type_permission_safety"] = "PASS"
            payload_count = _validate_legacy_archive(
                archive_root, members, captured
            )
            result["payload_count"] = payload_count
        _revalidate_sidecar(
            directory_fd, sidecar_name, sidecar_state, sidecar_raw
        )
        _recheck_child_identity(
            directory_fd,
            archive_name,
            discovered_archive_state,
            "Backup archive",
        )
        _recheck_backup_directory(backup_dir, directory_fd, directory_state)
        result["overall"] = "PASS"
        if include_manifest and verified_manifest is not None:
            result["_verified_manifest"] = verified_manifest
    except BackupError as exc:
        result["failures"] = [str(exc)]
        if result["path_type_permission_safety"] == "NOT RUN":
            result["path_type_permission_safety"] = "FAIL"
    except Exception as exc:
        result["failures"] = [
            f"Verification failed unexpectedly: {type(exc).__name__}"
        ]
        if result["path_type_permission_safety"] == "NOT RUN":
            result["path_type_permission_safety"] = "FAIL"
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
    return result


def _destination_absolute_path(destination: pathlib.Path) -> pathlib.Path:
    raw_path = os.fspath(destination)
    if not raw_path or "\x00" in raw_path or "\\" in raw_path:
        raise BackupError("Destination path is empty or contains an unsafe separator")
    supplied = pathlib.Path(raw_path)
    if ".." in supplied.parts:
        raise BackupError("Destination path contains a parent-traversal component")
    absolute = pathlib.Path(os.path.abspath(supplied))
    if not absolute.is_absolute() or len(absolute.parts) < 2:
        raise BackupError("Destination path is not a supported absolute path")
    _safe_archive_path("/".join(absolute.parts[1:]))
    return absolute


def _paths_overlap(first: pathlib.Path, second: pathlib.Path) -> bool:
    try:
        return os.path.commonpath((str(first), str(second))) in {
            str(first),
            str(second),
        }
    except ValueError:
        return False


def _require_secure_destination_primitives() -> None:
    if (
        not hasattr(os, "O_NOFOLLOW")
        or not hasattr(os, "O_DIRECTORY")
        or not hasattr(os, "supports_dir_fd")
        or not hasattr(os, "supports_fd")
        or os.open not in os.supports_dir_fd
        or os.stat not in os.supports_dir_fd
        or os.listdir not in os.supports_fd
        or not hasattr(os, "pathconf")
    ):
        raise BackupError(
            "This platform lacks the no-follow directory-descriptor primitives "
            "required for safe restore planning"
        )


def _open_directory_path_nofollow(path: pathlib.Path) -> int:
    flags = (
        os.O_RDONLY
        | os.O_DIRECTORY
        | os.O_NOFOLLOW
        | getattr(os, "O_CLOEXEC", 0)
    )
    descriptor = os.open(path.anchor, flags)
    try:
        for component in path.parts[1:]:
            next_descriptor = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise BackupError("Destination parent is not a real directory")
        return descriptor
    except OSError as exc:
        os.close(descriptor)
        raise BackupError(
            f"Destination path contains an unavailable or symlinked parent: "
            f"{exc.strerror}"
        ) from exc
    except BaseException:
        os.close(descriptor)
        raise


def _pin_restore_destination(
    destination: pathlib.Path,
) -> tuple[
    pathlib.Path,
    int,
    os.stat_result,
    str,
    str,
    int | None,
    os.stat_result | None,
]:
    _require_secure_destination_primitives()
    absolute = _destination_absolute_path(destination)
    parent = absolute.parent
    leaf = absolute.name
    if not leaf:
        raise BackupError("Destination must name a directory below its parent")
    parent_fd = _open_directory_path_nofollow(parent)
    destination_fd: int | None = None
    try:
        parent_state = os.fstat(parent_fd)
        name_limit = os.pathconf(parent_fd, "PC_NAME_MAX")
        path_limit = os.pathconf(parent_fd, "PC_PATH_MAX")
        if (
            name_limit <= 0
            or path_limit <= 0
            or len(os.fsencode(leaf)) > name_limit
            or len(os.fsencode(str(absolute))) >= path_limit
        ):
            raise BackupError("Destination path exceeds supported filesystem limits")
        try:
            path_state = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return absolute, parent_fd, parent_state, leaf, "does_not_exist", None, None
        if not stat.S_ISDIR(path_state.st_mode) or stat.S_ISLNK(path_state.st_mode):
            raise BackupError(
                "Destination already exists and is not a real directory"
            )
        destination_fd = os.open(
            leaf,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_fd,
        )
        destination_state = os.fstat(destination_fd)
        if not _same_file_state(path_state, destination_state):
            raise BackupError("Destination changed while it was being pinned")
        if os.listdir(destination_fd):
            raise BackupError("Destination exists and is not empty")
        if not _same_file_state(destination_state, os.fstat(destination_fd)):
            raise BackupError("Destination changed while it was being inspected")
        return (
            absolute,
            parent_fd,
            parent_state,
            leaf,
            "exists_empty",
            destination_fd,
            destination_state,
        )
    except BaseException:
        if destination_fd is not None:
            os.close(destination_fd)
        os.close(parent_fd)
        raise


def _recheck_restore_destination(
    pinned: tuple[
        pathlib.Path,
        int,
        os.stat_result,
        str,
        str,
        int | None,
        os.stat_result | None,
    ],
) -> None:
    (
        absolute,
        parent_fd,
        parent_state,
        leaf,
        state,
        destination_fd,
        destination_state,
    ) = pinned
    parent_path_fd = _open_directory_path_nofollow(absolute.parent)
    try:
        if not _same_file_state(
            parent_state, os.fstat(parent_fd)
        ) or not _same_file_state(parent_state, os.fstat(parent_path_fd)):
            raise BackupError("Destination parent changed during restore planning")
        try:
            current_state = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            current_state = None
        if state == "does_not_exist":
            if current_state is not None:
                raise BackupError("Destination appeared during restore planning")
            return
        if (
            current_state is None
            or destination_fd is None
            or destination_state is None
            or not stat.S_ISDIR(current_state.st_mode)
            or not _same_file_state(destination_state, current_state)
            or not _same_file_state(destination_state, os.fstat(destination_fd))
            or os.listdir(destination_fd)
        ):
            raise BackupError("Destination changed during restore planning")
    finally:
        os.close(parent_path_fd)


def _restore_plan_files(
    manifest: dict[str, object],
    destination: pathlib.Path,
    parent_fd: int,
) -> tuple[list[dict[str, object]], int]:
    file_entries = manifest.get("files")
    if not isinstance(file_entries, list):
        raise BackupError("Verified manifest file list is invalid")
    name_limit = os.pathconf(parent_fd, "PC_NAME_MAX")
    path_limit = os.pathconf(parent_fd, "PC_PATH_MAX")
    if name_limit <= 0 or path_limit <= 0:
        raise BackupError("Filesystem path limits cannot be established")
    planned: list[dict[str, object]] = []
    seen: set[str] = set()
    total_size = 0
    for entry in file_entries:
        if not isinstance(entry, dict):
            raise BackupError("Verified manifest contains an invalid file entry")
        if entry.get("category") == "metadata":
            continue
        relative = entry.get("relative_path")
        archive_path = entry.get("archive_path")
        size = entry.get("size")
        digest = entry.get("sha256")
        mode = entry.get("mode")
        category = entry.get("category")
        if (
            not isinstance(relative, str)
            or not isinstance(archive_path, str)
            or not isinstance(size, int)
            or not isinstance(digest, str)
            or not isinstance(mode, str)
            or not isinstance(category, str)
        ):
            raise BackupError("Verified manifest contains incomplete file metadata")
        parts = _safe_archive_path(relative)
        if archive_path != f"payload/{relative}":
            raise BackupError("Verified manifest has an inconsistent payload mapping")
        folded = relative.casefold()
        if folded in seen:
            raise BackupError("Restore plan contains duplicate destinations")
        seen.add(folded)
        if any(len(os.fsencode(part)) > name_limit for part in parts):
            raise BackupError(
                f"Destination filename exceeds filesystem limits: {relative}"
            )
        planned_path = destination.joinpath(*parts)
        if len(os.fsencode(str(planned_path))) >= path_limit:
            raise BackupError(f"Destination path exceeds filesystem limits: {relative}")
        total_size += size
        if total_size > MAX_TOTAL_MEMBER_BYTES:
            raise BackupError("Restore plan exceeds the supported total payload size")
        planned.append(
            {
                "relative_path": relative,
                "category": category,
                "size": size,
                "sha256": digest,
                "mode": mode,
            }
        )
    planned.sort(key=lambda item: str(item["relative_path"]))
    return planned, total_size


def restore_dry_run(
    backup_dir: pathlib.Path, destination: pathlib.Path
) -> dict[str, object]:
    limitations = [
        "This command creates a read-only plan; it does not restore files.",
        "Staged and unstaged patches are informational and are not applied.",
        "The archive does not serialize the Git index and cannot reconstruct exact staged state.",
        "The archive and unsigned checksum sidecar do not authenticate provenance.",
    ]
    result: dict[str, object] = {
        "overall": "FAIL",
        "errors": [],
        "warnings": [
            "SHA-256 verifies consistency with the sidecar, not trusted provenance."
        ],
        "destination": {"path": None, "state": "not_validated"},
        "verification": {"overall": "NOT RUN"},
        "planned_file_count": 0,
        "planned_byte_count": 0,
        "files": [],
        "recovery_items": {
            "deleted_tracked_paths": [],
            "patches": {},
        },
        "limitations": limitations,
    }
    pinned: tuple[
        pathlib.Path,
        int,
        os.stat_result,
        str,
        str,
        int | None,
        os.stat_result | None,
    ] | None = None
    try:
        repository_root = ROOT.resolve(strict=True)
        verified_backup_dir = backup_dir.resolve(strict=True)
        absolute_destination = _destination_absolute_path(destination)
        result["destination"] = {
            "path": str(absolute_destination),
            "state": "not_validated",
        }
        if absolute_destination == repository_root.parent:
            raise BackupError("Destination is the parent of the repository")
        for protected in (repository_root, verified_backup_dir):
            if _paths_overlap(absolute_destination, protected):
                raise BackupError(
                    "Destination overlaps the repository or backup directory"
                )
        pinned = _pin_restore_destination(absolute_destination)
        (
            absolute_destination,
            parent_fd,
            _parent_state,
            _leaf,
            state,
            _dest_fd,
            _dest_state,
        ) = pinned
        result["destination"] = {
            "path": str(absolute_destination),
            "state": state,
        }

        verification = verify_backup(backup_dir, include_manifest=True)
        verified_manifest = verification.pop("_verified_manifest", None)
        result["verification"] = verification
        if verification.get("overall") != "PASS":
            failures = verification.get("failures", [])
            result["errors"] = failures if isinstance(failures, list) and failures else [
                "Backup verification failed"
            ]
            return result
        if not isinstance(verified_manifest, dict):
            raise BackupError(
                "Restore planning requires a verified manifest-backed archive"
            )
        planned, total_size = _restore_plan_files(
            verified_manifest, absolute_destination, parent_fd
        )
        source = verified_manifest.get("source")
        patches = verified_manifest.get("patches")
        if not isinstance(source, dict) or not isinstance(patches, dict):
            raise BackupError("Verified manifest recovery metadata is invalid")
        patch_items: dict[str, dict[str, object]] = {}
        for patch_name in ("staged", "unstaged"):
            patch = patches.get(patch_name)
            if not isinstance(patch, dict):
                raise BackupError("Verified manifest patch metadata is invalid")
            patch_items[patch_name] = {
                "archive_path": patch["archive_path"],
                "size": patch["size"],
                "sha256": patch["sha256"],
                "applied": False,
            }
        deleted_paths = source.get("deleted_tracked_paths")
        if not isinstance(deleted_paths, list):
            raise BackupError("Verified manifest deleted-path list is invalid")
        result["files"] = planned
        result["planned_file_count"] = len(planned)
        result["planned_byte_count"] = total_size
        result["recovery_items"] = {
            "deleted_tracked_paths": deleted_paths,
            "patches": patch_items,
        }
        warnings = verification.get("warnings", [])
        if isinstance(warnings, list):
            result["warnings"] = sorted(
                set(result["warnings"] + warnings)
            )
        _recheck_restore_destination(pinned)
        result["overall"] = "PASS"
    except (BackupError, OSError, ValueError) as exc:
        result["errors"] = [str(exc)]
        if result["destination"]["state"] == "not_validated":
            result["destination"]["state"] = "invalid"
    except Exception as exc:
        result["errors"] = [
            f"Restore planning failed unexpectedly: {type(exc).__name__}"
        ]
        if result["destination"]["state"] == "not_validated":
            result["destination"]["state"] = "invalid"
    finally:
        if pinned is not None:
            if pinned[5] is not None:
                os.close(pinned[5])
            os.close(pinned[1])
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="parmar_backup.py",
        description="Create and verify versioned PARMAR worktree backups.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    backup = subparsers.add_parser("backup", help="create a new worktree backup")
    backup.add_argument(
        "--output-dir",
        required=True,
        type=pathlib.Path,
        help="existing output directory outside the repository",
    )
    backup.add_argument(
        "--include-ignored",
        action="append",
        metavar="REPO_RELATIVE_PATH",
        help="include one explicitly allowlisted ignored file (may be supplied once)",
    )
    verify = subparsers.add_parser(
        "verify", help="verify an existing backup without extracting it"
    )
    verify.add_argument(
        "--backup-dir",
        required=True,
        type=pathlib.Path,
        help="directory containing exactly one timestamped archive and sidecar",
    )
    restore = subparsers.add_parser(
        "restore",
        help="create a read-only restore plan; no files are restored",
        description=(
            "Verify a manifest-backed backup and report a non-destructive restore "
            "plan. This command never creates the destination or restores files."
        ),
    )
    restore.add_argument(
        "--dry-run",
        action="store_true",
        required=True,
        help="required: only produce a read-only plan; no restore writes are enabled",
    )
    restore.add_argument(
        "--backup-dir",
        required=True,
        type=pathlib.Path,
        help="directory containing exactly one timestamped archive and sidecar",
    )
    restore.add_argument(
        "--destination",
        required=True,
        type=pathlib.Path,
        help="fresh, empty, or not-yet-existing destination directory",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "verify":
        result = verify_backup(args.backup_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["overall"] == "PASS" else 1
    if args.command == "restore":
        result = restore_dry_run(args.backup_dir, args.destination)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["overall"] == "PASS" else 1
    if args.include_ignored and len(args.include_ignored) != 1:
        print("Backup failed: --include-ignored may be supplied only once", file=sys.stderr)
        return 2
    try:
        selection = args.include_ignored[0] if args.include_ignored else None
        create_backup(args.output_dir, selection)
    except (BackupError, OSError) as error:
        print(f"Backup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
