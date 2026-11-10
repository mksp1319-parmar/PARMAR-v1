# AETHER Phase 2R.5 — Dedicated Admission Controller Feasibility

**Recommendation: NO-GO for production or remote browsing.** A dedicated
controller is feasible as an authority-separation component, but it does not
create a kernel-enforced, irrevocable cgroup admission seal. Linux cgroup v2
provides process placement, kill, and observation interfaces; it does not
provide an operation that revokes all existing cgroup writers or prevents a
trusted systemd/root authority from reopening admission. A manager/service
protocol can fence AETHER's own writers under a carefully tested trust model.
It cannot turn `populated 0` into proof against systemd, host root, a leaked
writable descriptor, or unverified shutdown/storage behavior.

This is a feasibility study only. No helper, service, cgroup, account, or
systemd configuration was implemented. `REMOTE_BROWSING_ENABLED=false`
remains enforced.

## 1. Scope and repository state

Inspected the repository state before review. No staged changes were present.
The worktree already contained Android modifications, the uncommitted
Phase 2R.4 addition to `ISOLATION-READINESS.md`, and the untracked
`ADMISSION-FREEZE-ARCHITECTURE.md`; all were preserved. No Git operation that
stages, resets, cleans, commits, or publishes was performed.

Reviewed:

- [ADMISSION-FREEZE-ARCHITECTURE.md](./ADMISSION-FREEZE-ARCHITECTURE.md)
- [ISOLATION-READINESS.md](./ISOLATION-READINESS.md)
- [isolation-launcher.cjs](./isolation-launcher.cjs)
- [browser-child-supervisor.cjs](./browser-child-supervisor.cjs)
- [isolation-probe.cjs](./isolation-probe.cjs)
- [browser-child-broker.cjs](./browser-child-broker.cjs)
- [main.cjs](./main.cjs)
- [security.cjs](./security.cjs)
- [README.md](../README.md)
- Existing tests: `main-lifecycle.test.cjs`, `browser-child.test.cjs`,
  `isolation-prototype.test.cjs`, `production-child-network-probe.test.cjs`,
  and `electron-isolation-integration.test.cjs`.

No AETHER systemd unit, helper, delegated cgroup, observer, or cgroup
lifecycle test exists. Current production cleanup signals a detached process
group. The main process waits on the supervisor during orderly `before-quit`;
that is not an independent manager/observer failure boundary.

The current host is a container with cgroup v2 mounted at `/sys/fs/cgroup`,
the current process in `/init`, no running user systemd manager, and no
writable delegated subtree established. This environment cannot validate the
proposed systemd or cgroup authority behavior.

## 2. Trust-boundary diagram

The diagram is a target proposal, not an installed architecture. A local
broker/controller protocol must contain fixed operations only; there is no
generic command, executable path, unit-property, signal, or cgroup-path input.

```text
 Interactive desktop session                         system services

 Electron main
 UID/GID: logged-in desktop account
 no capabilities; no cgroup access
       |
       | authenticated fixed lifecycle requests
       v
 Lifecycle manager
 UID/GID: aether-lifecycle (dedicated system account)
 no capabilities; no cgroup access; cannot signal browser
       |
       | private local IPC; peer credentials + request ID
       v
 Admission controller / fixed privileged broker
 UID/GID: dedicated service identity; see feasibility limits below
 no direct cgroup FD in the preferred systemd-mediated design
 accepts fixed AETHER operations only
       |
       | constrained system D-Bus calls for exact generated unit IDs
       v
 systemd system manager (PID 1; trusted host authority)
 owns the hierarchy and may create, migrate, kill, or remove cgroups
       |                                      |
       | creates fixed unit before exec       | keeps generation slice
       v                                      v
 Browser + Chromium descendants          Independent observer
 UID/GID: aether-browser                  UID/GID: aether-observer
 no capabilities; no cgroup write         read-only cgroup view
 no cgroup FDs; no manager IPC             durable evidence directory
       |                                      |
       +----------- process state ------------+
                                              |
                               durable evidence -> ACK -> manager

 Host administrator (UID 0 / equivalent) can override every boundary above.
```

### Trust assumptions

- The kernel and cgroup v2 implementation behave according to the supported
  kernel's documented interfaces.
- systemd PID 1 is trusted. It necessarily retains authority to manage the
  hierarchy and can admit or move a process after observer verification.
- The admission controller, its fixed launch policy, service configuration,
  and its IPC authentication are trusted.
- The observer can read the exact generation's cgroup state without being
  able to write to it. This access and systemd stop ordering require native
  acceptance; they are not established in this repository.
- Host root, a malicious kernel/hypervisor, and storage hardware that falsely
  reports completed flushes are outside the guarantee.

Different process names or UIDs alone do not provide these boundaries.
Filesystem permissions, capabilities, systemd/D-Bus authorization, inherited
descriptors, signal permissions, service restart policies, and executable
integrity must all be established and tested.

## 3. Identity and capability matrix

UID/GID names below are proposed dedicated identities, not existing accounts.
Allocate unique system UIDs/GIDs at installation; do not hard-code numeric
IDs or silently reuse the logged-in user. Capabilities are target policy.
`systemd` and the administrator remain trusted and outside least-privilege
claims.

| Identity | UID/GID | Capabilities | Writable cgroup files | Readable cgroup files | Process signaling | Descriptor inheritance | Restart behavior |
|---|---|---|---|---|---|---|---|
| Electron/main | Logged-in desktop account | Empty effective/permitted/inheritable/ambient sets where supported; `NoNewPrivileges`. | None. No delegated subtree. | None required. | Can signal same-UID processes subject to normal checks; cannot signal the distinct browser UID. It can request stop through authenticated IPC. | Receives no cgroup FD, systemd control FD, or observer journal FD. Any desktop IPC descriptors are close-on-exec unless explicitly needed. | User session/desktop policy may restart the app, but restart must create a new generation and cannot reopen or reuse a quarantined generation. |
| Browser process and descendants | Dedicated `aether-browser` UID/GID | Empty capability sets; `NoNewPrivileges`; no privilege escalation. | None, including no `cgroup.procs`, `cgroup.threads`, `cgroup.kill`, or writable ancestor. | Prefer none. If procfs exposes its own cgroup path, that is informational only and grants no write permission. | May signal its own same-UID descendants; no authority to signal lifecycle/controller/observer identities. | No controller, manager, evidence, or writable cgroup FDs. CLOEXEC alone is insufficient if a descriptor is passed before exec; explicitly close and test. | `Restart=no` for each generation; no automatic resurrection after stop or manager/controller crash. |
| Lifecycle manager | Dedicated `aether-lifecycle` UID/GID | Empty capability sets. | None. | No cgroup access required. | Cannot signal the browser UID; asks the admission API to stop the generation. | No cgroup, kill, or evidence-store FD. No FD passing to the controller. | A restart recovers request IDs from durable state and queries the controller. It may not reopen a closed generation. |
| Admission controller / broker | Dedicated service identity, not browser or lifecycle UID. A privileged system service may be required to access systemd's restricted control API; exact UID and privilege policy are a deployment blocker. | Preferred systemd-mediated design: no Linux capabilities, `NoNewPrivileges`, strict filesystem/mount restrictions, and only the required system D-Bus connection. A root-UID service remains highly trusted even with a reduced capability set. | Preferred design: no direct cgroup FD. systemd PID 1 is the actual hierarchy writer. If direct delegated writes are chosen instead, only that generation's necessary `cgroup.procs`/creation authority is granted; it must not be shared with the browser or lifecycle manager. | Only generation metadata through systemd or explicit minimum read-only view. | Can ask systemd to stop/kill only AETHER generation units via a fixed API. It must not have a general PID/signal API. | No FD passing; use CLOEXEC plus explicit descriptor allowlists. No child/worker may inherit writer handles. Controller exit must close its own descriptors; it does not revoke copies elsewhere. | `Restart=on-failure` may restart the service but must not reopen an old generation. Controller recovery is journal-driven and idempotent. Exact restart/authorization setup is unproven. |
| Independent observer | Dedicated `aether-observer` UID/GID | Empty capability sets. | None. | Read-only `cgroup.events` and `cgroup.procs` for the exact generation, plus parent traversal. Read access must be verified without writable cgroup access. | No authority to signal browser/controller. It can report evidence and send ACKs. | Receives only read-only cgroup access and its own evidence-store FD. It must never receive admission, kill, or unit-control descriptors. | Restarts independently of the desktop and controller, reconciles durable records, and resends the same ACK. Missing/inconsistent state remains quarantined. |
| systemd system manager | UID/GID 0:0 (system manager) | Broad host authority; exact capability set is systemd/version/config dependent. Do not claim least privilege. | Can create and manage AETHER cgroups and unit cgroups. | Full hierarchy visibility. | Can signal processes under its control. | Owns its internal descriptors and can open new cgroup handles at any time. It is not fenced by the AETHER controller. | PID 1 manages unit restarts and shutdown; unit policy must disable browser restart and preserve evidence/anchor ordering. |
| Host administrator | UID 0 or equivalent privileged authority | Full or equivalent host authority. | Can alter all cgroups and permissions. | Full. | Can signal any process. | Can inspect, duplicate, or reopen descriptors subject to host controls. | Can change units, policies, kernel, and storage; explicitly outside the guarantee. |

### Identity feasibility blockers

Electron's current browser child depends on the desktop display/session and
profile. Moving it to a dedicated UID affects Wayland/X11 authorization,
desktop portals, D-Bus access, profile ownership, downloads, and upgrades.
Passing a display token or profile path may itself grant capabilities or
expose user data. Those interfaces require a separate threat review. Do not
solve them by sharing the desktop UID or exposing the browser to the manager's
home directory.

The controller's authorization to call `StartTransientUnit`, `StopUnit`, or
`KillUnit` is also unresolved. Granting broad `manage-units` access to an
unprivileged process can become a general privileged-unit launch interface.
If a root service is used, its input validation and code become privileged
trusted computing base. A narrow, fixed AETHER RPC reduces its exposed
surface but does not make a compromised helper harmless.

## 4. Architecture comparison

| Mechanism | Admission and writer separation | Existing FD and migration behavior | Fork/termination | Crash, systemd, and evidence | Feasibility |
|---|---|---|---|---|---|
| Dedicated privileged helper writing cgroupfs directly | A small helper can validate a fixed operation set and own the writer. It must launch into the cgroup before browser code runs. Root/helper authority is broad unless carefully constrained; helper compromise can bypass its own validation. | Existing writable descriptors remain authority. The helper must never pass/duplicate them and must close them before observer verification. Permission/path changes do not constitute a reliable revocation protocol. Host root can reopen/migrate. | `cgroup.kill` can terminate the subtree on kernels that implement it; it does not close admission. | Independent observer and durable store are additional components. systemd/root remains able to change state. | Technically plausible, but broad privileged TCB and stale-FD/restart proof require native tests and security review. No implementation authorized. |
| systemd-managed delegated cgroup ownership | Delegated service receives authority over a subtree. It can place children before exec, but any process with delegated permissions may become a writer. A per-user manager often shares a UID with desktop processes; UID separation must be explicit. | `cgroup.procs` writable descriptors remain capabilities. systemd manager retains global authority. Delegate boundaries do not by themselves revoke an open descriptor or block manager/root migration. | systemd `KillMode=control-group` kills remaining unit processes at stop after stop procedure/timeouts; does not provide an immutable post-stop admission seal. | systemd can manage unit restart/stop ordering; observer and evidence persistence still need design. Unit cgroups may be removed before evidence unless an anchor is proven to remain. | Operationally attractive but authority boundary and observer ordering are unproven. Delegation alone is not sufficient. |
| Single-writer controller with explicit authority transfer | One controller serializes generation operations. With systemd mediation, PID 1 is still the actual cgroup authority; with direct cgroupfs writes, the controller is the only AETHER writer. | Closing every controller-owned FD and confirming controller exit fences its own descriptors only if none were inherited, duplicated, or passed. It cannot revoke a copy elsewhere or prevent systemd/root reopening. A flag, chmod, queue close, or PID check is not a fence. | Terminate only after closure; use subtree kill rather than PID enumeration. Forks can occur until killed. | Controller journal and observer ACK can recover ordinary process crashes. They cannot force the host to keep the system manager/observer alive during shutdown or persist through dishonest storage. | Best software-level serialization, but not a kernel-enforced authority revocation. |
| PID namespace init termination | Cannot stop an external privileged actor from migrating a process into the cgroup; it is not cgroup admission control. | Does not revoke cgroup descriptors or migration rights. | Documented kernel behavior: terminating PID namespace init sends SIGKILL to remaining namespace processes; subsequent fork in that dead namespace fails with `ENOMEM`. | Does not produce durable evidence or prevent systemd removing the cgroup before observer commit. | Defense in depth only; not a replacement for admission control. |

### Preferred candidate for native feasibility evaluation

Prefer a system service with a **fixed admission API** that asks the system
manager to create one per-generation AETHER slice and one fixed browser service
under it. The controller builds all unit properties and executable arguments
from trusted package constants. The browser service runs as
`aether-browser`, with no capabilities and no restart policy. The per-generation
slice is the proposed anchor: it must remain present while the observer reads
its recursive `cgroup.events` and recursively checks `cgroup.procs` in every
descendant cgroup, commits evidence, and ACKs; only then may the controller
stop/remove that slice.

This candidate relies on PID 1 as the actual admission and cgroup writer. The
controller can serialize only AETHER requests; it cannot prevent an authorized
systemd/root caller from creating or migrating another process. A privileged
helper that writes cgroupfs directly has a different TCB but still cannot
revoke host-root authority.

Do not invoke `systemd-run`, a shell, or an arbitrary executable/argument
string from the app. A future implementation would use a typed D-Bus API with
validated generated unit names and a constant `ExecStart` vector, or a fixed
native service API that internally makes those calls. The controller API must
not accept caller-supplied unit properties, executable paths, cgroup paths,
UIDs, signals, or command strings.

`StartTransientUnit` and `StopUnit` are documented systemd manager APIs; their
availability is not proof of correct AETHER unit construction, authorization,
placement-before-exec, retained-anchor behavior, or shutdown ordering. Those
are acceptance questions. Keep the system manager and administrator explicitly
inside the trusted boundary.

## 5. Descriptor-fencing analysis

### Can an already-open writable `cgroup.procs` descriptor still work?

**Yes, it must be treated as capable of writing after pathname or permission
changes.** Linux `open(2)` creates an open-file description used by later
I/O; the reference is not replaced when the pathname is changed. `chmod(2)`
changes mode bits, but on ordinary local filesystems does not revoke an
already-open descriptor. The `chmod(2)` manual calls out NFS as having
different server-side behavior; do not generalize that exception to cgroupfs.
The cgroup v2 documentation describes `cgroup.procs` as read/write and
migration by writing a PID. It does not specify a permission-revocation
operation for open descriptors.

Therefore:

1. Treat every writable `cgroup.procs` FD, writable parent-directory FD, and
   systemd/root control path as an admission capability.
2. Do not claim fencing from chmod, rename, unmount, closing an application
   queue, setting a shutdown flag, or observing `populated 0`.
3. If an AETHER controller directly owns the only writer, serialize writes,
   never pass the FD, use `O_CLOEXEC` at creation, explicitly close it, and
   wait for the controller process to exit before observer verification.
   `O_CLOEXEC` addresses exec inheritance; it does not stop inheritance across
   `fork()` before exec. Audit all fork/worker paths and forbid `SCM_RIGHTS`.
4. Ensure no concurrent thread can still be writing when the FD is closed.
   Controller exit closes its own descriptor table, but does not close a
   duplicated FD in another process. An observer cannot prove that no
   privileged process anywhere has another descriptor.
5. Test cgroupfs-specific writes from an FD opened before attempted permission
   changes on every supported native kernel. Until verified, existing open
   FDs remain live authority in the threat model.

A systemd-mediated controller does not hold a cgroup writer FD, but PID 1
retains the ability to reopen the hierarchy. That is a trusted-root/systemd
assumption, not a fencing achievement by AETHER. `pidfd_open()` can provide
stable process identity and exit observation; it does not revoke other FDs or
freeze cgroup migration rights.

### Documented behavior versus acceptance assumptions

Documented Linux behavior:

- Cgroup v2 places forked children in their forking process's cgroup; a
  process can be migrated by writing its PID to destination `cgroup.procs`.
- `cgroup.events` `populated` reflects live processes in a cgroup subtree and
  supports notifications when that value changes. It is observation, not an
  admission lock.
- `cgroup.kill` is a subtree-wide kill interface where supported. It is not
  documented as closing admission.
- `clone3()` with `CLONE_INTO_CGROUP` (Linux 5.7+) can create a process
  directly in a target cgroup, avoiding a post-fork migration window for that
  process. Availability, permission, interaction with systemd, and production
  launch integration must be tested. It does not stop another authorized
  process from migrating tasks later.
- PID namespace init death kills the namespace's remaining processes and
  subsequent forks in that namespace fail.
- `fsync()` flushes file data/metadata and the containing directory requires
  a separate `fsync()` for a rename's directory entry. Hardware may still
  misreport persistence.

Requires native acceptance:

- Whether the deployed `cgroup.procs` open FD remains writable after a
  permission change on the exact cgroupfs/kernel.
- Which UIDs can read the target `cgroup.events`/`cgroup.procs` and traverse
  all ancestor cgroup directories under the shipped systemd configuration.
- That the browser's systemd unit has cgroup membership before the first
  executable instruction and cannot move itself or descendants out.
- Whether a per-generation slice remains available and stable until the
  observer commits and ACKs, including during `systemctl stop` and shutdown.
- `cgroup.kill` outcomes under concurrent fork/migration and under every
  supported kernel version.
- Evidence survival under filesystem errors, abrupt reboot, and VM power
  interruption on the actual storage stack.

No mock, unit test, process tree, or successful systemd API call is proof of
these kernel properties.

## 6. Proposed protocol

### Common request contract

All messages use a versioned, bounded schema over a private Unix socket or
authenticated system D-Bus interface. Authenticate the peer from kernel
credentials (`SO_PEERCRED` for a Unix socket or bus credentials) and map it to
the expected service identity. Do not trust a PID/UID included in the JSON
payload. Bind requests to a random 128-bit-or-stronger generation ID, boot ID,
monotonic sequence, operation, and caller identity. Use strict allowlisted
fields; reject unknown fields, oversized values, duplicate keys, invalid
encodings, and out-of-order state changes. No shell or generic execution
operation exists.

Idempotency keys are `(generation_id, operation, request_id)`. A retry returns
the same durable result or current state, never starts a second browser. A
request for a terminal, unknown, mismatched-boot, or quarantined generation
fails closed. Store operation intent before acknowledging state-changing
requests.

### Operations and transitions

| Operation / transition | Authorized caller | Input validation and authentication | Idempotency | Failure behavior | Audit evidence and restart recovery |
|---|---|---|---|---|---|
| `CreateGeneration`: none → `ACTIVE` | Lifecycle manager to admission API. | Peer UID must be `aether-lifecycle`; only protocol version, request ID, and bounded approved profile token. Controller generates UUID and boot ID. No path, argv, unit properties, or user ID from caller. | Same request ID returns the same generation. | Reject invalid or unauthorized input; do not create a unit. | Durable generation record and unit name; after restart, query the existing record. |
| `StartGeneration`: `ACTIVE → ACTIVE` | Lifecycle manager requests controller; controller asks systemd. | Generation must be active and unused. Controller constructs constant executable/argv, fixed browser UID, fixed unit template, no capabilities, `NoNewPrivileges`, and restart disabled. Validate executable ownership/hash at install/update boundary. | One unit invocation per generation; duplicate start returns existing job/state. | Any auth, D-Bus, identity, or placement error is failure; kill/stop partial unit and quarantine if membership cannot be resolved. | Record systemd job/unit/invocation ID and cgroup identity before reporting ready. Recovery queries by immutable unit/invocation ID. |
| `RequestStop`: `ACTIVE → STOP_REQUESTED` | Electron/lifecycle manager. | Authenticated peer; exact generation; no signal or target PID input. Persist intent before returning. | Duplicate stop returns the same pending result. | Missing durable intent or failed journal write means no success; block new launches and quarantine. | Intent sequence, boot ID, request ID, caller UID, timestamp. |
| `CloseAdmission`: `STOP_REQUESTED → ADMISSION_CLOSED` | Admission controller only. | Verify generation, journaled stop intent, exact unit identity, and no new starts in flight. Atomically mark generation closed before issuing any stop request. | Repeated close is success only if same generation is durably closed. | In-flight create/start unresolved => quarantine; do not infer closure from app IPC state. | Durable closed generation and canceled/settled systemd jobs; recovered closed state cannot transition back to active. |
| `FenceWriter`: `ADMISSION_CLOSED → WRITER_FENCED` | Controller reports; observer independently validates available evidence. | Controller must have no direct writer FD in preferred design; all start jobs settled; no restart policy. Direct-FD variant must prove all copies closed and writer process exited. | Same generation returns same fence record. | If any descriptor holder, in-flight writer, or restart authority cannot be ruled out, quarantine; no empty check accepted. | Unit invocation and restart policy, controller PIDFD exit if it held direct FDs, no-FD-pass audit, and explicit trusted-PID-1 assumption. |
| `TerminateGeneration`: `WRITER_FENCED → DESCENDANTS_TERMINATED` | Admission controller requests exact systemd unit stop/kill. | Exact generated unit only; no arbitrary signal/name. Request systemd stop with fixed `KillMode=control-group`, fixed stop timeout, and bounded final kill behavior. | Repeated requests attach to same stop job/result. | D-Bus/job error, timeout, or unexpected unit restart => quarantine; bounded retry may continue cleanup but cannot report success. | Stop job ID, unit invocation ID, systemd result, exit status, kill timestamps. Reconcile from systemd after controller restart. |
| `ObserveEmpty`: `DESCENDANTS_TERMINATED → EMPTY_VERIFIED` | Independent observer only. | Read-only access to exact per-generation anchor cgroup; verify device/inode/path or equivalent identity, recursive `cgroup.events populated 0`, and empty `cgroup.procs` in every cgroup below the anchor. Ensure no unit/cgroup identity substitution. | Repeated identical observation returns same observation sequence; any repopulation cancels it. | Read error, inaccessible file, different identity, nonempty state, or lost writer fence => quarantine. | Raw cgroup file contents, identity, boot ID, kernel/systemd version, observer identity, timestamps and errors. |
| `CommitEvidence`: `EMPTY_VERIFIED → EVIDENCE_DURABLE` | Independent observer. | Validate complete ordered state history and exact generation. Write canonical evidence to persistent path outside child hierarchy. | Same generation and observation hash returns same evidence ID/hash. | Short write, `fsync`, rename, directory `fsync`, or storage error => no durable state/ACK; quarantine. | Append-only record with raw observations, state sequence, stop/kill results, cgroup identity, software/kernel versions, and cryptographic integrity metadata. |
| `Acknowledge`: `EVIDENCE_DURABLE → ACKNOWLEDGED` | Observer to lifecycle manager/controller/systemd integration. | Authenticated observer identity; generation, evidence ID/hash, and sequence must match durable record. | Duplicate ACK returns the same result. | Delayed/missing ACK means the caller remains pending/quarantined; do not remove anchor. Recover by querying the committed evidence ID. | ACK request, receiver, timestamp, and receipt result; resend after observer restart. |
| `RemoveGeneration`: `ACKNOWLEDGED → CGROUP_REMOVED` | Controller via exact systemd unit stop/removal; observer verifies. | Require valid ACK receipt, matching generation, and fresh empty observation; only target generated slice/unit. | Repeated removal is successful only if the same generation is confirmed absent after prior ACK. | Missing ACK, cgroup mismatch, or failed removal => quarantine and retain all evidence. | systemd job result and observer confirmation that target cgroup identity is absent; durable record remains external. |
| `Finalize`: `CGROUP_REMOVED → IDLE` | Lifecycle manager consumes observer result. | Validate same generation and evidence hash; do not accept caller-supplied success bool. | Repeated finalization returns same terminal record. | Missing terminal evidence => quarantine; no generation reuse. | Durable terminal state linked to evidence and removal job. Startup recovery reconciles incomplete generations; never infers success from missing units. |

`QUARANTINED` is reachable from every transition on missing, inconsistent, or
unauthenticated evidence. It blocks launches for the generation and browsing
globally. An operator recovery is a separately audited action; it cannot
manufacture an `EMPTY_VERIFIED` record.

## 7. Observer and durable evidence

### Independence and read-only access

The observer must run under a dedicated UID, outside the browser cgroup,
outside the lifecycle manager's process tree, and with no controller API that
can create/move/kill processes. It should have only read-only access to the
generation's `cgroup.events` and `cgroup.procs` plus ancestor traversal, and
write access only to its evidence directory. `ProtectControlGroups=read-only`
or a read-only mount can reduce accidental writes but does not replace DAC,
capability, and descriptor audits.

The proposed D-Bus `GetUnitProcesses`/unit properties can supplement
observation but are not independent kernel-file evidence. Exact read-only
cgroup file access under the selected systemd delegation/ownership model must
be verified. If access requires giving the observer write permission, a
writable FD, or broad root authority, the independent-observer claim fails.

### Durable record and ACK

Persist evidence outside the browser hierarchy and outside volatile `/run`.
Use an append-only per-generation record with canonical serialization and
monotonic sequence. Suggested commit sequence: create a unique temporary file
in the evidence directory; write full content; `fsync()` the file; atomically
rename to the final generation record; `fsync()` the containing directory;
only then send ACK with generation, evidence ID/hash, and observer sequence.
Record errors and raw kernel/systemd observations, not only a boolean.

The observer key should be separate from the browser and manager. A signature
or MAC can detect accidental corruption and identify the writer but cannot
prevent root from altering the service or key. An append-only journal or
remote log may improve auditability, but remote delivery must not become a
browsing/networking shortcut or be required to claim local process cleanup.

Duplicate and delayed ACKs are resolved by generation/evidence hash. After
observer restart, it scans durable records, verifies hashes and sequence,
reconciles systemd/cgroup state, and resends the same ACK. If the record is
absent, corrupt, or mismatched, it quarantines. If the record is committed but
the ACK was lost, retry is safe and idempotent. The cgroup anchor remains until
ACK receipt is durably recorded.

### Shutdown and power loss

An orderly systemd stop can be ordered so the AETHER runtime/anchor stops
before the observer; the observer must commit before its own stop completes.
The exact unit graph, `DefaultDependencies`, stop timeout, systemd job behavior,
and manager shutdown sequencing need acceptance tests. A forced power cut can
stop both processes at any instruction and can lose volatile or unflushed
state. `fsync()` documents a flush request, not a guarantee against storage
hardware/firmware that lies, cache loss, filesystem bugs, or physical damage.

No protocol can guarantee durable evidence if the host loses power before
commit, if the evidence device is lost/corrupt, if the observer and controller
fail together before persistence, or if root deletes/rewrites the evidence.
Those cases remain **unknown/quarantined**, not successful cleanup.

## 8. Failure matrix

| Failure / race | Required behavior | Evidence for eventual success | Otherwise |
|---|---|---|---|
| Existing writable descriptor | Keep it in the authority set until all references are proven closed. Permission changes are not a fence. | Native stale-FD test plus controller exit/no-inheritance proof; systemd/root explicitly trusted. | Quarantine. |
| Concurrent process migration | Reject writes from browser/manager/lifecycle identities; controller closes generation; PID 1/root remains trusted. | Native denied-write attempts before and after the writer fence; no unexpected cgroup movement in event trace. | Quarantine. |
| Fork during termination | Stop admission first, then unit-wide/cgroup-wide kill; do not rely on PID enumeration. | Native stress test with concurrent fork and post-stop empty observations. | Quarantine if any task survives/reappears or writer state is ambiguous. |
| Lifecycle manager crash | Controller/observer continue from durable generation state; no browser auto-restart. | Reconciled state log, exact unit ID, observer record and ACK. | Quarantine. |
| Observer crash before evidence commit | Do not ACK; controller retains the anchor. Observer restarts, re-observes, and re-commits only if generation identity is still valid. | New complete observation followed by durable commit. | Quarantine. |
| Observer crash after commit, before ACK | Return same record/hash after restart and resend ACK. | Existing durable record verifies and receiver durably records the ACK. | Quarantine until ACK receipt. |
| Admission controller crash | If systemd has already launched the unit, its manager still owns it; no implicit restart or new generation. Observer detects unknown/incomplete generation. | Systemd reconciliation plus observer evidence; controller restart cannot reopen old generation. | Quarantine. |
| systemd stop | Ensure observer evidence/ACK completes before anchor removal; systemd may still stop services due root policy or shutdown. | Native stop-order trace and retained persistent record. | Quarantine; absence of a unit is not success. |
| Reboot | Reconcile boot ID, journaled state, evidence record, systemd unit and cgroup identity on next boot. | Durable complete record from prior boot, linked to generation and removal. | Quarantine; incomplete records stay incomplete. |
| Duplicate stop request | Same generation and request ID returns the same state/result. No new unit or generation is created. | Journal proves one transition sequence. | Reject or quarantine conflicting request IDs/state. |
| Missing durable evidence | Never ACK or remove anchor based on in-memory status, logs, or `populated 0` alone. | Verified record persisted and sequence complete. | Quarantine indefinitely pending audited recovery. |
| systemd/root migration after verification | Outside the unprivileged AETHER guarantee; accepted only as explicit trusted-admin assumption. | Cannot be established by the AETHER observer. | If root is in scope as adversary: unconditional NO-GO. |
| Host/device failure during commit | Do not infer persistence from process success or `close()`. | Post-reboot record/hash and filesystem/storage acceptance evidence. | Unknown/quarantined. |

## 9. Native Linux acceptance test plan

### Unprivileged simulations

These are useful protocol tests, not kernel enforcement evidence:

- Model every state transition and crash point; assert missing evidence always
  yields quarantine.
- Exercise duplicate/concurrent stop requests, request replay, delayed/missing
  ACKs, observer restart before/after commit, and controller restart.
- Use a fake systemd D-Bus peer to assert only fixed methods/unit names/
  `ExecStart` values are sent; reject arbitrary executable paths, unit
  properties, cgroup paths, signals, and command strings.
- Model cgroup identity mismatch, PID reuse, stale generation IDs, and
  out-of-order unit/observer events.
- Inject write, `fsync`, rename, directory-`fsync`, and evidence corruption
  failures; assert no ACK or success.
- Test FD allowlists and CLOEXEC in a helper harness, including fork-before-
  exec, descriptor duplication, and attempted `SCM_RIGHTS` passing. Results
  validate helper behavior only, not cgroupfs semantics.

### Native Ubuntu acceptance

Use a disposable supported Ubuntu 24.04 x86_64 VM with a running systemd
system manager, cgroup v2, separately provisioned test accounts, and an
explicitly documented test-only unit policy. Do not change sysctls, AppArmor,
kernel configuration, system-wide cgroup settings, or host policy. Capture
kernel, cgroup2 mount options, systemd version, filesystem type, unit files,
UID/GID and capability state, and all test artifacts. Tests that require
administrator provisioning must be run only in that disposable VM.

| Test | Setup and attack | Required observation / pass condition |
|---|---|---|
| Existing writable descriptors | Open target `cgroup.procs` writable before closure; attempt write after chmod/path changes; repeat with duplicated and fork-inherited copies. | Demonstrate that pathname/permission changes are not treated as revocation. The proposed controller must have no copied writer after its exit; otherwise NO-GO. Record actual kernel behavior rather than generalizing. |
| Concurrent migration | Run authorized test writer, then concurrent browser/lifecycle/manager-identity write attempts around closure; attempt moving a test process into and out of the generation. | Only explicitly trusted systemd/root actor can succeed after closure. Any unexpected writer success blocks design. |
| Fork during termination | Child continuously forks while stop/`cgroup.kill`/systemd stop races; capture cgroup membership and task state. | Close admission first; all descendants terminate; observer reads empty only after writer fence; no repopulation. |
| Manager crash | SIGKILL lifecycle manager at each protocol transition, including before stop intent, after intent, during close, after commit, and before ACK receipt. | Controller/observer reconcile from durable state; no false ACK, no old-generation restart, otherwise quarantine. |
| Observer crash | Kill observer before record write, during write, after file `fsync`, after rename, after directory `fsync`, and after commit/before ACK. | No ACK before durable commit. Recovery returns same hash after commit or re-observes before commit; anchor retained until ACK. |
| Controller crash | Kill controller before `StartTransientUnit`, while the systemd job is pending, after process start, while stopping, and after durable evidence but before remove. | No unintended duplicate unit, no restart of closed generation, and independent observer either completes or quarantines. |
| systemd stop | Issue stop for browser unit, anchor slice, controller, observer, and relevant target in each ordering; test stop timeout and forced kill. | Anchor remains until durable evidence and ACK, or result is explicitly quarantined. Preserve journal and cgroup events. |
| Reboot | Normal reboot at each transition; recover after boot using persistent generation/evidence records. | Complete prior record can be verified; incomplete generation never becomes success solely because the cgroup/unit is absent. |
| Abrupt power loss | Power off disposable VM around evidence commit and ACK. Repeat on supported storage configuration. | After boot, record is either valid and complete or the generation is quarantined. This cannot prove against deceptive hardware. |
| Duplicate stop | Concurrently issue same and conflicting stop request IDs from authorized and unauthorized identities. | Same operation is idempotent; conflicting or replayed unauthorized requests rejected; exactly one generation history. |
| Missing durable evidence | Force disk-full/read-only errors, failed file/directory `fsync`, record corruption, and missing journal entry. | No ACK, no cgroup removal, no success. Quarantine persists. |
| Observer read-only access | Attempt read of `cgroup.events` and `cgroup.procs`, then attempt writes, moves, signals, and controller operations as observer. | Reads succeed for the exact generation; all writes/management operations fail. If read access requires broad write/root power, independence criterion fails. |
| Placement before execution | Use an instrumented fixed browser binary that records cgroup identity at its first instruction and races an immediate fork. | First instruction and descendants start under exact generation unit; no parent-cgroup window. |

Keep raw `cgroup.events`, `cgroup.procs`, cgroup identity, unit invocation IDs,
systemd journal, controller/observer records, syscall-level diagnostics where
available, and checksums. A single observed empty sample is not sufficient;
test the authority fence and all identified writer paths first. Do not label
simulated, container, or mocked results as native acceptance.

## 10. Residual risks

- systemd PID 1 and host root can always change cgroup membership, permissions,
  unit definitions, or observer behavior. If trusted-root is unacceptable,
  this design cannot meet the threat model.
- No AETHER-controlled operation revokes writable cgroup FDs already held by
  other processes. Controller exit closes only its own descriptor references.
- The exact D-Bus/polkit boundary for allowing only fixed AETHER unit
  operations is unresolved; broad unit-management authorization is dangerous.
- Dedicated browser UID integration with desktop display, portals, profile,
  downloads, and keyring is untested and may introduce new credentials or
  data-sharing paths.
- systemd may remove unit cgroups during stop; retaining a generation anchor
  and observer access until ACK is not yet demonstrated.
- cgroupfs read permissions and ancestor traversal for a separate observer
  have not been tested on the deployment profile.
- `cgroup.kill` support and concurrency semantics vary by supported kernel;
  uninterruptible tasks may delay exit.
- Observer/controller compromise, simultaneous failure before durable commit,
  filesystem or device failure, abrupt power loss, and dishonest storage can
  prevent evidence or invalidate durability assumptions.
- PID namespaces, pidfds, process names, empty process scans, and systemd unit
  inactivity each provide useful information but none substitutes for a
  verified admission authority transition plus durable independent evidence.

## 11. GO/NO-GO recommendation and next gate

**NO-GO for production implementation approval and remote browsing.**
Proceed only to a separately approved feasibility prototype on a disposable
native Ubuntu VM if it uses fixed operations and no host-wide configuration
changes. The current evidence supports only this narrower claim: an
independent controller can serialize AETHER's own requests, and an observer
can potentially verify a cgroup state after the controller's own writer
handles are closed. It does not support a kernel guarantee against systemd,
root, or escaped descriptors.

The next acceptance gate is a reviewed prototype and native matrix demonstrating:

1. Distinct account/capability and file-permission boundaries for all six
   identities above, including the actual systemd D-Bus authorization.
2. Fixed, pre-exec unit placement; no generic command interface or restart of
   a closed generation.
3. Successful stale-FD, migration, fork-race, and controller-crash tests on
   every supported kernel/cgroupfs/systemd profile.
4. Read-only independent observation and retention of the generation anchor
   through evidence `fsync`, atomic rename, directory `fsync`, and durable ACK.
5. systemd stop, reboot, abrupt-power-loss, duplicate-request, and missing-
   evidence tests with raw artifacts and quarantine on all uncertain outcomes.
6. Independent security review accepting the explicit root/systemd and
   storage trust assumptions.

Until then, keep **`REMOTE_BROWSING_ENABLED=false`**. Do not implement the
helper or change system configuration as part of this feasibility phase.

## Sources consulted

Official and primary references used for documented behavior:

- Linux kernel, [Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html):
  process placement/fork behavior, `cgroup.procs`, `cgroup.events`,
  `cgroup.kill`, delegation, and `CLONE_INTO_CGROUP`.
- Linux man-pages, [`open(2)`](https://man7.org/linux/man-pages/man2/open.2.html),
  [`chmod(2)`](https://man7.org/linux/man-pages/man2/chmod.2.html), and
  [`close(2)`](https://man7.org/linux/man-pages/man2/close.2.html): open-file
  descriptions, access modes, descriptor lifetime, and permission changes.
- Linux man-pages, [`clone3(2)`](https://man7.org/linux/man-pages/man2/clone3.2.html)
  and [`pidfd_open(2)`](https://man7.org/linux/man-pages/man2/pidfd_open.2.html):
  `CLONE_INTO_CGROUP` availability and stable process handles.
- Linux man-pages, [`pid_namespaces(7)`](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html):
  namespace-init termination behavior.
- Linux man-pages, [`fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html):
  file and directory flush requirements and storage caveats.
- systemd, [`org.freedesktop.systemd1`](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.systemd1.html):
  manager D-Bus operations including transient units and stop/kill requests.
- systemd, [`systemd.kill(5)`](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html):
  `KillMode=control-group` and stop-timeout kill behavior.
- systemd, [`systemd.resource-control(5)`](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)
  and [`systemd.service(5)`](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html):
  unit resource-control and service execution configuration. The exact
  AETHER delegation and stop-order behavior remains to be tested.

Documentation establishes interface semantics, not that this machine or a
future packaged AETHER deployment meets the required permissions, ordering,
or durability properties.
