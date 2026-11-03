# PARMAR V1 Backup and Recovery Runbook

## Scope and limits

The backup command captures a point-in-time worktree view: eligible tracked
files as they exist when the backup is made, modified tracked files,
non-ignored untracked files, deleted tracked paths as metadata, staged and
unstaged Git patches, and an optional explicitly allowlisted ignored audit log.
It excludes Git internals and applies filename, directory, extension, and
heuristic secret-detection policies. A backup is not a Git repository clone,
does not contain all ignored files, and does not serialize the Git index.

The v1 manifest records source HEAD/branch/status, deleted tracked paths, each
payload's relative path, archive path, category, size, SHA-256, and mode, plus
the staged and unstaged patch hashes and sizes. Verification checks the archive
checksum against the sidecar, parses the archive without extracting it, and
compares every manifest entry, payload size/hash/mode, path, and expected
member set. This establishes consistency with the recorded values; it does not
establish who created the archive. The sidecar is unsigned. An attacker able to
replace both archive and sidecar can create a matching pair. Preserve a checksum
through a trusted, separate channel if authenticated provenance is required.

The verifier rejects absolute paths, drive prefixes, backslashes, traversal,
ambiguous/noncanonical components, duplicate or case-ambiguous names, unsafe
file/directory collisions, symlinks, hard links, devices, FIFOs, and other
unsupported archive member types. It rejects privileged permission bits,
accepts only supported per-file PAX path metadata, and rejects global PAX
headers, GNU long-name extensions, and unsupported PAX fields. Limits include
20 GiB compressed archive size, 8 GiB per member, 40 GiB aggregate member size,
16 MiB manifest size, 100,000 archive members, 255 UTF-8 bytes per path
component, and 4,095 UTF-8 bytes per archive path. PAX extensions are limited
to 64 KiB each, eight records per extension, 1 MiB total, and 4,096 total
records. Group/world writable archive modes are reported as warnings. No
archive member is extracted by backup verification or restore planning. Source
symlinks and special files cannot be backed up as regular payloads. Hard-link
relationships, ownership, ACLs, extended attributes, and timestamps are not
restored by this format.

The backup's file payloads represent the current worktree, not the content of
the index. Deleted tracked paths are reported but not recreated. Staged and
unstaged patches are retained as informational recovery items; the planner does
not apply them. The format does not preserve the complete Git index, including
all index flags, conflict stages, extensions, and exact staged state. It cannot
promise exact Git-state reconstruction. Legacy A47 archives may pass the
legacy checksum-and-structure verifier, but the restore planner requires a
manifest-backed v1 archive and will refuse to plan from a legacy archive.

The optional `--include-ignored` argument supports only the allowlisted
`PARMAR/audit/decision_log.jsonl` path. Secret scanning detects selected
credential patterns and is not exhaustive; review the intended backup scope
and never treat the scanner as proof that a backup contains no secrets.

## Commands

Create a backup under an existing directory outside the repository:

```sh
python3 -B scripts/parmar_backup.py backup --output-dir /path/to/backup-root
```

The command creates a private, timestamped subdirectory containing one
`.tar.gz` archive and its `.sha256` sidecar. The archive contains
`metadata/manifest.json`, `metadata/staged.patch`, `metadata/unstaged.patch`,
and eligible files under `payload/`. The command prints the created directory,
archive path, digest, manifest file count, and exclusions. To include the
single approved ignored audit log, pass
`--include-ignored PARMAR/audit/decision_log.jsonl`.
Each backup directory is expected to contain exactly one timestamped archive
and its matching sidecar. Verification and restore-plan JSON is printed to
standard output; reports are not written to disk by these commands.

Verify a specific created backup directory without extracting it:

```sh
python3 -B scripts/parmar_backup.py verify --backup-dir /path/to/backup-root/PARMAR-v1-worktree-backup-TIMESTAMP
```

Verification prints deterministic JSON. A successful result has
`"overall": "PASS"` and exit code `0`; an invalid or unsupported backup has
`"overall": "FAIL"` and a nonzero exit code. A passing checksum alone is not
proof of provenance or authenticity.

Produce a non-destructive restore plan:

```sh
python3 -B scripts/parmar_backup.py restore --dry-run --backup-dir /path/to/backup-root/PARMAR-v1-worktree-backup-TIMESTAMP --destination /path/to/fresh-destination
```

`--dry-run` is required. The command verifies the backup before planning,
requires a manifest-backed archive and a destination that is either absent
(with an existing safe parent directory) or an existing empty directory, and
never creates or changes the destination. It refuses destinations overlapping
the repository or backup directory, the repository itself or its parent,
symlinked paths, and non-empty directories. Its JSON includes the verification
result, destination state, planned payload paths with category/size/SHA-256/
mode, deleted-path and patch metadata, warnings, limitations, and totals.
`"overall": "PASS"` with exit code `0` means only that a read-only plan was
constructed. Any invalid archive, unsafe destination, or invalid plan produces
`"overall": "FAIL"` and a nonzero exit code. It does not write files, delete
paths, apply patches, merge, overwrite, roll back, or restore.

## Checksum and independent storage

On systems with GNU `sha256sum`, verify the archive using its existing sidecar:

```sh
sha256sum --check /path/to/PARMAR-v1-worktree-backup-TIMESTAMP.tar.gz.sha256
```

After transferring an archive, verify the checksum again at the destination.
Transfer the archive and checksum through an organization-approved process to
trusted external media or storage that is independent of the source device and
its failure domain. Confirm access controls and keep a trusted checksum or
signature separately when provenance matters. No transfer or external-storage
capability is implied by these instructions. Another directory in the same
Codespace, workspace, or storage volume is not an independent backup.

## Recovery checklist

1. Keep the current working repository untouched and make a separate safety
   copy before any recovery attempt.
2. Locate the archive and matching sidecar; verify the checksum and run the
   complete `verify` command.
3. If provenance matters, compare against a checksum or signature obtained
   through a trusted independent channel. Do not trust a sidecar merely because
   it matches the archive.
4. Review the restore dry-run JSON. Use a new, empty destination outside the
   repository and backup directory. Do not use the current repository, its
   parent, or the only copy of any working data.
5. Compare the planned paths, sizes, hashes, modes, deletions, and patch
   metadata with the intended recovery scope. Remember that deletion records
   are informational and patches are not applied by the planner.
6. Preserve the archive and sidecar unchanged. Do not treat a successful
   dry-run as a completed restore.
7. There is no restore-write command in this version. Any future restore
   operation requires a separately reviewed and tested implementation; do not
   overwrite the only working repository.

## Platform and filesystem support

Backup creation and verification rely on POSIX-style no-follow opens, directory
file descriptors, safe regular-file checks, and hard-link publication. Restore
planning additionally requires no-follow directory-descriptor traversal,
descriptor-based directory listing/stat, and filesystem path-limit queries.
Linux is the validated platform for this workflow. Windows is unsupported;
other operating systems, network filesystems, unusual mounts, and filesystems
with different permission or descriptor semantics are not established as
supported. Required primitives or path limits that cannot be established cause
the operation to fail closed. Archive permission modes are validated and
reported; this dry-run does not set permissions on disk.
