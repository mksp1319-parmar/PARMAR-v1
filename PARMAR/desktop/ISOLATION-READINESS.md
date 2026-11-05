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

## Code-only readiness update (2026-10-31)

The page-level Ctrl/Meta zoom shortcuts now publish browser state after
changing the active tab's zoom factor, so the browser chrome does not retain
stale zoom state. A lifecycle regression test verifies the updated factor is
sent to the renderer.

The browser renderer now forces the address field to follow active-tab
changes even while that field remains focused, while preserving in-progress
text edits during ordinary updates to the same tab. A regression test drives
the renderer's Ctrl+Tab action and verifies both behaviors. Another regression
test covers the settings-panel zoom buttons and Ctrl-minus/Ctrl-zero shortcuts.

The UI smoke-test adapter keeps Xvfb as its default and supports Weston with
its real Xwayland backend as an opt-in alternative. Readiness requires both
Weston's Xwayland display announcement and a Wayland Unix socket; shutdown
signals and verifies the Weston process group, including Xwayland, and
escalates to SIGKILL if graceful cleanup fails. ImageMagick 7 uses its genuine
`magick import` and `magick` commands. Focused adapter tests cover startup
failure, early exit, readiness timeout, normal shutdown, process-group
cleanup/escalation, and command mapping. Isolation tools remain fixed at
`/usr/bin/unshare` and `/usr/bin/setpriv`; the existing network-isolation,
namespace, `no_new_privs`, screenshot, and cleanup assertions were not
weakened.

Code-level verification: `cd PARMAR/desktop && npm test` completed with 118
tests, 114 passed, 0 failed, and 4 skipped. JavaScript syntax checks for the
changed/new test and application files and `git diff --check` passed. This
suite does not establish that Weston/Xwayland or the Electron UI ran here:
the live Electron isolation and packaged UI screenshot tests were skipped
because their runtime prerequisites/explicit opt-in were absent. No new
package build, real Electron launch, screenshot capture or image inspection,
or hosted workflow run was performed for this code-only update. These runtime
checks remain pending; keep `REMOTE_BROWSING_ENABLED=false` until the required
production isolation evidence is collected and reviewed.
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

## Ubuntu 24.04 user-namespace CI failure (2026-10-22)

GitHub Actions run
[39571628476](https://github.com/mksp1319-parmar/PARMAR-v1/actions/runs/39571628476/job/119126976845)
failed in `unshare --user --map-current-user --net true` with
`write failed /proc/self/uid_map: Operation not permitted` and exit status 1.
That failure establishes that the hosted runner denied the UID map; the old
job did not print the relevant sysctl values or AppArmor profile, so it does
not by itself prove which kernel policy caused the denial. [Ubuntu's AppArmor
documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/)
describes the per-process restriction on unprivileged user namespaces and the
`kernel.apparmor_restrict_unprivileged_userns` control. On a standard hosted
`ubuntu-24.04` VM, this is the leading cause; the updated job logs the
AppArmor and user-namespace settings, active profile, namespace tools, and
the exact command's failure reason and exit status to distinguish it from
other kernel or runner restrictions.

Only for the disposable workflow VM, the job temporarily sets
`kernel.apparmor_restrict_unprivileged_userns=0` when its original value is
`1`, then restores `1` in an `always()` cleanup step. Other AppArmor settings
are not changed. The namespace probe and AETHER child run as the ordinary
runner user; neither receives elevated privileges. The setting does not
change PARMAR's application security configuration. The required live
namespace, isolation, Electron UI, and screenshot checks remain failures if
their prerequisites or assertions fail; they are not skipped in CI.

During the 2026-10-22 Codespace check, the AppArmor restriction was `0` and
the unprivileged namespace probe succeeded, but `/usr/bin/Xvfb`,
`/usr/bin/xdotool`, ImageMagick `import`/`convert`, and
`node_modules/electron/dist/electron` were absent. No live Electron window
opened and no screenshots were generated in that check.

## Local verification (2026-10-24)

The normal desktop suite completed with 84 tests: 82 passed, 2 environment-
gated checks skipped, and 0 failed. The live Linux namespace prototype and
controlled-listener fixture did run and passed; those results are not
Electron/Chromium evidence. Required-mode Electron isolation and packaged UI
smoke runs did not skip: both failed because `/usr/bin/Xvfb` is absent. The
pinned Electron binary was restored with its package installer, but the
packaged executable cannot start in this Codespace because shared libraries
are missing, including `libatk-1.0.so.0`, `libatk-bridge-2.0.so.0`,
`libcups.so.2`, `libgtk-3.so.0`, X11/GBM, ALSA, and AT-SPI libraries. The
AppImage executable also cannot be launched directly because `libfuse.so.2`
is absent.

Fresh Linux directory and AppImage packages both built successfully in
temporary output directories. The directory package and an extracted copy of
the AppImage each contained the production main process, child supervisor and
broker, isolation launcher and verifier, preloads, and browser assets. The
AppImage's `--appimage-extract` path worked without FUSE. Builds and archive
inspection do not establish that the packaged Electron runtime can launch.

The updated workflow has not been run on GitHub; this local evidence does not
verify the hosted runner or restoration step. Run it on the exact published
branch and inspect its diagnostics, test results, and
`aether-linux-runtime-screenshots` artifact before treating hosted runtime
verification as complete. Keep `REMOTE_BROWSING_ENABLED = false`.

## Provisioned Codespace runtime verification (2026-10-24)

The Ubuntu 24.04 Codespace permitted non-interactive sudo and had sufficient
disk space. Apt indexes were refreshed and the missing GUI/runtime and
screenshot dependencies from the workflow were installed system-wide, with
recommendations disabled. The transaction installed 101 packages and updated
14 dependency packages; no package was removed. Electron 44.7.0 then started,
and `ldd` reported no unresolved shared libraries. Xvfb, xdotool, and
ImageMagick `import`/`convert` are available. The AppImage smoke uses
`--appimage-extract-and-run`, so it does not depend on FUSE mounting.

The normal desktop suite completed with 84 tests: 82 passed, 2 environment-
gated runtime tests skipped, and 0 failed. Separately, the required-mode live
Electron/Chromium isolation integration passed (1 passed, 0 failed, 0 skipped).
It observed the Electron main process, utility process, and Chromium renderer
in the isolated network namespace, and completed its controlled-listener,
descendant, crash, and cleanup checks.

The required packaged AppImage UI smoke passed (1 passed, 0 failed, 0 skipped)
under Xvfb. It inspected production startup and crash-recovery process trees
for the separate network namespace, empty routes, loopback-only interface,
zero effective capabilities, and `no_new_privs`; it also checked restricted
IPv4/IPv6 navigation, session persistence, browser interactions, and process
cleanup. Sixteen nonempty screenshots were captured in the temporary
verification output directory. A live run exposed and corrected the test's
address-bar click coordinate, which had been below the toolbar; the browser
window also now routes keyboard shortcuts through its existing active-tab
handler when browser chrome has focus.

This verifies the local Codespace runtime only. The AppArmor user-namespace
setting was already `0`, and the unprivileged namespace probe succeeded
without changing it. This does not determine whether changing that setting
will fix the previous hosted runner's `uid_map` denial. No GitHub Actions run
was dispatched, and `REMOTE_BROWSING_ENABLED` remains `false`.

## Production-child network evidence boundary (2026-10-24)

The packaged UI smoke starts the actual production Electron browser child.
It checks the child and its live descendants for a separate network namespace,
only the loopback interface, no external IPv4/IPv6 routes, `no_new_privs`,
and restricted effective capabilities. It also confirms the test runner can
reach controlled IPv4/IPv6 TCP listeners, enters those addresses through the
production address bar, verifies that navigation is rejected, and observes
that neither listener receives a connection. These observations verify the
production child's configured namespace and fail-closed navigation behavior;
they do not show a production-process socket attempt being denied by the
kernel, because the navigation policy cancels the request before dispatch.

The separate Electron/Chromium integration fixture does exercise direct TCP,
renderer fetch, redirect, and WebSocket attempts against controlled listeners
inside its isolated test application. This is OS-boundary evidence for that
fixture and the shared isolation launch mechanism, not proof that the actual
production browser child made or blocked those requests. Do not add a
verification-only socket probe to production startup or the packaged UI
smoke. Independent production-child socket attribution needs a separately
reviewed test design that does not create a release-build policy bypass. The
current production child has no test-only action that can initiate a native
socket attempt: its normal navigation and `webRequest` policy rejects remote
destinations before dispatch. The UI smoke therefore cannot distinguish a
kernel-denied connect from a request that never reached the socket layer.

The next safe step is independent review of a test-only packaged harness that
keeps `REMOTE_BROWSING_ENABLED` false, preserves the normal `unshare` /
`setpriv` launch and child supervision, and triggers only explicit native
loopback `connect()` attempts against parent-owned controlled listeners. It
must be excluded from release artifacts, identify the actual child PID and
executable for each attempt, prove the parent can reach each listener, require
the child attempt to execute, record a kernel/network error rather than a UI
policy cancellation, and fail if any listener accepts a child connection.
Until that seam is reviewed and implemented, the existing fixture is the
available OS-boundary evidence; the production packaged child has namespace
configuration and navigation-denial evidence only. Do not use DevTools,
remote-debugging switches, a relaxed request policy, or privileged AETHER
execution as a shortcut.

Until such evidence and the hosted workflow verification are available,
`REMOTE_BROWSING_ENABLED` remains `false`.

## A10(g) release-readiness evidence audit and minimum future test

This section reconciles the A10(e) and A10(f) records with the A10(f)
process-correlation/WebSocket follow-up above. The newest focused report is
`/tmp/parmar-a10f-correlation-final-check.kYZfht/probe/production-child-network-probe-e686346201a5b2cc9019cc48.json`.
Earlier reports remain useful historical records but do not supersede the
newest report's limitations. In particular, the A10(e) and earlier A10(f)
paragraphs that say the tab renderer was not instrumented predate the later
tab probe; they are historical, not the current status.

### Evidence categories

**Directly verified in the latest focused run**

- The test-only wrapper identified the actual `WebContentsView.webContents`
  loading packaged `newtab.html`, recorded WebContents ID `2`, and collected
  CDP events from its renderer PID `36609`. It separately identified the
  `browser.html` shell renderer PID `36580`; these are distinct renderers.
- The packaged Electron app metrics and process arguments identify
  NetworkService candidate PID `36564`. The tab renderer and NetworkService
  were each checked independently in the process tree. The tab renderer used
  `net:[4026532405]`; NetworkService used `net:[4026532344]`. Both had only
  `lo`, no external routes, zero effective capabilities, and
  `no_new_privs=1`. The namespace identifiers differ and are not represented
  as shared.
- The tab CDP session recorded the configured numeric-loopback IPv4 HTTP,
  IPv6 HTTP, redirect-source, and WebSocket creation events, correlated to the
  tab renderer/WebContents metadata. Controlled listener counters were zero
  after the production-tab probes. App parent/child, Xvfb, and listener
  cleanup were verified.
- The separate Node controller client received a real HTTP 302 from the
  controlled source and made a request to the controlled target. Its target
  returned 204. This is evidence about the fixture and Node client only.

**Application/session-policy evidence (attribution is consistent, not
independently instrumented)**

- The three tab HTTP requests ended with `net::ERR_BLOCKED_BY_CLIENT`, which
  is consistent with the production session's `webRequest` cancellation.
  The probe does not record the policy callback itself, so the CDP error alone
  does not conclusively attribute cancellation to that callback. It does not
  prove an OS denial.
- The production tab's redirect-source request was cancelled before the
  source listener received it; this is consistent with the configured
  session policy, but no separate callback evidence was captured. Chromium
  observed no real 302 and issued no redirect-target request. The Node
  fixture's 302 does not change this.

**Inferred, but not directly attributed**

- NetworkService candidate PID `36564` belongs to the same Electron instance
  and is independently identified as a network utility process. The CDP
  request IDs do not identify which NetworkService process handled a given
  request; no per-request NetworkService attribution is established.
- The `WebContentsView` CDP stream recorded `Network.webSocketFrameError`
  and `Network.webSocketClosed` for request ID `36609.5`, with no handshake
  request or response event and an empty error message. This is correlated
  renderer-side lifecycle evidence, but the failure cause (session policy,
  Chromium, or kernel) is unknown.
- No external traffic was configured and the probed production processes had
  no external routes. No host-wide packet capture was performed, so absence
  of all unexpected host traffic is not independently measured.

**Not yet tested or proven**

- A renderer-request-correlated `connect()` syscall, destination tuple, and
  kernel result/errno. The controller's Electron-main socket probe and its
  `ENETUNREACH`/`EADDRNOTAVAIL` results are not renderer evidence.
- A WebSocket handshake request reaching a controlled server or a handshake
  response (success or failure) observed in the actual tab.
- A real Chromium redirect source response and a correlated follow-up attempt
  by the actual production tab.
- The same request correlation on a hosted CI runner. No CI workflow run was
  dispatched or inspected for this evidence.
- System-wide evidence that no other process emitted external traffic.

### Minimum safe CI/host test contract

The existing production topology intentionally gives the browser child no
external interface or route and has loopback down. Under that topology the
controller's loopback listeners cannot answer the tab, while the production
session policy cancels HTTP/WebSocket requests before a handshake or redirect
can occur. Do not change the production policy or put the production tab in a
host-network namespace to make these tests pass.

Local prerequisite checks for this assessment:

- `/usr/bin/unshare`, `/usr/bin/setpriv`, `/usr/sbin/ip`, and
  `/usr/bin/nsenter` are present. An unprivileged
  `unshare --user --map-current-user --net --fork -- true` succeeded (exit 0),
  so creation of a user/network namespace is verified locally.
- Inside that namespace, `/proc/self/status` showed `CapEff=0`. Creating a
  test-only veth pair with `/usr/sbin/ip link add ... type veth peer name ...`
  failed with `RTNETLINK answers: Operation not permitted` (exit 2). No link
  was created in the host namespace; no host networking or security setting
  was changed. Therefore the proposed rootless veth endpoint topology is
  **not available under the current local invocation**.
- `/usr/bin/strace` is installed, but the local controller has zero effective
  capabilities and `ptrace_scope=1`; unprivileged BPF is disabled
  (`unprivileged_bpf_disabled=2`), perf is restricted
  (`perf_event_paranoid=4`), tracefs events are unreadable, and `bpftrace`
  and `perf` are absent. No tracing was attempted.
- The workflow checks namespace creation and GUI dependencies, but does not
  check namespace-scoped `CAP_NET_ADMIN`/veth setup or provide a validated
  request-to-kernel observer. No hosted workflow run was inspected. These
  prerequisites remain unverified for hosted CI.

### Architecture choice: three options

**Recommendation: C — defer kernel-attribution testing until a suitable
runner is verified.** It is the only option supported by current evidence
without assuming unverified privileges, topology capabilities, or
instrumentation. It preserves the production boundary but does not close the
evidence gap. Remote browsing remains disabled.

| Option | Isolation boundary and controlled endpoints | Request-to-process/kernel attribution | Required privileges and runner capabilities | Risk and maintenance |
|---|---|---|---|---|
| **A. Infrastructure-pre-provisioned isolated topology** | Can keep the tab and NetworkService in a dedicated app namespace separated from the host, with no default route/Internet forwarding and only a test-owned link to controlled HTTP, redirect, and WebSocket endpoints. It is a test topology, not the production child's exact no-interface/no-route namespace. The current launcher has no supported join/configure path. | A provisioned topology alone does not correlate CDP request to NetworkService syscall. A validated per-process observer remains necessary to record PID, destination, attempt, and kernel outcome. | Requires a dedicated disposable VM/runner that provisions the topology, then drops setup privileges before tests. No host root, host-level `CAP_NET_ADMIN`, or test-process privilege. Current local veth creation fails with `CapEff=0`; hosted support is unknown. | Most viable if an independently validated runner exists; requires isolated runner provisioning and reliable teardown. Not demonstrated here. |
| **B. Test-only launcher/topology seam, excluded from production builds** | Could explicitly configure a disposable isolated namespace with only fixture endpoints and a narrowly limited test archive policy. The actual tab stays off the host network, but the topology differs from production and requires a separate unchanged-policy run. | The seam does not solve syscall attribution; it still requires the observer and independent PID/request/destination/result correlation. | Requires safely provisioned namespace networking before capability drop, without adding privilege to production. The current launcher always creates a fresh namespace and drops capabilities; a test seam would need separate security review and packaging exclusion. | Highest risk: seam/allowlist leakage into release, test-vs-production behavior drift, and ongoing maintenance. No implementation justified before runner and observer are available. |
| **C. Defer until a suitable runner is available** | Preserve current production topology and fail-closed policy. Do not claim real Chromium endpoint responses, redirect follow-through, or WebSocket handshake. Existing Node redirect fixture remains separate. | Report current CDP/process evidence and policy-consistent failures; leave NetworkService syscall/kernel attribution unavailable. | No added privilege or host change. Future runner must be explicitly verified for safe endpoint isolation and a validated observer; hosted CI support is not assumed. | Lowest risk and maintenance. Does not close gaps; selected until evidence prerequisites are met. |

Neither A nor B is currently validated: local namespace creation works but
veth setup is denied, the launcher cannot join a prepared topology, and no
safe per-process observer has been validated. Both would need controlled
HTTP/302/WebSocket endpoints plus a distinct production-policy test. Do not
implement a speculative seam or treat endpoint reachability as proof of
kernel denial.

If a future runner satisfies those prerequisites, validation should use two
**separate, disposable test modes**, not a single claim that combines
production policy rejection with network transport:

1. Use a dedicated Linux host/CI runner that has verified rootless user and
   network namespace support, a working sandboxed Electron runtime, and the
   required GUI prerequisites. Hosted-runner support for veth configuration,
   user-namespace capabilities, ptrace/BPF, or syscall tracing is unknown:
   test it explicitly and fail required mode if a prerequisite is absent.
2. **Production-policy mode:** use the normal packaged application, launcher,
   sandbox, and exact no-route child namespace, with
   `REMOTE_BROWSING_ENABLED=false`. Verify the fail-closed session/navigation
   policy and process isolation. Do not call application-policy cancellation
   an OS-denied request.
3. **Test-only transport mode:** only after a separate, disposable app
   namespace can be connected to a fixture-only endpoint namespace, use a
   test archive/configuration that allows only the numeric fixture addresses
   for HTTP, redirect, and WebSocket probes. Keep both namespaces without a
   default route or host/Internet forwarding; permit only the explicit
   test-owned link and fixture ports. This changes the network topology from
   the production child's exact no-interface/no-route namespace. It may
   preserve the no-host/no-public-egress invariant, but its evidence must be
   labeled test-topology evidence, not the production namespace's behavior.
   Do not alter production assets or policy, and do not launch the actual tab
   in the host namespace.
   Creating and configuring a veth requires `CAP_NET_ADMIN` in the owning
   network namespace. The current test process has no such capability. The
   only acceptable future arrangement is infrastructure-side provisioning
   confined to a dedicated disposable VM/network namespace, with privileges
   dropped before test execution; no test process may receive host-level
   `CAP_NET_ADMIN` or use `sudo`. If that preprovisioned isolated topology is
   unavailable, this transport mode is blocked.
4. The current production launcher unconditionally creates a fresh user and
   network namespace using `unshare --user --map-current-user --net`, then
   drops capabilities and sets `no_new_privs` before starting Electron. It
   has no supported option to join a preconfigured fixture namespace or
   retain a fixture-only interface. The veth probe failed locally with
   `CapEff=0`. Thus connecting a controlled endpoint requires a separately
   reviewed test-only launcher/topology seam (or host-pre-provisioned
   isolated namespaces with a demonstrated way for the supervised child to
   join the app namespace before capability drop). The current app topology
   cannot be used to deliver a real redirect or WebSocket handshake.
5. Provide a supported per-process observation mechanism that correlates the
   isolated NetworkService PID, destination address/port, syscall attempt,
   and kernel result/errno. It must avoid tracing the host-network controller,
   preserve Chromium sandboxing, require no additional runtime privileges,
   and be validated not to perturb sandbox or network behavior. No such
   mechanism has been validated here. `strace` exists but was not used:
   tracing the full test launcher would include host-network control
   processes, and tracing/inserting an observer into Chromium can affect its
   sandbox. If the observer requires elevated capabilities, host security
   changes, or a sandbox bypass, it does not meet this test contract.
   Report kernel attribution unavailable rather than claiming OS denial.
6. Record server-side evidence for the real WebSocket upgrade and exact 302
   source response; record the tab request/handshake/redirect lifecycle,
   renderer PID/WebContents ID, NetworkService candidate PID, and separately
   correlated syscall destination/outcome. A CDP event, browser error string,
   PID proximity, or zero listener counter alone is insufficient.
7. Write a machine-readable report containing package/config hashes, namespace
   IDs, interfaces/routes, capabilities, `no_new_privs`, process ancestry and
   types, tab/WebContents and CDP identifiers, NetworkService candidate and
   syscall attribution (or explicit unavailable status), fixture request and
   response counters, and cleanup results. Always verify all application,
   Chromium, tracing, fixture, and display processes exited.
8. Run the unchanged production-policy test separately from the test-only
   endpoint-allowlist run. The latter cannot establish that the unchanged
   production no-route topology permits real transport.

Acceptance criteria for any future prototype:

- Fail required mode if user/network namespace creation, GUI prerequisites,
  endpoint isolation, the no-default-route/no-forwarding check, or the
  validated per-process observer is unavailable. No privileged fallback.
- Prove process ancestry and exact PID/type for the WebContentsView renderer
  and NetworkService; capture both namespace IDs and independently check
  routes, interfaces, capabilities, and `no_new_privs`.
- For every probed attempt, correlate a tab CDP request ID with an observed
  NetworkService PID and a kernel connect destination/result/errno. Keep
  policy cancellations distinct from connect attempts.
- For WebSocket, require server-side receipt of the upgrade request and
  record the HTTP handshake outcome plus the matching tab CDP lifecycle.
- For redirects, require server-side source request and exact 302 Location,
  then record the tab's distinct destination request and target-side receipt.
  If the source is blocked, mark follow-through unverified; never synthesize
  a 302 or claim it was followed.
- Verify controlled listeners, child/renderer/network-service processes, any
  observer, and display processes are cleaned up on success and failure.
- Preserve `REMOTE_BROWSING_ENABLED=false`; treat production-policy tests and
  test-only transport tests as separate evidence.

This prototype is not currently feasible in the observed local environment:
namespace creation works, but test-owned veth creation is denied, the
production launcher discards the parent topology, and no safe request-to-
kernel observer is available. Do not work around these blockers by adding
privileges, bypassing the production launcher, enabling remote browsing, or
altering host security settings. Until a suitable host/CI runner and reviewed
test-only architecture meet the acceptance criteria, the status is **not
release-ready for enabling remote browsing**.

## Test-only production-child direct socket harness (2026-10-24)

The test suite now provides a required-mode harness for direct TCP attempts
from the actual packaged Electron process launched with
`--aether-browser-child`. Build a fresh Linux directory package, then run:

```sh
cd PARMAR/desktop
PARMAR_AETHER_LINUX_DIR_PATH=/absolute/path/to/linux-unpacked \
PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
npm run test:production-child-network-probe
```

The test extracts the supplied archive into a temporary directory and creates
a separate instrumented `app.asar`. That test archive keeps the packaged
production `main.cjs`, `browser-child-supervisor.cjs`,
`isolation-launcher.cjs`, and `isolation-probe.cjs` byte-for-byte unchanged;
the harness verifies those copies before launch. It changes only the temporary
package entry to a test bootstrap and adds the two explicit probe environment
variables to the temporary supervisor's child allowlist. The bootstrap runs
the unchanged production main and, only in the supervised browser-child
process, calls the direct-socket probe immediately after the production
isolation verifier succeeds. No probe, bootstrap, or probe environment
allowlist change is added to the release package. The harness has no IPC
route, navigation bypass, remote destination, or privileged launch.

The test uses parent-owned `127.0.0.1` and `::1` listeners, proves the parent
can connect to both, then requires the reported PID to be the live
`--aether-browser-child` process using the packaged Electron executable. It
checks that PID's network namespace identity and verifies the existing report
of loopback-only/down interface, zero routes, zero effective capabilities,
and `no_new_privs`. Both child `connect()` calls must be recorded as executed,
unconnected, and rejected with a recognized OS error; neither listener may
observe a child connection. Parent, child, Xvfb, and listeners are cleaned up
even after assertion failure.

This is direct evidence for TCP connects made by the production Electron main
process in a test-instrumented package using the production supervisor and
isolation launcher. It is not a byte-for-byte run of the normal release
`app.asar`, and it does not prove how Chromium renderer or network-service
sockets behave. The separate fixture still remains fixture-only evidence.
Keep `REMOTE_BROWSING_ENABLED = false` until the production browser's intended
network behavior and all required independent review gates are satisfied.

Required-mode local result (2026-10-24): the test used the byte-identical
Electron executable from a fresh Linux directory package and verified that
the tested PID was a descendant of the packaged parent, ran the production
`--aether-browser-child` argument, and matched the probe's reported namespace.
The controlled IPv4 `connect()` returned `ENETUNREACH`; the controlled IPv6
`connect()` returned `EADDRNOTAVAIL`. Both attempts were recorded as executed
and blocked, with no listener connections. Cleanup verified parent exit,
empty production-child process group, Xvfb exit, and closed listeners. This
local run proves the production Electron main-process TCP behavior in the
test-instrumented package only; it does not remove the renderer/network-service
evidence gap or verify a hosted Actions runner.

## Required local verification (2026-10-25)

The Linux directory package and AppImage were built into a temporary output
directory outside the repository. The checked-in release configuration and
the pre-existing ignored `desktop/dist` directory were not redirected or
overwritten. Inspection of the fresh `app.asar` found 17 packaged files, no
`test/` directory, and none of the test-only production-child probe, bootstrap,
or temporary builder configuration. The packaged PARMAR emblem was
byte-for-byte identical to
`../interface/static/assets/parmar-emblem.png` relative to this document.

The focused feature, store, preload, renderer, startup, and lifecycle tests
passed 49/49. The full desktop suite then passed 97/97 with zero failures and
zero skips. Required-mode runs of the live Electron/Chromium integration,
production-child direct-socket harness, and packaged AppImage UI smoke all
passed in the full suite. The packaged UI smoke was also run separately after
adding 360px mobile, 640px tablet, and large-desktop captures; all passed and
process-group cleanup was verified. Screenshots were inspected from the
temporary output directory.

The live Electron/Chromium fixture directly attempted renderer requests
against parent-owned controlled endpoints, including fetch, redirect, and
WebSocket paths. The fixture recorded no accepted connections, and its
renderer ran outside the host network namespace. This demonstrates those
tested requests were blocked in that fixture under the local Linux runtime; it
does not exercise the production AETHER renderer. The separately instrumented
production-child harness exercised direct IPv4 and IPv6 TCP `connect()` calls
from the supervised production Electron main process and observed
`ENETUNREACH` and `EADDRNOTAVAIL`, respectively, with no accepted connections.
The normal packaged UI smoke observed the production Chromium process tree in
isolated namespaces with `no_new_privs`, zero effective capabilities outside
Chromium's expected sandbox capability, rejected restricted-navigation
requests before dispatch, and cleaned up all recorded processes. Its zero
listener count is navigation-policy evidence, not proof of a kernel-denied
renderer socket attempt.

Accordingly, Chromium renderer/network-service isolation in the production
release has **not** been directly proven by these runs. Renderer-originated
network traffic was tested only in the separate integration fixture, and the
production-child socket harness tests the Electron main process. Keep
`REMOTE_BROWSING_ENABLED = false`; no test here establishes safe unrestricted
remote browsing or verifies a hosted Actions runner.

## Follow-up verification (2026-10-25)

The store regression suite now passes 16/16. It covers the preserved
`updateBookmark` behavior, duplicate normalization, malformed JSON, failed
rename recovery, and a temporary-file collision. The collision test verifies
that exclusive temp-file creation failure does not delete the pre-existing
file. `AetherStore.save()` tracks whether it created its temporary file and
only removes that file on failure; failed persistence leaves the in-memory
state unchanged.

The complete desktop command ran with the live Electron runtime, AppImage UI
smoke, and production-child probe explicitly required. It passed 100/100 tests
with zero failures and zero skips. This includes the live Electron/Chromium
fixture, production-child probe, and packaged UI smoke. The production-child
probe again observed direct IPv4 TCP blocked with `ENETUNREACH` and IPv6 TCP
blocked with `EADDRNOTAVAIL`; both controlled listeners recorded no child
connections. The production process tree and its observed descendants were
checked for non-host network namespaces, only loopback interfaces, no
external routes, `no_new_privs`, and zero effective capabilities apart from
Chromium's sandbox allowance in its user namespace. A real Chromium renderer
was observed. The normal UI smoke's restricted URL attempts were rejected by
policy before dispatch and are not treated as OS-level socket evidence.

The packaged UI smoke exercised launch, paused session restoration, tab
keyboard actions, restricted-navigation errors, empty history/bookmark panels,
crash recovery, and shutdown cleanup. Captures were visually inspected at
360x720, 640x720, the default 1320x880 desktop size, and 1460x920 large
desktop size (the requested 1480px window was constrained by the display).
No overall horizontal page overflow was apparent; the tab strip and mobile
shortcut row intentionally scroll horizontally. These screenshots do not
constitute a DOM scroll-width assertion, and a native application-menu
interaction was not part of this smoke.

The directory package and AppImage built successfully in a temporary
directory. Both packaged emblems matched the source asset byte-for-byte, and
neither production `app.asar` included test fixtures. JavaScript syntax checks
and `git diff --check` passed. The test-instrumented production-main-process
probe still does not directly exercise sockets from the production Chromium
renderer or network service, nor production redirects or WebSockets.
`REMOTE_BROWSING_ENABLED` remains `false`.

## Packaged production Chromium renderer probe

This section describes the evidence boundary for the packaged Chromium test.
It intentionally does not turn a passing regression into a claim of proven
renderer OS-level network denial.

### Security properties and test architecture

The required regression starts with a fresh Linux directory package produced
outside the existing `desktop/dist` directory. The test makes a disposable
copy of that package. It verifies byte identity for the Electron executable
and the production `main.cjs`, supervisor, launcher, isolation verifier, and
fail-closed `security.cjs`. The disposable copy changes only its package entry
point, test supervisor allowlist/switches, and browser-shell CSP. The
test-only entry point immediately loads the real production `main.cjs`. The
test CSP uses the broad `http:` and `ws:` scheme sources because Chromium
rejects an IPv6-literal CSP source expression; the harness separately
validates that every configured request URL uses numeric `127.0.0.1` or
`::1`. The application remains in a no-route namespace. This test-only CSP
does not change the production CSP or policy, and
`REMOTE_BROWSING_ENABLED` stays `false`.

The packaged parent runs below an unprivileged `unshare --user
--map-current-user --net --fork --kill-child=SIGKILL` boundary and
`setpriv --no-new-privs`. Proxy-named environment variables are removed from
the test application's environment. Before accepting results, the test
compares the live packaged parent namespace with its runner, reads its
interfaces and IPv4/IPv6 route tables from `/proc`, and checks its effective
capability mask and `NoNewPrivs`. The production supervisor then creates its
own stricter child namespace. For each live packaged child, including the
reported renderer and NetworkService PIDs, the test records PID, executable,
process type, network/user namespace IDs, interfaces, route presence,
capabilities, and `no_new_privs`. A Chromium NetworkService may be in a
different namespace from the renderer; the report records each actual
namespace rather than assuming they are identical. Both must be non-host and
have only loopback and no external route.

The packaged `browser.html` shell renderer is instrumented through CDP for
controlled IPv4 HTTP, IPv6 HTTP, redirect-source HTTP, and WebSocket attempts.
The report associates each CDP request event/failure (or WebSocket creation
event) with the shell renderer PID obtained from that `webContents`. This is
not the `WebContentsView` tab-content renderer and does not prove its socket
behavior. It proves dispatch to Chromium's shell-renderer/networking stack
only; CDP events are not kernel-syscall evidence. A separate production
Electron-main-process Node socket probe reports its own PID and IPv4/IPv6
socket API errors; it is explicitly stored as **main-process evidence**, never
counted as renderer evidence.

Each required probe writes a machine-readable JSON report and a diagnostic
log into the supplied fresh evidence directory. The report preserves raw CDP
events, direct-main-process records, process and namespace observations,
listener counters, redirect outcome, test status, cleanup state, and kernel
instrumentation availability. CI uploads this directory, including
screenshots, on success or failure.

### Findings and evidence classification

**A. Directly observed facts**

- CDP records renderer-target request events and Chromium network failures for
  the controlled loopback URLs when the required probe passes.
- The test identifies the renderer and `network.mojom.NetworkService` in the
  packaged process tree and records their live PIDs and process state.
- The test-owned IPv4/IPv6 HTTP and WebSocket listeners report accepted
  connection/request counts. The redirect source and target are independent
  listeners.
- The test-only JavaScript result, CDP result, listener result, and independent
  Electron-main-process socket result are distinct report fields.

**B. Independently verified security properties**

- The packaged parent and production browser child are observed in
  non-host network namespaces with only loopback and no external routes.
- Live packaged descendants, including the renderer and NetworkService, are
  checked for namespace identity, interfaces/routes, effective capabilities,
  and `no_new_privs`.
- Test package destinations are numeric loopback only and proxy variables are
  removed. The test controller remains unprivileged in its normal network
  namespace so its owned `127.0.0.1` and `::1` listeners can bind and accept
  only controlled local traffic. Each production Electron/AppImage process
  under test independently enters and is checked in a no-route namespace.
- The packaged UI smoke requires an explicitly supplied AppImage path outside
  `desktop/dist`, runs the actual AppImage, and creates its screenshots
  directory exclusively so stale screenshot files cause a failure.
- The production policy remains fail-closed.

**C. Inferences**

- A Chromium `net::ERR_*` result combined with no accepted listener connection
  is consistent with failure before the controlled listener receives the
  request. It does not determine whether Chromium rejected the request before
  a syscall or the OS rejected a socket attempt.
- Process namespace and route observations establish network isolation for
  the inspected processes at observation time, but do not by themselves prove
  that a specific renderer request reached the kernel.

**D. Unverified claims**

- No request-correlated `connect()` syscall, NetworkService destination, or
  kernel errno is available from CDP or the current test harness. A JavaScript
  error, Chromium network error, or zero listener count is not proof of a
  kernel-level denial.
- A real HTTP 302 response and followed redirect are not verified. With the
  first hop isolated, the redirect source listener cannot receive the request
  and return its response. The source and target counters must remain zero;
  the test explicitly marks the followed redirect unverified.
- The WebSocket renderer event alone does not prove a kernel socket attempt or
  handshake.

**E. Outstanding blockers**

- On the current execution host, `/proc/sys/kernel/unprivileged_bpf_disabled`
  reports `2`, `perf_event_paranoid` reports `4`, tracefs events are not
  readable, and `bpftrace`/`perf` are unavailable. No tracing tool is used.
  The exact blocker is the absence of an already-authorized unprivileged
  kernel facility (or a purpose-built Chromium NetworkService diagnostic)
  that can correlate a renderer request with destination, NetworkService PID,
  namespace, and actual OS `connect()` errno without ptrace, elevated
  privileges, or weakening the isolation boundary.
- Do not enable remote browsing until this request-to-syscall evidence exists
  and receives independent security review.

An earlier, separate diagnostic attempt used `strace` and recorded successful
external TCP connections while the application was not yet confined to a
no-route namespace. The attempt was stopped; that trace is invalid as
production-isolation evidence. Ptrace also destabilized Chromium sandbox
behavior. Do not repeat that host-network tracing setup. This incident is
historical and is not evidence of external traffic from the isolated runs
described below.

### Required local commands

Requirements: Linux with unprivileged user/network namespaces, `/usr/bin/unshare`,
`/usr/bin/setpriv`, `/usr/bin/Xvfb`, `/usr/bin/xdotool`, the Electron runtime
libraries, and installed desktop dependencies. A required-mode run fails if
the package, GUI runtime, namespace creation, evidence directory, or process
isolation checks are unavailable; it must not silently skip or fall back to
`desktop/dist`. No `sudo`, host sysctl change, route addition, or tracing
program is used for the runtime tests.

Build fresh packages and run the focused production probe, packaged UI smoke,
isolation/supervisor tests, and complete serial suite with the following
commands. The packaging commands run in an unprivileged no-route network namespace.
The test controller intentionally remains in its normal, unprivileged
namespace, with proxy variables removed, because a fresh rootless network
namespace has loopback down and cannot bind the test-owned `::1` listener in
this environment. The test controller's destinations are numeric loopback
only; each packaged Electron/AppImage application it starts enters and is
independently verified in its own no-route namespace. Do not wrap the Node
test controller in another no-route namespace. The controller is not claimed
to be OS-isolated; its role is to own controlled listeners and inspect the
separate isolated application.

```sh
cd PARMAR/desktop
package_dir="$(mktemp -d /tmp/parmar-aether-packages.XXXXXX)"
evidence_dir="$(mktemp -d /tmp/parmar-aether-evidence.XXXXXX)"
mkdir -p "$evidence_dir/focused-probe" "$evidence_dir/focused-ui" "$evidence_dir/full-suite"

run_isolated() {
  /usr/bin/unshare --user --map-current-user --net --fork --kill-child=SIGKILL -- \
    /usr/bin/setpriv --no-new-privs -- /usr/bin/env \
    -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u NO_PROXY -u SOCKS_PROXY \
    -u all_proxy -u http_proxy -u https_proxy -u no_proxy -u socks_proxy \
    -u npm_config_proxy -u npm_config_http_proxy -u npm_config_https_proxy "$@"
}

run_unproxied() {
  /usr/bin/env \
    -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u NO_PROXY -u SOCKS_PROXY \
    -u all_proxy -u http_proxy -u https_proxy -u no_proxy -u socks_proxy \
    -u npm_config_proxy -u npm_config_http_proxy -u npm_config_https_proxy "$@"
}

run_isolated npm run package:dir -- \
  --config.directories.output="$package_dir" \
  --config.electronDist="$PWD/node_modules/electron/dist"
run_isolated npm run package:linux -- \
  --config.directories.output="$package_dir" \
  --config.electronDist="$PWD/node_modules/electron/dist"

PARMAR_AETHER_LINUX_DIR_PATH="$package_dir/linux-unpacked" \
PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
PARMAR_AETHER_UI_SCREENSHOT_DIR="$evidence_dir/focused-probe" \
run_unproxied npm run test:production-child-network-probe

PARMAR_AETHER_APPIMAGE_PATH="$package_dir/PARMAR AETHER-1.0.0.AppImage" \
PARMAR_AETHER_UI_SMOKE=1 \
PARMAR_AETHER_UI_SMOKE_REQUIRED=1 \
PARMAR_AETHER_UI_SCREENSHOT_DIR="$evidence_dir/focused-ui" \
run_unproxied node --test test/electron-ui-smoke.test.cjs

run_unproxied node --test --test-concurrency=1 \
  test/browser-child.test.cjs test/isolation-prototype.test.cjs
run_unproxied npm run test:electron-isolation

PARMAR_ELECTRON_RUNTIME_LIB_DIR=/usr/lib/x86_64-linux-gnu \
PARMAR_ELECTRON_RUNTIME_REQUIRED=1 \
PARMAR_AETHER_UI_SMOKE=1 \
PARMAR_AETHER_UI_SMOKE_REQUIRED=1 \
PARMAR_AETHER_APPIMAGE_PATH="$package_dir/PARMAR AETHER-1.0.0.AppImage" \
PARMAR_AETHER_UI_SCREENSHOT_DIR="$evidence_dir/full-suite" \
PARMAR_AETHER_LINUX_DIR_PATH="$package_dir/linux-unpacked" \
PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
run_unproxied npm test
```

The test parent and each packaged child are validated from `/proc/<pid>/ns`,
`/proc/<pid>/net/{dev,route,ipv6_route}`, and `/proc/<pid>/status`. The
test-only CSP allows `http:` and `ws:` scheme sources; the harness separately
validates the configured request targets as numeric loopback. The app's
no-route namespace is an independent boundary and is not inferred from the
CSP. The JSON evidence files in `evidence_dir` are the machine-readable
results; the runner output alone is not a substitute for those records.

The test harness itself must have working host loopback to own the listeners;
it is not claimed to have no external routes. Proxies are removed and its
network test targets are controlled numeric loopback addresses only. The
application under test, including the packaged AppImage control/main process
and its Chromium descendants, is the process tree that must be independently
verified in the no-route namespace. A namespace-level failure to create the
isolated application is a test failure, not a reason to run it directly.
The AppImage smoke creates a new `screenshots/` child within its evidence
directory. This keeps screenshots fresh while allowing the production-child
probe and UI smoke to share one evidence root in the serial full suite.

### CI contract and execution status

`.github/workflows/aether-linux-runtime.yml` targets `ubuntu-24.04`, checks
namespace and GUI prerequisites, creates fresh package/evidence directories,
builds the directory package and AppImage using the cached Electron
distribution while isolated from network routes, runs the focused probes and
the complete suite in required mode, and uploads evidence/screenshots even on
failure. It no longer changes AppArmor/user-namespace kernel settings. If the
hosted runner disallows unprivileged namespaces, the job must fail closed.
Package dependency installation is a setup step; no runtime test process is
privileged.

Workflow configuration is not evidence of a hosted run. The workflow status
for this phase is **not run/not verified**; no hosted result is claimed.
`REMOTE_BROWSING_ENABLED` remains false. A passing test suite is a regression
result only, not proof of the outstanding renderer-to-kernel security claim.

## Final required-mode verification (2026-10-25)

Fresh artifacts were built outside `desktop/dist` at
`/tmp/parmar-aether-final-packages.i3bzsP`: both `npm run package:dir` and
`npm run package:linux` completed inside unprivileged no-route namespaces
using the installed Electron distribution. Required-mode tests used that
directory package and AppImage, with proxy variables removed from test
subprocesses and controlled numeric-loopback listeners.

Results:

- `npm run test:production-child-network-probe`: **1 passed, 0 failed,
  0 cancelled, 0 skipped**.
- Packaged UI smoke plus `startup-config.test.cjs`: **8 passed, 0 failed,
  0 cancelled, 0 skipped**. The smoke ran the freshly built AppImage and
  produced 17 screenshots.
- `browser-child.test.cjs` plus `isolation-prototype.test.cjs`: **29 passed,
  0 failed, 0 cancelled, 0 skipped**.
- `npm run test:electron-isolation`: **1 passed, 0 failed, 0 cancelled,
  0 skipped**.
- Required-mode serial `npm test`: **100 passed, 0 failed, 0 cancelled,
  0 skipped**. The suite completed with exit status 0 and produced the second
  renderer-probe report plus 17 further screenshots.

Machine-readable focused and full-suite probe reports, their diagnostic logs,
screenshots, and the complete test log were retained in
`/tmp/parmar-aether-final-evidence.i3bzsP/`. The probe reports record test
status `passed` and cleanup as complete; the UI smoke also confirmed its
Electron/Chromium process groups exited. A final process scan found no
remaining Electron, Chromium, Xvfb, namespace-test, or Node test-runner
processes.

The focused renderer report recorded shell renderer PID `130246` and
NetworkService PID `130226`. Their independently inspected network
namespaces differed (`net:[4026532405]` and `net:[4026532344]`), and each
reported only `lo`, no external routes, zero effective capabilities, and
`no_new_privs=1`. CDP recorded three HTTP request events and one WebSocket
creation event for the controlled IPv4, IPv6, redirect-source, and WebSocket
attempts. All seven controlled listener connection/request/upgrade counters
were zero. The separate main-process socket probe reported IPv4
`ENETUNREACH` and IPv6 `EADDRNOTAVAIL`; these are not renderer results.

The redirect source did not receive the first hop, so it could not return a
real 302 response; the redirect target remained untouched and
`followedRedirectVerified` is false. The report has no request-correlated
NetworkService `connect()` or kernel errno. Therefore the observed renderer
attempts and namespace state still do not prove that each request reached the
kernel and was denied there. The `WebContentsView` tab-content renderer's
network behavior is also not directly instrumented. Production navigation
policy remains fail-closed, but these renderer/kernel correlation gaps remain
release blockers for enabling remote browsing.

One earlier full-suite attempt was interrupted and reported 53 tests observed,
44 passed, 2 failed, 7 cancelled, and 0 skipped. Its failure cause was not
conclusively established. The subsequent complete required-mode run above
finished successfully; the interrupted attempt is not counted as a passing
run. No hosted CI run was started, so CI remains **not run/not verified**.
No unexpected external traffic was observed during the final verification;
the test targets were numeric loopback, and the packaged applications had no
external routes. No host-wide packet capture was performed.

## A10(e) focused probe rerun (2026-10-25)

The previously referenced probe failure log and JSON were not present in this
runtime, so the exact assertion or runtime error from that historical exit
status 1 could not be recovered. No assertion was disabled or weakened. The
current harness does contain its process-group safety guard in
`production-child-network-probe.test.cjs`; the test bootstrap also remains
present in the worktree.

To reproduce safely, a fresh directory package was built in an unprivileged
no-route namespace:

```sh
cd PARMAR/desktop
package_dir="$(mktemp -d /tmp/parmar-a10e-packages.XXXXXX)"
/usr/bin/unshare --user --map-current-user --net --fork --kill-child=SIGKILL -- \
  /usr/bin/setpriv --no-new-privs -- /usr/bin/env \
  -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u NO_PROXY -u SOCKS_PROXY \
  -u all_proxy -u http_proxy -u https_proxy -u no_proxy -u socks_proxy \
  -u npm_config_proxy -u npm_config_http_proxy -u npm_config_https_proxy \
  npm run package:dir -- \
  --config.directories.output="$package_dir" \
  --config.electronDist="$PWD/node_modules/electron/dist"
```

The focused test was then run twice in required mode, each time against that
fresh package and with proxy variables removed:

```sh
evidence_dir="$(mktemp -d /tmp/parmar-a10e-evidence.XXXXXX)"
mkdir -p "$evidence_dir/probe"
/usr/bin/env \
  -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u NO_PROXY -u SOCKS_PROXY \
  -u all_proxy -u http_proxy -u https_proxy -u no_proxy -u socks_proxy \
  -u npm_config_proxy -u npm_config_http_proxy -u npm_config_https_proxy \
  PARMAR_AETHER_LINUX_DIR_PATH="$package_dir/linux-unpacked" \
  PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
  PARMAR_AETHER_UI_SCREENSHOT_DIR="$evidence_dir/probe" \
  npm run test:production-child-network-probe
```

Both package build and focused probe invocations exited **0**. Each focused
run reported **1 passed, 0 failed, 0 cancelled, 0 skipped**. The latest
machine-readable evidence is in
`/tmp/parmar-a10e-evidence-repeat.DQV1Xn/probe/production-child-network-probe-3618ff7fcc27193b8f46519f.json`;
the immediately preceding run is in
`/tmp/parmar-a10e-evidence.H475jI/probe/production-child-network-probe-e7d5ba99fc7d70c9ec4931b3.json`.
Both reports record complete cleanup, the fail-closed production policy,
zero listener connections, and no kernel syscall attribution.

The test controller remains outside the packaged application's no-route
namespace so it can bind and verify its own loopback-only listeners. The
packaged parent and production browser child are launched through the
test's unprivileged namespace setup and real production isolation launcher;
the child namespace has `lo` down, no routes, zero effective capabilities,
and `no_new_privs=1`. Listener reachability checks are made by the controller
before launch; they do not claim that the application can reach those
listeners.

The latest report's Chromium failures were `net::ERR_INTERNET_DISCONNECTED`
for IPv4 HTTP and the redirect first hop, and `net::ERR_ADDRESS_INVALID` for
IPv6 HTTP. Chromium also emitted a WebSocket creation event. These are
Chromium-layer observations, not a renderer syscall/errno attribution. The
redirect source and target were untouched; no 302 was returned or followed.
The renderer attempt assertion passed, but the broader OS-level denial claim
remains unverified.

Because the historical failing report was unavailable and both current
required-mode reruns passed, the cause of the reported exit-1 remains
**undetermined**, not fixed. No test source change was made in this focused
rerun. JavaScript syntax checks for the probe, bootstrap, launcher, and
supervisor passed; `git diff --check` passed. `REMOTE_BROWSING_ENABLED`
remains false.

## A10 fast-track current-worktree verification (2026-10-25)

Verification was repeated against the current dirty worktree; the pre-existing
`desktop/dist` artifacts and prior-session `/tmp` results were not used as
evidence. No application or test source changed during this verification.
The directory package was rebuilt with `npm run package:dir`, and the fresh
AppImage was built with `npm run package:linux`, both inside an unprivileged
no-route network namespace using the installed Electron distribution. The
fresh package directory is `/tmp/parmar-a10e-packages.muXxAA`; the AppImage
SHA-256 is
`a2efa3444d3dbe69f169c2f44beb77e88191d814fae3174c20390a0193e201e7`.

Required-mode results against those artifacts:

- Packaged AppImage UI smoke:
  `node --test --test-concurrency=1 test/electron-ui-smoke.test.cjs`:
  **1 passed, 0 failed, 0 cancelled, 0 skipped**; exit 0; 17 screenshots.
- Fresh-package production-child renderer probe:
  `npm run test:production-child-network-probe`:
  **1 passed, 0 failed, 0 cancelled, 0 skipped**; exit 0.
- Supervisor and isolation regressions:
  `node --test --test-concurrency=1 test/browser-child.test.cjs test/isolation-prototype.test.cjs`:
  **29 passed, 0 failed, 0 cancelled, 0 skipped**; exit 0.
- Electron isolation integration:
  `npm run test:electron-isolation`:
  **1 passed, 0 failed, 0 cancelled, 0 skipped**; exit 0.
- Complete serial required-mode desktop suite:
  `npm test`: **100 passed, 0 failed, 0 cancelled, 0 skipped**; exit 0;
  17 additional screenshots.
- JavaScript syntax checks for changed/new JavaScript and `git diff --check`:
  passed.

The full-suite JSON report is
`/tmp/parmar-a10e-full-suite.HRRKTY/full-suite/production-child-network-probe-8d120d48e003816c3cc4c6b8.json`;
the full-suite log and screenshots are in the same `full-suite` directory.
The focused report is
`/tmp/parmar-a10e-probe-latest.nlYnja/production-child-network-probe-0df105d01d249bcf3b2e5779.json`.
The UI smoke log and screenshots are in
`/tmp/parmar-a10e-ui-evidence.WEAN7s/`.

The full-suite report identifies renderer PID `13504` and NetworkService PID
`13483` in separate network namespaces. Both observed processes had only
`lo`, no external routes, zero effective capabilities, and
`no_new_privs=1`. CDP request events were recorded for controlled IPv4 HTTP,
IPv6 HTTP, redirect-source HTTP, and WebSocket attempts. Seven controlled
listeners remained at zero accepted connections, HTTP requests, and
WebSocket upgrades. The test's Node socket results are main-process evidence,
not Chromium renderer evidence.

The browser controller is intentionally outside the application's no-route
namespace so it can bind and check its own numeric-loopback listeners. The
packaged application remains launched through the production isolation
launcher. Test subprocess proxy variables are removed. The AppImage smoke
verified the packaged main process and Chromium descendants' namespace,
route, capability, `no_new_privs`, and process cleanup properties. This
distinction does not make the controller itself no-route isolated.

No fresh test proves that a renderer request maps to a NetworkService
`connect()` syscall or kernel errno. In the latest CDP report, IPv4 and
redirect-source HTTP errors were `net::ERR_INTERNET_DISCONNECTED`, IPv6 was
`net::ERR_ADDRESS_INVALID`, and WebSocket had a creation event. The redirect
source received no first hop, so it returned no 302 and the redirect target
was not followed. The `WebContentsView` tab-content renderer was not directly
instrumented. These remain evidence gaps; a passing suite does not establish
OS-level denial for each request.

Kernel instrumentation remains unavailable in this host report:
`unprivileged_bpf_disabled=2`, `perf_event_paranoid=4`, tracefs events are
unreadable, and `bpftrace`/`perf` are unavailable. No privileged tracing,
route addition, sysctl change, or weakened isolation was used. No unexpected
external network request was observed; test destinations were numeric
loopback and the packaged applications had no external routes. This is not a
host-wide traffic capture. The final process check found no remaining
Electron, Chromium, Xvfb, or test application process.

`REMOTE_BROWSING_ENABLED` remains `false`. Hosted CI was not run. The existing
renderer-to-kernel correlation, tab-content renderer, and real redirect
follow-through gaps remain release blockers for enabling remote browsing.

## A10(f) tab renderer and controlled redirect verification (2026-10-25)

The required-mode production-child probe was extended to observe the actual
`WebContentsView` tab renderer separately from the `browser.html` shell
renderer. The test-only hook associates the view's `webContents`, verifies its
`newtab.html` URL, and attaches CDP to that renderer. No production launcher,
session policy, CSP, sandbox, or isolation control was weakened. The disposable
test archive alone permits the controlled `http:` and `ws:` schemes; the
configured request destinations are numeric loopback addresses.

### Directly observed facts

- The focused run used the existing directory package at
  `/tmp/parmar-a10e-packages.muXxAA/linux-unpacked`. The probe checked the
  packaged production main, supervisor, launcher, and isolation verifier
  against the current worktree; no package rebuild or full suite was run.
- The actual tab renderer was PID `26755` (`WebContentsView` WebContents ID
  `2`); the separate shell renderer was PID `26733`. Chromium identified
  NetworkService PID `26708` as a utility process in the same packaged app's
  process metrics.
- The tab renderer and NetworkService were separately observed in network
  namespaces `net:[4026532405]` and `net:[4026532344]`. For both, the process
  evidence recorded only `lo`, no external routes, zero effective
  capabilities, and `no_new_privs=1`. This is process/namespace state
  evidence, not request-to-syscall correlation.
- The tab renderer generated CDP request events for IPv4 HTTP, IPv6 HTTP,
  redirect-source HTTP, and WebSocket creation. The three HTTP attempts ended
  with `net::ERR_BLOCKED_BY_CLIENT`, consistent with the production session
  `webRequest` cancellation. The WebSocket handshake result was not
  correlated.
- A separate controller-side Node HTTP client reached the controlled
  redirect-source listener, received a genuine 302 whose `Location` was the
  numeric-loopback target, and requested the target, which returned 204. This
  validates the listener fixture only; it is not a Chromium redirect test.
- After resetting the fixture counters, the production app's controlled
  listener observations remained zero connections, HTTP requests, and
  WebSocket upgrades. The report records application cleanup complete.

### Independently verified properties and limits

The live tab renderer and NetworkService process records independently show
non-host network namespaces with no external routes, only loopback, no
effective capabilities, and `no_new_privs`. Chromium's HTTP failures are
consistent with the production session policy, and the source listener
received no request; the probe does not separately record the policy callback.
The successful 302 test belongs only to the separate Node fixture client. The
production tab did not reach the redirect source, Chromium observed no 302,
and no target follow-up was observed.

CDP proves that Chromium reported the renderer-targeted requests; it does not
prove that a request reached a NetworkService `connect()` syscall or establish
the kernel's result. Kernel instrumentation remains unavailable in this
environment (`unprivileged_bpf_disabled=2`, `perf_event_paranoid=4`, unreadable
tracefs events, and no `bpftrace` or `perf`). The zero listener counters
therefore do not establish kernel-level denial. The WebSocket event establishes
creation only, not a handshake or kernel attempt.

### Reproduction and results

From `PARMAR/desktop`, JavaScript syntax checks and `git diff --check` passed.
The `startup-config` regression reported **7 passed, 0 failed, 0 skipped**.
The required production-child probe command was:

```sh
evidence_dir="$(mktemp -d /tmp/parmar-a10f-redirect-final.XXXXXX)"
mkdir -p "$evidence_dir/probe"
/usr/bin/env \
  -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u NO_PROXY -u SOCKS_PROXY \
  -u all_proxy -u http_proxy -u https_proxy -u no_proxy -u socks_proxy \
  -u npm_config_proxy -u npm_config_http_proxy -u npm_config_https_proxy \
  PARMAR_AETHER_LINUX_DIR_PATH=/tmp/parmar-a10e-packages.muXxAA/linux-unpacked \
  PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
  PARMAR_AETHER_UI_SCREENSHOT_DIR="$evidence_dir/probe" \
  npm run test:production-child-network-probe
```

It ran after removing inherited proxy variables and reported **1 passed,
0 failed, 0 cancelled, 0 skipped**, exit status 0. The machine-readable report
is `/tmp/parmar-a10f-redirect-final.GBATV1/probe/production-child-network-probe-8e3c77d75eef3dbda49b4272.json`.
No full suite, package build, hosted CI, external destination, privileged
tracing, or host security-setting change was used in this phase.

`REMOTE_BROWSING_ENABLED` remains `false`. OS-level denial correlated to each
renderer request, Chromium WebSocket handshake outcome, and Chromium redirect
follow-through remain unverified release blockers.

## A10(f) process-correlation and WebSocket follow-up (2026-10-25)

The tab probe now retains WebSocket CDP lifecycle events by the request ID
reported by that exact `WebContentsView` debugger session. It records
`webSocketFrameError`, handshake-request/response events when present, and
`webSocketClosed`. A first required-mode attempt failed because the test
assumed the frame-error message contained `net::ERR_BLOCKED_BY_CLIENT`; the
observed field was an empty string. That attribution assertion was removed;
the test now requires a correlated frame-error event and records its actual
empty message without assigning a cause.

The latest required-mode run identifies tab renderer PID `36609`, WebContents
ID `2`, and shell renderer PID `36580`. NetworkService PID `36564` was found
from the packaged app's process metrics and the process tree, and its process
arguments identify the NetworkService utility. Both it and the tab renderer
were independently checked: the NetworkService is in `net:[4026532344]`, and
the tab renderer is in `net:[4026532405]`; each has only `lo`, no external
routes, zero effective capabilities, and `no_new_privs=1`. Their namespace
identifiers differ. The probe does not infer that they share a namespace.

The CDP request events are delivered through the tab renderer's debugger
session and carry renderer PID/WebContents metadata. `app.getAppMetrics()`
associates the NetworkService candidate with the same Electron instance, but
neither those metrics nor the CDP request ID attributes an individual request
to that utility PID. The report now labels it a same-instance candidate and
states request attribution as unavailable. No request-to-NetworkService
syscall correlation has been established.

For WebSocket, CDP recorded a `webSocketFrameError` and `webSocketClosed`
with request ID `36609.5`; it recorded no handshake request or handshake
response, and `errorMessage` was empty. This is correlated renderer-side
failure lifecycle evidence only. It does not identify whether the session
policy, Chromium, or the operating system caused the failure, and it is not
evidence of a kernel connect attempt. The controlled listeners stayed
untouched.

### Safe OS-instrumentation assessment

This host has `/usr/bin/strace`, `ptrace_scope=1`, and zero effective
capabilities for the test controller. However, that does not establish a safe
supported way to observe only the isolated Chromium child: tracing the full
test-launched app tree would also trace the host-network control Electron
process, while inserting a tracer into the production child launch path is
not part of this phase and could affect Chromium sandbox behavior. No tracer
was run or attached. Unprivileged BPF/perf are not available here:
`unprivileged_bpf_disabled=2`, `perf_event_paranoid=4`, tracefs event data is
unreadable, and `bpftrace`/`perf` are absent. No sysctl or security setting
was changed.

A future host/CI run needs a pre-provisioned, supported, unprivileged
per-process observation mechanism that can identify destination, syscall
result/errno, and PID for the isolated NetworkService without tracing the
host-network controller or changing runtime privileges/settings. It must
also demonstrate that instrumentation does not disable or weaken Chromium
sandboxing and must correlate the observed PID to the packaged app and tab
request by independent evidence. Until such a method is available and
validated, kernel-level renderer denial remains unproven; zero listener
counters and browser error events are insufficient.

The HTTP redirect fixture remains a separate Node-only test of a real 302 and
target request. The production tab's source request failed in a manner
consistent with session-policy cancellation before the redirect source, so
Chromium received no 302 and did not attempt the target. No redirects were
enabled or followed in the production tab.

Final focused verification used the existing directory package; no build or
full suite ran. JavaScript syntax checks and `git diff --check` passed;
`test/startup-config.test.cjs` reported **7 passed, 0 failed, 0 skipped**.
The required production-child probe command (from `PARMAR/desktop`) was:

```sh
/usr/bin/env \
  -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u NO_PROXY -u SOCKS_PROXY \
  -u all_proxy -u http_proxy -u https_proxy -u no_proxy -u socks_proxy \
  -u npm_config_proxy -u npm_config_http_proxy -u npm_config_https_proxy \
  PARMAR_AETHER_LINUX_DIR_PATH=/tmp/parmar-a10e-packages.muXxAA/linux-unpacked \
  PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
  PARMAR_AETHER_UI_SCREENSHOT_DIR="$evidence_dir/probe" \
  npm run test:production-child-network-probe
```

It reported **1 passed, 0 failed, 0 cancelled, 0 skipped**, exit status 0.
The final JSON is
`/tmp/parmar-a10f-correlation-final-check.kYZfht/probe/production-child-network-probe-e686346201a5b2cc9019cc48.json`.
The failed intermediate assertion run is not counted as a pass. Cleanup was
verified for the app parent, production child group, Xvfb, and listeners.
`REMOTE_BROWSING_ENABLED` remains `false`.

## AETHER renderer and tab-limit follow-up (2026-10-29)

The browser renderer now handles rejected initial-status and viewport-layout
IPC requests with visible errors. A late initial-status response cannot replace
state already delivered by the main process; only the newest viewport-layout
request may report an error. Renderer subscriptions and its resize observer are
released on unload. At narrow widths, the security-state label stays available
to assistive technology while the visual status indicator no longer competes
with the horizontally scrollable tab strip.

All user-triggered tab creation paths use the shared 16-tab guard. Keyboard,
application-menu, and browser-child new-tab actions report creation errors to
the browser instead of allowing an expected tab-limit error to be treated as
an unexpected child-protocol failure. Opening AETHER via the application
menu starts with the initial tab rather than immediately opening a duplicate;
concurrent new-tab requests during an existing startup are still forwarded.

From `PARMAR/desktop`, the focused command
`node --test --test-concurrency=1 test/browser-renderer.test.cjs test/main-lifecycle.test.cjs test/browser-child.test.cjs test/preload.test.cjs`
reported **51 tests, 50 passed, 0 failed, 1 skipped**. The skipped
packaged-artifact assertion requires a built artifact; no package was rebuilt
and no production browser was launched during this follow-up. JavaScript
syntax checks (`node --check` for the main, renderer, preload, and regression
test files), YAML parsing, `bash -n` for all 11 workflow `run` blocks, and
`git diff --check` passed. No package was rebuilt, no screenshot or live UI
inspection was performed, no production browser was launched, and no hosted
workflow was dispatched.

These changes do not verify Chromium's request-to-kernel attribution,
production WebSocket handshake behavior, redirect source/target attempts,
hosted-runner namespace prerequisites, packaged UI screenshots, or the
runner's cleanup behavior. They do not enable remote browsing or alter the
isolation design. `REMOTE_BROWSING_ENABLED` remains `false`; production release
still requires the external verification listed above.

## Production security evidence gate (2026-10-29)

The following matrix separates source-level controls and test-harness
observations from a completed production security run. “PASS” applies only to
the specified code/configuration invariant; it is not approval to enable
remote browsing. No production browser, package build, or hosted workflow was
run for this gate.

| Requirement | Existing implementation and test | Evidence currently available | Status |
|---|---|---|---|
| Child starts in a separate network namespace with no active interfaces/routes | `isolation-launcher.cjs` builds the fixed `unshare --user --map-current-user --net` launch; `isolation-probe.cjs` checks namespace IDs, loopback-down, interface list, routes, capabilities, and `NoNewPrivs`; `browser-child-supervisor.cjs` independently compares child and parent namespace IDs. Unit/prototype coverage: `test/isolation-prototype.test.cjs`, `test/browser-child.test.cjs`. Packaged checks: `test/electron-ui-smoke.test.cjs`, `test/production-child-network-probe.test.cjs`. | Code and deterministic mocked/unit coverage exist. The production `/proc`/`ip` assertions require launching the packaged app and have not been executed for this gate. Historic prototype evidence is not packaged Chromium evidence. | **PASS** launcher/verifier configuration; **BLOCKED** packaged runtime proof |
| Effective capabilities are dropped and `no_new_privs` holds across Chromium descendants | `isolation-launcher.cjs` applies `setpriv --inh-caps=-all --ambient-caps=-all --no-new-privs`; packaged process-tree checks in `test/electron-ui-smoke.test.cjs` and `test/production-child-network-probe.test.cjs` read `/proc/<pid>/status` for each live process. | These are executable checks, not a result for the current package/run. | **BLOCKED** |
| Chromium NetworkService connection attempt and kernel outcome are attributed to the request | `test/production-child-network-probe.test.cjs` records renderer CDP request IDs and same-Electron-instance NetworkService PID candidates. Its evidence explicitly sets request attribution and kernel socket observation to unavailable. `test/electron-ui-smoke.test.cjs` only verifies restricted navigation and listener counters. | No safe validated observer correlates the exact request, NetworkService PID, destination `connect()` attempt, and kernel return/errno. `strace` presence alone is not evidence; prior readiness notes record ptrace/BPF/perf constraints and no tracer run. | **BLOCKED** |
| A real Chromium WebSocket handshake is observed | The test wrapper records CDP `webSocketWillSendHandshakeRequest`, `webSocketHandshakeResponseReceived`, `webSocketFrameError`, and close events; the controlled listener can return HTTP 101. The production-child assertions expect a correlated frame error and no handshake response because the production session policy cancels first. | No request reaches the listener, no 101 is returned to Chromium, and no successful/failed real handshake response is attributed. | **BLOCKED** |
| Chromium follows a real redirect and the destination attempt is observed | `verifyControlledRedirectFixture` in `test/production-child-network-probe.test.cjs` verifies an actual 302 and target request using a Node HTTP client. The Chromium probe separately verifies source policy cancellation and asserts there is no target-follow request. | The Node fixture proves only Node’s redirect behavior. Chromium does not receive the 302 because the production session policy cancels before the source listener. | **BLOCKED** |
| Browser-child/Chromium descendants and test resources are cleaned up | `browser-child-supervisor.cjs` kills the detached child process group; packaged cleanup assertions exist in `test/electron-ui-smoke.test.cjs` and `test/production-child-network-probe.test.cjs`. This gate adds machine-readable cleanup evidence including app/child group members, Xvfb, and listener state, and a deterministic unit test of the cleanup verdict. | The checks have not been run against the packaged browser in this gate. A passing unit test validates summary logic only; it is not runtime cleanup evidence. | **PASS** cleanup-evidence contract; **BLOCKED** packaged runtime cleanup |
| Hosted Linux namespace/GUI prerequisites and full workflow succeed | `.github/workflows/aether-linux-runtime.yml` diagnoses required commands/settings, checks unprivileged user/network namespace creation, builds both packages, runs focused packaged probes and full serial tests, then uploads evidence. | Workflow structure is present; there is no successful hosted run for the current worktree. | **BLOCKED** |
| Remote browsing remains fail-closed | `security.cjs` sets `REMOTE_BROWSING_ENABLED = false`; `test/security.test.cjs`, `test/startup-config.test.cjs`, and the production probe’s archive assertion cover the invariant. | Source and local unit checks; no security transition was made. | **PASS** policy configuration |

### Remaining authorized verification

On a dedicated Linux runner with the documented GUI libraries, Xvfb, and
namespace prerequisites, use the existing workflow after the exact revision
has been published and CI execution is authorized. It runs the package builds,
the required production-child test, the packaged AppImage smoke, isolation
fixture, and serial desktop suite, and uploads reports/screenshots. Do not
count the locally skipped packaged test or prior test-fixture results as
production evidence.

Given an already-built `linux-unpacked` artifact and an approved isolated
Linux runtime, the focused commands from `PARMAR/desktop` are:

```sh
PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 \
PARMAR_AETHER_LINUX_DIR_PATH=/absolute/path/to/linux-unpacked \
PARMAR_AETHER_UI_SCREENSHOT_DIR=/absolute/path/to/evidence/probe \
  npm run test:production-child-network-probe

PARMAR_AETHER_APPIMAGE_PATH="/absolute/path/to/PARMAR AETHER-1.0.0.AppImage" \
PARMAR_AETHER_UI_SMOKE=1 \
PARMAR_AETHER_UI_SMOKE_REQUIRED=1 \
PARMAR_AETHER_UI_SCREENSHOT_DIR=/absolute/path/to/evidence/ui \
  node --test test/electron-ui-smoke.test.cjs

PARMAR_ELECTRON_RUNTIME_LIB_DIR=/absolute/path/to/gtk-libraries \
PARMAR_ELECTRON_RUNTIME_REQUIRED=1 \
  npm run test:electron-isolation
```

These commands launch test-instrumented or fixture browser processes; they
were not run during this gate. They can verify runtime namespace, capability,
`no_new_privs`, listener, and cleanup assertions but still do **not** close the
NetworkService syscall-attribution gap. Before any test-only topology can
exercise redirect targets or a successful WebSocket handshake, a dedicated
disposable runner must provide the previously documented fixture-only
network topology without host/public forwarding. The NetworkService request
must then be correlated with a validated, sandbox-preserving observer that
records PID, destination, syscall attempt, and kernel outcome. There is no
safe exact tracing command to give until that observer and runner are
provisioned and independently validated; do not infer this evidence from CDP,
application policy, or zero listener counts.

**Single release blocker:** production network-boundary evidence is incomplete:
the actual Chromium NetworkService syscall/outcome is unobserved, and the
hosted packaged process-isolation/cleanup run has not passed. Keep
`REMOTE_BROWSING_ENABLED=false` until that evidence is obtained and reviewed.

## Final release gate audit (2026-10-31)

The current package manifest pins Electron 44.7.0 and electron-builder
26.15.3. The Linux scripts target an unpacked directory or an AppImage; the
builder configuration uses app ID `com.parmar.aether`, product name
`PARMAR AETHER`, ASAR packaging, and the original PARMAR emblem for both the
Linux icon and an explicit resource at `aether/parmar-emblem.png`. All 17
configured ASAR file entries, the emblem resource, and icon path exist. The
emblem is a 552x548 PNG. This is static configuration verification, not a
fresh package build or an inspection of built archive contents.

The application runtime uses Electron and Node built-ins; the lockfile has
the exact Electron and electron-builder versions and no additional app
dependencies. Electron's Linux GTK/ATK/CUPS/X11/GBM/XKB/ALSA/AT-SPI shared
libraries are host runtime prerequisites rather than npm package entries.
The installed Electron binary's `ldd` output reports these 12 libraries
missing in this environment: `libatk-1.0.so.0`,
`libatk-bridge-2.0.so.0`, `libcups.so.2`, `libgtk-3.so.0`,
`libXcomposite.so.1`, `libXdamage.so.1`, `libXfixes.so.3`,
`libXrandr.so.2`, `libgbm.so.1`, `libxkbcommon.so.0`, `libasound.so.2`,
and `libatspi.so.0`. `/usr/bin/unshare`, `/usr/bin/setpriv`, and
`/usr/sbin/ip` exist; Xvfb, xdotool, and the legacy ImageMagick `import` and
`convert` commands do not. No dependency was installed.

The release gates are therefore: **PASS** source-level policy and fail-closed
navigation configuration (`REMOTE_BROWSING_ENABLED=false`); **PASS** static
packaging metadata and source/resource path checks; **NOT VERIFIED** fresh
package build and built-archive completeness; **FAIL in this environment**
Electron GUI runtime prerequisites (the libraries and tools above are
missing); **NOT VERIFIED** packaged runtime launch, visual screenshots and
inspection, and production Electron/Chromium network-isolation and cleanup
evidence. The full desktop suite completed with 118 tests: 114 passed, 0
failed, and 4 skipped. JavaScript syntax checks across desktop CJS files and
`git diff --check` passed. No package was built and no application was
launched for this audit. Continue to keep `REMOTE_BROWSING_ENABLED=false`.

## Linux CI runtime verification workflow (2026-10-31)

The Linux workflow now records the hosted runner's namespace prerequisites and
checks the installed GUI packages, Electron's resolved shared libraries, and
the additional libraries Electron may load dynamically. Before its
network-disabled package builds, it asks the lockfile-pinned electron-builder
toolset downloader to provision the AppImage tools; that downloader validates
the tool archive against electron-builder's pinned checksum. The builds remain
inside the existing unprivileged user/network namespace with
`no_new_privs`.

After packaging, the workflow inspects both the unpacked package and the
extracted AppImage for the required ASAR entries and byte-identical original
PARMAR emblem resources. It supplies the fresh unpacked path to the artifact
test, requires the packaged AppImage UI smoke and production-child probe, and
uploads their logs and screenshots even when a later step fails. These are
workflow guarantees only: this workflow was not dispatched or run here, so
package creation, actual Electron launch, screenshot inspection, process
cleanup, and production isolation remain **NOT VERIFIED**. Keep
`REMOTE_BROWSING_ENABLED=false` pending successful hosted-runner evidence and
review.

## A14 pending-task verification (2026-10-31)

This is the current evidence register for the pending items below. Older
dated sections remain historical run records; do not treat them as evidence
for the current worktree. No package was built or launched and no workflow
was run during this verification.

| Task or requirement | Status | Evidence available now | Remaining work and local availability |
|---|---|---|---|
| `built Linux artifact contains launchable app.asar paths and required browser isolation assets` | BLOCKED | Skipped by `test/browser-child.test.cjs` because `PARMAR/desktop/dist/linux-unpacked/resources/app.asar` is absent and `PARMAR_AETHER_LINUX_DIR_PATH` is unset. | Run after a fresh package exists. Cannot complete here without a prohibited package build. CI package inspection also checks the executable and archive. |
| `live Electron and Chromium descendants stay outside the host namespace and cannot reach controlled listeners` | BLOCKED | Skipped because `/usr/bin/Xvfb` is missing, `PARMAR_ELECTRON_RUNTIME_LIB_DIR` is unset, and required GTK libraries are absent. Required mode was checked and failed explicitly on missing Xvfb before launching Electron. | Requires a Linux GUI runtime with Xvfb, pinned Electron and GTK libraries; run `npm run test:electron-isolation` with `PARMAR_ELECTRON_RUNTIME_REQUIRED=1`. Not runnable here. |
| `packaged AETHER UI launches isolated Chromium and supports real browser chrome interactions` | BLOCKED | Skipped because `PARMAR_AETHER_UI_SMOKE=1` is unset. The AppImage is absent and GUI tools/runtime are missing. Required mode was checked and failed explicitly on missing Xvfb before package launch. | Requires a fresh executable AppImage and GUI runtime; CI runs the smoke with both `PARMAR_AETHER_UI_SMOKE=1` and `PARMAR_AETHER_UI_SMOKE_REQUIRED=1`. Not runnable here. |
| `test-only harness records packaged Chromium renderer requests in the isolated network namespace` | BLOCKED | Skipped because `PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1` is unset. No unpacked package exists. Required mode was checked and failed explicitly on missing Xvfb before app launch. | Requires a fresh `linux-unpacked` package, Xvfb/xdotool, and an evidence directory; CI runs it with required mode. Not runnable here. |
| Fresh package build and actual packaged application launch | NOT VERIFIED | No AppImage or `linux-unpacked` archive is present in the expected workspace output. Build and launch were prohibited for this verification. | Run the existing workflow on an authorized published revision; inspect package logs and both package archives. |
| Genuine mobile, tablet, and desktop screenshots | NOT VERIFIED | The smoke now requests 360x720, 640x720, 768x1024, and 1480x920 windows. It captures the actual packaged AETHER window, not a fixture. No screenshot was generated here. | Run the required packaged smoke, retain the PNGs, and inspect them. The 768x1024 capture covers the tablet-width CSS range. |
| Screenshot pixel dimensions and nonblank content | NOT VERIFIED | `assertScreenshotDimensions` decodes width, height, and distinct-color count from each PNG; it checks 360x720, 640x720, 768x1024, and 1480x920 and rejects captures with 20 or fewer colors. The startup-config regression test checks all four assertions and the content guard. These checks passed as source-level tests only. | Execute the packaged smoke and confirm the assertions pass against actual saved images. Missing/malformed images fail through the ImageMagick command; incorrect dimensions or blank/near-blank captures fail explicit assertions. |
| Visual screenshot inspection and design comparison | BLOCKED | No genuine current-worktree screenshots exist. The design-reference section records no AETHER browser-specific design board. | Human inspection of the workflow artifact is required; a design comparison additionally needs an approved AETHER reference. |
| Electron/Chromium process isolation and cleanup | BLOCKED | Launcher configuration and unit tests preserve `unshare --user --map-current-user --net`, capability dropping, and `no_new_privs`. The Node namespace prototype passes in the suite, but the live Electron test and packaged smoke were skipped. | Required hosted run must inspect the production child and Chromium descendants at startup/recovery and verify process-group cleanup at shutdown. Prototype results are not production proof. |
| App-level navigation rejection | PASS (source/unit scope only) | `REMOTE_BROWSING_ENABLED=false`; security tests and production-probe assertions check policy cancellation. Current suite passed. | Keep remote browsing disabled. A packaged UI/policy interaction remains unverified until the smoke runs. |
| Main-process direct socket restrictions | NOT VERIFIED | The opt-in production-child probe contains direct IPv4/IPv6 socket assertions for the test-instrumented packaged Electron child. It was skipped here. | Run that required probe and retain PID, namespace, errno, and listener evidence. This proves only those main-process socket attempts. |
| Renderer network attempts | NOT VERIFIED | The probe injects controlled fetch/WebSocket requests in a real tab renderer and records CDP request events in the test-instrumented package. It was skipped here. | Run the probe and inspect renderer request/failure events. CDP evidence does not attribute a kernel connect to Chromium NetworkService. |
| Chromium NetworkService syscall attribution | BLOCKED | Probe code explicitly records syscall/errno attribution as unavailable; CDP request IDs and candidate NetworkService PIDs are not a process/request correlation. `/usr/bin/strace` 6.8 is installed; a harmless trace of `unshare --user --map-current-user --net /usr/bin/true` succeeded. `ptrace_scope=1`, `perf_event_paranoid=4`, and tracefs event listings are unavailable. This validates only tracing a simple child and namespace setup, not Chromium or preservation of its sandbox under tracing. | On an approved disposable isolated Linux runner, test a `strace -f -ff -ttt -yy -e trace=connect` observer against one controlled request and verify PID, destination, connect result, and request correlation while independently confirming Chromium sandbox, namespace, capabilities, and `no_new_privs` remain intact. Do not treat this candidate as evidence until that experiment passes. |
| Real WebSocket and redirect behavior at the OS boundary | BLOCKED | Production policy currently cancels requests before a listener handshake or redirect response; the test-only Node fixture does not establish Chromium production behavior. | Requires a reviewed, isolated test topology plus the validated NetworkService observer. Do not infer this from policy cancellation, CDP alone, or zero listener connections. |
| Original PARMAR emblem and packaging configuration | PASS (source/config scope) | Source emblem exists as a 552x548 PNG; package configuration uses it as Linux icon and `aether/parmar-emblem.png`; config tests pass. | Built-package byte identity is not verified locally. The CI package step uses `cmp` against the original source for both unpacked and extracted AppImage resources. |
| Responsive CSS and browser controls | PASS (source/unit scope) | Responsive 640/400 CSS breakpoints and browser renderer/control regression tests pass. The smoke includes size assertions for mobile, tablet, and desktop. | Live visual behavior and the four screenshot dimensions remain unverified until the packaged smoke runs. |
| Required smoke/probe gates and evidence collection | PASS (configuration only) | Required-mode checks were exercised and failed rather than skipped when prerequisites were missing. Workflow sets required flags for package probes, Electron isolation, and UI smoke; upload uses `always()` when the evidence directory exists. | No hosted workflow was run. Verify its tests have no runtime skips and review the uploaded logs/screenshots on the exact authorized revision. |
| Independent production security review | BLOCKED | The readiness record identifies this as outstanding; no independent review result is present for the current worktree. | Requires authorized review of the production process boundary, Chromium sandbox, network evidence, and cleanup. |

The complete desktop command `cd PARMAR/desktop && npm test` reported **118
tests, 114 passed, 0 failed, and 4 skipped**. The four skips are the first four
rows above. `test/startup-config.test.cjs` passed all 7 tests, including the
four viewport dimension-gate checks. Project JavaScript syntax checks
excluding `node_modules` and `git diff --check` passed. A required-mode
diagnostic for each live Electron/probe test reached its prerequisite
assertion and failed on the missing `/usr/bin/Xvfb`; these expected diagnostic
failures are not counted as suite failures or runtime passes.

The workflow is configured to create fresh packages, inspect the original
emblem bytes and ASAR contents, run package probes and the full serial suite
with runtime checks required, and upload evidence under
`aether-linux-runtime-evidence`. Configuration is not execution evidence.
Current production blockers remain the hosted package/runtime result, actual
screenshot inspection, NetworkService syscall attribution, production
redirect/WebSocket OS-boundary evidence, process cleanup evidence from the
packaged run, and independent security review. Keep
`REMOTE_BROWSING_ENABLED=false`.

## A15 regression verification (2026-10-31)

The 768x1024 screenshot follows the same recovered packaged Electron window
path as the 360x720, 640x720, and 1480x920 captures. Each uses ImageMagick
`import -window <window-id>` to capture the actual window; no generated image
or UI fixture is used. The shared validator decodes `%w %h %k` from the saved
image, asserts exact pixel dimensions, and requires more than 20 distinct
colors. A missing or malformed image fails the conversion command; a blank
capture fails the color assertion. The startup-config regression checks all
four sizes and the content guard. These runtime assertions were not executed
against real screenshots in this environment.

The smoke retains its existing `context.after` cleanup for the parent,
browser-child process group, display, controlled listeners, and temporary
profile directory. Cleanup code was inspected, but no packaged test ran here,
so successful and failure-path runtime cleanup remains unverified. Evidence
screenshots are intentionally outside the temporary profile directory and
are retained by the workflow artifact upload.

Required-mode diagnostics for the UI smoke, live Electron integration, and
production-child probe reached their prerequisite assertions and failed on
missing `/usr/bin/Xvfb`, before launching Electron. In the full desktop suite,
the artifact test is skipped when `resources/app.asar` is absent; the workflow
first asserts the fresh unpacked executable and ASAR exist and separately
inspects both package targets. Required runtime flags are set for the live
integration, AppImage smoke, and production-child probe in the CI steps.
`actions/upload-artifact` runs with `always()` when the evidence directory was
created and uses `if-no-files-found: error`; an upload failure therefore
fails the workflow rather than being ignored. No workflow was run here.

The host has `/usr/bin/strace` 6.8. It successfully traced a harmless
`unshare --user --map-current-user --net /usr/bin/true` child, which confirms
basic ptrace/namespace tracing is available. This is not a Chromium observer:
no packaged application was launched, and tracing may alter Chromium's
sandbox behavior. No renderer request, NetworkService syscall, WebSocket
handshake, redirect target, or kernel socket outcome was observed. The
smallest next experiment is on a disposable isolated Linux runner with an
already-built package: make exactly one controlled renderer request, trace
connect calls with PID and decoded destination, correlate it to the request,
and independently verify sandbox, namespace, capabilities, and `no_new_privs`
are unchanged. If tracing prevents any of those checks, reject it as an
observer. A reviewed test-only network topology is still needed to allow a
controlled redirect/WebSocket attempt to reach OS enforcement without public
forwarding. No evidence category substitutes for another: policy cancellation
is not a main-process socket result; a main-process result is not renderer or
NetworkService evidence; CDP events are not kernel syscall outcomes; and
Node/fixture behavior is not packaged Chromium behavior.

The A15 focused package/policy/workflow and display-adapter tests passed
**18/18** after the pixel-content assertion was added. The final serial desktop
suite passed **114 of 118 tests, with 0 failures and 4 environment/artifact
skips**. JavaScript syntax checks excluding `node_modules` and
`git diff --check` passed. No package was built or launched and no GitHub
Actions run occurred.

## A16 hosted user-namespace prerequisite (2026-10-31)

The reported hosted-runner diagnostics show
`apparmor_restrict_unprivileged_userns=1`,
`unprivileged_userns_clone=1`, and
`unshare --user --map-current-user --net true` failing while writing
`/proc/self/uid_map` with `Operation not permitted`. The enabled AppArmor
restriction is the leading explanation for the denial; the `uid_map` error
identifies the mapping stage that failed. The clone sysctl only says that
unprivileged user-namespace cloning is not globally disabled; it does not
grant AppArmor authorization or prove UID/GID map writes are permitted.
Without that runner's kernel/AppArmor audit denial, the screenshot alone does
not conclusively exclude an additional hosted-runner security policy.

The workflow still fails closed, but its namespace preflight now exercises
the production-relevant `unshare --user --map-current-user --net` operation
and verifies that both user and network namespace IDs differ from the parent.
It prints and validates the one-entry UID/GID maps against the invoking
runner's numeric IDs and checks the same IDs from inside the new namespace.
If `uid_map` fails while the AppArmor restriction is `1`, the log labels
AppArmor as the likely cause without changing policy or treating the failure
as success. The regression test checks these requirements and rejects a
workflow sysctl/AppArmor bypass.

Safe resolution options considered:

1. Disabling `apparmor_restrict_unprivileged_userns` globally on the runner
   would grant unprivileged user-namespace creation to all processes in that
   job VM, not just AETHER. It is not justified for this workflow and was
   rejected.
2. A dedicated AppArmor profile with narrowly granted `userns` permission
   may be possible on a runner whose administrator supports profile loading.
   It would require explicit review and runtime proof that the permission
   covers the exact `unshare` and Chromium nested-namespace lifecycle without
   weakening Electron's own sandbox. This environment has no AppArmor profile
   administration tooling, and no such profile was tested; none was added.
3. Use a dedicated ephemeral Linux runner image whose administrator has
   preconfigured and reviewed an appropriate scoped AppArmor policy, or an
   approved runner environment where unprivileged UID/GID mapping is
   permitted. Keep the unprivileged production launch unchanged. The existing
   preflight must pass with distinct namespaces and exact UID/GID maps before
   package or runtime gates may proceed. Do not assume another hosted Ubuntu
   label works without running this check.

Local validation of the namespace mapping preflight succeeded on this Codespace:
the child namespace IDs differed, and `/proc/self/uid_map` and
`/proc/self/gid_map` each contained the expected single mapping
`1000 1000 1`. This confirms the script's expectations in this environment
only. Focused namespace/workflow tests passed **18/18**; the complete desktop
suite passed **114 of 118 tests, 0 failed, 4 skipped**; JavaScript syntax
checks excluding `node_modules`, workflow YAML parsing, `bash -n` for all
workflow run blocks, and `git diff --check` passed. The hosted runner issue is
**NOT RESOLVED** until the revised preflight passes on an authorized Actions
run or the workflow uses a validated alternative runner. No Actions run was
dispatched. Production AppImage isolation, Chromium network behavior, and
hosted cleanup remain unverified.

## A17 hosted namespace diagnostics review (2026-10-31)

The workflow diagnostic step now records only numeric runner UID/GID, the
relevant namespace sysctls, the current AppArmor profile, the runner's UID/GID
maps, and user/network namespace IDs. It does not dump the full runner
environment or supplementary group list. On namespace failure the preflight
preserves the `unshare` stderr and exit status, then attempts to read `dmesg`
and the last 500 kernel journal records. It filters those optional sources to
AppArmor/user-namespace/UID-map/GID-map denial lines. Missing commands,
restricted kernel-log access, or no matching records are recorded as
diagnostic limitations; they do not replace the original failure or turn the
preflight into success.

The preflight's identity assertions match `--map-current-user`: each child map
must contain exactly one range mapping namespace ID `AETHER_HOST_UID` to the
same host UID, and likewise for GID; the child reports those same numeric
IDs. It does not assume namespace UID/GID zero. User and network namespace
IDs must both differ from the parent. The workflow tests cover these exact
requirements, optional audit sources, and the final failure exit.

The focused regression executes the actual extracted workflow preflight with
a fake `unshare` that emits the UID-map denial and exits 73, plus fake
`dmesg`/`journalctl` commands that deny access. It verifies the evidence log
retains the original failure and exit code, records both optional diagnostic
denials, and never prints the namespace-success message. This exercises the
failure path without creating a package or launching AETHER.

No evidence establishes that switching from `ubuntu-24.04` to a different
GitHub-hosted label will permit these mappings. A dedicated ephemeral runner
is required if the standard hosted runner continues to deny the preflight.
Its minimum prerequisites are: unprivileged user and network namespace
creation by the job UID; permission to write exact one-entry UID/GID maps for
that UID/GID; a distinct user namespace and network namespace; and a reviewed
AppArmor policy that permits the required rootless namespace setup and
Chromium lifecycle without globally disabling AppArmor or weakening Chromium
sandboxing. The preflight proves namespace creation and mapping, not the
quality of the host's AppArmor policy; runner administrators must provide
that policy review. A passing preflight on an authorized workflow run is
required before proceeding to package/runtime tests.

The exact hosted root cause remains **suspected, not proven**. The supplied
runner output is consistent with AppArmor's unprivileged-userns restriction,
but the runner kernel audit messages were not provided. The A17 workflow
change is not hosted-validated; no Actions run was dispatched. Production
isolation remains gated on a successful hosted packaged run and the separate
NetworkService/network-boundary evidence described above.

## A18 consolidated integration review (2026-10-31)

The review found two fail-closed/evidence issues and corrected them:

- The CI setup log used full `id` output despite the namespace diagnostics
  contract limiting identity data to numeric UID/GID. It now logs only those
  two values; the workflow regression test rejects the full identity form.
- Weston cleanup could interpret an inaccessible `/proc/<pid>/stat` entry as
  an absent process. Cleanup now propagates access errors and fails if procfs
  itself is unavailable, rather than reporting an unverified process group
  as clean. The display-adapter regression covers denied and unavailable
  procfs.

The focused integration run reported **73 tests, 70 passed, 0 failed, and 3
skipped**. The skips were the built-artifact assertion, packaged UI smoke,
and production-child probe; those require a fresh package and/or explicitly
enabled packaged runtime. The complete desktop suite reported **120 tests,
116 passed, 0 failed, and 4 skipped**. Its additional skip was the live
Electron/Chromium isolation test, which requires the pinned Electron runtime,
Xvfb, and GTK libraries. No skipped test was treated as passing evidence.

JavaScript syntax checks excluding `node_modules`, workflow YAML parsing,
`bash -n` on every workflow `run` block, and `git diff --check` passed.
`REMOTE_BROWSING_ENABLED` remains `false`. The workflow still requires the
namespace preflight and packaged runtime gates, but no hosted run was
performed. AppArmor remains the suspected—not proven—cause of the reported
hosted UID-map denial. Package launch, real screenshot inspection, packaged
process cleanup, and Chromium NetworkService syscall/network-boundary
evidence remain unverified and block production readiness.

## A27.1 current-commit hosted run results (2026-10-31)

GitHub Actions run
[41225181362](https://github.com/mksp1319-parmar/PARMAR-v1/actions/runs/41225181362)
ran commit
`db5654420cde1d2ab9e6358af51f93bb8916a7b8` on `ubuntu-24.04` and concluded
**failure**. Its retained `aether-linux-runtime-evidence` artifact contains
`ci-setup.log`, `namespace-prerequisites.log`, and
`network-namespace-check.log`.

The namespace preflight **failed**. The retained logs record
`apparmor_restrict_unprivileged_userns=1` and
`unprivileged_userns_clone=1`; `unshare --user --map-current-user --net` then
failed writing `/proc/self/uid_map` with `Operation not permitted`. The kernel
audit record explicitly reports AppArmor profile `unprivileged_userns`
denying capability `sys_admin` for `unshare`'s `userns_create` operation.
This confirms the immediate AppArmor denial on this runner, rather than only
suggesting AppArmor based on the sysctl values. The enabled clone sysctl does
not override that denial. The workflow did not change AppArmor or sysctl
settings.

**AETHER tests passed in this run: none.** Setup, diagnostics, and evidence
artifact upload completed successfully; these are workflow steps, not passing
application tests. Eight downstream steps were skipped after preflight
failure:

1. Verify Electron GUI runtime prerequisites.
2. Install pinned desktop dependencies.
3. Verify Electron runtime libraries and prepare AppImage tools.
4. Build and inspect the unpacked and AppImage packages.
5. Run the focused packaged production-child probe.
6. Run the focused packaged AppImage UI smoke test.
7. Run focused isolation and supervisor regressions, including live Electron
   isolation.
8. Run the complete serial desktop regression suite.

Consequently, this run produced **no current-commit package, packaged launch,
runtime probe result, or AETHER screenshot**. Package integrity and emblem
checks, packaged Electron/Chromium isolation and cleanup, screenshot pixel
assertions and visual inspection, renderer-to-kernel attribution, and
production redirect/WebSocket behavior remain **unverified** for this commit.
The readiness checks implemented in the workflow are not execution evidence.

Historical results remain historical: the previously recorded local desktop
suite result of 120 tests (116 passed, 0 failed, 4 skipped) predates this
hosted run and does not establish that the suite passed on commit
`db5654420cde1d2ab9e6358af51f93bb8916a7b8`. Earlier package and runtime
results likewise apply only to their recorded revisions. Do not count those
results as current-commit passes.

Keep `REMOTE_BROWSING_ENABLED=false`. The immediate blocker is a runner that
permits the required rootless namespace operation while retaining the
existing exact UID/GID mapping assertions and security controls. A27.2 must
test a supported runner candidate with the preflight before any package or
runtime gates can execute; if no hosted candidate passes, use the reviewed
ephemeral-runner path described above.

## A27.2 hosted runner preflight candidates (2026-10-31)

The manual-only workflow `.github/workflows/aether-namespace-preflight.yml`
tests `ubuntu-22.04` and `ubuntu-24.04` independently with read-only
repository permissions. It checks out the selected revision, runs only the
shared `.github/scripts/aether-namespace-preflight.sh`, and uploads each
candidate's diagnostic log even when its preflight fails. It does not install
packages or dependencies, build or launch AETHER, or perform application
network tests.

The production runtime workflow now calls the same script, so candidate and
production checks use identical requirements: unprivileged user and network
namespace creation, distinct namespace IDs, exact one-entry UID/GID mappings
for the runner's numeric UID/GID, and failure diagnostics that preserve the
original exit status. The script does not change AppArmor or sysctls and does
not grant capabilities. Focused local regression and syntax checks exercise
the shared script and candidate-workflow constraints only; they do not
establish hosted runner behavior. The shared script also passed a direct
local preflight: this environment reported
`apparmor_restrict_unprivileged_userns=0`, distinct parent/child user and
network namespace IDs, and exact `1000 1000 1` UID/GID maps. This is
local-only evidence and does not predict either hosted candidate. Neither
Ubuntu candidate has been run by this change. An authorized
`workflow_dispatch` is required before either candidate can be reported as
passing.

### A27.2-F fail-closed regression results

The shared namespace preflight now enables `errexit` and `pipefail`, rejects
empty parent namespace IDs before attempting child creation, and rejects empty
child namespace IDs before comparing them with the parent IDs. A failed
`readlink` exits with its original status; the existing `unshare` failure
branch still preserves its status while treating denied optional kernel-log
diagnostics as unavailable. The production workflow's pull-request and push
path filters both include `.github/scripts/**`, so changes to the shared
preflight invoke the production checks.

The focused command `cd PARMAR/desktop && node --test
test/startup-config.test.cjs` passed all 16 tests with zero failures and zero
skips. Added fixture-only regressions cover parent user/network `readlink`
failures, empty parent and child IDs, and a successful exact-map/distinct-ID
path. The existing simulated UID-map failure and denied-diagnostic-source
regression also passed. `bash -n` passed for the shared script, Ruby YAML
parsing passed for both workflows, and `git diff --check` passed.

These are local code and controlled-fixture results only. The fixtures do not
create namespaces or emulate hosted runner policy. Ubuntu 22.04 and 24.04
remain untested pending an authorized manual workflow run; no candidate is
reported as passing, and `REMOTE_BROWSING_ENABLED` remains `false`.

## A38 browser privacy and permissions

The browser settings panel reports the fixed Electron session permission
policy. Main-process request and check handlers validate HTTPS origins and
known permission types, then deny every request; unknown permission types,
invalid origins, and all other permission requests are denied as well.
Permission labels indicate policy, not whether a site previously requested
access. Remote browsing remains disabled, per-site permission controls are not
implemented, and no renderer IPC can grant permissions.

The panel describes locally persisted history, bookmarks, tab/session
metadata, zoom and other preferences, and download metadata. Download
destination paths are not persisted in AETHER's download records. Clearing
history affects history only; clearing download records removes inactive
metadata and does not delete downloaded files. Resetting preferences is a
separate action. These actions do not clear saved tabs/session metadata,
bookmarks as a group, or the persistent Chromium session's cookies, cache, or
website storage. No Electron runtime or visual verification was performed for
this update; automated desktop tests validate the policy, IPC boundaries, and
settings content only.

## A39 browser profiles and metadata separation

AETHER now maintains a bounded profile registry in `aether-profiles.json`.
The fixed `Default` profile continues using the existing user-data
`aether-state.json`; this is a compatibility mapping, not a copy or merge, and
the original data is not deleted. Other profiles use generated UUID directory
names under `profile-data`; profile names are validated display names and are
never filesystem paths. Each selected profile has its own AETHER metadata
store for bookmarks, history, tab/session and zoom state, preferences, closed
tabs, and download metadata. Invalid or unsupported registry data fails
explicitly and is left unchanged.

Profile creation and next-startup selection are available in Browser Settings.
Switching requires confirmation and only changes the selected profile for the
next startup; the current process continues using the original profile's
metadata store, and the UI explains that a restart is required. There is no
profile deletion control.

## A40 Chromium profile partitions

Each validated profile ID selects a deterministic persistent Chromium
partition. The fixed `default` ID retains the existing
`persist:parmar-aether-browser-v1` partition for compatibility. Other profile
IDs must be generated-format UUIDs and map to
`persist:parmar-aether-profile-<profile-id>`. Names do not participate in
partition names or paths. Invalid IDs and partition initialization failures
abort browser startup; there is no fallback to the Default partition. Existing
Chromium data is neither migrated nor deleted.

At browser startup, the selected profile is validated before its session is
resolved with `session.fromPartition`. Permission request/check denial,
download approval, and HTTP(S)/WebSocket request cancellation handlers are
installed on that session before any tab view is created. Session setup is
idempotent for a profile within the process, and a session object already
assigned to another profile is rejected. Each `WebContentsView` is created
with the active profile's session and a consistency check prevents tab
creation if the active ID and initialized session do not match. Existing
per-view navigation and popup restrictions remain in place.

Profile selection remains restart-only. A running process does not move or
reuse live `WebContents` across partitions; it continues using its original
profile and metadata store until it exits. On the next startup, only the
selected profile's metadata is restored, and saved remote addresses remain
paused on the local AETHER Start Page. The Default partition preserves prior
Chromium data; additional profiles receive distinct partition identifiers and
do not import that data.

Closing the browser window closes each tab's `WebContents` and clears the tab
references; the initialized session remains cached for that same profile if
the window is reopened in the still-running process. Selection in Settings
only stages a next-startup profile and does not change the active store or
session. A live switch would require coordinating metadata persistence,
outstanding downloads and requests, tab event handlers, and destruction of all
old-profile contents before creating any target-profile contents. That
cross-profile transition is intentionally not implemented.

Partition mapping and policy lifecycle are covered by Electron mocks in the
desktop tests. These tests are not evidence of actual Chromium storage
separation. No Electron runtime or visual verification was performed.
Independent runtime verification is still required before claiming that
cookies, cache, website storage, or other Chromium state are isolated in
practice. This work does not establish network isolation; remote browsing
remains disabled.

## A41 Chromium profile isolation verification preparation

### Verified implementation facts

- `profilePartition()` accepts only the fixed `default` ID or a profile ID
  matching the generated UUID format. It preserves the legacy Default
  partition and derives every other partition name only from the ID.
- Browser startup loads the validated registry's startup profile, resolves
  that profile's session with `session.fromPartition()`, and installs its
  permission request/check denial handlers, download handler, and
  HTTP(S)/WebSocket request-cancellation hook before creating the browser
  window's first tab.
- `createTab()` rejects creation unless the module's active profile ID equals
  the ID associated with the initialized session. Every tab is a newly
  constructed `WebContentsView` with that session explicitly supplied in
  `webPreferences.session`. The only `session.fromPartition()` call is in the
  policy installer.
- Tab creation contains no path that adopts or transfers an existing
  `WebContents`. Closing a tab closes its contents; closing the browser window
  closes every remaining tab contents and clears the tab map. A closed window
  may be reopened with new contents on the same active profile session.
  Selection in settings only stages the next startup; it does not change the
  active profile or session in the current process.
- The above lifecycle assertions are based on source inspection and
  Electron-mock tests. They do not prove how a particular Electron/Chromium
  build stores or separates on-disk browser data.

### Storage ownership and evidence gaps

The app does not directly read, write, clear, or migrate cookies, Chromium
HTTP cache, DOM `localStorage`, IndexedDB, or service-worker registrations.
The expected owner for those Chromium stores is the Electron `Session`
selected by the `WebContentsView` partition. In Chromium, the web-platform
stores are also origin-scoped within the browser context. This is the intended
Session/partition contract, not a result demonstrated by AETHER's current
tests.

| Data | Current code evidence | Runtime evidence still needed |
|---|---|---|
| Cookies | No app-level cookie access; tab views receive the profile session. | Set unique cookies for the same test origin in each session; read back only the corresponding value before and after restart. |
| HTTP cache | Session is profile-specific; the app's request hook cancels HTTP(S), so AETHER cannot fetch a cacheable HTTP response under current policy. | Confirm each session reports a distinct persistent storage path. Do not enable HTTP(S) merely to populate cache. Actual cached-response separation remains unverified unless it can be tested without relaxing the production policy. |
| `localStorage` | No app-level access; expected to belong to the origin and selected Chromium session. | Write distinct same-origin markers from a local secure test page in each session; confirm no cross-read and persistence across process restart. |
| IndexedDB | No app-level access; expected to belong to the origin and selected Chromium session. | Create/read distinct database records from the same local secure test origin in each session, including after restart. |
| Service workers / Cache Storage | No app-level registration or cache access; expected to live in the session's Chromium storage partition. | Register a worker from a secure local test origin; verify per-session registration and distinct Cache Storage entries, then verify both after restart. |

`Cache Storage` (the web API commonly used by service workers) is not the
same as Chromium's HTTP cache. Testing Cache Storage does not verify HTTP
cache partitioning. The existing HTTP(S) request cancellation must stay in
place during AETHER verification; HTTP cache contents therefore remain an
explicit evidence gap unless a safe, policy-preserving test is found.

### Previously skipped full-suite tests

The prior full desktop run reported four skips:

1. `built Linux artifact contains launchable app.asar paths and required
   browser isolation assets` — skipped because the expected packaged
   `build/linux-unpacked/resources/app.asar` was absent. It inspects packaging
   output, not runtime storage isolation.
2. `live Electron and Chromium descendants stay outside the host namespace
   and cannot reach controlled listeners` — requires Linux namespace tools,
   pinned Electron, Xvfb, and user-local GTK libraries. It launches Electron
   and tests process/network namespace controls; it does not test profiles'
   storage contents.
3. `packaged AETHER UI launches isolated Chromium and supports real browser
   chrome interactions` — opt-in via `PARMAR_AETHER_UI_SMOKE=1`; requires a
   packaged application and GUI tooling and launches the app. It verifies
   UI/runtime behavior, not profile storage separation.
4. `test-only harness records packaged Chromium renderer requests in the
   isolated network namespace` — opt-in via
   `PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1` plus a fresh Linux
   directory package and evidence directory. It launches the packaged child
   for a network probe, not a profile-storage comparison.

None of these skipped tests currently demonstrates that cookies,
`localStorage`, IndexedDB, service-worker state, or cache contents are
isolated between AETHER profiles. The A40 focused-test failure was in the
new mock test's teardown: it asserted that the first tab's WebContents had
been destroyed without first closing its browser window. The explicit window
close was added before starting the simulated second process; the retry
passed. This was a test-fixture error, not evidence of a production lifecycle
defect.

### Opt-in, non-user-data runtime verification procedure

The following is a proposed test procedure; it has not been run and does not
authorize launching Electron as part of ordinary tests.

1. Add a separately invoked runtime test with an explicit opt-in flag and a
   pinned Electron runtime. Require a newly created, unique temporary
   `userData` directory owned by the test. Refuse to run if the directory is
   not empty or is not beneath the test's temporary root. Never point it at
   the developer's normal AETHER data directory. Do not call
   `clearStorageData()` on any existing profile.
2. Generate two test profile UUIDs and names, create a registry containing
   only those test profiles plus the required Default entry, and select each
   test profile only on its respective test startup. Assert the exact
   partition names and that each `Session.getStoragePath()` is non-empty and
   distinct. Record Electron/Chromium versions and the two paths as test
   evidence.
3. Keep the production remote-browsing flag false and preserve the production
   session policies. Serve a fixed fixture only from an explicitly registered
   secure custom test scheme backed by in-memory fixture bytes; do not make
   HTTP(S) requests, contact the Internet, or add an HTTP allowlist. The
   fixture should use one identical origin in both sessions and write
   different random markers to cookies, `localStorage`, IndexedDB, a
   service-worker registration, and Cache Storage.
4. In one test process, create a new WebContents per profile with the
   corresponding session; assert the session identity, read each store's
   marker in its owning contents, and assert that the other profile's marker
   is absent. Close the contents and process cleanly.
5. Restart the test app using the same temporary test `userData` directory,
   first with profile A and then profile B selected. Recreate contents only
   with the selected profile's session, verify its marker persists, verify
   that the other profile's marker is not visible, and confirm the two
   storage paths remain stable. Save logs/results outside the user-data
   directory. Clean up only the test-created temporary directory after the
   run, never any pre-existing profile storage.
6. Report HTTP cache separately. Do not enable HTTP(S) to manufacture cache
   entries. Distinct session storage paths and web-platform Cache Storage
   results are not proof that HTTP cache entries were populated or isolated.
   The test must mark HTTP cache verification as outstanding unless a
   policy-preserving, local-only method is independently established.

Evidence sufficient for a bounded claim would include the test source and
fixture, the opt-in command and successful results, Electron/Chromium
versions, profile IDs (not names or user data), distinct stable storage
paths, per-profile read/write assertions in the same origin, successful
process-restart persistence checks, and proof the ordinary session policies
and remote-browsing flag remained unchanged. Even then, the conclusion must
be scoped to the tested Electron/Chromium build and tested storage APIs.
Network isolation and HTTP-cache isolation require separate evidence.

## A42-A46 profile isolation hardening and verification

### Architecture and lifecycle

The Default ID continues to map to the pre-existing persistent partition
`persist:parmar-aether-browser-v1`; other validated generated UUIDs map to
`persist:parmar-aether-profile-<uuid>`. The profile name is never part of a
partition name or profile data path. Invalid IDs are rejected before Electron
session lookup. A session lookup or policy-installation error is surfaced and
does not fall back to another profile.

At startup, AETHER validates the profile registry, selects the persisted
startup profile, resolves its session, and installs the restrictive permission
request/check, download, and HTTP(S)/WebSocket request-cancellation handlers.
Only after that does it create a BrowserWindow and new `WebContentsView`
instances with the selected session. A tab is not restored from an existing
WebContents; it is recreated on the local Start Page, with a saved remote URL
kept paused. The browser-window chrome remains a separate local renderer.

Settings selection is explicit and staged for the next startup. The running
process continues to use its original store/session; live switching is not
implemented. Closing a tab removes its app event listeners, replaces its
popup handler with deny, and closes its WebContents. Closing the browser
window applies that disposal to every tab and clears tab references. Session
policy setup is cached per profile and is not registered twice when the same
profile's browser window is reopened in that process.

### Data integrity, recovery, and compatibility

The registry validates exact record shapes, supported versions, bounded
profile counts, generated IDs, safe normalized names, unique IDs/names, valid
creation timestamps, and a selected ID that references an existing profile.
Malformed or partial registry JSON fails startup without rewriting the
registry. Writes validate the candidate metadata, write to a unique
exclusive-created temporary file, fsync it, then rename it into place. A
failed write preserves the prior registry and removes only the temporary file
created by that operation. Browser metadata uses the same temporary-file and
rename pattern.

Bookmarks, history, preferences, tab/session/zoom state, closed tabs, and
download metadata remain in each profile's separate `aether-state.json`. The
Default profile uses the existing user-data root and file in place; no
copy/merge migration or Chromium storage reset is performed. New profiles use
UUID-only directories. A missing metadata file is treated as an empty store
for compatibility with a newly created, not-yet-used profile. AETHER cannot
distinguish that case from external loss of a profile directory; it does not
merge another profile's data or claim to recover externally deleted data.
Malformed or unsupported existing metadata fails explicitly rather than
being silently replaced. Profile deletion and Chromium storage cleanup are
not implemented.

### Settings diagnostics

The profile settings state is described as:

- **Metadata separation implemented** — AETHER-owned records are stored in
  the selected profile metadata store.
- **Dedicated Chromium partition configured** — each profile ID maps to a
  persistent partition, and tab views are configured with that session.
- **Runtime storage verification pending** — the current automated desktop
  suite does not prove Chromium storage separation.
- **Network isolation not verified** — AETHER continues to keep remote
  browsing disabled; no network-isolation claim is made.

The active profile name and restart-required selection are shown. Creating a
profile and selecting one call the existing validated main-process
operations. The UI does not expose storage paths, deletion, or unimplemented
runtime controls.

### A42 opt-in synthetic runtime harness

`test/profile-storage-runtime.test.cjs` and
`test/profile-storage-runtime-worker.cjs` implement an opt-in Electron test.
The parent creates a unique temporary root and empty temporary user-data
directory, generates two profiles and random synthetic markers, then runs
four separate Electron processes: seed A, seed B, restart/verify A, and
restart/verify B. Each worker verifies its selected profile, opens only that
profile's validated persistent partition, installs deny-by-default
permissions, cancels downloads, blocks HTTP(S)/WebSocket requests, denies
popups, and allows top-level navigation only to its in-memory secure custom
scheme fixture. No HTTP(S) allowlist or external server is added.

For each profile the fixture writes a cookie, `localStorage` entry, IndexedDB
record, service-worker registration and service-worker-owned Cache Storage
marker, plus a page-owned Cache Storage marker. The two profiles use the
same test origin and key names but different random values. After restart, the
test asserts each profile reads its own values, not the other profile's
marker, and has the same storage path and partition mapping. Results include
only synthetic profile IDs, partition/storage paths under the temporary root,
versions, and category pass states; marker values are not emitted. The
temporary root is removed by the test after the child processes exit.

Run only when deliberately performing runtime verification:

```sh
cd /workspaces/PARMAR-v1/PARMAR/desktop
xvfb-run -a env PARMAR_AETHER_PROFILE_STORAGE_RUNTIME=1 npm run test:profile-storage-runtime
```

On a machine with a graphical display, omit `xvfb-run -a`. The pinned Electron
runtime must already be present; this milestone does not install it. The
harness has not been executed as part of this milestone. Its tests are skipped
by default, including during ordinary `npm test`. A successful run is
necessary runtime evidence for the listed APIs, not evidence for every
Chromium storage mechanism or for AETHER's network boundary. The harness
reports HTTP cache as **unverified** and keeps production HTTP(S) requests
blocked. Cache Storage and Chromium HTTP cache are distinct mechanisms.

### Verification status and limitations

Implemented and mock-tested: Default partition compatibility, deterministic
and distinct ID mappings, malformed ID rejection, no fallback on session
initialization failure, deny-by-default permission request/check handling,
request cancellation, popup/navigation restrictions, per-session download
policy registration, profile-specific metadata restoration, restart-only
selection, distinct mocked sessions, and WebContents disposal.

Not runtime-verified in this milestone: cookies, HTTP cache, `localStorage`,
IndexedDB, service-worker registrations, Cache Storage, storage persistence
across real Electron restarts, and actual storage path behavior. The opt-in
harness targets the web-platform storage categories and restart persistence
but has not been run. HTTP cache remains unverified because HTTP(S) requests
are cancelled by policy. Network isolation remains unverified and is a
separate process/network-boundary question. Do not describe profile storage
or network isolation as production-verified until test evidence exists for
the exact Electron/Chromium build in use.

Final non-runtime validation for this milestone: focused profile, lifecycle,
settings, and runtime-gate tests passed 77 with 0 failures; the opt-in runtime
test was skipped as intended. The full desktop suite passed 204 tests, failed
0, and skipped 5 (209 total). Syntax checks for changed JavaScript files and
`git diff --check` passed. `REMOTE_BROWSING_ENABLED` remained false. No
Electron process or runtime harness was launched, so all Chromium storage
categories above remain unverified.

The five full-suite skips were:

1. `built Linux artifact contains launchable app.asar paths and required
   browser isolation assets` — the expected built Linux `app.asar` was absent.
2. `live Electron and Chromium descendants stay outside the host namespace
   and cannot reach controlled listeners` — Linux namespace tools, pinned
   Electron, Xvfb, and the user-local GTK runtime directory are required.
3. `packaged AETHER UI launches isolated Chromium and supports real browser
   chrome interactions` — its `PARMAR_AETHER_UI_SMOKE=1` opt-in was not set;
   it requires a packaged app and GUI environment.
4. `test-only harness records packaged Chromium renderer requests in the
   isolated network namespace` — its required opt-in and fresh Linux package
   were not provided.
5. `persistent Chromium profile storage remains isolated across process
   restarts` — its `PARMAR_AETHER_PROFILE_STORAGE_RUNTIME=1` opt-in was
   intentionally not set. This harness must be run separately to produce
   runtime storage evidence.

## A68 workflow validation and evidence status (2026-11-03)

This review used the worktree at HEAD
`477d63656e760655fe23c2dc676031036840440b`. The AETHER workflows and desktop
test file contain uncommitted changes; this section records source and local
test evidence only. No GitHub Actions run was dispatched.

### Local verification

| Check | Result | Evidence boundary |
|---|---|---|
| YAML syntax | Both AETHER workflow files parsed with the already-installed `js-yaml` dependency. | Syntax parsing does not validate GitHub Actions schema, contexts, or runtime semantics. |
| Workflow review and assertions | Source review confirmed the trigger definitions, read-only permissions, job timeouts, and dependency steps. Startup-config assertions statically check the standalone manual-only trigger and permissions, Perl ordering before both preflight calls, and the standalone privileged/package-command allowlist. | Static source checks do not execute workflow steps or fully validate Actions semantics. |
| Perl | Local `/usr/bin/perl` loaded `Fcntl` constants `O_WRONLY`, `O_CREAT`, `O_NOFOLLOW`, and `O_NONBLOCK`. | This proves availability only in this environment, not package installation on a hosted runner. |
| Script and runtime verifier syntax | `bash -n` and `node --check` passed. | Syntax only. |
| Namespace preflight tests | 75 passed, 0 failed. Fixtures cover bounded diagnostics, log-path rejection, exit precedence, signals, and cleanup. | Fixture tests do not prove host kernel namespace creation or isolation. |
| Startup-config suite | 83 passed, 0 failed. | Local suite only. |
| Electron runtime provisioning tests | 12 passed, 0 failed. | These tests do not launch Electron. |

Commands and exit codes:

```text
REMOTE_BROWSING_ENABLED=false node -e 'const fs=require("node:fs"); const yaml=require("./PARMAR/desktop/node_modules/js-yaml"); for (const file of process.argv.slice(1)) { yaml.load(fs.readFileSync(file,"utf8")); console.log(`${file}: YAML syntax parsed`); }' .github/workflows/aether-linux-runtime.yml .github/workflows/aether-namespace-preflight.yml
exit 0

perl -MFcntl=O_WRONLY,O_CREAT,O_NOFOLLOW,O_NONBLOCK -e 'print "Perl Fcntl flags available\n"'
exit 0

REMOTE_BROWSING_ENABLED=false bash -n .github/scripts/aether-namespace-preflight.sh
exit 0

REMOTE_BROWSING_ENABLED=false node --check PARMAR/desktop/scripts/verify-electron-runtime.cjs
exit 0

REMOTE_BROWSING_ENABLED=false node --check PARMAR/desktop/test/startup-config.test.cjs
exit 0

REMOTE_BROWSING_ENABLED=false node --test --test-name-pattern='namespace preflight' PARMAR/desktop/test/startup-config.test.cjs
exit 0 — 75 passed, 0 failed, 0 skipped

cd PARMAR/desktop && REMOTE_BROWSING_ENABLED=false node --test test/startup-config.test.cjs
exit 0 — 83 passed, 0 failed, 0 skipped

cd PARMAR/desktop && REMOTE_BROWSING_ENABLED=false node --test test/electron-runtime-provisioning.test.cjs
exit 0 — 12 passed, 0 failed, 0 skipped

REMOTE_BROWSING_ENABLED=false git diff --check
exit 0
```

`actionlint`, `yamllint`, and `yq` were not installed. The existing local
`js-yaml` dependency parses syntax but is not an Actions semantic validator;
no dependency was installed. Workflow expression and step structure were
inspected locally, but formal Actions schema/expression validation remains
pending.

### Hosted-runner evidence still required

After the reviewed workflow changes are published, run the relevant workflows
on an authorized GitHub-hosted runner for that exact revision, then retain the
workflow run URL, job logs, and uploaded artifacts. Evidence must show:

- The apt Perl installation step completed and the dependent preflight step
  actually ran.
- The preflight log records successful namespace creation, exact child
  UID/GID mappings, and child user/network namespace identities distinct from
  the parent. A failed or unsupported runner must remain failed and preserve
  diagnostics; it must not report success.
- The Linux runtime job's required live process checks show the production
  Electron/Chromium processes in the intended non-host network namespace,
  loopback down, only the loopback interface, empty IPv4/IPv6 routes, zero
  effective capabilities, and `no_new_privs`. Retain the relevant focused
  test logs, full-suite result, and screenshot/evidence artifact.
- If an unsupported hosted runner is part of the compatibility claim, retain
  a run on that runner showing the expected fail-closed nonzero result and
  diagnostic artifact. Local fixtures are not a substitute for that runner
  behavior.

No hosted workflow run occurred during A68. YAML parsing and local tests do
not establish package installation or kernel behavior on GitHub Actions.

### Independent production verification still required

An independent review must verify the packaged Electron renderer and
NetworkService process boundary and establish that remote browsing remains
blocked until isolation is approved. Production claims require evidence from
the actual packaged runtime and controlled probes with clear process/request
attribution; source assertions, mocked fixtures, or UI-policy rejection alone
do not prove kernel-level packet blocking. Preserve the existing Electron
sandbox and fail-closed behavior.

**Status: `REMOTE_BROWSING_ENABLED` remains `false`. Production is not marked
ready.** Hosted-runner evidence, Actions semantic validation, and independent
production-boundary verification remain pending.
