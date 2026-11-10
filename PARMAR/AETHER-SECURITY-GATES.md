# AETHER Security Architecture and Release Gates

**Policy:** remote browsing is disabled until all security prerequisites pass
and a separate explicit authorization is recorded. The constant in
`PARMAR/desktop/security.cjs` is `REMOTE_BROWSING_ENABLED = false`; this
roadmap task did not alter it. No workflow was dispatched.

**Current security decision: NO-GO for production approval and remote
browsing.** `PARMAR/desktop/ADMISSION-FREEZE-ARCHITECTURE.md` (Phase 2R.4)
and `ADMISSION-CONTROLLER-FEASIBILITY.md` (Phase 2R.5) are feasibility/
architecture evidence, not implementation. They identify no cgroup
containment/admission barrier, a race/authority problem around writer
descriptors and process migration, no independent observer/durable
evidence/ACK, and no approved production systemd architecture. Process-group
termination, a namespace probe, navigation policy, mock or passing unit test
cannot bypass this NO-GO. See the [completion ledger](./AETHER-COMPLETION-LEDGER.md)
and [master roadmap](./AETHER-MASTER-ROADMAP.md).

## Threat model scope to complete and review

| Threat/asset | Required attacker capability considered | Required control and evidence before acceptance |
|---|---|---|
| Malicious website / navigation abuse | Malformed URL, redirect/scheme tricks, content exploiting browser engine | Strict URL/scheme/origin policy, safe local errors, engine sandbox and egress enforcement; runtime redirect/cancel/adversarial tests. |
| Renderer compromise | Script execution and full renderer control | No privileged APIs; isolated context; narrow validated preload/IPC; per-tab process boundary as appropriate; exploit simulation and actual packaged process inspection. |
| IPC abuse | Forged sender, stale frame, malformed/replayed messages | Sender/frame/origin and payload validation, authorization on main side, correlation/replay protection; forged IPC tests in live runtime. |
| Browser-child compromise | Child/descendant forks, migrates, signals, races shutdown, tries network/files | Separate identity and enforceable process/network/FS policy; no inherited writers/authority; native descendant/migration/re-admission/shutdown-race tests. |
| Network service / main process | Direct network/UDP/DNS/IPv6/proxy attempts outside renderer | OS-level egress policy covering every process; tests independently originate traffic from renderer, network service, main, child and descendants. |
| Malicious download | Path traversal, overwrite, deceptive file, content execution, interrupted transfer | User approval, safe destination, no auto-open/execute, dangerous-file warning, cancellation and recovery; packaged controlled payload tests. |
| Local file/secret access | Renderer, child, PARMAR integration or diagnostics seeks local files, cookies, tokens, passwords | Least-privilege identity, narrow file mediation, credential isolation, strict redaction; filesystem/secret-canary tests. |
| Profile/private leakage | Cross-profile reads, private data persistence, crash/restart residue | Separate contexts/stores, ephemeral cleanup and explicit restore exclusions; independent on-disk inspection after close/crash/kill. |
| Permission abuse | Website, extension or AI requests sensitive capability | Deny by default, visible action-specific human consent, origin scope, revocation; live permission bypass/revocation tests. |
| Update compromise | Tampered/replayed/rollback/untrusted payload | Signed update metadata and payload, protected key, version/rollback policy; tamper/replay/interruption tests and artifact verification. |
| Supply-chain compromise | Dependency, build runner, workflow token or artifact tampering | Locked/audited dependencies, least-privilege CI, SBOM, provenance and secrets scanning; release-specific evidence. |
| DoS/crash/recovery | Resource exhaustion, corrupt state, repeated crash, low storage | Resource caps, surfaced errors, recovery without false success/data corruption; fault injection and measured resource tests. |
| Search/provider data flow | Search query, suggestion text, location or history disclosed to a provider without user understanding | Provider-neutral data-flow contract, clear provider/category selection, separately disclosed suggestions, minimal query data, retention controls, safe failure and independent network evidence. No provider is selected or authorized here. |
| AI/research provenance | Page/history/private data sent to AI without consent; generated claims mistaken for source evidence; fabricated citations | Explicit scoped disclosure/approval, no secret/private context, provenance labels, source-linked claims, citation validation, limitations and adversarial fabricated/missing-source tests. |
| Extensions (if ever proposed) | Untrusted extension permissions/code, cross-origin access | Excluded by default; separate threat model, store/source provenance, permission review, isolation and uninstall/data cleanup before any implementation. |
| PARMAR/VOKKI / human boundary | Forged/unauthorized assistant request, unavailable peer, coercive/hidden recording | Optional authenticated narrow interface, AETHER-side checks and explicit human approval; mic indicator/cancel; no silent camera capture. |
| Host authority | Root/systemd/kernel can alter cgroups, move processes, affect storage | Declare exact trust boundary; do not claim protection against actors design cannot constrain. If root is in scope, preserve NO-GO. |

Threat-model deliverable must identify data assets, attacker powers, trust
assumptions, impacts, controls, residual risks, acceptance owner and tests for
desktop/Linux/Windows/macOS/Android/iOS. Any platform-specific exception must
be explicit rather than implied by a shared product claim.

## Trust boundaries and invariants

Required boundary map: desktop control/main process; browser renderer; preload;
browser engine and network service; all child/descendant processes; profile
storage and secrets; downloads; operating system identity/sandbox; platform
permission services; PARMAR API/IPC; VOKKI assistant; human approval. Android
and iOS require their own diagrams, not a copied Electron diagram.

Measurable invariants to turn into tests:

1. **Least privilege:** renderer/child have no cgroup writer, privileged
   capability, broad local-file grant, or authority to signal lifecycle
   services. Verify effective credentials, capabilities, open descriptors,
   inherited handles, filesystem access and child tree on each supported OS.
2. **Network containment:** every in-scope process, including network service,
   main and descendants, is denied remote egress until approved. Test IPv4,
   IPv6, DNS, UDP/QUIC, proxy, loopback and direct socket paths as threat model
   requires. App-level navigation blocking is not OS containment.
3. **IPC:** every privileged request validates exact sender/frame, schema,
   origin, size, state and authorization; malformed, forged, replayed and
   stale requests fail closed and produce redacted evidence.
4. **Permissions:** default deny; never silently grant. Grants are scoped,
   visible, revocable and tested after restart. AI cannot grant or waive them.
5. **Downloads and files:** explicit approval/destination, normalized safe
   paths, no implicit execute/open, safe failure/cancel/recovery.
6. **Profile/private:** each persistent profile is separated and deletable;
   private data is never restored or made persistent after close/crash/kill.
7. **Secrets and diagnostics:** credentials/tokens/cookies/private content are
   excluded from logs/support exports/AI context unless separately reviewed
   and explicitly scoped; never place secrets in test evidence.
8. **Deletion:** UI wording matches actual data class and verified deletion
   behavior; do not promise secure erasure where flash/filesystem limits make
   it unprovable.
9. **Crash and shutdown:** no success-shaped fallback, no unobserved live
   descendant, no unsafe automatic re-admission; recovery is visible and
   evidence durable before any containment claim.
10. **Updates:** verify signed identity, version and rollback policy before
    install; interrupted update retains a recoverable verified version.

## Search, AI and research privacy requirements

- Search is an ordinary browser capability and must not require AI. AI being
  disabled, unavailable or offline must not disable URL navigation or ordinary
  search once those browser flows separately pass their security gates.
- A user action to search does not consent to silently send keystrokes as
  suggestions, browsing history, page contents, identifiers, private-session
  data or unrelated context. Disclose what leaves the device, its recipient,
  purpose and applicable retention before any external AI processing; obtain
  scoped user approval and support cancellation/revocation. AI consent does
  not authorize network access around Gate D/E, navigation policy or a site
  permission.
- Keep provider selection OPEN until a provider is separately approved. Define
  category coverage, query handling, result provenance and search-history
  controls without provider-specific assumptions. Label sponsored content
  clearly; never make sponsored results appear organic or imply a ranking
  endorsement that is not supported.
- Distinguish generated answers and summaries from retrieved/verified source
  content in the UI and stored research. A citation must resolve to the source
  it claims to support; never invent citations. Mark unverified claims, missing
  or unavailable sources, stale/conflicting results, and source-coverage
  limitations explicitly.
- Research validation is not a model assertion: define and test source identity,
  relevance, freshness, citation-to-claim linkage, and conflict/coverage
  handling. Keep private browsing, credentials, cookies and tokens outside AI
  context by default. No research or AI feature is verified merely because its
  requirements are written here.

## Admission-controller NO-GO register

The existing Phase 2R.4/2R.5 work is a hard blocker, not an implementation
backlog that can be bypassed with a demo setting.

| Question | Existing evidence/current status | Evidence required to change decision |
|---|---|---|
| Is there production cgroup containment/admission freeze? | NO. Existing docs state no AETHER cgroup lifecycle/containment implementation or production systemd unit. | Reviewed design plus native supported-host implementation and independent end-to-end admission tests. |
| Can `populated 0` alone prove no future process admission? | NO. Observation is a point-in-time state; a writer can race afterward. | Enforceably fence every in-scope writer/authority before observation; test attempts to repopulate after freeze. |
| Are writable cgroup descriptors revoked by chmod/path changes? | Not established; existing feasibility document warns not to assume descriptor revocation. | Native experiments for stale, duplicated and fork-inherited descriptors; proof all writers are gone before evidence. |
| Can trusted systemd/root reopen/migrate? | Yes, trusted host authority remains outside app-level guarantee. If root is adversary, unconditional NO-GO. | Explicit threat boundary and tested service ordering; do not claim protection against root/kernel. |
| Is an independent observer and durable record/ACK implemented? | NO. No independent observer, durable cleanup evidence, or ACK protocol in product. | Independent process with read-only observation, durable externally stored record, authenticated ACK, power-loss/shutdown ordering evidence. |
| Does process-group `SIGKILL` prove tree containment? | NO. It does not enforce admission, cgroup membership or durable empty evidence. | Cgroup/native process-tree proofs under fork/migration/crash/shutdown races. |
| Is Linux process separation enough for Windows/macOS/mobile? | NO. | Separate platform threat model and OS-specific containment/runtime evidence. |

If any authority/race cannot be constrained or independently proven under the
accepted adversary model, the design remains **NO-GO**. Keep remote browsing
disabled and limit the product to honest local/offline capabilities. No
theoretical proposal, successful mock, or namespace test overrides the finding.

## Mandatory gates

| Gate | Objective and minimum evidence | Current status | Failure behavior |
|---|---|---|---|
| **A — Offline shell** | Application launches and local features work without claiming remote browsing. Test offline behavior, local storage, permission absence/defaults, no external requests and truthful disabled controls on actual runtimes. | PARTIAL / runtime not fully established. Android contract/shell source exists; desktop source/policy exists. | Do not describe product as a functioning remote browser. Fix local-flow errors or keep feature disabled. |
| **B — Browser engine integration** | Engine exists behind a platform adapter and is isolated/configured; remote access remains disabled. Verify package contents, engine version, process graph, default security settings and no accidental request. | PARTIAL on desktop source; NOT STARTED Android/iOS. | Engine integration does not grant remote browsing. Disable/rollback engine if it emits unapproved traffic. |
| **C — Runtime acceptance** | Actual packaged renderer, preload, IPC, browser child, storage, lifecycle, crash and artifact behavior verified on supported hosts; mandatory tests run without skip. Capture exact artifact hash, environment, commands, logs/screenshots and results. | BLOCKED. Existing workflows have failed preflight/recent required run evidence not successful; historical local reports include skips. | Block Gate D/E; preserve evidence; do not skip/bypass or claim runtime success. |
| **D — Independent containment** | Approved threat model met with enforceable admission/egress control, authority separation, no writable/inherited writer, independent observer, durable empty-state evidence and ACK, tested across adversarial races/failures on each claimed OS. Independent reviewer signs evidence. | **NO-GO** for production; core Linux authority/race/evidence unresolved. | Hard stop. Remote remains false. Do not start remote browsing, production approval or relabel status. |
| **E — Remote browsing authorization** | Only after Gate D and all required security reviews: separate recorded product/security approval, bounded rollout plan and controlled tests. Explicitly authorize any flag change in a distinct task; verify tests/telemetry and rollback. | BLOCKED; `REMOTE_BROWSING_ENABLED=false`. | No implementation prompt changes flag for demo. Preserve deny state and report blocked. |
| **F — Platform acceptance** | Each declared OS builds, installs, launches, passes runtime/security/accessibility/data acceptance on suitable device/host. Record exact OS/hardware/engine/artifact. | BLOCKED across desktop matrix; Android device absent; iOS NOT STARTED. | Narrow support matrix; no parity claim. |
| **G — Release acceptance** | Verified artifacts/signatures/install/update/rollback, privacy/accessibility, SBOM/license/provenance, independent security approval, docs/branding and release notes for each platform. | BLOCKED. | No release candidate or publication. Preserve prior trusted release and evidence. |

Dependencies: A precedes B; B precedes C; C and a reviewed security architecture
are prerequisites to D; D precedes E; each shipped platform passes F; all
mandatory feature/security/privacy evidence and F precede G. A limited offline
shell may be delivered without E only if it passes its own truthful offline
acceptance and does not imply remote capability.

## Independent security acceptance protocol

For each claim, retain: threat/invariant ID; independent tester; exact commit
and artifact hashes; OS/kernel/systemd/engine/tool versions; test command and
setup; raw logs/observations; expected/actual result; pass/fail/skip; known
limits; reviewer decision. An implementation-authored test is useful regression
coverage, not automatically independent proof.

Mandatory adversarial cases include:

- Renderer-originated, network-service, main-process and descendant egress;
  IPv4/IPv6, DNS/UDP/QUIC and configured proxies where in scope.
- Child fork while shutdown starts; process migration into/out of launch
  cgroup; entry after observer's empty read; re-admission after freeze.
- Existing, duplicated and inherited writable descriptor attempts; manager,
  controller, observer crash; service restart; shutdown/reboot/power interruption.
- Forged/stale IPC, wrong frame/origin, invalid schema, replay, permission
  denial bypass, download path traversal/overwrite and profile/private leakage.
- Storage clear by category and all, interrupted/corrupt persistence, update
  tampering/replay/rollback, and redaction canaries.

## Workflow authorization boundary

1. **Prepare:** edit/check YAML and scripts; no dispatch.
2. **Review:** inspect diff, permissions, triggers, secrets, runner and artifacts;
   no dispatch.
3. **Authorize:** user separately approves the exact workflow/ref/action.
4. **Run:** dispatch only the approved workflow; record run URL/ID and artifact.
5. **Review result:** inspect all jobs/logs/artifacts, including skipped and
   failed jobs. A successful YAML parse or package job is not runtime acceptance.

No phase authorizes workflow dispatch implicitly. Do not trigger GitHub Actions
during roadmap authoring.
