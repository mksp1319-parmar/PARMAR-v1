# AETHER Phase 2R.4 — Admission Freeze and Independent Cleanup Evidence

**Decision: NO-GO.** The current implementation has no cgroup containment or
process-admission barrier. A delegated cgroup plus an independent `populated 0`
read would still be insufficient unless all authorities able to add processes
are fenced first. Keep `REMOTE_BROWSING_ENABLED=false`. This is an architecture
proposal and test plan, not evidence that the proposed controls work on a
supported Ubuntu host.

## Scope and evidence boundary

Reviewed the Linux launcher, browser-child supervisor and broker, isolation
probe, [main.cjs](./main.cjs) shutdown wiring, readiness document, repository
cgroup requirements, security gate, and existing lifecycle and cleanup tests.
The Electron main process defers orderly `before-quit` while the supervisor's
`stop()` promise resolves and logs cleanup failures; SIGTERM/SIGINT route
through `app.quit()`. This is orderly app-level coordination, not independent
survival after manager failure. No AETHER systemd unit, cgroup service
configuration, or cgroup lifecycle implementation exists. The existing
`ISOLATION-READINESS.md` has unrelated uncommitted changes; this report and its
small readiness addendum preserve them.

The current host reports cgroup v2 at `/sys/fs/cgroup`, with this process in
`/init`; `systemd --user` is unavailable and the cgroup root is not writable by
the current account. This is not a delegated-cgroup or native-Ubuntu test.
No privileged host configuration was changed.

### Current implementation and authority boundaries

- [isolation-launcher.cjs](./isolation-launcher.cjs) starts a fixed
  `unshare`/`setpriv` command with `shell: false`, detached process-group
  semantics, and pipes. Its cleanup sends `SIGKILL` to `-child.pid`; there is
  no cgroup placement or cgroup read.
- [browser-child-supervisor.cjs](./browser-child-supervisor.cjs) starts the
  production Electron child the same way, validates its network namespace,
  and requests graceful stop before process-group signaling. It has no
  cgroup authority, independent observer, or durable cleanup record.
- [browser-child-broker.cjs](./browser-child-broker.cjs) authenticates the
  app-level stop message. Closing that IPC channel is not an OS admission
  barrier.
- [isolation-probe.cjs](./isolation-probe.cjs) verifies network namespace,
  interfaces/routes, capabilities, and `no_new_privs`; it does not inspect
  process admission or cgroup state.
- [security.cjs](./security.cjs) hard-codes
  `REMOTE_BROWSING_ENABLED = false`.
- Existing tests cover mocked supervisor behavior, namespace probes, process
  groups, and process-tree cleanup. They do not test cgroup permissions,
  stale `cgroup.procs` descriptors, concurrent cgroup migration, an independent
  cgroup observer, or durable evidence.
- The repository's earlier cgroup requirements in [README.md](../README.md)
  correctly reject process groups and require a delegated cgroup and external
  monitor, but the lifecycle requirements do not themselves establish an
  admission freeze before accepting `populated 0`.

The app's lifecycle manager can request stop and signal the process group. The
child can fork descendants while it remains alive. The protocol capability and
PID/UID checks protect the IPC contract, not cgroup authority. There is no
application cgroup writer in the current code; therefore it cannot establish
the required process-cgroup guarantee.

## Threat and authority model

The target guarantee covers a compromised browser descendant, ordinary
application processes, duplicate requests, and manager/observer process
failures. The kernel, systemd's system manager, and a small dedicated
admission-control service are trusted authorities. A malicious host root,
kernel, hypervisor, or storage device that lies about durable writes is outside
the achievable guarantee and must not be presented as covered.

| Actor | Current authority | Required target boundary |
|---|---|---|
| Browser, renderer, Chromium descendants | Can fork while running; same app UID. No cgroup access control is configured or verified. | No cgroup write access, no inherited cgroup writer descriptors, and no authority to migrate into or out of the launch cgroup. |
| Main app / lifecycle manager | Can send stop IPC and signal its process group. In a user-delegated design, same-UID code may also be able to open delegated cgroup files. | Must not own, inherit, or be able to reopen `cgroup.procs`; a shutdown flag alone is insufficient. |
| Future admission controller | None exists. | Sole AETHER-level admission writer; only a narrowly scoped, generation-bound authority. systemd/root remains an explicitly trusted external authority. |
| Independent observer | None exists. | Read-only access to the launch cgroup and a durable evidence store outside the child hierarchy; cannot launch or migrate a process. |
| systemd / host administrator | No AETHER unit was found. A system service manager or root can manage cgroups; a delegated user manager may manage its delegated subtree. | Explicitly trusted and ordered to retain the anchor until the observer commits evidence and acknowledges it. No claim is made against root. |

A user-level systemd delegation to the same UID as the browser does not by
itself separate the browser from the cgroup writer: processes sharing that UID
may share file permissions. A production implementation needs a reviewed
privilege boundary, such as a small system service that owns the cgroup
authority and a browser identity that cannot access it. It must not add
capabilities or modify host policy during ordinary application startup.

## Race and authority analysis

In the table, “prevention” describes the proposed target, not the current
implementation. Linux cgroup v2 provides controls for moving, freezing,
killing, and observing processes; its documented interface does not provide a
one-way “seal this cgroup against all future writers” operation. A sample of
`cgroup.events` is evidence of a state at a time, not admission closure.

| Scenario | Actor and race window | Enforceable prevention in a target design | Evidence required | Residual failure modes |
|---|---|---|---|---|
| 1. Entry after observer reads `populated 0` | Any process still authorized to write the destination `cgroup.procs`; the window starts immediately after the read. | Fence every in-scope AETHER writer before the observer reads. Treat systemd/root as a trusted external authority that must not start or migrate another process into the closed generation. | Admission-controller generation is closed; controller's writer has exited; manager and child are denied cgroup writes; only then read `cgroup.events` and `cgroup.procs`. | A privileged host actor can always reopen or repopulate the cgroup. If any unaccounted writer exists, `populated 0` is not stable proof. |
| 2. Already-open writable `cgroup.procs` FD | A writer that opened the file before permissions/path changes can write after the observer's sample. | Do not treat chmod, rename, unlink, unmount, or an app queue close as revocation. Ensure the only FD holder is a non-forking admission controller; close it and wait for that process to exit before verification. Do not pass/inherit the FD. | Native helper audit and FD inheritance tests; controller exit observed by an independent process (prefer pidfd); stale-FD test on the supported kernel/cgroupfs. | Linux does not give the observer a general inventory of every privileged/open FD. A duplicated FD, compromised controller, or root can defeat the design. Exact cgroupfs behavior after permission changes requires an experiment; it is not assumed. |
| 3. Migration into the cgroup during shutdown | A writer with destination `cgroup.procs` permission can move a process in after signaling or verification. | Separate admission control from termination. Fence the migration writer before descendant cleanup. Restrict all other users, including the browser UID, from opening/writing the target. | Denied migration attempts from the child and manager; controller FD/process fence recorded before empty observation. | Trusted systemd/root can still move processes. Any second delegated writer invalidates the proof. |
| 4. Descendant forks during termination | A live descendant can fork until it exits; a fork may race PID enumeration or graceful shutdown. | Do not enumerate PIDs as the kill primitive. Use cgroup-wide `cgroup.kill` where supported, then observe completion only after admission is fenced. A dedicated PID namespace with a controlled namespace init can be an additional kernel teardown boundary, not a substitute for cgroup migration control. | Native concurrent-fork test; cgroup-wide kill result; repeated process/cgroup observations after writer fencing. If PID namespaces are added, separately verify init exit and namespace behavior. | `cgroup.kill` is not an admission seal; a later writer may repopulate. Kernel version, controller configuration, and fork/migration interaction require native tests. Uninterruptible tasks may delay termination. |
| 5. Lifecycle manager retains authority | The current manager remains alive after it observes child exit; a delegated manager may still write or signal. | The manager is never given admission authority. If a separate controller temporarily owns it, it must close the admission FD and exit; killing children must not depend on the app manager remaining alive. | Permission-denial tests for manager identity; controller exit and no-restart evidence; observer runs in a separate failure domain. | systemd/root remains trusted. A same-UID delegation or manager-controlled restart can silently restore authority. |
| 6. Stale process handle or inherited descriptor reopens admission | A retained PID can be reused; an inherited/duplicated FD remains a write capability independent of application-level state. | Use pidfds for process identity and waits where available. Never pass the cgroup writer FD to the manager, child, observer, or workers. A controller exit closes its own descriptors, provided they were not copied. Prevent service restart from reopening the generation. | PID/start-time or pidfd identity, FD inheritance tests, service restart policy, and a generation ledger proving no later controller activation. | pidfds identify processes; they do not revoke cgroup descriptors. An unobserved duplicate or trusted root writer remains outside observer proof. |
| 7. Manager, observer, or both crash | A manager can disappear before requesting/finishing cleanup; an observer can disappear before or after committing evidence. | Persist stop intent outside the cgroup before shutdown. On restart, recover by launch ID and fail closed. No observer ACK means no success. A separately managed controller/observer can continue after the app manager exits; simultaneous loss leaves the generation quarantined. | Durable intent/evidence journal, process exit records, idempotent recovery, and explicit distinction between pre-commit and post-commit observer crash. | Abrupt host/power loss can interrupt storage writes. fsync cannot promise survival from faulty hardware or a lying filesystem/device. |
| 8. systemd stops/removes hierarchy before durable evidence | systemd stop, logout, reboot, timeout, or unit failure can kill processes and remove an empty cgroup while the observer is still writing. | Keep an anchor outside the child cgroup. The stop job must wait for the external observer's durable commit and ACK before removing the child cgroup. Shutdown ordering must keep the observer and evidence store available; if that cannot be satisfied, report quarantine. | Native `systemctl stop`/reboot tests with event ordering, cgroup identity, persistent evidence after restart, and proof the anchor was retained until ACK. | Forced shutdown may kill the observer or system manager before commit. No success can be claimed when the durable record or ACK is missing. |

### Kernel behavior versus assumptions

The following are documented Linux interfaces/semantics, not AETHER acceptance
results:

- cgroup v2 `cgroup.procs` represents processes in a cgroup and supports
  migration by writing a PID; `cgroup.events` reports `populated` state for a
  cgroup subtree; `cgroup.kill` provides a subtree-wide kill interface on
  kernels that implement it. None is documented as an immutable admission
  seal. See the [kernel cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html).
- A process exit closes its file descriptors. This is useful only if all
  copies of the admission descriptor are confined to that process. A
  descriptor deliberately passed or duplicated to another process survives
  the controller's exit.
- PID namespace init termination causes the kernel to kill remaining namespace
  members, and later process creation in that dead namespace fails. This
  provides a distinct process-creation boundary, but does not prohibit an
  external authorized actor from migrating some other process into a cgroup.
  See [pid_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).
- systemd's `KillMode=control-group` kills remaining processes of a unit during
  stop, subject to stop sequencing/timeouts. It is not an independent,
  durable-evidence protocol. See
  [systemd.kill(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html).

The following require experiments on each supported native Ubuntu/systemd
configuration: whether the intended delegated ownership actually denies
`cgroup.procs` access to every browser/manager identity; whether an already
open `cgroup.procs` descriptor still succeeds after attempted permission
changes; `cgroup.kill` behavior under concurrent fork and migration; exact
unit stop/removal ordering; PID namespace teardown as deployed; and persistence
of the evidence record across forced VM power loss. A mocked test or Codespace
result proves none of these kernel/service-manager properties.

## Architecture alternatives

| Criterion | A. Delegated cgroup anchor + lifecycle manager + independent observer | B. Dedicated admission controller with authority transition | C. PID namespace teardown, not cgroup emptiness alone |
|---|---|---|---|
| Process admission | Delegated manager can place processes; an observer's empty read does not stop later writes. | Strongest candidate if one isolated controller is the sole admission writer and all other actors are denied. | Dead PID namespace prevents new namespace members, but not an external process migrated into the cgroup. |
| Existing writable FDs | Remain a risk for every delegated writer; observer cannot infer they are gone from `populated 0`. | Controller closes the only admission FD and exits; safe only if no copy escaped and no service restart reopens it. | PID namespace teardown does not revoke cgroup FDs or cgroup migration rights. |
| Process migration | Any actor with delegated write access can migrate a process in during/after shutdown. | Separate identity/permission boundary denies migration except the controller and trusted system manager; fence controller before verification. | Does not itself prevent cgroup migration by a host-level actor. |
| Fork races | cgroup-wide kill is better than PID enumeration but does not close later admission. | `cgroup.kill` after admission fence; optional PID namespace init death gives defense in depth. | Kernel kills remaining members when namespace init exits; no cgroup-migration guarantee. |
| Manager/observer crashes | Manager death needs an external reaper; observer death loses evidence unless separately durable. | App manager is non-authoritative; controller/observer recover from a persistent generation journal. Simultaneous failure remains quarantine. | Namespace init death is kernel-mediated, but durable evidence and systemd ordering still need an observer. |
| systemd stop/reboot | Requires a retained anchor; the observer must beat unit removal. | Requires an external system service and ordering that waits for durable ACK; root systemd is a trusted authority. | Namespace teardown may proceed during stop, but systemd can still remove cgroups before evidence. |
| Durable evidence | Not inherent; observer must persist outside the cgroup. | Explicit observer journal and ACK protocol can provide evidence under stated storage assumptions. | Namespace exit is not itself a durable evidence record. |
| Least privilege | User delegation is operationally convenient but may share authority with the same-UID child. | Narrow helper can hold only required cgroup FDs and drop unrelated privileges; deployment still has a privileged trusted component. | PID namespace creation may be unprivileged in some configurations, but does not replace required cgroup authority separation. |
| Operational complexity | Moderate initially; high risk of assuming `populated 0` is a barrier. | Highest: service packaging, distinct identities, FD confinement, restart policy, observer, journal, and stop ordering. | Adds another namespace/init lifecycle and tests; insufficient as the sole cgroup-admission solution. |

**Recommended target for evaluation: B, with C only as defense in depth.**
Use a small native system service as the sole admission authority; the desktop
manager and browser receive no cgroup writer FD or permission. Keep the
observer read-only and outside the browser hierarchy and manager failure
domain. A trusted systemd manager remains a root authority and must not start,
restart, or migrate a process into a closed generation. Do not use
`systemd-run` shell invocation or process-group signaling as a substitute for
this authority design.

The admission controller must establish membership before the child executes
application code, using a reviewed native launch path (for example a supported
systemd unit/cgroup API or a kernel-supported create-in-cgroup mechanism).
Do not spawn a browser first and rely on a later PID migration to close the
startup race. If the required system service, separate identity, kernel
features, or delegation cannot be established and verified without weakening
the host, do not launch the browser.

This is a candidate design, not an approval to implement it and not proof that
Linux provides a root-proof cgroup seal. The trust boundary must explicitly
exclude hostile root/systemd. A separate authority transition can fence
unprivileged writers under a tested configuration; a privileged actor can
always undo it.

## Verifiable lifecycle state machine

Every launch has a random immutable generation ID and only moves forward.
Duplicate stop requests for that generation are idempotent. Any missing,
contradictory, or unpersisted evidence transitions to **QUARANTINED**, never to
success. A quarantined generation cannot restart or enable remote browsing.

| Transition | Authorized actor and preconditions | Observable evidence | If evidence is missing | Reversible? |
|---|---|---|---|---|
| `ACTIVE → STOP_REQUESTED` | Authenticated lifecycle API; generation is active. Persist stop intent before returning success to the caller. | Durable intent with generation, boot ID, and monotonically increasing sequence; launch gate rejects new starts for this generation. | Enter `QUARANTINED`; block launches and remote browsing. | No. A new launch needs a new generation after cleanup. |
| `STOP_REQUESTED → ADMISSION_CLOSED` | Admission controller only; matching generation and durable stop intent. It rejects all launch/migration requests and will not issue another admission FD. | Controller's closed-generation record and denial of a subsequent admission request. | `QUARANTINED`; do not infer closure from a manager flag or closed IPC queue. | No. |
| `ADMISSION_CLOSED → WRITER_FENCED` | Admission controller closes every admission FD and exits; observer verifies controller process exit. Termination authority may retain only non-admission kill/read access. | pidfd/wait evidence for controller exit, controller generation, and tested proof that no FD was passed or inherited; manager/child write-denial checks. | `QUARANTINED`; no empty observation is accepted. | No. Reopening admission creates a different generation. |
| `WRITER_FENCED → DESCENDANTS_TERMINATED` | Termination controller with kill-only authority; admission writer is fenced. | Successful `cgroup.kill` operation (where supported), tracked child exit results, and any configured PID-namespace-init termination result. | Retry bounded cleanup; if still ambiguous or alive, `QUARANTINED`. | No. |
| `DESCENDANTS_TERMINATED → EMPTY_VERIFIED` | Independent read-only observer; writer fence is already evidenced. | `cgroup.events` says `populated 0`; `cgroup.procs` is empty; launch cgroup identity matches the generation. Read errors, identity changes, or reappearance fail. | `QUARANTINED`; retain the anchor and continue observation/cleanup if safe. | No under the writer-fence invariant; if population reappears, immediately quarantine. |
| `EMPTY_VERIFIED → EVIDENCE_DURABLE` | Independent observer; all prior records available. | Evidence record written to persistent storage outside the child cgroup, file `fsync` completed, atomic rename completed, and containing directory `fsync` completed. Record includes generation, boot ID, cgroup identity, controller/observer identities, kill result, and observed state. | `QUARANTINED`; never synthesize a durable result from memory or logs. | No. |
| `EVIDENCE_DURABLE → ACKNOWLEDGED` | Observer sends an authenticated ACK to the lifecycle manager/systemd integration. | ACK includes generation ID, durable record ID/hash, and observer sequence; duplicate ACK queries return the same result. | Keep retrying/querying; delayed or missing ACK means `QUARANTINED` to the caller, even if a durable record may later be recovered. | The durable fact is not reversible; ACK delivery may be retried. |
| `ACKNOWLEDGED → CGROUP_REMOVED` | Trusted cgroup owner/systemd integration only; matching ACK and verified empty cgroup. | Removal result and confirmation that the generation's cgroup identity no longer exists; evidence record remains outside it. | `QUARANTINED`; retain the empty anchor and evidence for recovery. | No. |
| `CGROUP_REMOVED → IDLE` | Lifecycle manager after durable removal event. | Durable terminal record links removal to the same generation and prior evidence hash. | `QUARANTINED`; no new generation until reconciled. | No. |

`QUARANTINED` is a terminal failure state for normal application flow. An
operator may perform a separately audited recovery after inspecting the
generation; recovery does not rewrite a missing record as successful evidence.
systemd must retain the anchor until `EVIDENCE_DURABLE` and ACK are complete.
If systemd stop/reboot ordering cannot do so, that stop is an unverified
quarantine.

## Evidence and acknowledgement protocol

1. Assign a generation UUID and record the cgroup identity (device/inode and
   expected path), boot ID, unit identity, and controller version. Keep durable
   state outside both the browser cgroup and volatile `/run`.
2. Record `STOP_REQUESTED` durably before acknowledging the request. Stop and
   restart requests are serialized by generation; duplicate stops return the
   same pending/completed result.
3. The admission controller closes the generation, fences all of its
   admission descriptors, and exits. The manager cannot reopen the cgroup.
   The observer verifies the exit and then asks the termination authority to
   kill the subtree.
4. The observer checks the exact cgroup identity, `cgroup.events`,
   `cgroup.procs`, and required process/namespace records only after the
   writer fence. It must not infer the fence from a previously empty read.
5. Commit an append-only, generation-linked evidence record outside the
   hierarchy. Use a temp file, `fsync`, atomic rename, and directory `fsync`;
   include the observed raw values and errors, not only a boolean `success`.
6. Only after durable commit send an authenticated ACK containing the record
   ID/hash. The manager/systemd stop path may remove the cgroup only after
   receiving that ACK. A retry is a query by generation, not a new cleanup.
7. If the manager crashes after commit but before ACK delivery, the observer
   returns the same committed record on recovery. If the observer crashes
   before commit, there is no ACK and no success. If either side cannot recover
   a consistent sequence, quarantine.

Durability is conditional on the filesystem, storage stack, and hardware
honoring flushes. A reboot/power-cut test is required on the supported
deployment; it cannot establish protection against a dishonest device.

## Failure matrix

| Failure point | Required recovery | Success permitted? |
|---|---|---|
| Manager crashes before stop intent | External service notices manager loss and records/initiates cleanup, or generation remains quarantined. | No, until independent evidence is durable and acknowledged. |
| Manager crashes after intent, before admission closes | Controller continues or recovery closes admission; no auto-restart may reopen the generation. | No. |
| Admission controller crashes before/while closing | Its own FDs close on exit, but recovery must prove no copies escaped and no replacement can reopen. Otherwise quarantine. | No, not from process exit alone. |
| Controller exits after closing admission | Observer confirms process exit and writer boundary, then continues kill/verify. | Not until later states commit. |
| Observer crashes before evidence `fsync` | Recover from durable intent and repeat verification; if the cgroup/identity is gone or ambiguous, quarantine. | No. |
| Observer crashes after durable commit, before ACK | Recover and return the same record/hash; resend ACK idempotently. | Only after ACK is accepted by the lifecycle integration. |
| `populated 0` changes or `cgroup.procs` is nonempty | Admission fence is suspect or wrong cgroup identity; quarantine and stop all new work. | No. |
| systemd stop/removal races with commit | Retain external evidence; absence of the expected cgroup/ACK ordering is quarantine. | No. |
| Reboot or abrupt host termination | On boot, reconcile durable generations and systemd/cgroup state; unmatched or missing evidence stays quarantined. | No for an incomplete generation. |
| Delayed/missing ACK or duplicate request | Query/retry by generation; do not remove the cgroup or claim success before ACK. | No until ACK. |

## Test plan

### Unprivileged unit tests

- Model every state transition and crash between each transition; assert that
  missing evidence always yields `QUARANTINED`.
- Duplicate and concurrent stop requests return one generation/result and
  cannot reopen admission; test delayed, duplicated, malformed, and missing
  ACKs.
- Inject observer crash before durable commit and after commit/before ACK;
  verify recovery never fabricates evidence and post-commit retry returns the
  same hash.
- Model fork/migration events before and after the writer fence and prove the
  state machine refuses `EMPTY_VERIFIED` when the fence is absent.
- Test file journal ordering, atomic replacement, `fsync` error propagation,
  cgroup identity mismatch, and systemd stop ordering using fakes.

These are protocol/model tests only. They do **not** prove kernel admission
control, cgroup descriptor behavior, systemd ordering, or disk durability.

### Privileged native-Ubuntu acceptance tests

Run only in a disposable, supported Ubuntu 24.04 x86_64 VM with a systemd
manager and a deliberately pre-provisioned test delegation. No test may modify
system-wide sysctls, AppArmor, kernel settings, or host policy. Capture kernel,
systemd, filesystem, cgroup-v2, and helper versions with every result.

- **Admission/fork:** launch a test child in the real launch cgroup and race
  many forks against stop. Verify no child executes outside the intended
  boundary; fence admission, kill, and prove no task can enter after the
  observer's empty sample. Record any transient repopulation as failure.
- **Concurrent migration:** have an authorized test writer and denied
  manager/child identities attempt migration before and after fencing. A
  post-fence successful migration is a release blocker.
- **Stale descriptor:** open `cgroup.procs` before closure, retain it across
  attempted permission/path changes, and attempt a write after the observer
  sees empty. Repeat with inherited and duplicated descriptors. The accepted
  design must show the only admission FD holder exited and every forbidden
  write is denied; do not infer this from chmod or pathname disappearance.
- **Manager crash at every state:** SIGKILL the unprivileged manager at each
  transition. Verify the independent controller/observer either completes
  and records a valid result or leaves quarantine; no recovery may restart
  admission for the old generation.
- **Observer crash:** terminate before evidence commit and after commit but
  before ACK. Verify the first case never succeeds and the second returns the
  same durable record on recovery.
- **systemd stop/reboot:** issue `systemctl stop` during shutdown, stop the
  anchor, and perform normal reboot plus abrupt disposable-VM power-off at
  selected transition points. Verify ordering, cgroup retention through ACK,
  and recovery after boot. Missing evidence is a failure, not a pass.
- **Duplicates/acknowledgement:** issue concurrent duplicate requests and
  delay/drop ACKs. Verify one generation, no early cgroup removal, idempotent
  recovery, and quarantine until durable ACK.
- **Kill semantics:** exercise `cgroup.kill` during concurrent fork and
  migration on every supported kernel. Verify unsupported/missing controls
  fail closed; do not substitute a PID scan or process group.

Native tests must use the actual packaged production launch path. Preserve
machine-readable observer records, systemd journal, cgroup snapshots, and
failure diagnostics. A test run on a different kernel, systemd version, or
delegation profile does not certify the supported host.

### Existing tests run for this review

No cgroup or admission-freeze test was available to run. The existing
`browser-child`, `isolation-prototype`, `production-child-network-probe`, and
`main-lifecycle` suites remain process-group/namespace or mocked app-lifecycle
coverage, not kernel admission tests. The targeted command
`REMOTE_BROWSING_ENABLED=false node --test --test-concurrency=1 test/main-lifecycle.test.cjs test/browser-child.test.cjs test/isolation-prototype.test.cjs test/production-child-network-probe.test.cjs`
completed with **63 tests: 61 passed, 0 failed, 2 skipped**. One packaged
artifact check and one production packaged-child probe were skipped; live
namespace/process-group tests that ran do not establish cgroup admission
control. The packaged `electron-isolation-integration` test was not run for
this review.

## Residual risks and exact remote-browsing gates

Residual risks include a privileged host/systemd actor re-admitting a process;
an escaped or duplicated writer FD; a kernel/cgroupfs/systemd behavior change;
the browser and manager sharing an identity or filesystem access; tasks stuck
in uninterruptible sleep; controller/observer implementation compromise;
evidence storage not honoring flushes; and forced shutdown before durable
commit. These must either be excluded explicitly by the trust model or leave
the generation quarantined. No claim is made that cgroup state prevents
network access; this report addresses process lifecycle only.

Remote browsing may not be enabled until all of the following hold:

1. A reviewed implementation has a sole admission authority, a distinct
   unprivileged browser identity, no browser/manager access to admission FDs
   or writable cgroup paths, and an independently operated read-only observer.
2. Membership is established before browser application code executes; there
   is no direct-spawn or process-group fallback. The supported kernel, cgroup
   v2, systemd, unit/delegation, and filesystem versions are pinned and
   acceptance-tested.
3. Every race in this report passes native tests: post-empty admission,
   stale/inherited descriptors, concurrent migration, fork during kill,
   manager/observer failures, systemd stop/reboot, duplicate requests, and
   delayed/missing ACK. Test reports preserve raw evidence and demonstrate that
   every missing-evidence path is quarantine.
4. Durable evidence is outside the child hierarchy, is committed before ACK,
   survives supported reboot/power-loss tests, and systemd cannot remove the
   hierarchy before the ACK.
5. The production package—not only a fixture—passes independent review of its
   process, network, and lifecycle boundaries, including the existing
   IPv4/IPv6, DNS, UDP/QUIC, WebSocket, proxy, redirect, and failover gates in
   [README.md](../README.md).
6. A separate security review accepts the complete evidence and the stated
   trusted-root/systemd and storage assumptions.

Until every gate is met, **NO-GO** and `REMOTE_BROWSING_ENABLED=false`.
