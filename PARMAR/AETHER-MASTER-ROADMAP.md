# AETHER Master Product Roadmap

**Purpose:** evidence-based engineering path from this checkout to a release
candidate for AETHER, an independent browser integrated optionally with the
separate PARMAR ecosystem. This is a roadmap, not an implementation approval.

**Snapshot:** 2026-11-10; branch `main`; HEAD
`92107ec9cd2d1a687ccb01b13067a4c31aee7f6b`. The worktree was already dirty
before this roadmap was written. See the [completion ledger](./AETHER-COMPLETION-LEDGER.md)
for the exact changed-path inventory and evidence boundaries.

## Product and authority rules

1. AETHER owns its name, visual identity, logo/icon system, browser interface,
   navigation, tabs, privacy/security design, platform implementations,
   settings, profiles, storage, lifecycle, release, and maintenance.
2. PARMAR is a different product. Integration is narrow, explicit,
   authenticated, permission-controlled, documented, versioned, and revocable.
   The canonical PARMAR emblem is never recreated, altered, distorted, or used
   as AETHER's identity. The repository-required source digest is
   `d2327d8b5853a4c9dd5e43b8a776c3f91a962276b37cd1c8e136cab7db81c98d`;
   the audit computed that digest for
   `PARMAR/interface/static/assets/parmar-emblem.png`, but did not check a
   packaged AETHER asset.
3. VOKKI is an optional PARMAR assistant, not AETHER's browser identity. It
   cannot initiate unauthorized browsing/actions; microphone state must be
   explicit and visible; camera video is never silently captured. Do not
   imply unimplemented assistant capabilities work.
4. No Google/Chrome identity, copied browser mark, or fake partner attribution
   may appear as AETHER branding. Underlying engine choice grants no branding
   rights.
5. `REMOTE_BROWSING_ENABLED=false` is a mandatory invariant. No demo, build,
   test, or implementation prompt may change it to bypass a gate.
6. Roadmap status terms are evidence-specific: IMPLEMENTED, TESTED,
   RUNTIME-VERIFIED, DEVICE-VERIFIED, RELEASE-VERIFIED, PARTIAL, NOT STARTED,
   BLOCKED, NO-GO, UNKNOWN. A source change is not a test; a test is not OS
   containment; a build is not runtime verification; skipped tests are not
   passes.
7. Product identity is **AETHER — The AI-Native Browser**: an independent,
   premium, cross-platform browser with deeply integrated AI. Deliver a
   complete browser first; AI is optional and must never be required for
   ordinary browsing. AETHER and PARMAR remain separate product identities;
   VOKKI/PARMAR integration is optional and cannot be implied as a dependency.
   Do not use Google/Chrome branding or imply affiliation, copy another
   browser's design, or claim unimplemented behavior.

## How to use this roadmap

- Implement one focused slice per future prompt, in the order in
  [AETHER-EXECUTION-SEQUENCE.md](./AETHER-EXECUTION-SEQUENCE.md). Do not ask an
  agent to implement a whole stage.
- For each slice, inspect the current worktree and exact source first, state
  scope/non-goals, name allowed and prohibited files, preserve unrelated work,
  implement, run only the authorized relevant tests, inspect the diff, report
  exact results, and update ledgers only with evidence.
- Every phase below has objective, decisions, dependencies, bounded slices,
  target files, verification/evidence, stop conditions, exit criteria, and
  recovery notes. Phase-specific prerequisites are cumulative: no later phase
  bypasses a prior security or platform gate.
- Workflow preparation, review, authorization, dispatch, and result review are
  separate actions. No workflow was dispatched as part of this authoring task.
- Code and architecture names in “inspect” fields are discovery targets, not
  an exhaustive ownership grant. Do not overwrite pre-existing changes.

## Stage 0 — Repository baseline and engineering governance

**Objective:** establish a reproducible, non-destructive baseline and execution
controls. **Baseline:** desktop Electron source, Android Compose/SQLite offline
shell, an iOS planning document only, PARMAR web/interface code, existing
contracts/readiness documents, and dirty source/workflows/caches. No cross-
platform shared executable module was found in the initial inventory.
**Decisions:** canonical source-of-truth location for future ADRs/evidence;
owners and review roles; whether generated build/cache files are ignored or
tracked. **Dependencies:** none. **Security:** baseline integrity, change
provenance, secret handling, and no workflow authority implied by YAML.
**Tests/evidence:** read-only Git inventory; repository-specific lint/test
commands only when authorized; inventory report with commit/worktree context.
**Stop:** unexpected conflicting roadmap, data-loss risk, or unclear ownership.
**Exit:** worktree changes are inventoried and future slices can be isolated.
**Recovery:** restore from reviewed patch/backup only with explicit owner
approval; never reset, clean, stash, or discard.

| Phase | Objective, implementation slices, files to inspect | Verification, acceptance, stop/recovery |
|---|---|---|
| 0.1 Repository inventory | Map tracked and untracked code by desktop (`PARMAR/desktop`), Android (`PARMAR/android`), iOS (`PARMAR/ios`), interfaces/contracts (`PARMAR/interface`, `PARMAR/AETHER-MOBILE-OFFLINE-CONTRACT.md`), PARMAR backend, workflows, tests, build manifests, assets, duplicated logic, and missing infrastructure. Slices: inventory build/dependency graphs; trace product-owned versus PARMAR-owned modules and platform duplication; classify outputs/caches and identify missing iOS project/shared schemas. | `git ls-files`, `git status --short --branch --untracked-files=all`, manifest and source review. Accept with checked-in inventory and links, generated/caches distinguished, no claim of exhaustive source review unless completed. Stop on unrecognized sensitive data. |
| 0.2 Worktree preservation | Record branch/HEAD, staged/unstaged/untracked lists, owners/subsystems, and snapshot each future implementation prompt. Preserve existing desktop, Android, workflow, and doc edits. | Before/after exact status and path inventories; no staging/commit/push/clean/reset/stash. Accept only if pre-existing changes remain intact. Stop if a new task conflicts with changed files; seek owner guidance. Recovery by restoring only task-owned documented changes. |
| 0.3 Engineering governance | Define coding/naming, ADR template, test taxonomy and evidence fields, surfaced error handling, security review triggers, doc update rules, dependency pin/update and license review, SBOM/provenance, release evidence, and ledger status semantics. | Review governance against existing README/desktop policy/Android contract; acceptance: templates and review checklist documented and adopted before cross-platform changes. Stop on any policy that weakens default deny or equates tests with security proof. |
| 0.4 Master tracking | Maintain stage/phase/slice ledger, blockers, ADR/decision register, risk register, evidence index, dependency graph, and owner assignment. | Reconcile every gate and matrix row to a ledger entry; links resolve; counts computed from identifiers. Accept when status changes require evidence and dated context. Recovery: append superseding evidence, never rewrite history. |

## Stage 1 — Security architecture and threat model (hard gate)

**Objective:** obtain an independently reviewed, enforceable security design
before remote browsing. **Baseline:** desktop has Electron isolation settings,
policy/preload/browser-child code and Linux process separation, but source and
unit tests do not prove containment. Admission Freeze and Admission Controller
documents record NO-GO: no cgroup containment/admission barrier, trusted
authority/race concerns, no independent observer or durable ACK, no approved
production systemd design. **Decisions:** adversary boundary (including host
root), supported OS/engine, trust roots, guarantees and recovery semantics.
**Dependencies:** Stage 0. **Security:** this stage is the security gate.
**Verification:** threat-model review plus native and adversarial tests from an
independent reviewer; test commands and host/kernel config recorded.
**Stop:** unaccounted authority, race, untestable guarantee, false evidence, or
an unresolved NO-GO. **Exit:** approved architecture and acceptance plan;
remote browsing remains disabled until Gate E. **Recovery:** quarantine
generation/profile; preserve forensic evidence; no graceful fallback that
claims containment.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 1.1 Threat model | Enumerate malicious sites, renderer compromise, download payloads, navigation abuse, IPC forgery, privilege escalation, compromised child, local-file access, credential/cookie leakage, cross-profile access, permission abuse, update/supply-chain compromise, DoS, crash/recovery, and extensions if proposed. Inspect `desktop/security.cjs`, preload, broker, store, profile/download/permission modules, Android manifest/data layer, mobile contract, update/build configuration. | Abuse cases identify assets, attacker capability, impact, mitigations, residual risk, test owner. Independent security review and signed-off scope. Stop if a required threat is omitted or premise is untestable. |
| 1.2 Trust boundaries | Diagram main, renderer, preload, browser engine, child tree, network, storage, downloads, profiles, OS, PARMAR/VOKKI and human approval; specify identity, IPC, data flow, authority and failure direction. | Validate diagram against actual call graph/process tree and packaged configuration. Acceptance: no implicit trust edge; all crossings have authenticated/validated policy. |
| 1.3 Security invariants | Specify measurable least privilege, isolation/egress, file access, IPC validation, deny-by-default permissions, download handling, profile/private separation, secret handling, deletion, crash and update integrity invariants. | Map each invariant to negative tests and independent OS/runtime evidence, with fail-closed behavior. Stop on “unit test proves OS security” or undocumented exceptions. |
| 1.4 Admission-controller feasibility | Extend, do not bypass, `PARMAR/desktop/ADMISSION-FREEZE-ARCHITECTURE.md` and `ADMISSION-CONTROLLER-FEASIBILITY.md`: cgroup v2 lifecycle/delegation, admission freeze, open writer descriptors, migration/fork/descendants, independent observer, durable evidence/ACK, systemd ordering, reboot, kernel/manager/observer failure and quarantine. | Native supported-Ubuntu experiments for each authority and race; document exact kernel/systemd versions, tests, logs, owner/privilege assumptions. Current recommendation is NO-GO; further experiment does not authorize implementation. Stop if any writer/actor can repopulate after evidence. |
| 1.5 Security architecture decision | Compare per-platform candidates; for each state assumptions, failure model, actors with authority, revocation/freeze semantics, empty-state evidence, durable evidence after shutdown, unprovable assumptions and native acceptance. | ADR independently reviewed; explicit GO/NO-GO. Current state remains NO-GO for production/remote browsing. No candidate accepted by analogy, design prose, process-group kills, or namespace probes alone. |
| 1.6 Security acceptance plan | Specify isolated probes for renderer/network-service/main egress, child descendants, migration/re-admission, file access, forged IPC, permissions, downloads, profile/private leakage, shutdown races and crash cases. | Commands, test fixtures, host prerequisites, pass/fail/skip handling, evidence retention and independent observer are specified before implementation. Stop on skipped mandatory probe; recovery preserves disabled remote access. |

## Stage 2 — Desktop runtime foundation

**Objective:** turn the Electron prototype into an observable, lifecycle-
reliable, packaged runtime on only declared platforms. **Baseline:** Electron
44.7.0 / Chromium 152.0.7977.130 is pinned in the desktop package; Linux
packaging evidence exists historically, but packaged runtime acceptance is
blocked; modified Linux workflow YAML has not run. **Decisions:** supported
platforms, minimum OS/runtime, display/test matrix, crash-report privacy, and
release channel. **Dependencies:** Stage 0; Stage 1 security design for any
remote engine activity. **Security:** child privilege/containment, logging
redaction, profile integrity. **Tests:** unit, required-mode Xvfb/runtime,
packaged startup/restart/crash and platform-specific acceptance. **Stop:** a
required test is skipped, workflow failure is bypassed, or platform claim lacks
runtime evidence. **Exit:** observable package launches and recovers on each
declared OS. **Recovery:** preserve profile backups; rollback package without
reopening a quarantined browser session.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 2.1 Runtime acceptance | Continue from actual Phase 3A.3 state; inspect `.github/workflows/aether-linux-runtime.yml`, `aether-profile-storage-runtime.yml`, desktop scripts/tests and package lock. Prepare/review workflows separately. After exact authorization, dispatch only named workflow; verify runner, dependencies, XKB/Xvfb, Electron, child, Chromium renderer, preload, IPC, profiles, shutdown/crash, package. | Required-mode run must execute every acceptance (no skip), archive job logs/screenshots/artifact hashes and commit/ref. User explicitly authorizes dispatch; YAML readiness is not authorization. Stop at failed preflight/test, preserve evidence and do not retry/relax gate without approval. |
| 2.2 Runtime observability | Add structured redacted logs, per-run/tab/profile correlation IDs, startup/child/renderer/storage diagnostics, crash records and exportable support bundle. Inspect `main.cjs`, supervisor/broker, store, preload, package config. | Unit/contract tests for redaction and schema; packaged fault injection confirms useful diagnostics. Never log passwords, cookies, tokens, private content or full sensitive URLs. |
| 2.3 Lifecycle reliability | Exercise single-instance, graceful/forced quit, child/renderer crash, restart, corrupt profile, interrupted write, OS restart and interrupted update. | Electron runtime fault tests with data-integrity assertions and recovery artifacts. Accept only no success-shaped fallback/data loss; stop on orphaned process or unverified shutdown. |
| 2.4 Platform matrix | Evaluate Linux/Windows/macOS engine sandbox and filesystem/process differences; declare supported OS/version/architecture only after build and runtime proof. | Per-OS CI preparation and authorized runs, native sandbox/security evidence, installer smoke. No support claim based on cross-compiling or Linux-only tests. Roll back declared support rather than assert parity without evidence. |

## Stage 3 — Complete desktop browser

**Objective:** deliver real, secure end-to-end browser flows rather than mock
controls. **Baseline:** Electron UI, tabs/navigation policies, bookmark/history
handlers, downloads approval, persistent profiles/settings and Linux child
separation exist in source; remote access is denied and private browsing,
per-site permission controls, full storage deletion and runtime proof are
incomplete. **Decisions:** browser-engine scope, remote-navigation enablement
after Gate E only, private-session data policy, profile export and feature
support. **Dependencies:** Stage 1 GO for remote actions; Stage 2 accepted
runtime. **Security:** every page/IPC/download/storage/permission path follows
approved threat model. **Tests:** focused unit, Electron integration, packaged
E2E and privacy/data-lifecycle tests. **Stop:** unapproved external request,
false privacy claim, fake control, or gate failure. **Exit:** end-to-end tests
on supported desktop. **Recovery:** transactional storage migration, backups,
session quarantine, clear restart semantics.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 3.1 Browser shell | Audit window lifecycle, workspace, address/search, controls, new tab, loading/error states, shortcuts, context menus and responsive layout (`main.cjs`, `browser.html`, renderer/CSS/preload). Make every visible action functional or honestly disabled. | Packaged UI smoke, keyboard/responsive/accessibility checks; remote actions stay denied. Stop on renderer/main boundary bypass. |
| 3.2 Navigation | Implement HTTPS canonicalization, direct-URL/query distinction, a provider-neutral search contract for the required categories, back/forward/reload/stop, redirects, malformed URL, offline/error page, cancellation and safe scheme handling (`security.cjs`, browser child and tests). D-23 must not be resolved by the existing hard-coded endpoint. | Unit fuzz/canonicalization + runtime policy tests; blocked target never gets network; no remote browsing until Gate E. Provider choice requires separate approval. Recovery cancels target and returns safe local error. |
| 3.3 Tabs | Create/close/switch/reorder/duplicate/pin/restore/session-save, crash recovery, hard limits and memory pressure (`main.cjs`, store, renderer). | Runtime round trips, ordering/active-ID consistency, max-limit and crash tests. No URL fetch during restore until authorized. |
| 3.4 Bookmarks | Add/edit/delete/search/folders/import/export, duplicate policy, schema validation and backup/restore. | Store migration, malformed/oversize import, duplicate and round-trip tests; transactional rollback on failure. |
| 3.5 History | Real visit recording, search/date grouping, single/selected/time-range/all deletion, retention, privacy boundaries. | Runtime record/deletion tests ensure accurate per-category scope; no history written for blocked/failed navigation. |
| 3.6 Downloads | Explicit approval/destination, progress/cancel/retry, resumability if supported, file type/danger warnings, history, cleanup/interrupted recovery (`download-utils`, main, store). | Packaged test downloads to controlled fixtures, path traversal/overwrite/cancel/failure tests. No auto-open/execute; no claiming scanning without scanner. |
| 3.7 Profiles | Create/select/delete, independent cookies/cache/storage, migrations/recovery and explicit backup/export policy (`profiles.cjs`, `profile-partitions.cjs`, store). | Cross-profile leakage attempts and runtime restart/recovery; profile deletion scope verifiable. No implicit sync/export. |
| 3.8 Private browsing | Dedicated ephemeral session, clear visible state, isolate from profile, history/cookie/cache/storage deletion on close and crash. | Independent on-disk artifact inspection after normal close, crash, forced quit and OS kill; prove no restoration leakage before advertising. |
| 3.9 Permissions | Camera/mic/location/notifications/clipboard/download/file/pop-up prompts, site-specific temporary/persistent policy, revoke and default deny. | Runtime integration test each permission plus revocation/reset; no silent grants and no AI bypass. |
| 3.10 Storage controls | Accurate cookies/cache/site data/local storage/IndexedDB/service workers/history/download/per-site/full deletion semantics. | Seed each data class, clear selected scope, verify each storage artifact and UI wording. Atomicity/failure feedback; “clear history” never claims other categories. |
| 3.11 Browser preferences | Persist search engine, startup/home, theme/language, download location, privacy/default permissions, accessibility and shortcut settings. | Round-trip behavior tests in new process and invalid-value tests; only advertise persisted/operative settings. |
| 3.12 Advanced feature evaluation | Threat/license/platform review for reader, translation, PiP, print, find, zoom, devtools and extensions; stage individually. | Per-feature ADR/risk/functional tests; extensions require separate isolated design and are excluded by default. Reject feature parity as a reason to weaken isolation. |

Search is a first-class browser capability, not a synonym for one provider.
The eventual provider-neutral design must distinguish direct HTTPS URL
navigation from search intent; support general web, image, video (including
YouTube results), news, academic/research, shopping/product discovery and
local places/services; and specify provider choice, suggestions/autocomplete,
search-history controls, cancellation, offline/error behavior and safe result
handling. This is a requirements list, not evidence that these categories
exist or approval of any provider. The desktop resolver currently contains a
hard-coded provider URL, but no provider is approved by this roadmap and
remote requests remain blocked.

## Stage 4 — Android native foundation

**Objective:** verify the existing native offline shell on real Android
toolchains/devices before web engine work. **Baseline:** Compose shell with
SQLite tab/bookmark foundation, deletion flows, data limits and emblem source
hash check; current screen changes and Gradle cache artifacts are uncommitted.
Historical XML reports dated 2026-11-07 show 26 tests, no failures, but are not
a fresh run and do not prove build/runtime. Host audit reported Java 25, no
`adb`, no SDK variables, and no Xcode. **Decisions:** pinned JDK (17 compatible
with source), SDK and emulator/device matrix, backup/data protection.
**Dependencies:** Stage 0; Stage 1 threat-model review for network/engine.
**Security:** no network/permissions or false browser claim in offline shell.
**Tests:** `./gradlew testDebugUnitTest assembleDebug` with exact toolchain,
manifest inspection, physical/emulator acceptance. **Stop:** toolchain
unavailable, data-loss migration, external traffic or permission expansion.
**Exit:** reproducible verified shell/device. **Recovery:** database backup and
visible corruption/migration failure.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 4.1 Current shell verification | Preserve dirty work; inspect Gradle wrapper/version catalog, manifest, app source/tests, generated manifests and canonical asset. Build with pinned JDK/Gradle/SDK; run all JVM tests and APK assembly; inspect dependencies and merged manifest. | Fresh command/result + environment/version, count, APK hash, merged manifest, dependency tree and source/bundled emblem digest. Offline shell only; historical XML is not a pass. |
| 4.2 Device acceptance | Install/start/navigate, process death/restart persistence, backup exclusion, corruption, memory, rotation/configuration, lifecycle and accessibility on physical device and suitable emulator. | Record device/API, build hash, exact steps/logs/screenshots, failures; no `adb`/device means BLOCKED, not pass. |
| 4.3 Android architecture | Document lifecycle, browser-engine adapter boundary, repositories, persistence/migration, navigation, downloads, permissions, profiles, background work, logging and recovery against current Compose/SQLite implementation. | Architecture diagrams + contract tests; no desktop storage code reuse assumption. |
| 4.4 Android security | Manifest permission review, Web content policy, local file boundary, IPC, encryption decision, backup, network, grant/revocation. | Merged-manifest and device security tests; default no network permission before engine gate; reject unspecified encryption guarantees. |

## Stage 5 — Complete Android browser

**Objective:** implement actual remote browsing only under approved Android
security architecture. **Baseline:** Android is an offline local-data shell;
no engine, navigation, execution of search, real history/download, profiles,
permissions, or full storage controls. **Decisions:** engine/API by version,
minimum Android support and OS Safe Browsing/permission behavior.
**Dependencies:** Stage 1 accepted Android threat model; Stage 4 exit; Gate D/E
where containment is asserted. **Security:** WebView/platform engine
hardening, origin isolation, downloads and data protection. **Tests:** engine
adapter tests and device E2E with controlled test sites; outbound network stays
disabled until separate authorization. **Stop:** platform unsupported API,
unmitigated engine vulnerability, permission leak or failed deletion.
**Exit:** functional, secure, device-verified Android browser. **Recovery:**
clear/quarantine profile, retain recoverable metadata, user-visible errors.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 5.1 Browser engine decision | Compare WebView and any lawful/supportable option for security, maintenance, licensing, updates, process isolation, compatibility, debugging, memory and Android restrictions. | ADR backed by current official platform docs, dependency/license inventory, threat review and spike results. No desktop-engine equivalence assumption. |
| 5.2 Navigation and search | Address input, direct-URL/query distinction, provider-neutral category contract, navigation, back/forward, reload/stop, loading/error/offline. | Device tests for canonical URL, schemes, redirects, cancellation, offline and safe errors; provider choice remains open and external requests require Gate E approval. |
| 5.3 Tabs and sessions | Multiple tabs, select/close, restore metadata/session, crash recovery and persistence. | Process-death/runtime tests, lifecycle and tab limit checks; private session excluded from persistent restore. |
| 5.4 Bookmarks and history | Real visit recording, bookmark CRUD/search, deletion, validation and import/export. | E2E cross-check UI/database and selective deletion with failures. |
| 5.5 Downloads | Approval, progress, cancel, destination, Android APIs, recovery and content warning. | Device API-level tests and unsafe-path/content fixtures; no silent permission or open/execute. |
| 5.6 Profiles and private | Distinct engine contexts/stores, ephemeral private session and crash cleanup. | Independent filesystem/storage inspection across profile, normal/private, close/crash/reboot. |
| 5.7 Permissions/site controls | Permission prompt, origin/site-specific state, revocation, secure defaults. | Device permission matrix and revoke/relaunch checks. |
| 5.8 Data management | Per-category and all-data deletion with accurately scoped UI and failures. | Seed cookies/cache/site storage/history/download/service workers; prove deleted/not-deleted scope and recovery. |
| 5.9 Android usability | Back gesture/system bars/keyboard/touch targets/orientation/foldables/accessibility/battery/memory. | Device matrix with accessibility scanner/manual assistive technology and measured lifecycle/performance. |

## Stage 6 — Native iOS application

**Objective:** create a separately engineered native iOS product and verify it
on Apple tooling/devices. **Baseline:** `PARMAR/ios/IMPLEMENTATION-AND-VERIFICATION.md`
is planning only; no Xcode project, Swift implementation or native tests were
found. **Decisions:** supported Apple OS, current legal engine/entitlement
options, WebKit use, distribution/App Store, signing, data and privacy
disclosures. **Dependencies:** Stage 0, Stage 1 iOS threat model, Stage 7
contracts. **Security:** native web-content boundary, data protection,
permissions and app lifecycle. **Tests:** Xcode build/test on supported
simulator and physical device. **Stop:** no Apple host, signing/entitlement
ambiguity, unsupported engine promise or policy change. **Exit:** native
runtime/device evidence. **Recovery:** app sandbox backup and migration policy.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 6.1 Platform research | Verify current Apple engine rules/entitlements, WebKit, app-store rules, privacy labels, background/download/file constraints. Reconcile—not blindly retain—the offline-only constraints in existing iOS planning doc. | Dated official-source review and platform ADR. No desktop Chromium copy. |
| 6.2 Native foundation | In a separately authorized implementation, create Xcode app/test targets; define app lifecycle, navigation, persistence, browser adapter, permissions, downloads, errors and tests. | Xcode scheme builds/tests with selected versions/destination; no framework or network capability outside decision. |
| 6.3 Browser shell | Native home/address/search, tabs, navigation, bookmarks/history/downloads/settings/privacy. | Functional UI/e2e per control on simulator and device; disabled/fake controls not accepted. |
| 6.4 Profiles/private | Implement only platform-supported honest profile and ephemeral-session semantics. | Data lifecycle inspection on close/crash/background kill; limitations disclosed. |
| 6.5 iOS security | Web content boundaries, site permission, files, data protection/Keychain decisions, private cleanup and crash recovery. | Security review and instrumented tests; no unsupported secure-erasure claim. |
| 6.6 Device acceptance | Build/sign/install and verify navigation, persistence, permission, privacy, crash/recovery, accessibility across supported devices/simulator. | Exact Xcode/SDK/device, artifact/signing, test results and logs; no Apple host/device = BLOCKED. |

## Stage 7 — Cross-platform architecture

**Objective:** establish compatible product contracts without forcing identical
platform implementations. **Baseline:** desktop JS store, Android local SQLite,
mobile JSON-equivalent offline contract; no executable common schema or
migration module found. **Decisions:** schema authority/version, export
format, migration owners, sync/no-sync. **Dependencies:** Stage 0 and platform
foundation decisions; synchronization additionally Stage 1/privacy. **Security:**
strict field allowlists, credential-free URLs, no secrets/private content in
shared records. **Tests:** cross-platform golden fixtures, malformed/migration
corruption matrix. **Stop:** unversioned schema, secret field or implicit
cloud/sync. **Exit:** validated, versioned portability and parity declaration.
**Recovery:** immutable backups and rollback per migration.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 7.1 Shared contracts | Define/version tabs/bookmarks/history/downloads/profiles/preferences/permissions/settings/errors/import/export. Compare desktop store, Android models and offline contract; distinguish true shared code from duplicated adapters. | Schema review + cross-platform golden fixtures; reject unknown versions/fields without rewriting input. |
| 7.2 Data portability | Versioned export/import validation, compatibility, schema upgrades, partial import, corruption, duplicates and recovery. | Cross-platform round-trip and adversarial fixture tests; explicit omission of secrets/private data. |
| 7.3 Migration | Sequential per-platform migrations with validation, backup, atomicity, failure restore, rollback and evidence. | Test each prior schema fixture and injected failure; source survives failed/unknown migration. |
| 7.4 Synchronization decision | Decide no sync or opt-in service; if selected specify auth/encryption/conflicts/revoke/delete/recover and backend ownership. | Privacy/security ADR and real backend evidence required; absent backend => “not available,” never claim sync. |
| 7.5 Platform parity | Mark features supported/platform-limited/not supported/planned, with security caveats and version. | Matrix matches shipped behavior and tests; no forced API parity. |

## Stage 8 — PARMAR and VOKKI integration

**Objective:** optional, constrained, authenticated and human-governed
cooperation between distinct products. **Baseline:** desktop/mobile screens
mention PARMAR/VOKKI, but no scoped authenticated browser integration exists.
**Decisions:** identity, protocol, policy authority, audit retention, actions
requiring approval, availability behavior. **Dependencies:** Stages 1, 3/5/6
platform acceptance, 7 contracts. **Security:** no AI capability may cross
browser trust boundary, obtain secrets, or substitute for human approval.
**Tests:** invalid/forged/revoked/auth-failure/version-mismatch/offline and
cancellation tests. **Stop:** unapproved action, hidden recording, privilege
escalation, PARMAR outage fail-open. **Exit:** independently reviewed optional
integration. **Recovery:** immediate revoke/disconnect and local browser
operation without integration.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 8.1 Integration architecture | Versioned authenticated IPC/API, identity, authorization, payload validation, audit, errors, revocation and compatibility. | Threat-model/contract tests, replay/forgery tests and independent review. |
| 8.2 Human approval | Explicit approvals for destination, download, sharing page content, form submission, permission changes and protected local data. | User can see scope, deny/cancel; cancellation causes no side effect; no VOKKI suggestion counts as consent. |
| 8.3 VOKKI | Optional voice input/output, explicit mic permission and visible active state, user activation, wake-word feasibility, accessible cancel; no silent camera/video. | Permission lifecycle tests and physical indicator checks; unsupported capability not displayed as working. |
| 8.4 PARMAR governance | Evaluate policy checks, risk classification, approval request, decision record, rejection/cancel/audit. PARMAR is not unrestricted controller. | Policy decision never authorizes action without AETHER-side checks and human consent. |
| 8.5 Integration acceptance | Exercise auth fail/revoke, forged payload, unauthorized navigation, cancellation, counterpart unavailable, version mismatch. | Cross-platform contract tests; safe disconnect, no replay, no partial action. |

## Stage 9 — Intelligent browser capabilities

**Objective:** provide useful opt-in assistance without turning model output
into authority. **Baseline:** no scoped desktop AI/VOKKI runtime integration
exists. **Decisions:** provider/local models, page-content disclosure, retention,
offline and cost policy. **Dependencies:** Stage 1 and 8; functional browser
flows and user controls. **Security:** no default access to credentials,
cookies, tokens, private content, files, mic or camera. **Tests:** redaction,
consent/revocation, prompt injection, cancellation, output/action validation.
**Stop:** model output treated as a security decision or undeclared external
transfer. **Exit:** independently reviewed, bounded feature. **Recovery:**
disable provider/feature and delete supported stored context.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 9.1 AI architecture | Compare external/local providers for data, retention, offline, latency, cost, privacy, limitation and fallback; disclose recipient, data, purpose and retention before any external processing. | Provider ADR, privacy review, measured tests and explicit scoped consent; ordinary browsing works without AI; no fabricated capability or citation. |
| 9.2 AI features | Evaluate natural-language web questions, contextual page assistance, summarization, multi-source comparison, AI-assisted/deep research and other assistance as separate slices. Define discovery, source validation, citation handling, organization and limitations. | Feature-level usefulness/accuracy, source links, citation validation and disclosure tests; page access is user-triggered and scoped; distinguish verified source content from generated answers. |
| 9.3 Context boundaries | Prohibit implicit access to credentials, cookies, tokens, private browsing, local files, devices. Explicit scoped/revocable grants only. | Data-flow inspection, negative tests and revocation tests per field/source. |
| 9.4 AI action governance | Intent preview, risk assessment, human confirmation, action execution through normal browser policy, result verification, cancel/audit. | End-to-end tool/action tests; AI cannot approve itself or bypass navigation/permission gates. |

Product requirements for this stage include natural-language web questions,
user-scoped assistance for the current page, webpage summarization,
multi-source comparison and AI-assisted research. Deep research must define
source discovery, source validation, citation provenance/link handling,
research organization and explicit limitations. UI and data contracts must
separate verified source content from generated text, must not fabricate
citations, and must disclose uncertainty, missing sources and conflicting
evidence. Every capability remains NOT STARTED until implementation is
verified; no AI provider or processing location is selected here.

AI is opt-in and independently controllable. Before any external AI processing,
disclose the recipient, data categories, purpose and applicable retention/
sharing terms, then obtain explicit user approval for the specific context.
Do not silently transmit page contents, browsing history, URLs, identifiers or
private-session data. Ordinary URL navigation, search and browsing must remain
usable when AI is disabled, unavailable or offline; AI consent never
authorizes navigation, site permissions or bypass of a security gate.

## Stage 10 — UI/UX and brand experience

**Objective:** premium, coherent product UX without fake features or identity
conflation. **Baseline:** desktop and Android shells/UI exist; current Android
UI changes are uncommitted; no native iOS UI. Existing PARMAR emblem is
canonical; no evidence establishes a finished original AETHER logo/icon
system. **Decisions:** design owner, brand review and accessibility baseline.
**Dependencies:** platform/browser capabilities and Stage 1 labels. **Security:**
clear trust/permission/private indicators; no deceptive partner identity.
**Tests:** every control/state/accessibility and brand checklist review.
**Stop:** copied logo, altered PARMAR mark, control without behavior, implied
AI. **Exit:** functional, accessible, independently branded UI. **Recovery:**
feature-flag/remove misleading control, preserve valid user data.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 10.1 AETHER design system | Original logo, palette, typography, spacing, iconography, motion, components, empty/loading/error states. Establish asset ownership/licensing. | Brand asset provenance and visual review; reject Google/Chrome/copycat marks. |
| 10.2 Desktop experience | Browser workspace, address/search, tabs/navigation, bookmarks/downloads/settings/privacy/profile. | Runtime screenshots + keyboard/resize/accessibility and action tests; visible controls are implemented or clear disabled states. |
| 10.3 Android experience | Touch-first compact/responsive layouts, system navigation, keyboard/accessibility. | Device matrix, touch target and assistive technology checks. |
| 10.4 iOS experience | Native interactions preserve AETHER identity. | Simulator/device UI and accessibility checks. |
| 10.5 PARMAR integration visuals | Separate wordmarks and marks; source canonical PARMAR asset unchanged; VOKKI reflects actual capability only. | Hash source and package; compare aspect ratio/geometry and attribution on each platform. |
| 10.6 Functional UI acceptance | Verify actions, states, loading/errors, persistence and accessibility for every control. | Automated interaction inventory plus manual review; no placeholder represented complete. |

## Stage 11 — Privacy, accessibility and product quality

**Objective:** measurable, documented quality across supported platforms.
**Baseline:** restricted/empty offline states and some privacy controls exist;
no complete privacy inventory, localization/accessibility, or device
performance budget has been accepted. **Decisions:** retention defaults,
privacy contact/disclosures, locales, performance budgets from device data.
**Dependencies:** stages 3–10 features. **Security:** data minimization,
deletion truthfulness, redacted telemetry. **Tests:** per-platform privacy,
assistive technology, localization, fault/performance suites.
**Stop:** inaccurate disclosure, inaccessible critical action, unmeasured
claim. **Exit:** all criteria documented with device/context. **Recovery:**
disable failing feature, retain user data safely, publish limitation.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 11.1 Privacy | Data inventory/flows, retention, deletion/export/consent/permissions/private mode, redacted diagnostics and third parties. | Data-flow audit against implementation, privacy disclosures and deletion tests. |
| 11.2 Accessibility | Screen reader, keyboard/focus, contrast, text scale, reduced motion, labels and error announcements. | Platform-specific automation plus manual assistive-tech acceptance. |
| 11.3 Localization | Externalize strings, Unicode, date/time, RTL evaluation, locale formatting and completeness. | Pseudolocalization/RTL and translated string coverage; no hardcoded UI critical text. |
| 11.4 Performance | Measure startup/memory/CPU/tab/navigation/storage/download/battery/recovery; set budgets from supported devices. | Repeatable benchmark harness, device specs, percentile thresholds and regression tracking. |
| 11.5 Reliability | Low storage/network loss/memory pressure/corrupt DB/interrupted update/crashes/repeated lifecycle/large tab counts. | Fault injection and integrity checks; no silent success fallback. |

## Stage 12 — Complete testing and security acceptance

**Objective:** establish coverage and independent proof commensurate with
claims. **Baseline:** desktop test source and Android JVM tests exist; test
totals vary across historical reports, several Electron runtime tests were
skipped, Android artifacts are stale, no device evidence or iOS tests. **Decisions:**
coverage expectations, independent reviewer/lab, supported versions and
release-blocking severities. **Dependencies:** all feature/security phases.
**Security:** OS containment and update claims need independent evidence.
**Tests:** unit, integration, E2E, packaged runtime, threat-driven, independent,
regression, RC gates. **Stop:** critical/high issue, required skip, missing
platform evidence, inaccurate artifact. **Exit:** signed evidence package,
zero unresolved critical/high. **Recovery:** block/quarantine RC and retain
logs/artifact hashes.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 12.1 Unit | Core validation, policies, persistence, serialization, limits and failure cases. | Named command, fresh count; deterministic tests and mutation/negative cases as appropriate. |
| 12.2 Integration | Storage, engine adapter, IPC, permissions, downloads, profiles, migrations, PARMAR. | Cross-boundary integration tests with realistic platform adapters and failure injection. |
| 12.3 End-to-end | User journeys on every supported desktop/mobile platform. | Device/runtime recordings/logs with build hash; no mocks for claimed real behavior. |
| 12.4 Runtime | Actual packaged application, renderer/preload/IPC/process and package lifecycle. | Required-mode, no skips, logs/screenshots/process tree and artifact hash. |
| 12.5 Security | Threat-driven renderer compromise, IPC abuse, isolation/network/file/profile/private/permission/download/update tests. | Independent test execution; exact host/kernel/OS evidence and accepted residuals. |
| 12.6 Independent acceptance | Security-critical claims reviewed/tested by party independent of implementation. | Reviewer, scope, method, raw results, exceptions and approval recorded. |
| 12.7 Regression | Stable suites and affected regressions every change; baseline skips explicit. | CI result linked to exact ref, no newly skipped/failed required test. |
| 12.8 Release candidate gate | Verify all mandatory gates, legal/privacy/brand/security evidence and signed-off blockers. | Gate checklist complete; no unresolved critical/high; unauthorized workflow/release action blocked. |

## Stage 13 — Build, release and maintenance

**Objective:** traceable install/update/recovery and sustainable security
maintenance. **Baseline:** desktop dependencies locked and Linux AppImage /
directory package evidence is historical; no verified install/update/signing
path across declared platforms; Android has Gradle wrapper; iOS absent.
**Decisions:** release channels, signing identities, support policy, update
service and rollback window. **Dependencies:** stages 2–12 and Gates A–F.
**Security:** provenance, artifact authenticity, least-privilege CI, safe
updates. **Tests:** reproducible build comparison, signature/install/update/
rollback per OS. **Stop:** unsigned/untrusted update, missing SBOM/license/
provenance or unexplained artifact. **Exit:** Gate G and complete evidence.
**Recovery:** verified prior release, documented data migration rollback and
security incident process.

| Phase | Objective, engineering slices and inspect targets | Verification, acceptance, stop/recovery |
|---|---|---|
| 13.1 Reproducible build | Pin toolchains/dependencies, deterministic instructions, build provenance and checksums. | Clean-room rebuild comparison and provenance review. |
| 13.2 Packaging | Build artifacts for each declared OS/architecture; inspect package contents and resources. | Artifact hash, package inventory and clean install/runtime acceptance. |
| 13.3 Signing | Specify platform identity/certificates/notarization and protected signing service. | Signature and identity verification on final artifact; no credentials in repository/logs. |
| 13.4 Updates | Signed update metadata/payload, compatibility, explicit policy, rollback and interruption recovery. | Tamper/replay/rollback/interruption tests; no silent execution of untrusted payload. |
| 13.5 Supply chain | Dependency/SBOM, vulnerability/license review, integrity, secret scanning, CI permissions/provenance. | Release-specific reports and actionable exception process. |
| 13.6 Release docs | Install/upgrade/downgrade/recovery/uninstall/privacy/security/limitations/support. | Docs tested against artifacts and reviewed for claims/brand. |
| 13.7 Final acceptance | Per-platform artifact/signature/install/runtime/update/recovery/security/release notes. | Gate G signoff links every item to a dated exact artifact and evidence; any failure blocks release. |

## Prompt-sized engineering slice index

The 85 phase rows above are each decomposed into exactly two minimum
trackable engineering slices below: a deliverable/design/implementation slice
and a separate verification/acceptance slice. The phase tables provide the
specific files, requirements, dependencies, tests and stop/recovery criteria.
Each ID is a separately reviewable prompt; teams may split a listed slice into
smaller prompts, but must not combine slices or phases. Count = 2 IDs per
phase; this index is the source for the aggregate slice count.

| Phase | Slice 1 — bounded deliverable | Slice 2 — bounded verification/acceptance |
|---|---|---|
| 0.1 | S0.1.1 — Map tracked project areas, manifests, tests and dependencies. | S0.1.2 — Classify caches, generated files, duplicated code and missing infrastructure. |
| 0.2 | S0.2.1 — Capture branch/HEAD and staged/unstaged/untracked ownership. | S0.2.2 — Verify before/after preservation and define file ownership per prompt. |
| 0.3 | S0.3.1 — Define coding, ADR, errors, tests, security review and dependency policy. | S0.3.2 — Approve evidence/release templates and adoption/review responsibilities. |
| 0.4 | S0.4.1 — Establish phase, blocker, decision, risk and dependency ledgers. | S0.4.2 — Reconcile IDs, gate links, evidence links and count method. |
| 1.1 | S1.1.1 — Produce complete cross-platform threats/assets/attacker model. | S1.1.2 — Independently review abuse cases, mitigations and residual risks. |
| 1.2 | S1.2.1 — Map actual process, storage, network and human trust boundaries. | S1.2.2 — Validate every boundary against source and runtime call/process graphs. |
| 1.3 | S1.3.1 — Define measurable least-privilege/data/permission/update invariants. | S1.3.2 — Link each invariant to negative tests and independent evidence. |
| 1.4 | S1.4.1 — Investigate cgroup/systemd authority, freeze, migration and failure model. | S1.4.2 — Run approved native writer/observer/ACK race experiments; retain NO-GO if unresolved. |
| 1.5 | S1.5.1 — Compare platform containment architectures and state assumptions. | S1.5.2 — Obtain independent GO/NO-GO decision with evidence and residual risk. |
| 1.6 | S1.6.1 — Specify adversarial security acceptance cases and environments. | S1.6.2 — Approve exact commands, evidence retention, skip rules and reviewers. |
| 2.1 | S2.1.1 — Prepare/review required-mode runtime workflow and tests without dispatch. | S2.1.2 — After exact authorization, verify packaged Electron/Chromium runtime and retain results. |
| 2.2 | S2.2.1 — Implement structured correlation-aware redacted diagnostics. | S2.2.2 — Verify privacy redaction and packaged support bundle under faults. |
| 2.3 | S2.3.1 — Implement/complete lifecycle and recovery handling for listed failure cases. | S2.3.2 — Execute runtime crash/restart/OS interruption and data-integrity acceptance. |
| 2.4 | S2.4.1 — Define desktop OS/version/architecture support and sandbox assumptions. | S2.4.2 — Build/runtime/security-verify each declared target or narrow support. |
| 3.1 | S3.1.1 — Complete functional browser workspace and honest control states. | S3.1.2 — Verify packaged UI flows, shortcuts, resize and accessibility. |
| 3.2 | S3.2.1 — Implement safe URL/search/navigation/error behavior behind policy. | S3.2.2 — Test schemes, redirects, cancel, offline and fail-closed network behavior. |
| 3.3 | S3.3.1 — Implement desktop tab/session lifecycle, limits and recovery. | S3.3.2 — Verify persistent ordering, active state, crash recovery and memory limits. |
| 3.4 | S3.4.1 — Implement bookmark CRUD/search/folders/import/export. | S3.4.2 — Verify malformed, duplicate, oversize, migration and backup cases. |
| 3.5 | S3.5.1 — Implement history recording/search/retention/deletion scopes. | S3.5.2 — Verify real runtime visit and category-specific deletion behavior. |
| 3.6 | S3.6.1 — Implement approval, safe destinations, progress/cancel and recovery. | S3.6.2 — Test hostile names/content, overwrite, interruption and no auto-execution. |
| 3.7 | S3.7.1 — Implement profile lifecycle, isolated storage and migration policy. | S3.7.2 — Independently verify cross-profile isolation, deletion and recovery. |
| 3.8 | S3.8.1 — Implement isolated ephemeral private session and visible state. | S3.8.2 — Inspect artifacts after close/crash/kill before allowing privacy claim. |
| 3.9 | S3.9.1 — Implement default-deny prompts, site grants and revocation. | S3.9.2 — Verify live permission request, scope, deny, grant and revoke flows. |
| 3.10 | S3.10.1 — Implement explicit per-category/profile/site storage controls. | S3.10.2 — Seed and inspect each storage class; validate accurate UI wording. |
| 3.11 | S3.11.1 — Implement and persist approved browser preferences. | S3.11.2 — Verify each preference changes behavior after process restart. |
| 3.12 | S3.12.1 — Produce per-feature feasibility, licensing and threat decision. | S3.12.2 — Accept/reject feature individually with tests; extensions remain separate. |
| 4.1 | S4.1.1 — Build/test current Android offline shell with pinned toolchain. | S4.1.2 — Inspect merged manifest, dependencies, APK and bundled emblem digest. |
| 4.2 | S4.2.1 — Execute Android device/emulator install/lifecycle scenarios. | S4.2.2 — Record persistence, corruption, memory, rotation and accessibility evidence. |
| 4.3 | S4.3.1 — Specify Android lifecycle, data, engine adapter and services. | S4.3.2 — Review repositories, migrations, failure flows and module boundaries against code. |
| 4.4 | S4.4.1 — Define Android manifest, web, file, storage, backup and network policy. | S4.4.2 — Verify merged manifest and device permission/network/security behavior. |
| 5.1 | S5.1.1 — Compare Android engine choices and current platform constraints. | S5.1.2 — Approve security/licensing/maintenance ADR backed by prototype evidence. |
| 5.2 | S5.2.1 — Implement Android address/search/navigation engine adapter. | S5.2.2 — Verify navigation, offline, cancellation and safe-error behavior on device. |
| 5.3 | S5.3.1 — Implement Android tabs and persistent session metadata. | S5.3.2 — Verify process death, crash restore, limits and private exclusions. |
| 5.4 | S5.4.1 — Connect Android bookmarks/history to actual browser visits. | S5.4.2 — Verify end-to-end record, search, import and selective deletion. |
| 5.5 | S5.5.1 — Implement Android download approval/progress/cancel/recovery. | S5.5.2 — Verify destinations, content warnings, API levels and interruption cases. |
| 5.6 | S5.6.1 — Implement Android profile and ephemeral private engine contexts. | S5.6.2 — Inspect on-device data across profiles and closure/crash/reboot. |
| 5.7 | S5.7.1 — Implement Android site permission prompts and revocation. | S5.7.2 — Verify origin scope, default deny and persisted grant cleanup. |
| 5.8 | S5.8.1 — Implement per-category/full Android browser data deletion. | S5.8.2 — Seed/clear/inspect every data category and failure outcome. |
| 5.9 | S5.9.1 — Complete Android touch/navigation/responsive accessibility UX. | S5.9.2 — Verify device/foldable, battery, memory and assistive-technology behavior. |
| 6.1 | S6.1.1 — Research current Apple engine, entitlement and distribution rules. | S6.1.2 — Approve dated native iOS architecture/security decision. |
| 6.2 | S6.2.1 — Create authorized native iOS app/test project and module boundaries. | S6.2.2 — Build/test selected Xcode scheme and verify capabilities/dependencies. |
| 6.3 | S6.3.1 — Implement native iOS browser shell and real control actions. | S6.3.2 — Verify UI journeys, accessibility and errors on simulator/device. |
| 6.4 | S6.4.1 — Implement only platform-supported iOS profile/private behavior. | S6.4.2 — Verify data lifecycle after background kill, close and crash. |
| 6.5 | S6.5.1 — Implement iOS content, permission, file and data-protection boundaries. | S6.5.2 — Independently review/test private cleanup, Keychain and recovery claims. |
| 6.6 | S6.6.1 — Build/sign/install iOS app on supported Apple environment. | S6.6.2 — Record simulator/device runtime, persistence, privacy and accessibility evidence. |
| 7.1 | S7.1.1 — Define versioned cross-platform schemas and strict field allowlists. | S7.1.2 — Validate golden fixtures in each native implementation. |
| 7.2 | S7.2.1 — Implement versioned portable import/export validation. | S7.2.2 — Verify compatibility, partial/corrupt import and duplicate recovery. |
| 7.3 | S7.3.1 — Implement sequential migrations with backup/atomic recovery. | S7.3.2 — Run every prior-schema fixture and injected rollback failure. |
| 7.4 | S7.4.1 — Decide opt-in sync or explicit no-sync product behavior. | S7.4.2 — If approved, independently verify auth, encryption, revoke, conflict and deletion. |
| 7.5 | S7.5.1 — Set supported/platform-limited/unsupported/planned feature states. | S7.5.2 — Reconcile parity statements with actual tests and release evidence. |
| 8.1 | S8.1.1 — Specify authenticated, versioned, revocable PARMAR interface. | S8.1.2 — Verify identity, validation, replay, error, audit and compatibility boundaries. |
| 8.2 | S8.2.1 — Implement scoped human approval and cancellation for sensitive actions. | S8.2.2 — Verify denied/cancelled actions have no side effects. |
| 8.3 | S8.3.1 — Implement only approved optional VOKKI voice controls/indicators. | S8.3.2 — Verify mic prompt/state/cancel/accessibility; confirm no silent camera capture. |
| 8.4 | S8.4.1 — Specify PARMAR policy/risk/approval/audit contract. | S8.4.2 — Verify AETHER-side checks and fail-safe behavior when PARMAR unavailable. |
| 8.5 | S8.5.1 — Implement integration failure/forgery/revocation test harness. | S8.5.2 — Independently verify outage, mismatch, cancellation and unauthorized requests. |
| 9.1 | S9.1.1 — Compare AI providers/local models and sensitive data flows. | S9.1.2 — Approve privacy, consent, retention, cost and offline ADR. |
| 9.2 | S9.2.1 — Implement one separately approved assistance feature at a time. | S9.2.2 — Verify user-triggered scope, disclosure, result limitations and usefulness. |
| 9.3 | S9.3.1 — Implement scoped AI context allowlist and explicit user grant. | S9.3.2 — Verify no secrets/private/device data and immediate revocation. |
| 9.4 | S9.4.1 — Implement intent preview/approval/normal-policy action execution. | S9.4.2 — Verify result, cancellation, audit and that AI cannot authorize itself. |
| 10.1 | S10.1.1 — Create original AETHER logo, icon and design-system assets. | S10.1.2 — Review provenance, originality, accessibility and no copied identity. |
| 10.2 | S10.2.1 — Complete functional desktop workspace and browser surfaces. | S10.2.2 — Verify every control/state in packaged runtime and accessibility checks. |
| 10.3 | S10.3.1 — Complete touch-first Android responsive interface. | S10.3.2 — Verify device layout, keyboard, touch and accessibility. |
| 10.4 | S10.4.1 — Complete native-convention iOS interface with AETHER identity. | S10.4.2 — Verify native device interaction and accessibility. |
| 10.5 | S10.5.1 — Implement separate PARMAR/VOKKI visual treatment using canonical source. | S10.5.2 — Verify source/package hashes, geometry and accurate attribution on all platforms. |
| 10.6 | S10.6.1 — Inventory every visible interactive UI control and state. | S10.6.2 — Test action/persistence/error/accessibility; remove misleading placeholders. |
| 11.1 | S11.1.1 — Complete platform data-flow, retention and disclosure inventory. | S11.1.2 — Verify consent/export/deletion and diagnostics behavior against claims. |
| 11.2 | S11.2.1 — Implement accessibility semantics/focus/contrast/text-scale corrections. | S11.2.2 — Complete manual and automated platform assistive-tech acceptance. |
| 11.3 | S11.3.1 — Externalize and translate strings with locale-safe formatting. | S11.3.2 — Verify Unicode, pseudo-localization, RTL and translation completeness. |
| 11.4 | S11.4.1 — Measure representative device startup/resource/navigation workloads. | S11.4.2 — Approve device-derived budgets and regression thresholds. |
| 11.5 | S11.5.1 — Add low-storage/network/memory/corruption/crash fault cases. | S11.5.2 — Verify recovery, data integrity and user-visible errors repeatedly. |
| 12.1 | S12.1.1 — Complete unit validation across core data and policies. | S12.1.2 — Record exact-ref results, failures, skips and coverage gaps. |
| 12.2 | S12.2.1 — Complete integration tests with real storage/engine/IPC adapters. | S12.2.2 — Inject boundary failures and verify containment/recovery outcomes. |
| 12.3 | S12.3.1 — Automate complete user journeys on supported platforms. | S12.3.2 — Retain actual-device/runtime logs, screenshots and artifact identity. |
| 12.4 | S12.4.1 — Execute required-mode packaged runtime acceptance on each platform. | S12.4.2 — Review no-skip logs/process evidence/artifact hashes and approve Gate C. |
| 12.5 | S12.5.1 — Execute adversarial threat-model security tests. | S12.5.2 — Obtain independent OS/runtime evidence for every critical claim. |
| 12.6 | S12.6.1 — Commission independent review of security-critical claims. | S12.6.2 — Record raw report, limitations, exceptions and acceptance decision. |
| 12.7 | S12.7.1 — Maintain required regression suite and affected-test mapping. | S12.7.2 — Verify exact-ref CI run and skip/failure policy. |
| 12.8 | S12.8.1 — Assemble release-candidate evidence and blocker disposition. | S12.8.2 — Independently verify no critical/high unresolved and all mandatory gates. |
| 13.1 | S13.1.1 — Pin toolchains/dependencies and define provenance/checksum outputs. | S13.1.2 — Rebuild cleanly and compare artifacts/provenance. |
| 13.2 | S13.2.1 — Package each declared OS/architecture and inventory contents. | S13.2.2 — Verify clean installation and runtime with exact hashes. |
| 13.3 | S13.3.1 — Establish protected platform signing identities/process. | S13.3.2 — Verify final signatures/identity and key-handling evidence. |
| 13.4 | S13.4.1 — Implement signed update policy, compatibility and rollback. | S13.4.2 — Test tamper/replay/rollback/interruption and verified recovery. |
| 13.5 | S13.5.1 — Generate SBOM and complete vulnerability/license/CI review. | S13.5.2 — Verify artifact provenance, secrets scans and approved exceptions. |
| 13.6 | S13.6.1 — Write install/update/recovery/privacy/security/support documentation. | S13.6.2 — Validate instructions and claims against released artifacts. |
| 13.7 | S13.7.1 — Collect platform artifact/install/update/security acceptance evidence. | S13.7.2 — Approve Gate G and publish only under separate release authorization. |

## Separate branding acceptance checklist

- [ ] AETHER has an original name presentation, logo, icon family, colors and
  browser interface with documented provenance; not a Chrome/Google or other
  browser identity copy.
- [ ] AETHER product identity remains distinct from PARMAR; PARMAR appears only
  in an authorized integration/context.
- [ ] Original canonical PARMAR emblem is used byte-for-byte, aspect-fit and
  never redrawn, reshaped, recolored, cropped, distorted, or substituted.
- [ ] Verify source and every packaged PARMAR asset against the repository
  digest `d2327d8b5853a4c9dd5e43b8a776c3f91a962276b37cd1c8e136cab7db81c98d`.
- [ ] VOKKI is labeled as an optional PARMAR assistant, never browser identity;
  actual mic activation is explicit and visible; no silent camera recording.
- [ ] No fake partner branding, misleading attribution, fake AI, or decorative
  control that implies a feature exists.
- [ ] Branding reviewed on actual desktop/mobile artifacts and screenshots.

## Aggregate roadmap inventory

Counted from the numbered stage headings, phase rows before the slice index,
and unique slice IDs in the index: **14 stages**, **85 phases**, **170
engineering slices** (2 per phase). Status/evidence are tracked separately in
the [completion ledger](./AETHER-COMPLETION-LEDGER.md).
