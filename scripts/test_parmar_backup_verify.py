import base64
import gzip
import hashlib
import io
import json
import os
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
import zlib
from collections.abc import Callable
from contextlib import redirect_stdout
from io import StringIO
from typing import BinaryIO
from unittest import mock

from scripts import parmar_backup


ROOT_NAME = "PARMAR-v1-worktree-backup-20261102T102820Z"
ARCHIVE_NAME = f"{ROOT_NAME}.tar.gz"
PATCH_DATA = {
    "metadata/staged.patch": b"staged patch\n",
    "metadata/unstaged.patch": b"unstaged patch\n",
}


def _file_member(
    name: str,
    data: bytes,
    mode: int = 0o600,
    member_type: bytes = tarfile.REGTYPE,
    linkname: str = "",
) -> tuple[tarfile.TarInfo, bytes | None]:
    info = tarfile.TarInfo(name)
    info.mode = mode
    info.type = member_type
    info.linkname = linkname
    info.size = len(data) if member_type == tarfile.REGTYPE else 0
    return info, data if member_type == tarfile.REGTYPE else None


class BackupVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="parmar-verify-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)

    def _create_fixture(
        self,
        *,
        payloads: dict[str, bytes] | None = None,
        payload_overrides: dict[str, bytes] | None = None,
        omit_payloads: set[str] | None = None,
        extra_members: list[tuple[str, bytes, int, bytes, str]] | None = None,
        transform: Callable[[dict[str, object]], None] | None = None,
        raw_manifest: bytes | None = None,
        omit_manifest: bool = False,
        sidecar: bytes | None = None,
        truncate: bool = False,
        legacy: bool = False,
        pax_headers: dict[str, dict[str, str]] | None = None,
    ) -> pathlib.Path:
        archive_path = self.directory / ARCHIVE_NAME
        if legacy:
            self._write_legacy(archive_path)
        else:
            self._write_current(
                archive_path,
                payloads or {},
                payload_overrides or {},
                omit_payloads or set(),
                extra_members or [],
                transform,
                raw_manifest,
                omit_manifest,
                pax_headers or {},
            )
        if truncate:
            with archive_path.open("r+b") as output:
                output.truncate(max(12, archive_path.stat().st_size // 2))
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        sidecar_path = self.directory / f"{ARCHIVE_NAME}.sha256"
        sidecar_path.write_bytes(
            sidecar
            if sidecar is not None
            else f"{digest}  {ARCHIVE_NAME}\n".encode("ascii")
        )
        return archive_path

    def _write_current(
        self,
        archive_path: pathlib.Path,
        payloads: dict[str, bytes],
        payload_overrides: dict[str, bytes],
        omit_payloads: set[str],
        extra_members: list[tuple[str, bytes, int, bytes, str]],
        transform: Callable[[dict[str, object]], None] | None,
        raw_manifest: bytes | None,
        omit_manifest: bool,
        pax_headers: dict[str, dict[str, str]],
    ) -> None:
        files: list[dict[str, object]] = []
        archive_members: list[tuple[str, bytes, int, bytes, str]] = []
        for path, data in payloads.items():
            relative = pathlib.PurePosixPath(path).as_posix()
            files.append(
                {
                    "relative_path": relative,
                    "archive_path": f"payload/{relative}",
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "mode": "0644",
                    "category": "untracked",
                }
            )
            if relative not in omit_payloads:
                archive_members.append(
                    (
                        f"{ROOT_NAME}/payload/{relative}",
                        payload_overrides.get(relative, data),
                        0o644,
                        tarfile.REGTYPE,
                        "",
                    )
                )
        for path, data in PATCH_DATA.items():
            files.append(
                {
                    "relative_path": path,
                    "archive_path": path,
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "mode": "0600",
                    "category": "metadata",
                }
            )
            archive_members.append(
                (
                    f"{ROOT_NAME}/{path}",
                    data,
                    0o600,
                    tarfile.REGTYPE,
                    "",
                )
            )
        manifest: dict[str, object] = {
            "format": "parmar-worktree-backup",
            "version": 1,
            "created_at_utc": "2026-11-02T10:28:20+00:00",
            "source": {
                "repository": "/synthetic/PARMAR-v1",
                "head": "a" * 40,
                "branch": "main",
                "deleted_tracked_paths": [],
                "git_status_porcelain_v1_z_base64": base64.b64encode(b"").decode(
                    "ascii"
                ),
                "git_status_sha256": hashlib.sha256(b"").hexdigest(),
            },
            "patches": {
                name.removeprefix("metadata/").removesuffix(".patch"): {
                    "archive_path": name,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "size": len(data),
                }
                for name, data in PATCH_DATA.items()
            },
            "files": files,
            "exclusions": [],
        }
        if transform is not None:
            transform(manifest)
        manifest_data = (
            raw_manifest
            if raw_manifest is not None
            else json.dumps(manifest, sort_keys=True).encode("utf-8")
        )
        if not omit_manifest:
            archive_members.append(
                (
                    f"{ROOT_NAME}/metadata/manifest.json",
                    manifest_data,
                    0o600,
                    tarfile.REGTYPE,
                    "",
                )
            )
        archive_members.extend(extra_members)
        with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
            for name in (
                f"{ROOT_NAME}/",
                f"{ROOT_NAME}/metadata/",
                f"{ROOT_NAME}/payload/",
            ):
                info = tarfile.TarInfo(name)
                info.type = tarfile.DIRTYPE
                info.mode = 0o700
                archive.addfile(info)
            for name, data, mode, member_type, linkname in archive_members:
                info, body = _file_member(name, data, mode, member_type, linkname)
                if name in pax_headers:
                    info.pax_headers = pax_headers[name]
                archive.addfile(info, io.BytesIO(body) if body is not None else None)

    def _write_legacy(self, archive_path: pathlib.Path) -> None:
        files = {
            "README.txt": b"Tracked staged+unstaged diff: tracked-changes.patch\n",
            "tracked-changes.patch": b"legacy patch\n",
            "source-status.txt": b" M sample.txt\n",
            "source-branch.txt": b"main\n",
            "source-head.txt": (b"a" * 40) + b"\n",
            "untracked-files.txt": b"sample.txt\n",
            "preserved-ignored/README.txt": b"ignored audit log preserved\n",
            "untracked/sample.txt": b"synthetic\n",
        }
        directories = {"", "untracked", "preserved-ignored"}
        with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
            for directory in sorted(directories):
                name = f"{ROOT_NAME}/{directory}".rstrip("/") + "/"
                info = tarfile.TarInfo(name)
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                archive.addfile(info)
            for name, data in files.items():
                info = tarfile.TarInfo(f"{ROOT_NAME}/{name}")
                info.mode = 0o644
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))

    def _verify(self) -> dict[str, object]:
        return parmar_backup.verify_backup(self.directory)

    def _assert_failed(self, **fixture_options: object) -> dict[str, object]:
        self._create_fixture(**fixture_options)
        result = self._verify()
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertTrue(result["failures"])
        return result

    @staticmethod
    def _set_status(
        manifest: dict[str, object], status: bytes, deleted_paths: list[str]
    ) -> None:
        source = manifest["source"]
        assert isinstance(source, dict)
        source["git_status_porcelain_v1_z_base64"] = base64.b64encode(
            status
        ).decode("ascii")
        source["git_status_sha256"] = hashlib.sha256(status).hexdigest()
        source["deleted_tracked_paths"] = deleted_paths

    def test_valid_archive_and_payload_hashes_pass(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one", "two.bin": b"\x00\xff"})
        result = self._verify()
        self.assertEqual(result["overall"], "PASS", result)
        self.assertEqual(result["archive_checksum"], "PASS")
        self.assertEqual(result["manifest"], "PASS")
        self.assertEqual(result["per_file_hash_size"], "PASS")
        self.assertEqual(result["payload_count"], 2)

    def test_empty_payload_and_patch_members_pass(self) -> None:
        self._create_fixture()
        result = self._verify()
        self.assertEqual(result["overall"], "PASS", result)
        self.assertEqual(result["payload_count"], 0)

    def test_incorrect_sidecar_digest_fails(self) -> None:
        self._assert_failed(sidecar=b"0" * 64 + b"  " + ARCHIVE_NAME.encode() + b"\n")

    def test_malformed_sidecar_fails(self) -> None:
        self._assert_failed(sidecar=b"not a checksum\n")

    def test_truncated_archive_fails(self) -> None:
        self._assert_failed(truncate=True)

    def test_missing_manifest_fails_closed(self) -> None:
        self._assert_failed(omit_manifest=True)

    def test_invalid_manifest_json_fails(self) -> None:
        self._assert_failed(raw_manifest=b"{not json")

    def test_duplicate_manifest_json_key_fails(self) -> None:
        self._assert_failed(
            raw_manifest=b'{"format":"parmar-worktree-backup","version":1,"version":1}'
        )

    def test_unsupported_version_fails(self) -> None:
        self._assert_failed(transform=lambda manifest: manifest.update(version=99))

    def test_missing_declared_payload_fails(self) -> None:
        self._assert_failed(
            payloads={"missing.txt": b"declared"}, omit_payloads={"missing.txt"}
        )

    def test_unexpected_payload_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/undeclared.txt",
                b"unexpected",
                0o644,
                tarfile.REGTYPE,
                "",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_duplicate_archive_member_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/duplicate.txt",
                b"duplicate",
                0o644,
                tarfile.REGTYPE,
                "",
            )
        ]
        self._assert_failed(
            payloads={"duplicate.txt": b"duplicate"}, extra_members=extra
        )

    def test_duplicate_manifest_path_fails(self) -> None:
        def duplicate(manifest: dict[str, object]) -> None:
            files = manifest["files"]
            assert isinstance(files, list)
            files.append(dict(files[0]))

        self._assert_failed(payloads={"dup.txt": b"x"}, transform=duplicate)

    def test_absolute_archive_path_fails(self) -> None:
        extra = [("/outside", b"x", 0o644, tarfile.REGTYPE, "")]
        self._assert_failed(extra_members=extra)

    def test_parent_traversal_archive_path_fails(self) -> None:
        extra = [(f"{ROOT_NAME}/payload/../outside", b"x", 0o644, tarfile.REGTYPE, "")]
        self._assert_failed(extra_members=extra)

    def test_backslash_archive_path_fails(self) -> None:
        extra = [(f"{ROOT_NAME}/payload\\outside", b"x", 0o644, tarfile.REGTYPE, "")]
        self._assert_failed(extra_members=extra)

    def test_drive_prefix_archive_path_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/C:/outside",
                b"x",
                0o644,
                tarfile.REGTYPE,
                "",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_empty_archive_path_component_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload//outside",
                b"x",
                0o644,
                tarfile.REGTYPE,
                "",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_noncanonical_archive_path_alias_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/./outside",
                b"x",
                0o644,
                tarfile.REGTYPE,
                "",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_symlink_member_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/link",
                b"",
                0o777,
                tarfile.SYMTYPE,
                "../../outside",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_hardlink_member_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/link",
                b"",
                0o644,
                tarfile.LNKTYPE,
                f"{ROOT_NAME}/metadata/manifest.json",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_device_member_fails(self) -> None:
        extra = [(f"{ROOT_NAME}/payload/device", b"", 0o600, tarfile.CHRTYPE, "")]
        self._assert_failed(extra_members=extra)

    def test_fifo_member_fails(self) -> None:
        extra = [(f"{ROOT_NAME}/payload/fifo", b"", 0o600, tarfile.FIFOTYPE, "")]
        self._assert_failed(extra_members=extra)

    def test_unsupported_contiguous_member_fails(self) -> None:
        extra = [
            (
                f"{ROOT_NAME}/payload/contiguous",
                b"",
                0o600,
                tarfile.CONTTYPE,
                "",
            )
        ]
        self._assert_failed(extra_members=extra)

    def test_privileged_permission_bits_fail(self) -> None:
        self._assert_failed(
            payloads={"unsafe": b"x"},
            extra_members=[
                (f"{ROOT_NAME}/payload/privileged", b"x", 0o4755, tarfile.REGTYPE, "")
            ],
        )

    def test_manifest_privileged_permission_bits_fail(self) -> None:
        def privileged_mode(manifest: dict[str, object]) -> None:
            files = manifest["files"]
            assert isinstance(files, list)
            files[0]["mode"] = "04755"

        self._assert_failed(payloads={"unsafe": b"x"}, transform=privileged_mode)

    def test_file_directory_collision_fails(self) -> None:
        self._assert_failed(payloads={"collision": b"x", "collision/child": b"y"})

    def test_incorrect_payload_size_fails(self) -> None:
        def wrong_size(manifest: dict[str, object]) -> None:
            files = manifest["files"]
            assert isinstance(files, list)
            files[0]["size"] += 1

        self._assert_failed(payloads={"size.txt": b"x"}, transform=wrong_size)

    def test_incorrect_payload_hash_fails(self) -> None:
        self._assert_failed(
            payloads={"hash.txt": b"before"},
            payload_overrides={"hash.txt": b"after"},
        )

    def test_incorrect_archive_mapping_fails(self) -> None:
        def wrong_mapping(manifest: dict[str, object]) -> None:
            files = manifest["files"]
            assert isinstance(files, list)
            files[0]["archive_path"] = "payload/other.txt"

        self._assert_failed(payloads={"mapping.txt": b"x"}, transform=wrong_mapping)

    def test_malformed_metadata_fails(self) -> None:
        def wrong_head(manifest: dict[str, object]) -> None:
            source = manifest["source"]
            assert isinstance(source, dict)
            source["head"] = "not-a-commit"

        self._assert_failed(transform=wrong_head)

    def test_invalid_porcelain_record_fails_with_matching_digest(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b"!! hidden.txt\0", []
            )
        )

    def test_unterminated_porcelain_record_fails_with_matching_digest(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" M modified.txt", []
            )
        )

    def test_non_utf8_porcelain_path_fails_with_matching_digest(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" M \xff.txt\0", []
            )
        )

    def test_rename_record_requires_source_path(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b"R  renamed.txt\0", []
            )
        )

    def test_worktree_rename_code_fails_with_matching_digest(self) -> None:
        result = self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" R new.txt\0old.txt\0", ["old.txt"]
            )
        )
        self.assertIn("impossible status code", str(result["failures"]))

    def test_deleted_paths_must_match_porcelain_status(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" D deleted.txt\0", []
            )
        )

    def test_deleted_path_trailing_slash_is_rejected(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" D deleted.txt\0", ["deleted.txt/"]
            )
        )

    def test_deleted_path_traversal_is_rejected(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" D ../deleted.txt\0", ["../deleted.txt"]
            )
        )

    def test_deleted_path_absolute_alias_is_rejected(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest, b" D /deleted.txt\0", ["/deleted.txt"]
            )
        )

    def test_duplicate_deleted_paths_are_rejected_after_validation(self) -> None:
        self._assert_failed(
            transform=lambda manifest: self._set_status(
                manifest,
                b" D deleted.txt\0",
                ["deleted.txt", "deleted.txt"],
            )
        )

    def test_porcelain_rename_source_matches_deleted_path(self) -> None:
        self._create_fixture(
            transform=lambda manifest: self._set_status(
                manifest, b"R  renamed.txt\0old.txt\0", ["old.txt"]
            )
        )
        result = self._verify()
        self.assertEqual(result["overall"], "PASS", result)

    def test_porcelain_copy_source_is_not_deleted(self) -> None:
        self._create_fixture(
            transform=lambda manifest: self._set_status(
                manifest, b"C  copied.txt\0source.txt\0", []
            )
        )
        result = self._verify()
        self.assertEqual(result["overall"], "PASS", result)

    def test_oversized_pax_extension_fails(self) -> None:
        member = f"{ROOT_NAME}/payload/oversized.txt"
        result = self._assert_failed(
            pax_headers={
                member: {
                    "comment": "x" * (parmar_backup.MAX_PAX_EXTENSION_BYTES + 1)
                }
            },
            extra_members=[
                (member, b"x", 0o644, tarfile.REGTYPE, "")
            ],
        )
        self.assertIn("PAX extension", str(result["failures"]))

    def test_unsupported_pax_field_fails(self) -> None:
        member = f"{ROOT_NAME}/payload/extra.txt"
        result = self._assert_failed(
            pax_headers={member: {"comment": "unsupported"}},
            extra_members=[(member, b"x", 0o644, tarfile.REGTYPE, "")],
        )
        self.assertIn("unsupported field", str(result["failures"]))

    def test_overlong_path_component_fails(self) -> None:
        result = self._assert_failed(payloads={"a" * 256: b"x"})
        self.assertIn("component exceeds", str(result["failures"]))

    def test_overlong_total_archive_path_fails(self) -> None:
        path = "/".join(["a" * 202] * 20)
        result = self._assert_failed(payloads={path: b"x"})
        self.assertIn("total length", str(result["failures"]))

    def test_appended_empty_gzip_member_fails(self) -> None:
        archive_path = self._create_fixture()
        archive_path.write_bytes(archive_path.read_bytes() + gzip.compress(b""))
        sidecar_path = self.directory / f"{ARCHIVE_NAME}.sha256"
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        sidecar_path.write_bytes(f"{digest}  {ARCHIVE_NAME}\n".encode("ascii"))
        result = self._assert_existing_archive_fails()
        self.assertIn("gzip member", str(result["failures"]))

    def test_duplicated_gzip_stream_fails(self) -> None:
        archive_path = self._create_fixture()
        original = archive_path.read_bytes()
        archive_path.write_bytes(original + original)
        sidecar_path = self.directory / f"{ARCHIVE_NAME}.sha256"
        digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        sidecar_path.write_bytes(f"{digest}  {ARCHIVE_NAME}\n".encode("ascii"))
        result = self._assert_existing_archive_fails()
        self.assertIn("gzip member", str(result["failures"]))

    def _assert_existing_archive_fails(self) -> dict[str, object]:
        result = self._verify()
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertTrue(result["failures"])
        return result

    def test_non_utc_timestamp_fails(self) -> None:
        self._assert_failed(
            transform=lambda manifest: manifest.update(
                {"created_at_utc": "2026-11-02T10:28:20+01:00"}
            )
        )

    def test_malformed_timestamp_fails(self) -> None:
        self._assert_failed(
            transform=lambda manifest: manifest.update(
                {"created_at_utc": "not-a-timestamp"}
            )
        )

    def test_backup_directory_symlink_replacement_during_verification_fails(self) -> None:
        self._create_fixture()
        moved_directory = self.directory.with_name(self.directory.name + "-moved")
        original_stream = parmar_backup._stream_archive_members

        def replace_directory(
            source: BinaryIO, archive_root: str
        ) -> tuple[
            dict[str, dict[str, object]],
            dict[str, bytes],
            list[str],
            int,
        ]:
            self.directory.rename(moved_directory)
            self.directory.symlink_to(moved_directory, target_is_directory=True)
            return original_stream(source, archive_root)

        try:
            with mock.patch.object(
                parmar_backup,
                "_stream_archive_members",
                side_effect=replace_directory,
            ):
                result = self._verify()
        finally:
            if self.directory.is_symlink():
                self.directory.unlink()
            if moved_directory.exists():
                moved_directory.rename(self.directory)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("directory changed", str(result["failures"]))

    def test_sidecar_replacement_during_verification_fails(self) -> None:
        self._create_fixture()
        sidecar_path = self.directory / f"{ARCHIVE_NAME}.sha256"
        replacement_path = self.directory / "replacement.sha256"
        original_stream = parmar_backup._stream_archive_members

        def replace_sidecar(source: BinaryIO, archive_root: str) -> tuple[
            dict[str, dict[str, object]],
            dict[str, bytes],
            list[str],
            int,
        ]:
            replacement_path.write_bytes(sidecar_path.read_bytes())
            os.replace(replacement_path, sidecar_path)
            return original_stream(source, archive_root)

        with mock.patch.object(
            parmar_backup, "_stream_archive_members", side_effect=replace_sidecar
        ):
            result = self._verify()
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("sidecar changed", str(result["failures"]))

    def test_sidecar_modification_during_verification_fails(self) -> None:
        self._create_fixture()
        sidecar_path = self.directory / f"{ARCHIVE_NAME}.sha256"
        original_stream = parmar_backup._stream_archive_members

        def modify_sidecar(source: BinaryIO, archive_root: str) -> tuple[
            dict[str, dict[str, object]],
            dict[str, bytes],
            list[str],
            int,
        ]:
            current = sidecar_path.read_bytes()
            sidecar_path.write_bytes(b"0" + current[1:])
            return original_stream(source, archive_root)

        with mock.patch.object(
            parmar_backup, "_stream_archive_members", side_effect=modify_sidecar
        ):
            result = self._verify()
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("sidecar changed", str(result["failures"]))

    def _plan(self, destination: pathlib.Path) -> dict[str, object]:
        return parmar_backup.restore_dry_run(self.directory, destination)

    def _destination_parent(self) -> pathlib.Path:
        temporary = tempfile.TemporaryDirectory(prefix="parmar-restore-destination-")
        self.addCleanup(temporary.cleanup)
        return pathlib.Path(temporary.name)

    def test_restore_plan_lists_verified_nested_and_unicode_payloads(self) -> None:
        self._create_fixture(
            payloads={
                "nested/deeper/file.txt": b"synthetic payload\n",
                "unicode/caf\u00e9.txt": b"synthetic unicode payload\n",
            }
        )
        archive = self.directory / ARCHIVE_NAME
        sidecar = self.directory / f"{ARCHIVE_NAME}.sha256"
        source_hashes = (
            hashlib.sha256(archive.read_bytes()).digest(),
            hashlib.sha256(sidecar.read_bytes()).digest(),
        )
        destination = self._destination_parent() / "not-created"
        result = self._plan(destination)
        self.assertEqual(result["overall"], "PASS", result)
        self.assertEqual(result["destination"]["state"], "does_not_exist")
        self.assertFalse(destination.exists())
        files = result["files"]
        self.assertEqual(
            [entry["relative_path"] for entry in files],
            ["nested/deeper/file.txt", "unicode/caf\u00e9.txt"],
        )
        self.assertEqual(result["planned_file_count"], 2)
        self.assertEqual(
            result["planned_byte_count"],
            len(b"synthetic payload\n") + len(b"synthetic unicode payload\n"),
        )
        self.assertEqual(
            result["recovery_items"]["patches"]["staged"]["applied"], False
        )
        self.assertTrue(
            any("not trusted provenance" in warning for warning in result["warnings"])
        )
        self.assertEqual(
            source_hashes,
            (
                hashlib.sha256(archive.read_bytes()).digest(),
                hashlib.sha256(sidecar.read_bytes()).digest(),
            ),
        )

    def test_restore_plan_accepts_existing_empty_destination_without_changes(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        parent = self._destination_parent()
        destination = parent / "empty"
        destination.mkdir()
        before = list(destination.iterdir())
        result = self._plan(destination)
        self.assertEqual(result["overall"], "PASS", result)
        self.assertEqual(result["destination"]["state"], "exists_empty")
        self.assertEqual(list(destination.iterdir()), before)

    def test_restore_plan_accepts_valid_empty_payload(self) -> None:
        self._create_fixture()
        destination = self._destination_parent() / "empty-plan"
        result = self._plan(destination)
        self.assertEqual(result["overall"], "PASS", result)
        self.assertEqual(result["planned_file_count"], 0)
        self.assertEqual(result["planned_byte_count"], 0)
        self.assertFalse(destination.exists())

    def test_restore_plan_rejects_bad_checksum_with_structured_failure(self) -> None:
        archive = self._create_fixture(payloads={"one.txt": b"one"})
        with archive.open("r+b") as output:
            output.seek(0)
            first = output.read(1)
            output.seek(0)
            output.write(bytes([first[0] ^ 1]))
        destination = self._destination_parent() / "not-created"
        result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertTrue(result["errors"])
        self.assertEqual(result["verification"]["overall"], "FAIL")
        self.assertFalse(destination.exists())

    def test_restore_plan_rejects_corrupt_gzip_even_with_matching_sidecar(self) -> None:
        archive = self._create_fixture(payloads={"one.txt": b"one"})
        archive.write_bytes(b"not a gzip archive")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        (self.directory / f"{ARCHIVE_NAME}.sha256").write_text(
            f"{digest}  {ARCHIVE_NAME}\n", encoding="ascii"
        )
        destination = self._destination_parent() / "not-created"
        result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertEqual(result["verification"]["archive_checksum"], "PASS")
        self.assertTrue(result["errors"])
        self.assertFalse(destination.exists())

    def test_restore_plan_rejects_missing_sidecar_with_structured_failure(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        (self.directory / f"{ARCHIVE_NAME}.sha256").unlink()
        destination = self._destination_parent() / "not-created"
        result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertTrue(result["errors"])
        self.assertEqual(result["verification"]["overall"], "FAIL")
        self.assertFalse(destination.exists())

    def test_restore_plan_rejects_legacy_archive_without_manifest(self) -> None:
        self._create_fixture(legacy=True)
        destination = self._destination_parent() / "not-created"
        result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertEqual(result["verification"]["overall"], "PASS")
        self.assertIn("manifest-backed", str(result["errors"]))
        self.assertFalse(destination.exists())

    def test_restore_plan_rejects_destination_overlap_and_nonempty_directory(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        cases = (
            (parmar_backup.ROOT, "repository"),
            (parmar_backup.ROOT.parent, "repository parent"),
            (self.directory, "backup directory"),
            (self.directory.parent, "backup parent"),
            (self.directory / "child", "backup descendant"),
        )
        for destination, label in cases:
            with self.subTest(label=label):
                result = self._plan(destination)
                self.assertEqual(result["overall"], "FAIL", result)
                self.assertTrue(result["errors"])

        parent = self._destination_parent()
        nonempty = parent / "not-empty"
        nonempty.mkdir()
        (nonempty / "existing.txt").write_text("leave intact\n", encoding="utf-8")
        result = self._plan(nonempty)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("not empty", str(result["errors"]))
        self.assertEqual(
            (nonempty / "existing.txt").read_text(encoding="utf-8"),
            "leave intact\n",
        )

    def test_restore_plan_rejects_symlink_destination_and_parent(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        parent = self._destination_parent()
        target = parent / "target"
        target.mkdir()
        destination_link = parent / "destination-link"
        destination_link.symlink_to(target, target_is_directory=True)
        result = self._plan(destination_link)
        self.assertEqual(result["overall"], "FAIL", result)

        parent_link = parent / "parent-link"
        parent_link.symlink_to(parent, target_is_directory=True)
        result = self._plan(parent_link / "destination")
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertFalse((parent / "destination").exists())

    def test_restore_plan_rejects_parent_traversal_and_missing_parent(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        parent = self._destination_parent()
        result = self._plan(parent / ".." / "outside")
        self.assertEqual(result["overall"], "FAIL", result)
        result = self._plan(parent / "missing-parent" / "destination")
        self.assertEqual(result["overall"], "FAIL", result)

    def test_restore_plan_rejects_destination_path_over_filesystem_limit(self) -> None:
        relative = "/".join(["a" * 240] * 16)
        self._create_fixture(payloads={relative: b"one"})
        parent = self._destination_parent() / ("p" * 240)
        parent.mkdir()
        result = self._plan(parent / "destination")
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertTrue(
            any("filesystem limits" in error for error in result["errors"]),
            result,
        )
        self.assertFalse((parent / "destination").exists())

    def test_restore_plan_detects_destination_appearing_during_planning(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        parent = self._destination_parent()
        destination = parent / "appeared"
        destination_target = parent / "target"
        destination_target.mkdir()
        original = parmar_backup._restore_plan_files

        def create_destination(
            manifest: dict[str, object],
            target: pathlib.Path,
            parent_fd: int,
        ) -> tuple[list[dict[str, object]], int]:
            planned = original(manifest, target, parent_fd)
            destination.symlink_to(destination_target, target_is_directory=True)
            return planned

        self.addCleanup(lambda: destination.unlink() if destination.is_symlink() else None)
        with mock.patch.object(
            parmar_backup, "_restore_plan_files", side_effect=create_destination
        ):
            result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("changed", str(result["errors"]))

    def test_restore_plan_detects_existing_destination_replaced_by_file(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        parent = self._destination_parent()
        destination = parent / "replaced"
        destination.mkdir()
        original = parmar_backup._restore_plan_files

        def replace_destination(
            manifest: dict[str, object],
            target: pathlib.Path,
            parent_fd: int,
        ) -> tuple[list[dict[str, object]], int]:
            planned = original(manifest, target, parent_fd)
            destination.rmdir()
            destination.write_text("synthetic replacement\n", encoding="utf-8")
            return planned

        with mock.patch.object(
            parmar_backup, "_restore_plan_files", side_effect=replace_destination
        ):
            result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("changed", str(result["errors"]))
        self.assertEqual(
            destination.read_text(encoding="utf-8"), "synthetic replacement\n"
        )

    def test_restore_plan_detects_existing_destination_replaced_by_symlink(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        parent = self._destination_parent()
        destination = parent / "replaced-by-link"
        target = parent / "target"
        destination.mkdir()
        target.mkdir()
        original = parmar_backup._restore_plan_files

        def replace_destination(
            manifest: dict[str, object],
            planned_destination: pathlib.Path,
            parent_fd: int,
        ) -> tuple[list[dict[str, object]], int]:
            planned = original(manifest, planned_destination, parent_fd)
            destination.rmdir()
            destination.symlink_to(target, target_is_directory=True)
            return planned

        self.addCleanup(
            lambda: destination.unlink() if destination.is_symlink() else None
        )
        with mock.patch.object(
            parmar_backup, "_restore_plan_files", side_effect=replace_destination
        ):
            result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("changed", str(result["errors"]))

    def test_restore_plan_fails_closed_without_directory_descriptor_support(self) -> None:
        self._create_fixture(payloads={"one.txt": b"one"})
        destination = self._destination_parent() / "not-created"
        with mock.patch.object(parmar_backup.os, "supports_dir_fd", set()):
            result = self._plan(destination)
        self.assertEqual(result["overall"], "FAIL", result)
        self.assertIn("lacks the no-follow", str(result["errors"]))
        self.assertFalse(destination.exists())

    def test_legacy_archive_reports_structure_only(self) -> None:
        self._create_fixture(legacy=True)
        result = self._verify()
        self.assertEqual(result["overall"], "PASS", result)
        self.assertEqual(
            result["legacy_compatibility"],
            "LEGACY_CHECKSUM_AND_STRUCTURE_ONLY",
        )
        self.assertEqual(result["manifest"], "NOT AVAILABLE")
        self.assertEqual(result["per_file_hash_size"], "NOT AVAILABLE")


class PorcelainGitSemanticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="parmar-git-status-")
        self.addCleanup(self.temporary.cleanup)
        self.repository = pathlib.Path(self.temporary.name)
        self._git("init", "--quiet")
        self._git("config", "user.name", "Synthetic Test")
        self._git("config", "user.email", "synthetic@example.invalid")
        (self.repository / "old.txt").write_text("original\n", encoding="utf-8")
        self._git("add", "old.txt")
        self._git("commit", "--quiet", "-m", "initial")

    def _git(self, *arguments: str) -> bytes:
        result = subprocess.run(
            ["git", "-C", str(self.repository), *arguments],
            check=True,
            capture_output=True,
        )
        return result.stdout

    def _assert_status(self, expected: bytes, deleted_paths: set[str]) -> None:
        status = self._git(
            "status", "--porcelain=v1", "-z", "--untracked-files=all"
        )
        self.assertEqual(status, expected)
        self.assertEqual(parmar_backup._parse_porcelain_v1_z(status), deleted_paths)

    def test_staged_rename_uses_index_rename_record(self) -> None:
        self._git("mv", "old.txt", "new.txt")
        self._assert_status(b"R  new.txt\0old.txt\0", {"old.txt"})

    def test_unstaged_rename_is_deletion_and_untracked_path(self) -> None:
        (self.repository / "old.txt").rename(self.repository / "new.txt")
        self._assert_status(
            b" D old.txt\0?? new.txt\0",
            {"old.txt"},
        )

    def test_staged_rename_followed_by_worktree_modification(self) -> None:
        self._git("mv", "old.txt", "new.txt")
        (self.repository / "new.txt").write_text("modified\n", encoding="utf-8")
        self._assert_status(b"RM new.txt\0old.txt\0", {"old.txt"})

    def test_staged_deletion_with_untracked_replacement(self) -> None:
        self._git("rm", "--quiet", "old.txt")
        (self.repository / "replacement.txt").write_text(
            "replacement\n", encoding="utf-8"
        )
        self._assert_status(
            b"D  old.txt\0?? replacement.txt\0",
            {"old.txt"},
        )


class BackupRestoreIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="parmar-backup-e2e-")
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name)
        self.repository = self.base / "synthetic-repository"
        self.repository.mkdir()
        subprocess.run(
            ["git", "-C", str(self.repository), "init", "--quiet"],
            check=True,
            capture_output=True,
        )
        self._write_empty_baseline_commit()
        (self.repository / "nested").mkdir()
        (self.repository / "nested" / "sample.txt").write_text(
            "synthetic untracked content\n", encoding="utf-8"
        )
        (self.repository / "nested" / "caf\u00e9.txt").write_text(
            "synthetic unicode content\n", encoding="utf-8"
        )
        self.output_directory = self.base / "synthetic-backups"
        self.output_directory.mkdir()
        self.destination = self.base / "synthetic-restore"

    def _write_empty_baseline_commit(self) -> None:
        git_directory = self.repository / ".git"
        head_text = (git_directory / "HEAD").read_text(encoding="ascii")
        ref = head_text.strip().removeprefix("ref: ")
        if not ref.startswith("refs/heads/"):
            self.fail("Synthetic repository did not initialize a branch")
        tree_header = b"tree 0\0"
        tree_oid = hashlib.sha1(tree_header).hexdigest()
        self._write_object(git_directory, tree_oid, tree_header)
        commit_body = (
            f"tree {tree_oid}\n".encode("ascii")
            + b"author Synthetic Fixture <synthetic@example.invalid> 0 +0000\n"
            + b"committer Synthetic Fixture <synthetic@example.invalid> 0 +0000\n\n"
            + b"Synthetic empty-tree baseline\n"
        )
        commit_header = f"commit {len(commit_body)}\0".encode("ascii") + commit_body
        commit_oid = hashlib.sha1(commit_header).hexdigest()
        self._write_object(git_directory, commit_oid, commit_header)
        ref_path = git_directory.joinpath(*ref.split("/"))
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        ref_path.write_text(commit_oid + "\n", encoding="ascii")

    @staticmethod
    def _write_object(git_directory: pathlib.Path, oid: str, data: bytes) -> None:
        object_path = git_directory / "objects" / oid[:2] / oid[2:]
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(zlib.compress(data))

    def _git(self, *arguments: str) -> bytes:
        result = subprocess.run(
            ["git", "-C", str(self.repository), *arguments],
            check=True,
            capture_output=True,
        )
        return result.stdout

    def _repository_fingerprint(self) -> tuple[bytes, ...]:
        return (
            self._git("rev-parse", "HEAD"),
            self._git("branch", "--show-current"),
            self._git("diff", "--cached", "--binary", "HEAD"),
            self._git("diff", "--binary", "HEAD"),
            self._git("status", "--porcelain=v1", "-z"),
            self._git("ls-files", "--others", "--exclude-standard", "-z"),
        )

    def test_synthetic_backup_verify_and_restore_plan_workflow(self) -> None:
        before = self._repository_fingerprint()
        with mock.patch.object(parmar_backup, "ROOT", self.repository):
            with redirect_stdout(StringIO()):
                backup_exit = parmar_backup.main(
                    ["backup", "--output-dir", str(self.output_directory)]
                )
            self.assertEqual(backup_exit, 0)
            backup_directories = list(self.output_directory.iterdir())
            self.assertEqual(len(backup_directories), 1)
            backup_directory = backup_directories[0]
            verify_stdout = StringIO()
            with redirect_stdout(verify_stdout):
                verify_exit = parmar_backup.main(
                    ["verify", "--backup-dir", str(backup_directory)]
                )
            self.assertEqual(verify_exit, 0, verify_stdout.getvalue())
            verified = json.loads(verify_stdout.getvalue())
            self.assertEqual(verified["overall"], "PASS", verified)
            plan_stdout = StringIO()
            with redirect_stdout(plan_stdout):
                plan_exit = parmar_backup.main(
                    [
                        "restore",
                        "--dry-run",
                        "--backup-dir",
                        str(backup_directory),
                        "--destination",
                        str(self.destination),
                    ]
                )
            self.assertEqual(plan_exit, 0, plan_stdout.getvalue())
            plan = parmar_backup.restore_dry_run(
                backup_directory, self.destination
            )
            self.assertEqual(plan["overall"], "PASS", plan)
            self.assertFalse(self.destination.exists())
            manifest_result = parmar_backup.verify_backup(
                backup_directory, include_manifest=True
            )
            manifest = manifest_result["_verified_manifest"]
            payload_metadata = {
                entry["relative_path"]: (entry["size"], entry["sha256"], entry["mode"])
                for entry in manifest["files"]
                if entry["category"] != "metadata"
            }
            plan_metadata = {
                entry["relative_path"]: (
                    entry["size"],
                    entry["sha256"],
                    entry["mode"],
                )
                for entry in plan["files"]
            }
            self.assertEqual(plan_metadata, payload_metadata)
            self.assertEqual(self._repository_fingerprint(), before)

            corrupt_directory = self.base / "corrupt-backup-copy"
            corrupt_directory.mkdir()
            archive = next(backup_directory.glob("*.tar.gz"))
            sidecar = next(backup_directory.glob("*.tar.gz.sha256"))
            corrupt_archive = corrupt_directory / archive.name
            corrupt_archive.write_bytes(archive.read_bytes())
            (corrupt_directory / sidecar.name).write_bytes(sidecar.read_bytes())
            with corrupt_archive.open("r+b") as output:
                output.seek(0)
                byte = output.read(1)
                output.seek(0)
                output.write(bytes([byte[0] ^ 1]))
            corrupt_destination = self.base / "corrupt-restore"
            self.assertEqual(
                parmar_backup.verify_backup(corrupt_directory)["overall"],
                "FAIL",
            )
            failed_plan = parmar_backup.restore_dry_run(
                corrupt_directory, corrupt_destination
            )
            self.assertEqual(failed_plan["overall"], "FAIL", failed_plan)
            self.assertTrue(failed_plan["errors"])
            self.assertFalse(corrupt_destination.exists())
            failed_cli_output = StringIO()
            with redirect_stdout(failed_cli_output):
                failed_cli_exit = parmar_backup.main(
                    [
                        "restore",
                        "--dry-run",
                        "--backup-dir",
                        str(corrupt_directory),
                        "--destination",
                        str(corrupt_destination),
                    ]
                )
            self.assertEqual(failed_cli_exit, 1)
            self.assertEqual(
                json.loads(failed_cli_output.getvalue())["overall"], "FAIL"
            )
            self.assertEqual(self._repository_fingerprint(), before)


if __name__ == "__main__":
    unittest.main()
