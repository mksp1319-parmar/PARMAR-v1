# PARMAR Parallel Development Master Plan

**Status:** Active parallel development coordination for AETHER and VOKKI
under PARMAR Core product governance. This plan does not itself authorize
implementation; each work item retains its own scope and acceptance gates.
**Repository baseline:** `main` at
`69527f6b39d0521746eb91cd96b5fa44fc48348c`.
**Scope:** AETHER and VOKKI are independent workstreams under PARMAR Core
governance. Core contracts and services are shared runtime dependencies only
where explicitly approved and verified.
**Safety invariant:** `REMOTE_BROWSING_ENABLED=false` remains unchanged.
**Evidence rule:** Source and test files establish existence, not successful
runtime behavior, production readiness, or security acceptance. No tests,
builds, workflows, or source changes were performed during initial plan
authoring; current-cycle implementation and targeted test evidence is recorded
in §2.5 below.

## 1. Executive coordination decision

The active AETHER and VOKKI tracks proceed in parallel under PARMAR Core
governance, with separate product boundaries and security gates. Continue
evidence collection, local/offline readiness work, and independently testable
product work that does not cross an unapproved authority boundary. Do not
start cross-product integration, enable external services, or make release
claims until the dependency gates in this plan pass.

Three constraints govern the plan:

1. **AETHER remains independent.** Its browser work does not depend on VOKKI,
   VOKKI identity, PARMAR account availability, or provider availability.
   Remote browsing is disabled and the existing desktop security decision is
   NO-GO. Do not weaken, bypass, or edit the deny setting as part of these
   workstreams.
2. **VOKKI remains governed by PARMAR.** VOKKI is a presentation and input
   surface, not an authority, permission issuer, executor, or source of
   independent verification.
3. **PARMAR Core is a target architecture, not a verified shared service.**
   Some related code exists, but identity, authorization, policy, approval,
   execution, independent verification, audit, and release authority are not
   established as a complete production service set.

### Decision reconciliation status

The user supplied the approved D-01–D-13 directions and confirmed
**Dedicated Workspace + PARMAR-wide Presence**. The decisions are now mapped
in [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md) §11. The source establishes
approved product direction, not implementation, technical/vendor selection,
security acceptance, or production readiness.

**Task 23 documentation integration is VERIFIED.** This review checked that
the PRD and this plan consistently record all 13 approved directions and
Dedicated Workspace + PARMAR-wide Presence. No separate repository
acceptance artifact was found. This is documentation traceability only; it
does not establish implementation, technical selection, security acceptance,
or release readiness.

## 2. Current state and evidence

### 2.1 Repository snapshot and evidence limitations

- Current branch and commit: `main` /
  `69527f6b39d0521746eb91cd96b5fa44fc48348c`.
- Two pre-existing untracked VOKKI documents were present before this plan:
  `PARMAR/VOKKI-MASTER-PRD.md` and
  `PARMAR/VOKKI-PART13-PRIVACY-SECURITY-GOVERNANCE-REPORT.md`. Preserve both.
- The VOKKI PRD records this same branch/commit as its baseline. Its status
  statements and Part 13 source inventory are still documentary evidence, not
  runtime validation.
- The AETHER completion ledger records a different earlier commit and
  historical worktree. Its test totals and platform findings must not be
  represented as current-HEAD test results.
- No separate authoritative Task 23 acceptance artifact was found. The
  approved directions are user-supplied and their documentation integration
  is verified in this review; no implementation or release acceptance is
  inferred.
- No tests, builds, workflows, or runtime checks were run for this plan.

### 2.2 Workstream A — AETHER

**Desktop architecture, isolation, and security**

- Electron desktop source exists for the shell, browser UI, navigation
  decisions, tabs, storage, profiles, downloads, permissions, preload/IPC,
  child supervision, admission records, and isolation probes.
- This is a prototype/source inventory, not acceptance of a packaged browser.
  The AETHER completion ledger marks desktop runtime acceptance BLOCKED;
  actual packaged UI, renderer, IPC, browser child, storage lifecycle, and
  platform behavior are not established on the current ref.
- [AETHER-SECURITY-GATES.md](./AETHER-SECURITY-GATES.md) records a **NO-GO**
  for production approval and remote browsing. Admission-freeze feasibility
  identifies unresolved authority/race, writer-descriptor, independent
  observer, durable evidence/ACK, and host-service architecture issues.
- [desktop/ISOLATION-READINESS.md](./desktop/ISOLATION-READINESS.md) contains
  historical package and test evidence. Reports include skipped runtime
  tests, missing runtime/display prerequisites, and different historical
  suite totals. None is fresh current-HEAD runtime acceptance.
- `REMOTE_BROWSING_ENABLED=false` is a mandatory invariant. UI/navigation
  work may only improve truthful local/disabled behavior until the full
  independent security and authorization gates pass.

**Browser UI and core flows**

- Desktop UI and browser handlers exist, but the ledger marks the overall
  shell and many browser journeys PARTIAL. Navigation is BLOCKED; profile,
  permission, private-session, deletion, and real download behaviors need
  runtime and data-lifecycle evidence.
- The platform matrix describes general search as PARTIAL on desktop because
  the endpoint is denied, and browser search/navigation as NOT STARTED on
  Android and iOS. A visible control or URL parser is not an end-to-end
  browser feature.

**Android offline browser**

- Android has a native Compose local/offline shell and SQLite-based tab and
  bookmark foundations. History and downloads are honest empty/incomplete
  surfaces; no Android browser engine or remote browsing path is established.
- [AETHER-MOBILE-OFFLINE-CONTRACT.md](./AETHER-MOBILE-OFFLINE-CONTRACT.md)
  requires no network requests, browser engine, external handoff, or
  permission for the first offline milestone. Preserve this boundary.
- Existing JVM test reports (26 tests, zero failures/skips, dated 2026-11-07)
  are historical; no fresh build or device acceptance is established by this
  plan. The ledger reports Android device acceptance BLOCKED.

**AETHER release readiness**

- The [AETHER completion ledger](./AETHER-COMPLETION-LEDGER.md) classifies
  desktop runtime, Android device, full feature flows, independent security,
  and release acceptance as BLOCKED, PARTIAL, or NOT STARTED. It explicitly
  says phase acceptances are not complete merely because source or historical
  tests exist.
- iOS has a planning document only; it is NOT STARTED.
- Platform support must be declared narrowly and proven independently per
  platform. No cross-platform parity or production-ready claim is permitted.

### 2.3 Workstream B — VOKKI

**PRD and decisions**

- [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md) is a draft for review, not an
  implementation authorization. It records Dedicated Workspace +
  PARMAR-wide Presence and maps the user-approved D-01–D-13 product
  directions. Task 23 documentation integration is **VERIFIED**; the mapped
  product directions do not approve implementation details or release.
- The PRD says Parts 1–7 detailed reports are unavailable. Part 13 is a
  source-and-test inventory only; it says no tests/builds/runtime/production
  checks were executed for that assessment.
- Dedicated Workspace + PARMAR-wide Presence is an approved product
direction; this does not imply listening, background execution, or an
always-on provider connection. Provider, action, account, persistent data,
offline, platform implementation and production work remains gated on
technical decisions and evidence.

**Web implementation and repository gaps**

- A VOKKI web surface exists under `PARMAR/interface/static/`, with UI,
  identity, speech, avatar-presentation, and state modules. This is not a
  complete production account or digital-human client.
- PARMAR contains chat/provider orchestration, response-safety, session,
  conversation, memory, research, approval, and decision-log code and
  corresponding test sources. Part 13 marks those tests PRESENT / NOT RUN for
  its assessment; do not claim they pass from their existence.
- Current behavior is mixed: source-level controls and local flows exist,
  while production identity/deployment, all-route authorization, external
  per-user consent, encrypted data/key lifecycle, complete deletion/export,
  operational audit, and production acceptance are unverified or absent.
- Android's VOKKI surface is informational inside the AETHER offline shell;
  iOS VOKKI is NOT STARTED. Neither is evidence of a native VOKKI client.

**Capabilities and limits**

- **AI:** provider adapters and PARMAR response-release code exist. Local
  Demo is deterministic, not a local model. Provider configuration is not
  per-user consent, and a production inference deployment was not verified.
- **Memory:** owner-scoped records and retrieval consent exist in source.
  Revocation stops subsequent retrieval but does not itself delete stored
  rows; export, account-wide deletion, backup expiry, and encryption/key
  lifecycle remain gaps.
- **Voice/media:** browser speech and explicit camera-still flows exist in
  source. Runtime/device behavior is unverified. Camera stills can remain in
  IndexedDB after a scope change; lifecycle cleanup needs a decision and
  acceptance. Wake-word/background listening is not established.
- **Digital human:** the web surface uses a static portrait/presentation
  treatment. No selected renderer, rig, quality tier, asset licensing
  evidence, or device-performance acceptance is established.
- **Offline/customization:** no VOKKI offline inference, encrypted queue,
  cross-device sync, or local model runtime is verified. Appearance and
  environment customization remain decision-gated; do not claim them
  complete.
- **Actions:** the current approval continuation resumes provider generation;
  Part 13 does not establish a general-purpose connector executor or
  independently verified action outcome.

**Privacy/security blockers**

- Part 13 finding P13-01 is CRITICAL: production identity and route
  authorization are not established. P13-03 identifies missing per-user
  provider consent before egress. Other open/high findings cover data
  lifecycle, camera retention, secrets/encryption, action authority, audit,
  and unrun tests/production verification.
- Production exposure, external provider egress, and real connector execution
  remain blocked pending approved architecture and evidence. A UI decision,
  mock, or test source is not an approval or security proof.

### 2.4 PARMAR Core — existing code versus required authority

The VOKKI PRD §5.2–5.4 describes intended responsibility boundaries. Current
source offers partial building blocks; it does **not** establish the following
as complete, production-ready, shared services:

| Core boundary | Existing evidence | Required boundary and current status |
|---|---|---|
| Identity and account ownership | Server-created/local principals, optional sessions, owner-scoped stores | Verified production identity, account/workspace lifecycle, route authorization, ownership and recovery remain unestablished. |
| Permissions and consent | Provider allowlists, memory consent, browser/device permission UX | Separate scoped, purpose-bound, revocable records for data use and each capability; provider consent must be per user/request, not server configuration alone. |
| Policy and approval | Request analysis, risk/enforcement states, approval records | PARMAR policy remains authoritative; approval is bound to an exact action, parameters, user/session, scope, expiry and nonce. An approval does not execute. |
| Authorized execution | Provider-call orchestration exists; no general action executor verified | A distinct, least-privilege executor accepts only policy-authorized, approved, bounded parameters; it must not be callable directly by VOKKI or a model. |
| Independent verification | Response-release checks exist | A verifier independent of the provider/executor checks authorized evidence for the specific outcome. Provider repetition or executor self-report is insufficient. |
| Audit | Sanitized local decision/response logs exist | Complete, redacted, access-controlled and tamper-evident lifecycle records, failure policy, retention, monitoring, and recovery are not established. |
| Release authority | PRD defines separate gates | Named product/security/platform approvers and evidence-backed release authority must be assigned; a service or agent cannot self-certify its release. |

Until implemented and independently accepted, these are architecture
requirements and blockers—not capabilities to reuse by assumption.

### 2.5 Current-cycle implementation evidence — 2026-11-11

The bounded implementation cycle made one VOKKI presentation/navigation
change and one independent AETHER download-safety change. These do not resolve
production, runtime, privacy or security gates.

**VOKKI**

- `interface/static/index.html` retains the dedicated `data-section="voki"`
  workspace and permanent sidebar/mobile navigation, now labels the dedicated
  surface as the VOKKI workspace, and adds a globally available floating
  launcher in the PARMAR shell.
- The launcher enters the existing workspace through standard section
  navigation. It mirrors only lifecycle state already returned to the VOKKI
  interface. It does not submit a request, access microphone/camera, perform
  speech, persist new data, or invoke an action.
- `interface/static/app.js`, `voki-interface.js`, `premium.css`, and
  `tests/test_voki_interface.js` own the navigation, lifecycle, accessible
  presentation, responsive layout and regression behavior.
- `node --test PARMAR/tests/test_voki_interface.js
  PARMAR/tests/test_workspace_panels.js` — **79 passed, 0 failed, 0 skipped**.
  This is source-level/test-run evidence; no browser accessibility audit or
  packaged/web runtime acceptance was performed.

**AETHER**

- `desktop/download-utils.cjs` removes bidirectional format controls from
  suggested download filenames and rejects records containing such controls;
  ordinary Unicode names remain permitted.
- Focused test `cd PARMAR/desktop && node --test
  test/download-utils.test.cjs` — **2 passed, 0 failed, 0 skipped**.
- `git diff --check` passed. No AETHER package/runtime, download UI, device,
  isolation, or production verification was performed. The change does not
  alter `REMOTE_BROWSING_ENABLED=false` or any AETHER gate.

**Shared contracts:** none changed. No AETHER↔VOKKI runtime integration was
added; both products remain independently operable.

## 3. AETHER milestones

All milestones below are proposed and unstarted. Each needs a separately
authorized implementation task. No milestone permits changing
`REMOTE_BROWSING_ENABLED=false`.

| ID | Milestone | Bounded work | Independent exit evidence |
|---|---|---|---|
| A0 | Preserve and baseline | Record exact ref, tracked/untracked state, existing docs/findings, supported platform claims, and test evidence by age/ref. Do not rewrite prior reports or overwrite user changes. | Reviewed inventory and preservation checklist; no source or existing requirement documents altered by this planning task. |
| A1 | Desktop local shell/runtime | Make local shell, navigation-denied/error states, tabs and controls truthful and functional without enabling remote access. Address runtime availability only through approved environment setup. | Exact-ref package/runtime launch, UI and lifecycle evidence; required probes run with no unexplained skips; no external request; retained artifact hash/logs. |
| A2 | Android offline-shell acceptance | Reconcile existing Compose/SQLite implementation with the offline contract; verify local tabs/bookmarks/settings and truthful empty history/downloads. Do not add a browser engine, networking, or permissions in this milestone. | Fresh pinned build/unit evidence, merged-manifest/config inspection, device/emulator lifecycle and accessibility evidence, observed zero external requests, exact artifact/ref. |
| A3 | Desktop data and control flows | Close bounded local-flow gaps in tabs, bookmarks/history, profiles, permissions, download handling, deletion, and recovery; assign one feature at a time after A1. | Per-flow runtime, persistence, adversarial and data-lifecycle evidence on declared desktop OS; accurate UI states and error handling. |
| A4 | Independent isolation architecture review | Reassess the existing admission/containment NO-GO against an explicit threat model, platform actors, evidence requirements, authority races, and independent observer model. This is a decision/evidence milestone, not permission to implement a workaround. | Independent written GO/NO-GO with residual risks, native test plan and named acceptance authority. If unresolved, retain NO-GO and disabled browsing. |
| A5 | Remote browser proposal (conditional) | Only after A4 GO, desktop runtime acceptance, platform threat review, Gate D evidence, and separate explicit product/security authorization, prepare a bounded remote-navigation change. | Separate approval, native OS-level egress evidence, adversarial tests and independent release sign-off. Otherwise remain blocked; never flip the flag for a demo. |
| A6 | Platform declaration and release | Declare only platforms/features with actual package, runtime, security, accessibility, data, update and recovery evidence. Keep iOS planning-only until separately staffed and approved. | Per-platform Gate F/G evidence and signed release decision; no parity inference. |

## 4. VOKKI milestones

Each milestone is separately tracked and may not override an unresolved
decision. A feature stays disabled or out of scope until its own prerequisites
are accepted.

| ID | Milestone | Bounded work | Independent exit evidence |
|---|---|---|---|
| V0 | Verify decision documentation | Compare all 13 approved directions and Dedicated Workspace + PARMAR-wide Presence across the PRD and this plan; preserve the distinction between product direction and implementation/release approval. Status: VERIFIED in this review. | PRD §11 and this plan's D-01–D-13 register agree; PARMAR Core governance and both workstream boundaries are explicit. Technical decisions and release gates remain open. |
| V1 | Web and repo baseline | Map UI/API/source behavior to each approved PRD capability; separate IMPLEMENTED, PARTIAL, SIMULATED, DOCUMENTED ONLY, MISSING and UNVERIFIED. Identify exact route, data-store, test and UI owners. | Evidence-linked capability matrix; no test execution claim; approved web-first product direction, with web implementation scope still bounded by security gates. |
| V2 | Production identity and route perimeter | Select identity/recovery/tenant model and deployment perimeter; inventory every route/method; close P13-01/02 with server-side identity and route authorization. Keep demo explicitly separate. | Two-user/two-workspace access matrix across protected data/actions; fail-closed deployment, session/revocation and CSRF/origin evidence; independent review. |
| V3 | Consent and data lifecycle | Approve data classes, provider consent, memory revocation, camera-still retention, deletion/export/account closure, backups, encryption/keys, and provider deletion limits. Implement only explicitly approved scopes. | Data-flow/retention map; per-user consent/revocation and zero-future-egress evidence; verified deletion/export/restore/key evidence; truthful UI. |
| V4 | Governed conversation and provider egress | Keep provider behavior behind PARMAR. Establish approved provider, context minimization, transport, limits, cancellation, no silent fallback and response release; retain Local Demo labeling. | Fake transport and negative egress tests; approved real test deployment only after V2–V3 and TLS/security gates; request/response provenance and release evidence. |
| V5 | Memory, research and files | Deliver one data class/capability at a time with owner isolation, provenance, source validation, prompt-injection boundaries and lifecycle controls. | Per-capability authorization, consent, isolation, deletion, adversarial, recovery and quality-evaluation evidence; no unsupported “verified” claims. |
| V6 | Voice, camera and media | Resolve voice modes/languages/locality, stop/cancel behavior, transcript/audio retention, camera-still cleanup and platform scope. Keep wake-word/background use disabled unless separately approved. | Browser/device permission, indicator, audio/video egress/storage, cancellation, profile/logout cleanup and accessibility evidence. |
| V7 | Digital-human and customization | Evaluate renderer/quality tiers, asset rights, canonical identity/reset, user controls, uploaded asset scope, reduced-motion and fallback. | Product approval, asset/license provenance, stable identity, accessibility and named-device performance measurements. No renderer/tier claim before evidence. |
| V8 | Offline/hybrid and sync | Decide whether offline means cached UI, local persistence, local inference, queued requests, or sync; define keys, retention, conflict, revocation and no-replay semantics. | Separate architecture and threat review, licensed runtime/model evaluation, device benchmarks, network/queue adversarial tests and explicit release approval. Until then, no offline AI/sync claim. |
| V9 | Task/action authority | Define action categories, approval binding, expiry/replay rules, executor, independent verifier, cancellation/unknown outcome, durable task state, audit and emergency stop. | Action-specific threat model and end-to-end denial/approval/execution/independent-state verification; no general side-effecting execution before acceptance. |
| V10 | Platform and release acceptance | Web-first is an approved product direction; Android/iOS/Desktop are future independent clients with separate scope. Validate operations, accessibility, reliability, supply-chain and release ownership. | Exact deployed artifact, route and data-flow evidence, executed test suite records, independent security review and signed per-platform release approval. |

### VOKKI D-01–D-13 approved-direction register

The table records the user's approved product directions. Technical
implementation, vendor selection and security/release acceptance remain
separate gates; the PRD §11 retains the full dependency and safe-state map.

| Decision | Approved direction | Still gated |
|---|---|---|
| D-01 | Web-first; Desktop/Android/iOS are future independently gated platforms. | Each future platform's support and release evidence. |
| D-02 | Independent PARMAR accounts, optional secure login linking, personal/multiple-profile/family-team modes with strict isolation. | Identity provider/recovery, roles, implementation and isolation proof. |
| D-03 | Hybrid local/external AI, task-appropriate routing, explicit consent before external transfer, no silent fallback. | Specific models/providers, retention, cost and egress implementation. |
| D-04 | Automatic memory with user review/edit/delete/export/reset controls. | Consent semantics, categories, retention/deletion, key/backup/sync lifecycle; no implied model training. |
| D-05 | Camera understanding only with explicit permission and user-initiated capture; no hidden/background recording. | Processing, storage/retention and per-platform acceptance. |
| D-06 | Full multilingual voice direction, initial push-to-talk; wake-word/background listening requires separate approval/security gates. | Language/platform matrix, processing, retention and tested adapters. |
| D-07 | Preserve high-quality 3D, photorealistic-premium and cinematic directions. | Renderer, asset rights, hardware and quality-tier selection. |
| D-08 | Guide/Execute/Orchestrate under PARMAR Core governance, authorization, approval and verification. | Action categories, executor, verifier, audit and stop controls. |
| D-09 | Hybrid online/offline, local AI where supported, offline drafts and controlled sync; never automatically replay queued side-effecting actions. | Runtime, keys, conflict/recovery, security and sync implementation. |
| D-10 | WCAG 2.2 AA target, multilingual support and measurable platform-specific quality standards. | Locale matrix, metrics, conformance evidence and release thresholds. |
| D-11 | Research with source links/evidence, conflict disclosure, uncertainty and independent verification. | Evaluator, claim domains, labeled evidence and tested thresholds. |
| D-12 | PARMAR-managed independent local-AI infrastructure and evaluated external models. | Specific runtime/model/vendor, licensing, hardware, supply-chain and update owner. |
| D-13 | Full user-controlled VOKKI environment/appearance customization preserving canonical identity, voice and personality; uploaded assets require rights, safety and consent checks. | Asset-ingest/storage controls, platform implementation and separately gated situation-based suggestions. |

Task 23 documentation integration is **VERIFIED** in this review. The user's
approved directions are the source for this register; verification does not
establish implementation, security acceptance, or release readiness.

## 5. PARMAR Core dependencies and architectural boundaries

PARMAR Core should expose narrow, versioned contracts. AETHER and VOKKI must
not share direct database access, implicit identity, model authority, or
unreviewed cross-product calls.

1. **Identity/account ownership:** resolve a verified server-side principal,
   account/workspace, session and revocation state. Ignore caller-supplied
   identity/role/owner fields. AETHER browser-local profiles remain separate
   unless separately approved; VOKKI identity must not grant AETHER browsing
   authority.
2. **Permissions and consent:** distinguish identity authentication,
   resource authorization, capability permission, and data-processing
   consent. Bind each to principal, purpose, data/capability, recipient,
   scope, expiry and revocation. Check immediately before use/egress.
3. **Policy and approval:** PARMAR policy evaluates request and risk;
   approval is explicit, exact-action-bound, replay resistant, expiring and
   revocable. User intent, VOKKI text, provider output, and approval UI alone
   do not grant permission or prove completion.
4. **Authorized execution:** a separate executor receives only approved
   parameters after rechecking identity, policy, permission, consent and
   approval. It is least privilege, idempotent where possible, and reports
   bounded outcomes. Models/UI cannot invoke it directly.
5. **Independent verification:** a separately authorized verifier obtains
   independent evidence appropriate to the action and returns verified,
   failed, or unknown. Executor self-report/provider repetition is not
   independent evidence.
6. **Audit:** record bounded, correlated, redacted lifecycle metadata for
   identity, consent, policy, approval, execution, verification, release and
   denial. Define access, tamper evidence, retention, deletion, outages,
   monitoring and recovery. Do not log secrets or unapproved content.
7. **Release authority:** named product owner approves scope; security/privacy
   reviewers accept controls; platform owner accepts runtime/device evidence;
   release authority signs exact ref/artifact and residual risks. These roles
   are independent from implementation agents.

**Core delivery dependency:** first approve the contract and threat model;
then implement identity/route authorization and consent boundaries; then
policy/approval; then executor/verifier/audit only for approved action
categories; finally release authority. Do not create a broad “Core” service
that silently changes the authority of existing systems.

## 6. Parallel agent allocation and file ownership

These are proposed roles for later, explicitly authorized implementation.
During this planning task no agents or implementation tasks are started.

| Role | Bounded responsibility | Exclusive file ownership |
|---|---|---|
| AETHER desktop owner | A1/A3 desktop local shell and browser-flow work while remote access is denied. | `PARMAR/desktop/**`; AETHER desktop tests. No edits to VOKKI, PARMAR account services, or `REMOTE_BROWSING_ENABLED` value. |
| AETHER Android owner | A2 Android offline shell, local persistence, manifest and device acceptance. | `PARMAR/android/**`; Android tests/contracts owned by that stream. No VOKKI service integration or networking changes. |
| AETHER security architect | A4 threat model, admission-feasibility review, independent evidence plan and gate decision. | AETHER security/architecture documents and review evidence, one designated document owner. Read-only on implementation while assessing. |
| VOKKI product decision steward | V0 decision provenance, PRD traceability and approved scope. | `PARMAR/VOKKI-MASTER-PRD.md` and this plan's D-01–D-13 register. No source implementation. |
| VOKKI web owner | V1 and approved UI-only VOKKI work. | `PARMAR/interface/static/**` and specifically assigned VOKKI UI tests. No shared API, session, approval or policy changes. |
| PARMAR identity/data owner | V2/V3 principal, session, route, consent and data lifecycle contracts/services. | Exclusively assigned server modules per task (e.g. `sessions.py`, `conversations.py`, `memories.py`, `interface/futuristic_app.py`); never split a shared file between concurrent agents. |
| PARMAR governance/action owner | V4/V9 policy, approval, authorized execution, verification and audit contracts. | Exclusively assigned `PARMAR/chat/**`, `interface/approvals.py`, audit/execution modules per task; no overlapping edits with identity/data owner. |
| Independent verifier/security reviewer | Reviews threat models, negative tests, runtime evidence, data flows and release evidence; does not implement the control it accepts. | Read-only on workstream source; produces review findings in a separately assigned evidence location. |
| Integration/release coordinator | Maintains dependency map, contract versions, merge order, test evidence ledger and release approval packet. | Integration-only tests/manifests and plan/status records assigned to coordinator; no concurrent edits to domain-owned files. |

### File collision and coordination rules

- Every task names one accountable owner and exact paths before work starts.
- No two agents edit the same file concurrently. Shared server files have one
  temporary owner per task; other agents submit changes as separate patches
  for sequential integration.
- PRD/decision documents are product-steward owned. AETHER security gate and
  deny-state changes require AETHER security/release authorization; no agent
  may “clean up” old findings or overwrite historical evidence.
- Web UI, backend identity, PARMAR policy, AETHER desktop, and Android remain
  separate ownership zones. Cross-zone changes require a contract proposal
  and integration coordinator approval first.
- Keep each milestone small enough for its own diff, test selection, security
  review, rollback and evidence record. Merge only after its owner and
  independent reviewer accept it.

## 7. Integration sequence and conditions

### Safe parallel work before integration

These activities can proceed independently once separately authorized:

- AETHER desktop local shell/runtime and Android offline-shell work, each
  preserving their platform boundary and remote browsing denial.
- Bounded VOKKI work consistent with the approved PRD and PARMAR Core contracts.
- PARMAR Core identity/consent/API threat-model and contract design.
- Independent security review of existing AETHER and VOKKI evidence.
- Separate test-fixture design using fake/local dependencies; no shared
  production secrets, network access, or side effects.

### Shared dependencies and blockers

- VOKKI production identity and every-route authorization block production
  data access, provider egress and persistent/action-enabled release.
- Decision D-03 and consent/data-flow controls block provider egress.
- D-04/D-05 and key/backup decisions block memory/media lifecycle claims.
- D-08 plus PARMAR policy, approval, executor, verifier and audit block real
  side effects.
- D-01 and platform-specific runtime/security evidence block platform claims.
- AETHER Gate D is a hard NO-GO blocker to Gate E remote browsing; it is not
  replaced by PARMAR identity, VOKKI consent, or a passing mock/unit test.
- Cross-product identity, permission or API sharing is not a prerequisite for
  AETHER local browsing-shell work and is not authorized by this plan.

### Controlled integration order

Integration becomes permissible only after the applicable prerequisites pass:

1. **Documentation checkpoint:** Task 23's approved directions and
   Dedicated Workspace + PARMAR-wide Presence are traced consistently in the
   PRD and this plan. Resolve the technical choices and obtain separate
   approvals needed for any specific implementation or cross-product
   integration.
2. **Contract checkpoint:** PARMAR Core API/data contracts specify principal,
   tenant, purpose, consent, permissions, policy result, approval binding,
   expiry/revocation, error/failure semantics, audit fields and version
   compatibility. Threat review precedes implementation.
3. **Identity/consent checkpoint:** authentication and route authorization
   pass; consent and data-flow behavior are implemented and tested; provider
   egress stays denied until its independent gate passes.
4. **Policy/approval checkpoint:** all requests are reauthorized by PARMAR;
   VOKKI cannot supply an identity, waive policy, approve itself, or execute.
5. **Isolated contract test:** connect one approved low-risk VOKKI flow to a
   non-production PARMAR endpoint using test identities, fake providers, and
   no real side-effecting executor. Test denial and revocation first.
6. **Independent verification:** security reviewer observes full request,
   data, authorization, denial, audit and release behavior; unresolved
   findings block the integration.
7. **Explicit integration/release approval:** name exact services, routes,
   data classes, platform, artifact/ref, rollout, rollback and accountable
   approvers. Integration of VOKKI with PARMAR does not authorize or change
   AETHER.

Do not integrate by sharing databases, importing private implementation
modules across product boundaries, copying credentials, or using VOKKI/AI
output as a security decision. Prefer versioned service contracts and
platform-specific adapters.

## 8. Independent testing and release gates

These are future gates, not tests run or passed by this plan.

### AETHER gates

1. **A-offline:** truthful local behavior, no external requests, no unexpected
   permissions, and correct empty/disabled states on actual runtimes.
2. **B-engine:** engine/package configuration reviewed while remote access
   remains disabled; no accidental requests.
3. **C-runtime:** packaged UI, renderer, preload/IPC, child lifecycle,
   profile/storage, crash/restart and shutdown verified on exact supported
   hosts/artifacts. Mandatory runtime tests cannot be skipped.
4. **D-containment:** independently reviewed threat model; enforced process
   and network controls, authority/race tests, observer and durable evidence.
   Existing status is **NO-GO**.
5. **E-authorization:** after Gate D only, separate recorded product/security
   approval is required for any remote-browsing change. `REMOTE_BROWSING_ENABLED=false`
   remains mandatory until that separate task authorizes a change.
6. **F-platform:** per-OS build/install/runtime/security/accessibility/data
   acceptance; Android additionally requires device/no-network evidence.
7. **G-release:** signed/provenanced artifacts, update/rollback, privacy,
   accessibility, supply-chain, independent security and release sign-off.

### VOKKI and PARMAR Core gates

- **Identity:** production principal is server-established; route/method
  inventory is complete; unauthorized users/workspaces cannot read/write/
  export/act; logout/revocation invalidates sessions and pending approvals.
- **Consent/egress:** provider/data consent is purpose- and user-scoped;
  denial/revocation is observed as zero future egress; no hidden fallback;
  transport, proxy and provider certificate validation are verified.
- **Data lifecycle:** per-class collection, storage, retention, deletion,
  export, backup/restore, key protection, profile switch and account closure
  match user-facing claims; failures are visible and not success-shaped.
- **Policy/approval:** negative tests cover forged identity, altered action
  parameters, wrong owner, replay, expiry, duplicate approval, provider prompt
  injection, cancellation and unavailable policy.
- **Execution/verification:** no side effect before authorization; executor
  is least-privilege; verifier uses independent evidence; uncertain result is
  reported as unknown, never success.
- **Voice/media:** permissions, indicators, lifecycle stop, cancellation,
  storage/egress and deletion are observed on each claimed device/browser.
- **Digital-human/customization:** asset/license, stable identity/reset,
  disabled unsupported controls, reduced motion, accessibility and device
  performance are separately accepted.
- **Offline/platform:** no local-AI/sync/parity claim without selected runtime,
  licensing, hardware, update ownership, isolation, offline and recovery
  evidence.
- **Audit/release:** logs are minimized/redacted and operationally monitored;
  test and independent review evidence names exact commit/artifact,
  environment, commands, results, skips and limitations; release approvers
  are distinct from implementers.

### Evidence recording

For each gate retain: requirement/decision ID, owner, independent reviewer,
exact commit and artifact hash, platform/tool/runtime versions, test command
and environment, expected and actual result, pass/fail/skip, screenshots or
logs as appropriate, known limitations, and signed acceptance. A test source
or workflow file is not a test result. Historical results remain historical
and must not be combined into a synthetic total.

## 9. Risks, blockers, and unresolved decisions

| Risk / blocker | Consequence | Required resolution |
|---|---|---|
| Approved directions have unresolved technical details | Vendor, identity, privacy, action, runtime and production capabilities remain gated despite product direction approval. | Resolve implementation details per PRD §11; preserve safe states and do not reopen approved product direction without an explicit change. |
| AETHER containment NO-GO | Remote browsing and production approval remain blocked. | Independent A4 review and Gate D evidence; otherwise retain NO-GO. |
| Stale/conflicting historical test totals | False confidence or wrong acceptance claim. | Run exact-ref tests only under a separately authorized future task; document skips and environment. |
| Android device/runtime evidence absent | Cannot establish shipped offline-shell behavior or platform security. | Fresh pinned build/config and device acceptance on approved matrix. |
| Anonymous/demo identity and incomplete route authorization | Production exposure can disclose or mutate protected data. | VOKKI V2 fail-closed identity/authorization before exposure. |
| Provider server configuration is not user consent | Prompts/context may leave without informed per-user authorization. | Consent/data-flow gate and observed denial/revocation before egress. |
| Incomplete deletion, backup and encryption lifecycle | Privacy claims and account closure may be untrue. | Approve and prove data/key/backup lifecycle before persistence release. |
| Approval can be confused with execution | User may be told a side effect occurred when none was independently verified. | Separate executor, verifier, audit and unknown-result semantics before real actions. |
| No local model/verified offline inference | Offline capability can be overstated. | Keep AI offline/sync disabled until D-09/D-12 and V8 pass. |
| Shared-file collisions and product coupling | Concurrent edits can break authority or modify protected AETHER findings. | Enforce ownership table, contracts, sequential merge of shared files and reviewer sign-off. |
| Platform parity pressure | Unsupported or unverified behavior may be advertised. | Gate each client independently; narrow support claims instead of inferring parity. |
| Feature scope expands ahead of gates | Security, privacy and release debt accumulate. | Milestone exit criteria and explicit stop rules; no dependent work advances on failed prerequisites. |

## 10. Stop conditions and immediate next actions

**Stop** any workstream if it needs to weaken a security gate, infer user
consent, bypass PARMAR authorization, broaden an unapproved data flow, claim
runtime completion without evidence, or change AETHER's remote-browsing
setting. Preserve findings and return the blocker for an owner decision.

Recommended order:

1. Maintain the verified D-01–D-13 and workspace/presence traceability; any
   proposed product-decision change requires explicit approval.
2. Assign product, identity/data, policy, AETHER, independent security and
   release owners; approve exact milestone scopes.
3. Continue the bounded VOKKI workspace/presence UI and independent AETHER
   local/offline work without crossing unresolved authority boundaries.
4. Resolve PARMAR Core contracts and VOKKI identity/consent before provider,
   persistence, or action integrations.
5. Keep all integration conditional on the checkpoints and independent gates
   above. Reassess this plan when decisions or evidence materially change.

**Current release posture:** AETHER desktop remote browsing **NO-GO**;
Android offline-shell runtime/device acceptance unverified; VOKKI production
identity/provider/action release **not ready**; PARMAR Core shared authority
services **not assumed complete**.
