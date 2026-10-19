# Disposable Electron parent/child packaging experiment

This isolated proof of concept tests packaging and process startup only. It is not production integration. It does not import production PARMAR files, navigate to external websites, configure a proxy, or claim network isolation or descendant containment. The production Electron package, lockfile, entry point, and browsing policy are unchanged.

## Pins and prerequisites

- Electron `44.7.0`.
- Electron Forge CLI `8.0.1`.
- `@electron/asar` `4.0.1`.
- Forge 8.0.1 requires Node.js `>=22.13.0`; Electron 44.7.0 requires Node.js `>=22.12.0`.
- Building requires Linux x64, npm access to the npm registry and Electron release assets, and disk space for the packaged Electron runtime.
- Runtime tests additionally require the packaged Electron shared libraries (including GTK 3) and an active X11 `DISPLAY` or Wayland `WAYLAND_DISPLAY`.

Do not attempt runtime tests if `ldd` reports missing libraries or no desktop display is available. Packaging and Node-only supervisor tests do not launch Electron.

Forge's `packagerConfig.extraResource` copies `aether-child/` to the packaged application's `resources/aether-child/`. The parent is stored at `resources/app.asar`. The exact fixed path invocation in the parent remains an experiment: successful static packaging does not prove that Electron starts that custom child app path.

## Build and checks

Run from `parent/`:

```bash
npm ci
npm exec -- electron-forge --version
npm run package
npm test
npm run test:artifact
```

`npm run package` expands to:

```bash
electron-forge package --platform=linux --arch=x64
```

`npm test` runs Node-only supervisor tests and the runtime harness. The runtime scenario suite skips unless it finds Linux x64, a display environment, the package output, and no unresolved `ldd` dependencies. The supervisor tests use mocked child streams plus one actual Node fixture; those tests do not exercise Electron or prove the packaged app-path behavior. `test:artifact` inspects package metadata/source and does not launch the artifact.

## Runtime harness scenarios

On a suitable Ubuntu 24.04 x86_64 desktop, `npm test` runs each Electron scenario from a copy of the package in a fresh temporary directory outside the repository:

1. Child entry missing before spawn: parent reports `launch-failed`, exits nonzero, and emits no child PID.
2. Missing local child page: child reports a bounded structured startup-failure event and the parent exits nonzero.
3. Child exits before readiness: parent reports the early exit and fails.
4. Child never reports readiness: parent enforces the 15-second startup timeout, sends `SIGTERM`, escalates after 3 seconds, and fails.
5. Child exits normally after readiness: parent records the exit and succeeds.
6. Child ignores `SIGTERM`: harness requests parent-window close using `SIGUSR1`; the parent closes its window, asks the child to quit, escalates to `SIGKILL` after the bounded grace period, and reports shutdown failure.
7. Normal shutdown from an installed copy: harness requests parent-window close, records child exit and parent exit status, and checks reported paths refer to the copied installation, not the checkout.

Every harness scenario has an overall timeout. It records structured stdout/stderr, the exact parent and child PIDs, checks their PPID relationship and observed `/proc` process-tree membership while running, and verifies captured process identities have exited. If cleanup is needed, the harness signals only captured PIDs after rechecking their `/proc` start time; it does not use process-name matching. Process-tree inspection is a point-in-time observation, not a guarantee that detached descendants cannot escape.

The child readiness protocol is one newline-terminated JSON record, capped at 4096 bytes, with protocol version, component/event, Electron version, fixed executable, entry path, app/resource paths, PID/PPID, and local page. Only one exact `ready` or `startup-failed` shape is accepted. Malformed, duplicate, late, oversized, identity-mismatched, or unexpected output fails startup or terminates the child with a recorded failure. Child stderr is separately captured and each record is capped at 4096 bytes.

The parent derives its executable from `process.execPath` and the child app path from `process.resourcesPath` plus the fixed `aether-child` name. It calls `spawn(executablePath, [childAppPath], { shell: false })`; renderer input is not involved. The parent logs its PID/PPID and the child's executable/app/entry/resource/version/PID/PPID on readiness. Parent window-close, SIGTERM, and SIGINT routes initiate one shutdown; graceful and forced-stop deadlines are bounded, and the final parent status is logged.

## Cleanup

The runtime harness removes only the fresh temporary test-copy directory it created. After local validation, generated build dependencies and output can be removed from this `parent/` directory:

```bash
rm -rf node_modules out
```

Do not remove or reset any other worktree content.
