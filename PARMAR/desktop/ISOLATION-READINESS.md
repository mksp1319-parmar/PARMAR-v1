# AETHER process and network-isolation readiness

## Implemented process separation

On Linux, PARMAR now launches AETHER as a second Electron process using the
current trusted Electron executable (`process.execPath`), the fixed desktop
application path, fixed browser-child arguments, and `shell: false`. The
control process keeps its own window and single-instance lock; the child uses
a separate Electron profile directory while continuing to use AETHER's
existing bookmark/history store.

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
process running as the same user, and this IPC is not a network boundary.

On non-Linux platforms, the existing in-process browser path remains in use;
the current isolation prototype only supports Linux. The child-launch PoC is
still a separate disposable packaging experiment and is not imported by the
production app.

## Network isolation is not integrated

`REMOTE_BROWSING_ENABLED` remains `false`. Process separation and the
application's request cancellation are not an OS-enforced network boundary.
Production `main.cjs` does not invoke `isolation-launcher.cjs`: that launcher
executes a fixed shell bootstrap and starts only the offline Node
`isolation-probe.cjs`, not Electron. The new browser child currently starts
directly with no separate network namespace. Do not enable remote browsing on
the basis of this process split.

The live Electron/Chromium namespace fixture is test-only. It probes
controlled IPv4/IPv6 listeners from Electron main and renderer processes,
including redirects and WebSockets, inspects Chromium descendants, and checks
shutdown/crash cleanup. It is not production-path evidence. In the current
environment, `PARMAR_ELECTRON_RUNTIME_LIB_DIR` is not configured with
user-local GTK libraries, so real Electron/Chromium execution remains
blocked. The live Node-only namespace prototype does not prove Electron
containment.

## Remaining requirements

1. Implement a production launcher that enters the verified user/network
   namespace without an unreviewed shell path, verifies interfaces/routes and
   privilege state, then starts the fixed Electron child inside that boundary.
   Fail closed if any required OS facility is unavailable; do not modify host
   firewall, sysctl, or privilege configuration.
2. Extend the controlled-listener, descendant, crash, shutdown, and
   browser-child IPC integration tests to run against that exact production
   launch path. Independently verify IPv4, IPv6, loopback, redirects,
   WebSockets, and every Electron/Chromium descendant.
3. Add and verify the child application in the actual production packaging
   pipeline. The desktop package currently provides `npm start` and tests but
   no production packager configuration; the fixed development app path alone
   does not prove that an installed artifact contains or can launch the child.
4. Preserve Electron sandboxing, context isolation, URL validation,
   permission denial, IPC sender validation, and `REMOTE_BROWSING_ENABLED =
   false` through integration and verification.

## Runtime verification procedure

After a user-local GTK runtime directory is available, run from
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
