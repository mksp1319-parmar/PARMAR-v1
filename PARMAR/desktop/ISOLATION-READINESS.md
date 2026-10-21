# AETHER process and network-isolation readiness

## Implemented process separation

On Linux, PARMAR launches AETHER as a second Electron process through fixed
`unshare` and `setpriv` executables, using `shell: false`. The child enters a
new user and network namespace before Electron starts, drops effective,
inheritable, and ambient capabilities, and enables `no_new_privs`. The child
uses the current trusted Electron executable (`process.execPath`), the fixed
`app.getAppPath()` application path, and fixed browser-child arguments. There
is no direct-spawn or in-process fallback if namespace setup fails. The control
process keeps its own window and single-instance lock; the child uses a
separate Electron profile directory.

The parent/child stdio protocol accepts only authenticated, bounded,
sequenced messages for readiness, focus, new tab, close tab, status, and stop.
The launch capability is one-use authenticated during the initial handshake;
peer PID/UID, message schema, capability, and sequence are checked for every
message. Malformed or unauthorized traffic fails closed. Startup is bounded;
parent shutdown requests graceful browser exit and then kills the detached
child process group so Chromium descendants do not outlive it. A child crash
does not trigger an unisolated fallback.

The protocol runs over the two processes' inherited private stdio pipes. Its
PID/UID checks and random capability are not a defense against a compromised
process running as the same user, and this IPC is not a network boundary. A
post-readiness crash receives at most two bounded restart attempts; setup and
startup failures remain fail-closed.

On non-Linux platforms, the existing in-process browser path remains in use;
the current isolation prototype only supports Linux. The child-launch PoC is
still a separate disposable packaging experiment and is not imported by the
production app. Linux packaging is configured with electron-builder: both an
unpacked directory and an AppImage target are available. The AppImage child
receives only builder-owned `APPDIR` library/data paths; inherited library
search paths outside the image are discarded.

## Network isolation status

`REMOTE_BROWSING_ENABLED` remains `false`. The production child verifies its
network namespace differs from the parent, that loopback is down and is the
only interface, that IPv4 and IPv6 route tables are empty, that effective
capabilities are zero, and that `no_new_privs` is active before it opens a
window or reports readiness. The parent independently checks the child
namespace identity at the broker handshake. Any verification or setup failure
terminates the child group.

The target container permits rootless user/network namespaces and `ip`
inspection but denies nftables inspection. Isolation therefore relies on the
fresh namespace's absent external interfaces/routes and down loopback, not a
host firewall or a claimed nftables policy. No privileged host changes are
made. This is network isolation, not a general sandbox for other OS resources.

## Design reference status

The workspace contains PARMAR desktop and mobile reference boards, but no
AETHER browser-specific screen reference. The desktop board shows AETHER only
as a navigation destination; it is not a browser mockup. The supplied browser
stylesheet matches the current desktop shell stylesheet and is retained as the
visual direction. The shell uses the approved original PARMAR emblem asset at
its native square aspect ratio. No dedicated AETHER screenshot comparison or
live UI inspection has been completed in this environment.

The Linux package uses the same approved emblem as its application icon and
matches its desktop filename/window class to the PARMAR AETHER application ID.
Its desktop entry does not unconditionally pass `--no-sandbox`; the upstream
AppRun wrapper checks user-namespace availability before choosing its fallback.

## Reproducible Linux runtime verification

The repository now has a GitHub Actions workflow at
`.github/workflows/aether-linux-runtime.yml`. It installs Electron GUI and
screenshot dependencies on an Ubuntu 24.04 runner, builds both Linux targets,
runs the serial full suite and live Electron/Chromium isolation fixture, and
starts the packaged AppImage under Xvfb. The AppImage smoke test exercises
paused session restoration, real tab keyboard actions, restricted navigation,
empty history/bookmark panels, window resizing, child namespace/capability
state, process cleanup, and captures PNG screenshots as a workflow artifact.
It inspects the packaged production Electron child and its live descendants at
initial startup and after a supervisor-driven crash recovery. For each live
production Electron process and descendant it checks the verified non-host
network namespace, only the `lo` interface, empty IPv4/IPv6 route tables,
zero effective capabilities, and `no_new_privs`; it also requires a Chromium
renderer in each inspected process set. The production child verifier checks
that loopback is down before readiness, and the smoke requires readiness
before inspecting the process tree. The smoke records checked PIDs and
verifies that they and the replacement process group have exited at shutdown.
The process-group monitor created by `unshare` is not an Electron/Chromium
descendant and is checked for cleanup, not mistakenly treated as a browser
process in the child namespace.

The packaged smoke also enters controlled HTTPS URLs targeting parent-local
IPv4 and IPv6 loopback TCP listeners and asserts that neither listener accepts
a connection. These are **production-path restricted-navigation checks**:
the currently disabled product policy rejects navigation before Chromium
should dispatch a request. They do not prove that the operating-system
namespace independently blocks attempted packets, and they do not exercise
redirects or WebSockets from the packaged production child. Those probes
remain covered only by the separate test-wrapper fixture; they are not
production-child evidence. Each attempted URL and zero-connection result is
logged, and screenshots capture the resulting restricted UI states for
inspection.

The workflow has not yet run in this checkout. Its presence is not evidence
that the GitHub runner permits user/network namespaces, that Electron starts,
or that screenshots match a design reference. Inspect its result and uploaded
screenshots before changing this readiness assessment.

The controlled Electron/Chromium fixture now uses the same fixed executable
builder as production. It probes controlled IPv4/IPv6 listeners, loopback,
redirects, WebSockets, descendants, crash, and shutdown. A live Node child
launched through that builder has also been observed failing to reach
controlled host IPv4, IPv4 loopback, IPv6 loopback, redirect, and WebSocket
listeners; the listener counters remained zero. This does not prove Electron
containment. In this environment the Electron live test is skipped: Xvfb is unavailable and
`PARMAR_ELECTRON_RUNTIME_LIB_DIR` is not configured with a user-local GTK
runtime. The live Node namespace prototype does pass, but that is not evidence
that Electron/Chromium was launched or contained here.

Both the unpacked artifact and AppImage were built successfully in this
workspace. The packaged archive contains the production main process, broker,
isolation launcher/verifier, preloads, and browser assets. Artifact tests
verify the executable bit, archive contents, and exact child launch arguments;
they do not launch Electron. A direct development and packaged Electron
`--version` attempt fails before startup because host libraries including
`libatk-1.0.so.0`, `libgtk-3.so.0`, `libcups.so.2`, and X11/GBM/ALSA components
are missing. No system libraries were installed.

## Remaining requirements

1. Run the live Electron/Chromium controlled-listener fixture in an
   environment with Xvfb, the pinned Electron binary, and a user-local GTK
   runtime. This is required before making any claim about Electron descendant
   containment or enabling remote browsing.
2. Run the required packaged smoke. Its production-child process and
   IPv4/IPv6 policy checks are implemented but have not passed in this
   checkout. To establish OS-level network containment, separately verify
   the production launcher's namespace behavior with controlled probes that
   can demonstrate attempted traffic is blocked, including redirects and
   WebSockets. The existing redirect/WebSocket probes use a test wrapper and
   cannot substitute for this production-path evidence.
3. Keep Electron sandboxing, context isolation, URL validation, permission
   denial, sender validation, and `REMOTE_BROWSING_ENABLED = false` until live
   Electron verification and independent security review pass.

## Verification sprint results (2026-10-20)

No GitHub Actions run was started. `gh auth status` reports that no GitHub host
is authenticated. The current checkout has uncommitted changes, including the
workflow file, that are not present on the remote `main` branch; the GitHub
Actions API lists no workflows for the repository and returns 404 for this
workflow's run endpoint. An authenticated account with Actions write access
and a published branch containing these changes is required before this
workflow can be dispatched. The workflow YAML was parsed locally and its
dispatch, Linux job, full-suite, and dedicated-isolation steps were checked;
this is not evidence of a successful Actions run.

The serial desktop suite ran in required-runtime mode: 77 tests, 75 passed, 2
failed, 0 skipped. The live Electron fixture failed visibly because `/usr/bin/Xvfb`
is unavailable; the packaged UI smoke failed visibly for the same missing
executable. The configured system library directory also lacks the required
GTK runtime. The dedicated isolation command likewise failed at its
prerequisite check. CI now sets explicit required-runtime flags so these
checks fail rather than silently skip if runner dependencies are missing.
JavaScript syntax checks and `git diff --check` passed.

Both Linux targets were built from the current worktree into
`/tmp/parmar-aether-verify-20261020/` without overwriting the pre-existing
`desktop/dist/` artifacts. The unpacked executable's `ldd` output reports
missing GTK, ATK, CUPS, X11, GBM, ALSA, and AT-SPI libraries. No packaged
window was opened. No screenshots were captured or inspected, and no workflow
screenshot artifact exists. The workflow's configured artifact name is
`aether-linux-runtime-screenshots`; its runner-temporary output directory is
`aether-ui-screenshots/`.

Production Electron/Chromium containment is **not verified**. The passing
live namespace and controlled-listener tests in the local suite use the
prototype or fixture launcher, not the production packaged AppImage child.
The production UI test that checks the real child, its Chromium descendants,
crash recovery, and shutdown cleanup could not run without the GUI runtime.
Keep `REMOTE_BROWSING_ENABLED = false`.

Before remote browsing can be considered, all of the following are required:

1. Run this workflow on a published branch containing the changes. The package
   builds, serial suite, dedicated isolation test, and required UI smoke must
   all pass without skipped runtime checks.
2. Inspect the uploaded screenshots and confirm the captured restored,
   restricted-error, tab, history/bookmark, responsive, and crash-recovery
   states are legible and correct.
3. Verify the actual packaged production Electron child and every Chromium
   descendant, including after crash recovery: distinct network namespace,
   no external interface or routes, loopback down, zero effective
   capabilities, and `no_new_privs`. Controlled host IPv4, IPv4/IPv6 loopback,
   redirect, and WebSocket attempts must fail closed with zero listener
   requests. The packaged smoke's loopback requests only verify that current
   application policy rejects them before network dispatch; they do not
   satisfy the independent OS-boundary or redirect/WebSocket gates. Confirm
   graceful shutdown and crash cleanup leave no descendants.
4. Complete an independent security review of the production boundary and
   retain the existing Electron sandbox, context isolation, navigation and
   permission restrictions, and fail-closed startup behavior.

To run the workflow manually after publishing the branch, authenticate with
`gh auth login` (or configure an authorized `GH_TOKEN`), then use the GitHub
Actions page for **AETHER Linux runtime verification**, select the branch, and
choose **Run workflow**. Wait for the run to finish, inspect both test steps,
and download/review the `aether-linux-runtime-screenshots` artifact. Do not
interpret a workflow dispatched against another commit as verification of
these local changes.

## Runtime verification procedure

After Xvfb and a user-local GTK runtime directory are available, run from
`PARMAR/desktop`:

```sh
PARMAR_ELECTRON_RUNTIME_LIB_DIR=/absolute/path/to/user-local/gtk-libraries \
  npm run test:electron-isolation
```

The directory must contain `libgtk-3.so.0`; this does not install libraries
or change host configuration. This command exercises the existing test
fixture only. Production network isolation still requires a separately
verified production launcher and the same controlled-listener/descendant
checks against it. Remote browsing may only be considered after those checks,
packaging, process-lifecycle verification, and independent security review.

## Packaged production smoke follow-up (2026-10-20)

The packaged UI smoke now includes live process-tree checks at startup and
after crash recovery, checks the recovered Chromium renderer, and verifies
cleanup of recorded Electron/Chromium PIDs and the browser process group. It
also submits parent-local IPv4 and IPv6 loopback destinations through the real
packaged browser address bar, checks the entered URLs, asserts zero accepted
TCP connections and no persisted controlled destination, and captures the
restricted-state screenshots. These probes exercise the production
application's current deny policy; they are not evidence of an attempted
packet being blocked by the OS network namespace. Production-child redirects
and WebSockets are not exercised because remote browsing remains disabled.

Local verification after this change:

- `npm test`: 77 tests, 75 passed, 0 failed, 2 skipped. The live Electron
  fixture and packaged UI smoke were skipped because Xvfb and its GUI tools
  are unavailable.
- `npm run test:electron-isolation`: 1 test skipped in ordinary local mode.
- With required-runtime flags enabled, `npm test`: 77 tests, 75 passed,
  2 failed, 0 skipped. The fixture fails visibly because Xvfb is unavailable;
  the packaged smoke fails visibly because `/usr/bin/Xvfb` is missing.
- With required-runtime mode enabled,
  `npm run test:electron-isolation`: 1 test failed visibly because Xvfb is
  unavailable. The pinned Electron executable and namespace tools are
  present, but `/usr/bin/Xvfb`, `xdotool`, `xclip`, and ImageMagick `import`
  are absent. The configured system runtime also lacks GTK, ATK, CUPS, and GBM
  libraries.
- JavaScript syntax checks, `git diff --check`, and PyYAML parsing plus
  structural checks of the workflow passed. `actionlint` is not installed.

The packaged AppImage did not launch in this follow-up; the new production
process and loopback checks did not execute, no screenshots were generated or
inspected, and no CI run was started. The packaged production child,
crash-recovery isolation, production listener results, and shutdown cleanup
therefore remain **unverified**. `REMOTE_BROWSING_ENABLED` remains `false`.

## Linux CI preparation review (2026-10-20)

The workflow uses `ubuntu-24.04`, installs the Electron GUI/Xvfb interaction
dependencies, and now explicitly installs `iproute2`, required by the
production launcher's namespace verifier. Before npm tests it checks for
`unshare`, `setpriv`, and `/usr/sbin/ip`, then runs
`unshare --user --map-current-user --net true` as the unprivileged runner
user. This is a capability check, not a privileged fallback: if GitHub's
runner policy or kernel configuration denies rootless user/network namespaces,
the workflow must fail at this preflight. Do not use sudo for AETHER runtime
launches, grant extra capabilities, disable Electron sandboxing, or add a
less-restricted launch path to get past that failure. Whether the hosted
Ubuntu runner permits this exact namespace operation remains unverified until
a real workflow run.

The two package commands generate `dist/linux-unpacked` and
`dist/PARMAR AETHER-1.0.0.AppImage`, matching the packaging tests and packaged
smoke default. The test script places `--test-concurrency=1` before the
desktop test glob. CI sets both runtime-required flags and the UI-smoke
enable/required flags, so missing runtime prerequisites fail the job instead
of skipping. The screenshot upload uses `if: always()` and reads from the
runner-temporary screenshot directory; partial screenshots are retained when
the UI test fails after capturing them. GitHub Actions also retains its job
logs. If startup fails before any screenshot exists, the upload step warns
about the missing directory, while the required test failure remains
red/failing.

The packaged UI smoke has a 240-second Node test timeout to cover its bounded
startup, crash-recovery, interaction, and shutdown waits. The Electron
integration fixture has a 180-second test timeout. Xvfb cleanup in both tests
is bounded: it receives SIGTERM, then SIGKILL if needed, and cleanup asserts
that the process exited. Both test budgets fit within the workflow's
30-minute job timeout, which also covers package installation/build and
artifact upload.

Local checks for this review:

- `npm test`: 77 tests total, 75 passed, 0 failed, 2 skipped. These are the
  fixture Electron integration and packaged AppImage UI smoke; this host lacks
  Xvfb and GUI dependencies.
- `npm run test:electron-isolation`: 1 test, skipped for missing live runtime
  prerequisites.
- Required-runtime `npm test`: 77 total, 75 passed, 2 failed, 0 skipped. The
  live Electron fixture fails its required runtime prerequisite check; the
  packaged smoke reports missing `/usr/bin/Xvfb`. The pinned Electron binary
  and `unshare`, `setpriv`, and `ip` are present, but `/usr/bin/Xvfb`,
  `/usr/bin/xdotool`, `/usr/bin/xclip`, `/usr/bin/import`, and the configured
  GTK/ATK/CUPS/GBM runtime libraries are unavailable.
- Required-runtime `npm run test:electron-isolation`: 1 test failed visibly
  because Xvfb and the GUI runtime are unavailable.
- JavaScript syntax checks, PyYAML parsing and explicit workflow structure
  assertions, and `git diff --check` passed. `actionlint` is not installed.
- `REMOTE_BROWSING_ENABLED` was read from the security module and is `false`.

The packaged-child harness is wired to launch the real AppImage with
`--appimage-extract-and-run`, open the production PARMAR control window, and
find the separate packaged Electron executable by its production child flag;
it does not use the Electron test wrapper. If it runs, it checks the actual
Electron descendant tree for a separate network namespace, only the `lo`
interface, empty IPv4/IPv6 routes, zero effective capabilities, and
`no_new_privs`, requiring a Chromium renderer at initial readiness and after
supervisor crash recovery. The production isolation verifier additionally
checks that `lo` is down before readiness. It then checks process/PID and
process-group cleanup. These production checks have **not run here**.

The production UI's local IPv4/IPv6 listener checks only observe the app's
current navigation-deny policy: remote navigation is rejected before
Chromium should issue a network request. They cannot establish that an
attempted connection was blocked by the kernel namespace. Redirect, WebSocket,
and other controlled-listener probes in the separate integration fixture
exercise its test wrapper, not the packaged production child. No production
redirect/WebSocket or independent OS-level egress probe has passed or is
claimed. Adding a test-only route that bypasses production policy would need
separate security design and review; do not treat it as permission to enable
remote browsing.

### Acceptance criteria for runtime readiness

AETHER is not runtime-verified until a real Actions run for the exact published
commit completes all of these gates:

1. Rootless user/network namespace preflight succeeds without elevated
   privileges; both unpacked and AppImage builds succeed at the expected
   paths.
2. The serial full suite and dedicated live Electron test pass with all
   required-runtime flags enabled and **no runtime-related skips**.
3. The AppImage is observed launching under Xvfb. The real packaged production
   Electron child and Chromium renderer are observed; initial startup and
   crash-recovery replacement satisfy the namespace, interface, route,
   capability, and `no_new_privs` checks. Recovery uses the production
   launcher, and shutdown leaves no recorded browser processes or descendants.
4. The workflow uploads screenshots; a human inspects them for the restored,
   restricted/error, tab, history/bookmark, resize, and recovery states.
5. Before claiming the **OS-level network boundary** is verified, independently
   demonstrate controlled IPv4/IPv6 loopback, redirect, and WebSocket attempts
   from the actual production child fail at the OS boundary, not merely because
   the app policy rejected navigation. Keep probes confined to controlled
   local listeners. The current production UI checks do not satisfy this
   criterion; no such production-path probe should be added unless it can
   safely preserve the production boundary and clearly prove traffic reached
   the OS enforcement layer.
6. Complete independent security review of the production launcher, Electron
   sandbox, recovery path, and network boundary. Keep
   `REMOTE_BROWSING_ENABLED = false` until every applicable criterion above
   has direct evidence and the policy is deliberately reviewed.

No CI run URL, packaged launch result, production process evidence, or
screenshot artifact exists for this review. Do not infer a pass from YAML
validation or the Node-only prototype.

## A14 local runtime verification results (2026-10-20)

This section supersedes earlier local-runtime status entries above. The GUI
and Electron runtime dependencies were installed in this development
environment for the checks below. No GitHub Actions workflow was dispatched,
and no Git changes were staged, committed, or pushed.

The complete serial suite was run with both runtime checks required:

```sh
PARMAR_ELECTRON_RUNTIME_LIB_DIR=/usr/lib/x86_64-linux-gnu \
PARMAR_ELECTRON_RUNTIME_REQUIRED=1 \
PARMAR_AETHER_UI_SMOKE=1 \
PARMAR_AETHER_UI_SMOKE_REQUIRED=1 \
PARMAR_AETHER_APPIMAGE_PATH='/tmp/parmar-aether-runtime-20261020-1650/PARMAR AETHER-1.0.0.AppImage' \
PARMAR_AETHER_UI_SCREENSHOT_DIR=/tmp/aether-ui-runtime-evidence \
npm test
```

Results:

- Full serial `npm test`: 77 passed, 0 failed, 0 skipped.
- Dedicated required `npm run test:electron-isolation`: 1 passed, 0 failed,
  0 skipped.
- Dedicated required packaged AppImage UI smoke: 1 passed, 0 failed,
  0 skipped.
- `node --check` for all changed and new `.js`/`.cjs` files passed.
- `git diff --check` passed. PyYAML parsed the workflow; `actionlint` is not
  installed in this environment.
- `REMOTE_BROWSING_ENABLED` remains `false`.

Both Linux package targets were built in
`/tmp/parmar-aether-runtime-20261020-1650/`. The packaged AppImage was then
launched with `--appimage-extract-and-run` under Xvfb. The production UI smoke
opened the local restricted AETHER shell and launched the actual packaged
browser child through the production supervisor and isolation launcher. It
exercised paused session restoration, browser chrome and tabs, restricted
navigation, history/bookmark panels, resize behavior, crash recovery, and
shutdown. The smoke inspected nine production Electron/Chromium processes at
startup and nine after recovery; every inspected process was outside the host
network namespace, had only loopback and no non-loopback route, and had
`no_new_privs`. The production main process also passed the launcher's checks
for loopback-down, empty IPv4/IPv6 routes, and zero effective capabilities.
Chromium's nested sandbox processes were observed in a further user/network
namespace; one had `CAP_SYS_ADMIN` scoped to that isolated user namespace.
No effective capabilities were present in the host user namespace. Recorded
browser PIDs and the replacement process group were absent after shutdown.

The packaged smoke submitted controlled IPv4 and IPv6 loopback URLs through
the real browser UI and each local listener recorded zero connections. These
are application-policy checks: navigation was rejected before a browser
request could establish an independent OS-level packet-blocking result. The
fixture-only required Electron integration test separately launched real
Electron/Chromium through its test wrapper in a distinct rootless namespace.
Direct socket, renderer fetch, redirect, and WebSocket probes against
controlled host/loopback listeners all failed, with zero listener requests.
That fixture result is useful namespace evidence but is not a production
launcher redirect/WebSocket probe.

The AppImage smoke initially exposed and fixed a trusted-frame authorization
bug: Electron 44's `WebFrameMain` does not expose the assumed `isMainFrame`
property. Production IPC now verifies `senderFrame.parent === null`, and the
fallback page can open the restricted browser without loosening origin
validation. The smoke also exposed that the browser child store used the
pre-`setPath` user-data directory; it now resolves `app.getPath('userData')`
after the child profile path is set, restoring the seeded session correctly.
The runtime fixtures now observe process `exit` rather than waiting for
stdio `close`, which can be delayed by Chromium descendants holding inherited
pipes; cleanup still verifies the full recorded process group. The UI smoke
uses explicit browser-chrome focus, validates visible/restored state through
screenshots and persisted storage, and closes local listeners with the
supported `net.Server.close()` API.

Screenshots from the successful AppImage smoke are in the local directory
`/tmp/aether-ui-runtime-evidence/`. They include browser startup, paused
session, tab creation/switching, restricted navigation, history/bookmark
panels, two window sizes, crash recovery, and entered/blocked IPv4 and IPv6
destinations. The screenshots were opened and visually inspected. This is a
local directory, not a GitHub Actions artifact; the workflow upload step has
not been exercised.

Follow-up screenshot inspection found the first history and bookmark captures
did not show their panels. The UI smoke now clicks the toolbar buttons at their
actual centers, waits for rendering, and checks that each captured panel region
contains visible content using the installed ImageMagick tools. The updated
history and bookmark screenshots were inspected and show their respective
panels. The required standalone AppImage smoke passed (1 passed, 0 failed,
0 skipped), and the full serial suite passed again (77 passed, 0 failed,
0 skipped). The dedicated Electron isolation test also passed again (1 passed,
0 failed, 0 skipped).

Remaining gates:

1. Run the workflow on an authorized GitHub Actions runner for the exact
   published commit. Confirm the runner allows rootless user/network
   namespaces and inspect the uploaded screenshot artifact.
2. Independently review the production launcher and process-boundary
   evidence. The production UI probes do not demonstrate attempted packets
   being blocked by the OS, and production-child redirect/WebSocket probes
   have not run. Keep remote browsing disabled until those safe,
   controlled-network probes and the independent review are complete.
3. Preserve Electron sandboxing, fail-closed namespace setup, and
   `REMOTE_BROWSING_ENABLED = false` throughout those remaining gates.

## Historical production child direct-socket probe (2026-10-20)

Historical test wiring ran an opt-in-only direct TCP diagnostic in the
browser-child Electron main process. The diagnostic and its environment
forwarding have since been removed from production startup; the probe module
and tests remain in the source tree for possible migration to a separate
test-only app. The production builder now uses an explicit runtime-file
allowlist that excludes the probe module, tests, fixtures, prototypes, and
builder config. A fresh package has not yet been built and inspected against
that boundary.

At the time of the historical run, the parent test process set
`PARMAR_AETHER_PRODUCTION_NETWORK_PROBE=1` and provided a validated
configuration containing exactly the controlled `127.0.0.1` and `::1`
listener ports. The probe did not change browser navigation policy, network
request interception, Electron sandbox settings, broker authentication, or
`REMOTE_BROWSING_ENABLED`.

For each run, the test runner first connects to both listeners and requires
each listener to observe that baseline connection. It then clears those
observations and starts the packaged AppImage through its normal parent,
supervisor, and production isolation launcher. The browser child makes actual
Node TCP `connect()` calls to the same loopback destinations. It records the
child PID, executable and child arguments, network namespace identities,
verified interfaces/routes/capabilities/`no_new_privs`, destination and port,
attempted/connected flags, and OS error code/message. The runner associates
the result with the child PID, checks that the IPv4 and IPv6 listeners have
received no child connection, and repeats the checks after controlled crash
recovery. Test cleanup verifies recorded production processes and process
groups are gone and that both listeners have closed.

Local packaged AppImage result (20 October 2026): startup child PID `92934`
and recovered child PID `93071` used executable
`/tmp/appimage_extracted_179433408fca4544e9181ef5cf150a42/parmar-aether-desktop`
with the packaged `resources/app.asar` and `--aether-browser-child` arguments.
Both were in `net:[4026532288]`, distinct from the runner/parent
`net:[4026531840]`; the verified namespace had only `lo (down)`, zero IPv4
and IPv6 routes, zero effective capabilities, and `no_new_privs`. For both
processes, the IPv4 `127.0.0.1:45409` `connect()` call returned
`ENETUNREACH` and the IPv6 `[::1]:40665` call returned `EADDRNOTAVAIL`; all
four attempts were recorded as executed and blocked, with no listener
connections after the runner reachability checks.
The packaged smoke passed both standalone and within the serial desktop suite
(81 passed, 0 failed, 0 skipped). It reported the
browser child and process group exited, all recorded production processes
exited, and the controlled listeners closed.

This demonstrates that the production Electron main process's direct
loopback TCP connection attempts were rejected by its OS network namespace
configuration. It does **not** demonstrate packet-level behavior via packet
capture, nor does it test Chromium renderer/network-service TCP behavior,
production HTTP redirects, or production WebSockets. The existing Chromium
redirect and WebSocket attempts remain fixture-only evidence. These checks
remain unverified; this probe is not a basis to enable remote browsing.
Those results describe the then-built artifact and do not verify the current
source package boundary. The probe is no longer imported or invoked by
production startup, and its environment variables are no longer forwarded by
the production supervisor. Keep `REMOTE_BROWSING_ENABLED = false`.

## Packaged Chromium verification results (2026-10-21)

The current worktree was packaged as an AppImage outside the repository at
`/tmp/parmar-aether-current-20261021/`; the pre-existing `dist/` artifacts
were not overwritten. With the user-local system GUI libraries, Xvfb, and
the required-runtime flags enabled:

- `npm test`: 81 tests, 81 passed, 0 failed, 0 skipped. This included the
  live Electron fixture and the packaged AppImage smoke.
- `npm run test:electron-isolation`: 1 test, 1 passed, 0 failed, 0 skipped.
- The packaged smoke passed separately as well. It captured 16 screenshots,
  exercised initial startup, forced browser-child crash and supervisor
  recovery, restricted-navigation attempts, and shutdown. At shutdown the
  browser process group was empty, every recorded production PID had exited,
  and both controlled listeners were closed.

The packaged smoke now waits up to five seconds for each window capture to
render before applying its existing 10 KB screenshot-size assertion. This
addresses the initial blank-frame race without relaxing screenshot validation
or changing any production policy.

The packaged process inspection identified the actual Electron browser-child
main process, Chromium zygotes, GPU process, renderer processes, and the
`utility` process carrying
`--utility-sub-type=network.mojom.NetworkService`. At startup the child main
process (PID `13930`) and network service (PID `13963`) used
`net:[4026532287]`; the observed renderers (PIDs `13991`, `14009`, `14017`)
used `net:[4026532348]`. After recovery the replacement child was PID
`14052`, its network service PID `14087` used `net:[4026532287]`, and its
renderers used `net:[4026532348]`. Both namespaces differed from the parent
`net:[4026531840]`. The child namespace verifier observed only `lo` (down)
and zero IPv4/IPv6 routes; every inspected Electron/Chromium process had
`no_new_privs=1`, only loopback interfaces, and no route outside loopback.
The inspected main/network-service processes had zero effective
capabilities. Chromium sandbox processes in their nested user namespace were
checked for zero capabilities or only the expected namespace-local
`CAP_SYS_ADMIN`.

For both startup and recovery, the runner first demonstrated reachability of
the controlled IPv4 and IPv6 listeners. The actual production Electron
browser-child main process then executed direct TCP connects to those
listeners: IPv4 returned `ENETUNREACH`, IPv6 returned `EADDRNOTAVAIL`, and
neither listener observed a child connection. These are genuine direct-socket
attempts rejected by the isolated process's OS network configuration; they
are not Chromium HTTP requests.

The separate packaged address-bar checks entered
`https://127.0.0.1:<controlled-port>/...` and
`https://[::1]:<controlled-port>/...`. They were rejected by the
application's disabled-navigation policy before `loadURL`; zero listener
connections here establish policy rejection, not an OS-blocked Chromium
request. Explicit `http://` input is rejected before network access as well.
The packaged smoke did not produce Chromium HTTP, redirect, or WebSocket
attempts. The existing HTTP/redirect/WebSocket renderer attempts passed only
in the separate Electron test fixture, not the production AppImage path.
The dedicated fixture pass observed three renderer fetch attempts, three
redirect attempts, and three WebSocket attempts; the fetches/redirects
reported `TypeError: Failed to fetch`, the WebSockets reported
`connection failed`, and every controlled HTTP and WebSocket listener
counter remained zero. Its direct socket probes reported IPv4
`ENETUNREACH` and IPv6 `EADDRNOTAVAIL`. These are fixture-only observations;
the renderer API errors and zero counters alone do not attribute a production
OS-level rejection.

### Controlled Chromium test design and result categories

Keep the packaged test endpoints on ephemeral runner-local IPv4 and IPv6
listeners and verify each listener is reachable from the runner before
launching AETHER. For each scenario, record the production child and
NetworkService PIDs, their network namespaces, the application-policy
decision, whether a request reached Chromium's network layer, any observed
OS/network error, and listener observations. Classify a policy rejection as
`policy-rejected`; classify an attributable NetworkService attempt rejected
by the isolated OS boundary as `network-blocked`; classify a listener accept
as `connected`; and classify a request that policy prevented from being
issued as `unexecuted`. A zero listener count alone does not distinguish
these outcomes.

The current packaged results classify the two address-bar URLs as
`policy-rejected`; the production main-process TCP diagnostics are
`network-blocked`; production Chromium direct HTTP, redirect, and WebSocket
scenarios are `unexecuted`. The separate fixture exercises those renderer
request shapes, but cannot establish production behavior. A production
Chromium test would need a separately reviewed verification design that
allows only the controlled local endpoints, supplies direct HTTP plus an
IPv4-to-IPv6 redirect and a WebSocket attempt, and independently attributes
the connection result to the packaged NetworkService and OS boundary.
Temporarily allowing requests changes the protection being tested and could
become a release bypass if misconfigured or shipped. No such exception or
release-build allowance was added; obtain explicit independent security
review of that design before implementing it.

The process inventory is a `/proc` snapshot based on parent/child traversal;
the process-group scan is also used for cleanup. This observed and checked
the live packaged Chromium processes in these runs, but it is not a proof
that every possible descendant is discoverable: reparenting, process-group
changes, and races with process creation or exit can evade a snapshot. The
namespace boundary, rather than process enumeration, remains the primary
containment control.

No GitHub Actions run was dispatched or observed. Before remote browsing can
be considered, CI must run the packaging, full required-runtime suite,
dedicated isolation test, and packaged smoke on the exact published commit
with no runtime skips; uploaded screenshots must be inspected. A controlled,
reviewed way to exercise Chromium HTTP, redirects, and WebSockets against
loopback listeners and prove OS-level blocking from the packaged
NetworkService is also still required. The current fail-closed policy prevents
that test. No verification-only policy exception was added: such an exception
could bypass the production deny boundary if misconfigured or shipped, so its
design would require explicit review before implementation. An independent
security review of the process boundary, Chromium sandbox, descendant
cleanup, and any proposed network test is still required. Keep
`REMOTE_BROWSING_ENABLED = false`.

## Release workflow and security-gate audit (2026-10-21)

### Workflow inclusion and CI evidence

`.github/workflows/aether-linux-runtime.yml` exists in the worktree but is
untracked (`git status` reports `?? .github/`); it is not present in `HEAD`.
The current `main` commit and advertised `origin/main` commit are both
`2ffbcadba5b95c8c427de6d53858967bf600a8a6`. Thus the workflow and other
uncommitted runtime changes are not included in the current release commit.
The intended release commit must include the reviewed workflow and matching
desktop sources before a run can verify those exact changes.

`gh auth status` reports that no GitHub host is authenticated, and neither
`GH_TOKEN` nor `GITHUB_TOKEN` is present. Read-only `gh workflow list` and
`gh run list --workflow aether-linux-runtime.yml` therefore could not query
the repository. No CI result has been observed; CI status is **not run /
unknown**, not passed. Do not dispatch or publish to resolve this without
explicit authorization.

The workflow commands match the local verified desktop test commands:
`npm run package:dir`, `npm run package:linux`, `npm test`, and
`npm run test:electron-isolation`. The full suite sets both
`PARMAR_ELECTRON_RUNTIME_REQUIRED=1` and
`PARMAR_AETHER_UI_SMOKE_REQUIRED=1` plus `PARMAR_AETHER_UI_SMOKE=1`; the
dedicated Electron test also sets runtime-required mode. With those
requirements set, missing GUI, Electron, or namespace prerequisites make the
tests fail instead of silently skipping. The serial `npm test` includes both
the controlled Electron fixture and the packaged AppImage UI smoke. The
standalone integration command repeats the fixture test.

After package build, the smoke launches the generated AppImage through the
production parent/supervisor/namespace path; it is not fixture-only
verification. It checks the production browser child and observed Chromium
descendants through startup, recovery, and shutdown. Its direct TCP diagnostics
are from the production Electron main process. The workflow does not yet
exercise production Chromium HTTP, redirect, or WebSocket requests.

The workflow uploads the screenshot directory even when earlier steps fail,
with a 14-day artifact retention and `if-no-files-found: warn`. It does not
upload the built AppImage/unpacked package, a separate test-results report, or
a dedicated log artifact. Test output is available in Actions job logs when a
run exists; no explicit job-log retention is set in this workflow.

### Verified security facts and remaining assumptions

- **Production Electron main network:** packaged direct IPv4 and IPv6 TCP
  attempts ran at startup and after recovery. The observed namespace had
  loopback down and no routes; the attempts returned `ENETUNREACH` and
  `EADDRNOTAVAIL`, with controlled listeners reachable from the runner but
  accepting no child connections. This verifies these direct main-process
  attempts, not every networking mechanism.
- **Chromium:** the packaged smoke identified renderer processes in a
  nested network/user namespace and the Chromium `NetworkService` utility in
  the production child network namespace. Inspected processes had
  `no_new_privs`; the namespace and route checks passed. This is live
  process-state evidence, not proof that every possible Chromium network path
  is blocked.
- **HTTP, redirects, and WebSockets:** the packaged navigation policy
  rejected the attempted addresses before network dispatch. Production
  Chromium request behavior remains unverified. The positive request-shape
  attempts were only made by the separate test fixture.
- **Descendants and shutdown:** startup/recovery snapshots found the
  production child, NetworkService, renderer, and other live Chromium
  processes; the process group and recorded PIDs were empty after shutdown.
  `/proc` traversal is a time-bounded snapshot, not proof that every
  descendant can always be discovered.
- **Recovery and startup:** the packaged smoke observed a child crash,
  supervisor recovery, a new isolated child, and clean shutdown. The
  launcher is fail-closed on namespace/setup/startup failure and has no
  unisolated fallback. The documented bounded restart behavior is not a
  substitute for independent review of recovery race and exhaustion cases.
- **Electron policy and trust boundaries:** the current code retains
  `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  restrictive web security, denied permissions, and denied window opens.
  Remote navigation remains disabled; the browser session cancels HTTP(S)
  and WS(S) requests. Preload APIs are narrow, and main-process IPC handlers
  validate the sender and frame before actions. The control backend is
  restricted to a loopback origin. No remote-approval capability or
  approval-to-network boundary has been demonstrated or enabled.

Independent security review is still required for the production launcher and
namespace boundary, Chromium sandbox/user-namespace behavior, the limits of
descendant enumeration and cleanup, recovery failure modes, IPC and
navigation enforcement, and any proposed controlled Chromium request test.
Do not add a verification-only policy bypass without prior explicit review;
do not treat such a bypass as authorization to ship or enable browsing.

### Next steps without weakening production controls

1. Obtain explicit authorization to publish a reviewed commit/branch
   containing the workflow and the exact runtime sources to be verified, and
   authenticate with a GitHub account that can read workflow results and
   initiate the authorized CI path. The workflow is not tracked at the
   current commit, so neither its `push`/`pull_request` triggers nor
   `workflow_dispatch` can verify this local worktree as-is.
2. Run the workflow for that exact commit without required-runtime skips;
   inspect job logs and the screenshot artifact.
3. Obtain independent security review and an approved design for attributing
   controlled HTTP, redirect, and WebSocket attempts to the packaged
   NetworkService and its OS-level result, without a release-build exception.

Until these gates have direct evidence and review, keep
`REMOTE_BROWSING_ENABLED = false`.
