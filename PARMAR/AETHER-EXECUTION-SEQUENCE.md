# AETHER Recommended Execution Sequence

This is the order for future focused implementation prompts, not authorization
to modify code, run CI, publish artifacts, or release. The full phase
requirements are in the [master roadmap](./AETHER-MASTER-ROADMAP.md); live
status and evidence are in the [completion ledger](./AETHER-COMPLETION-LEDGER.md).
Complete one prompt at a time and stop at its exit gate.

## Recommended first implementation milestone

**Stage 2 / Phase 2.1 — Desktop runtime acceptance, continuing Phase 3A.3,
with `REMOTE_BROWSING_ENABLED=false`.** First prepare and review the current
uncommitted Linux runtime workflows/tests without dispatching them. Do not edit
the feature or weaken runtime/security preflights. Then ask for authorization
to run the exact named workflow/ref. If the user does not authorize dispatch,
stop after preparation/review and report that Gate C remains BLOCKED.

Why this first: current desktop source and packages have useful unit/package
evidence but no accepted live renderer/preload/IPC/process/profile lifecycle
run; the modified workflow YAML is not covered by prior runs. A fail-closed
runtime check is useful while Stage 1's admission architecture remains NO-GO,
but it cannot clear Gate D or authorize remote navigation.

### Exact evidence to pass Phase 2.1

On the exact authorized commit/ref, supported Ubuntu runner and locked
toolchain, produce a required-mode run with **no mandatory skips** showing:

1. Workflow preflight and dependency/XKB/Xvfb checks pass without namespace
   bypass or host-security relaxation.
2. Locked Electron binary and packaged artifact are identified by version,
   architecture and SHA-256; package content and canonical PARMAR asset are
   inspected.
3. Actual packaged AETHER process starts; Chromium renderer and preload
   execute; real IPC sender validation/round trips are exercised.
4. Browser child/descendants start and stop; process and namespace evidence is
   recorded; no claim of cgroup admission containment is made.
5. Profile persistence survives the intended close/relaunch path and failure
   cases are observed; shutdown, crash and recovery results are captured.
6. Screenshots, sanitized logs, exact commands, test counts, skips, runner/OS,
   workflow URL/run ID and artifact hashes are retained and independently
   reviewed.
7. Test asserts remote browsing remains disabled and no external page
   navigation is enabled. Gate C can pass while Gate D remains NO-GO.

A package build, YAML syntax, unit tests, workflow-ready branch, or prior
reported one-test Xvfb result alone does not pass this milestone. Any failed
preflight, required skip, missing process evidence or unexpected network
activity blocks the gate. Do not retry by weakening checks.

## Recommended next product-scope phase after Phase 3B.7

**Phase 3B.8 — Approve the provider-neutral universal-search and research
contracts (documentation/architecture only).** Keep Phase 2.1 as the first
runtime implementation milestone above; this recommendation does not reorder
or waive its security/runtime prerequisites.

Bounded outputs:

1. Define URL-versus-query intent, category capability descriptors, query and
   result/provenance contracts, provider selection/settings, suggestions
   disclosure, search-history retention/deletion, sponsored-result labels,
   cancellation and offline/error semantics. Do not choose or wire a provider.
2. Record separate desktop, Android and iOS engine/network dependencies and
   reconcile the existing iOS offline-only plan with the long-term browser
   scope. Do not change platform permissions, engine configuration or network
   behavior in this phase.
3. Define AI context consent, source-validation/citation provenance, research
   organization and limitation disclosures. Do not select or connect a model,
   transmit page/query data, add fake UI, or claim any feature works.
4. Update D-23/D-24, risk entries and the platform/completion matrices only
   when decisions or implementation evidence justify a status change.

Required invariants: `REMOTE_BROWSING_ENABLED=false`; no provider/network
authorization; AI is optional; ordinary browsing must not depend on AI; no
hidden data transfer; no invented citations; AETHER/PARMAR identities remain
separate; VOKKI/PARMAR integration remains optional. Any later network
implementation still requires the applicable security gates and explicit
authorization.

## Ordered focused prompts

Each phase ID below is a separate prompt; the order shown is dependency order.
The detailed phase objective and target modules are in the master roadmap.
Do not combine adjacent prompts into one implementation request.

| Sequence | Future focused prompt | Hard prerequisites / stop |
|---:|---|---|
| 1 | 0.1 — Complete the AETHER repository/module/dependency inventory | Read-only first; stop on sensitive/unowned data. |
| 2 | 0.2 — Record and preserve the exact worktree baseline | Never stage, stash, clean, reset, commit or discard. |
| 3 | 0.3 — Adopt engineering, evidence, security-review and release governance | Approval required for standards/owners. |
| 4 | 0.4 — Operationalize stage/phase/blocker/decision/risk/evidence ledgers | Keep historical evidence append-only. |
| 5 | 1.1 — Review the complete cross-platform threat model | Security review before code; unresolved attacker/asset blocks. |
| 6 | 1.2 — Map actual trust boundaries and authority flows | Must reconcile to source and runtime; do not infer. |
| 7 | 1.3 — Define measurable security invariants and evidence tests | No claim based on unit tests alone. |
| 8 | 1.4 — Run bounded native admission-controller feasibility investigation | Native host authorization and test safety required; no production implementation. |
| 9 | 1.5 — Record an independently reviewed security architecture decision | Preserve NO-GO unless all authority/race assumptions are proved. |
| 10 | 1.6 — Complete the independent security acceptance test plan | Remote browsing remains false. |
| 11 | 2.1a — Prepare/review Phase 3A.3 workflows and acceptance tests, no dispatch | Inspect dirty workflow/test changes; scope only exact workflow/evidence files. |
| 12 | 2.1b — Run the specifically authorized desktop runtime workflow | Separate exact user authorization mandatory; otherwise stop. |
| 13 | 2.2 — Add redacted structured desktop runtime observability | Keep secrets/private content out of logs. |
| 14 | 2.3 — Verify desktop startup/shutdown/crash/profile recovery | Required-mode runtime evidence, no false success. |
| 15 | 2.4 — Decide and verify the desktop support platform matrix | Claim only platforms with actual runtime evidence. |
| 16 | 4.1 — Freshly verify the current Android offline shell/toolchain | Preserve current Android source and Gradle cache changes. |
| 17 | 4.2 — Complete Android emulator and physical-device acceptance | Blocked until device/toolchain available. |
| 18 | 4.3 — Approve Android lifecycle/data/engine-boundary architecture | Keep offline contract; no engine code yet. |
| 19 | 4.4 — Verify Android manifest, storage and offline security | No permission/network expansion without approval. |
| 20 | 6.1 — Review current iOS platform, engine and distribution constraints | Use current authoritative platform requirements. |
| 21 | 7.1 — Approve cross-platform record schemas and golden fixtures | Do not force identical native implementation. |
| 22 | 7.3 — Specify migration/backup/failure protocol per platform | Versioned fixture and rollback design required. |
| 23 | 7.2 — Implement and verify portable import/export formats | Depends on 7.1/7.3; secrets/private data excluded. |
| 24 | 7.4 — Decide synchronization (including explicit no-sync option) | Do not invent backend or cloud behavior. |
| 25 | 7.5 — Approve platform feature parity/declaration matrix | Evidence must match built/runtime behavior. |
| 26 | 3.1 — Complete the desktop browser shell | Requires Phase 2 runtime acceptance; remote controls still disabled. |
| 27 | 3.3 — Complete safe desktop tabs and session persistence | Preserve private-session exclusion. |
| 28 | 3.4 — Complete desktop bookmarks and robust data interchange | Versioned import/export dependencies. |
| 29 | 3.5 — Complete desktop history lifecycle and deletion | Accurate category semantics. |
| 30 | 3.7 — Verify desktop profile isolation and recovery | Independent cross-profile evidence. |
| 31 | 3.9 — Implement desktop permission prompts and site-specific revoke | Default deny; runtime tests. |
| 32 | 3.6 — Complete desktop download approval/handling/recovery | No auto-open/execute; safe path tests. |
| 33 | 3.10 — Implement/test desktop per-category browser storage controls | Must prove each data class deletion. |
| 34 | 3.11 — Make every advertised desktop preference operative/persistent | No decorative setting. |
| 35 | 3.8 — Implement/test desktop ephemeral private sessions | Do not market before independent cleanup evidence. |
| 36 | 3.2 — Implement real desktop navigation behind approved gate | Requires 1.5 GO, Gates C/D and separate Gate E authorization; NO-GO blocks. |
| 37 | 3.12 — Evaluate desktop advanced features individually | Extensions require separate security decision. |
| 38 | 5.1 — Decide Android engine on current platform/security evidence | Requires 4.4 and approved threat model; no desktop engine assumption. |
| 39 | 5.2 — Implement Android navigation/search adapter | Requires engine decision, Gate E and platform acceptance. |
| 40 | 5.3 — Implement Android browser tabs/session restore | Private state not persisted. |
| 41 | 5.4 — Integrate Android bookmarks/history with actual navigation | Requires live engine and per-category tests. |
| 42 | 5.5 — Implement safe Android downloads | Device permission/API acceptance. |
| 43 | 5.7 — Add Android site permissions and revocation | Default deny and live tests. |
| 44 | 5.6 — Add Android profile/private contexts | Independent on-disk cleanup proof. |
| 45 | 5.8 — Implement Android browser-data deletion | Seed/clear/inspect every category. |
| 46 | 5.9 — Complete Android usability/accessibility/performance | Physical device evidence. |
| 47 | 6.2 — Create native iOS project foundation | Separately authorized implementation; Apple/Xcode host needed. |
| 48 | 6.3 — Implement native iOS browser shell | Only after Stage 6.1/6.2 and security gate. |
| 49 | 6.5 — Implement and review iOS security boundaries | No unsupported protection claims. |
| 50 | 6.4 — Implement truthful iOS profile/private behavior | Constrained to platform support. |
| 51 | 6.6 — Verify iOS simulator/device build, signing and runtime | Requires Apple host/device. |
| 52 | 8.1 — Specify authenticated, revocable PARMAR/AETHER interface | Both products remain distinct. |
| 53 | 8.4 — Define PARMAR policy and audit decision contract | PARMAR is not unrestricted browser controller. |
| 54 | 8.2 — Implement explicit human approval for sensitive actions | Cancel must produce no side effect. |
| 55 | 8.3 — Add optional VOKKI capabilities with visible permission state | No silent recording/camera; feature must be real. |
| 56 | 8.5 — Run integration abuse/outage/revocation acceptance | Authentication and version-boundary tests. |
| 57 | 9.1 — Decide AI provider/local model and privacy architecture | Explicit data disclosure, retention and opt-in. |
| 58 | 9.3 — Implement/test AI context boundaries and revocation | No implicit access to secrets/private/device data. |
| 59 | 9.2 — Deliver one separately approved AI assistance feature | Human-driven scope; one feature per prompt. |
| 60 | 9.4 — Add governed AI action preview/approval/result workflow | AI output is never a security decision. |
| 61 | 10.1 — Create original AETHER brand/design system | No Google/Chrome/copycat identity. |
| 62 | 10.5 — Verify PARMAR/VOKKI visual separation and canonical asset | Hash source and every package; never alter emblem. |
| 63 | 10.2 — Finalize desktop UX and functional control inventory | Runtime evidence for every visible control. |
| 64 | 10.3 — Finalize Android touch/accessibility UX | Device acceptance required. |
| 65 | 10.4 — Finalize native iOS UX | Native conventions and AETHER identity. |
| 66 | 10.6 — Audit every visible control across supported apps | Remove or honestly disable incomplete controls. |
| 67 | 11.1 — Complete privacy/data-retention/deletion assessment | Implementation and disclosure must match. |
| 68 | 11.2 — Complete per-platform accessibility acceptance | Manual assistive-tech evidence. |
| 69 | 11.3 — Complete localization/RTL/Unicode acceptance | Translation completeness and layout evidence. |
| 70 | 11.4 — Set and enforce performance budgets from device data | Reproducible benchmarks, not estimates. |
| 71 | 11.5 — Complete reliability/fault-injection matrix | Recovery preserves user data and is observable. |
| 72 | 12.1 — Complete unit validation and data/policy coverage | Exact commands, no silent skipped test. |
| 73 | 12.2 — Complete real-adapter integration coverage | IPC/storage/engine/download/profile/migration/PARMAR. |
| 74 | 12.3 — Complete end-to-end user journeys per platform | Actual supported runtime/device. |
| 75 | 12.4 — Complete packaged runtime acceptance per platform | No mandatory skip; artifacts and logs retained. |
| 76 | 12.5 — Execute the threat-model security suite | Independent OS-level tests for critical claims. |
| 77 | 12.6 — Obtain independent security acceptance | Reviewer and residual risks recorded. |
| 78 | 12.7 — Establish required regression policy | Exact-ref CI evidence and skip governance. |
| 79 | 12.8 — Assemble and independently approve the release-candidate evidence gate | No unresolved critical/high issue; all mandatory gates proven. |
| 80 | 13.1 — Establish reproducible builds and provenance | Clean-room check and hashes. |
| 81 | 13.2 — Verify all declared platform packages | Install and runtime on clean environments. |
| 82 | 13.3 — Configure and verify platform signing | Protected signing identity; no secret in repo. |
| 83 | 13.4 — Implement signed update and rollback lifecycle | Tamper/replay/rollback/interruption tests. |
| 84 | 13.5 — Complete SBOM/license/vulnerability/supply-chain evidence | Release-specific, exceptions reviewed. |
| 85 | 13.6 — Publish accurate install/security/privacy/recovery docs | Review against actual artifact. |
| 86 | 13.7 — Approve final release per platform (Gate G) | All gates pass; no critical/high blockers; release action separately authorized. |

## Mandatory prompt header/checklist

Every prompt that changes files must include the following before editing:

```text
Task and exact phase/slice:
Current branch, HEAD, full worktree status:
Scope:
Non-goals:
Allowed files (exact paths):
Files that must not change:
Dependencies and gate state:
Required tests/commands and exact acceptance criteria:
Stop conditions:
Rollback/recovery plan:
Authorization boundary (especially CI, release, network, secrets):
```

Then perform exactly this sequence:

1. Inspect current worktree/status and the exact relevant source/doc files.
2. State scope, non-goals, dependencies and the exact allowlist/denylist.
3. Preserve all unrelated and pre-existing changes; stop if they conflict.
4. Implement one focused slice only.
5. Run the exact relevant tests; do not install dependencies unless a changed
   manifest or missing dependency requires it. Do not dispatch CI absent exact
   user authorization.
6. Inspect diff and status; verify no prohibited files changed.
7. Report exact commands, actual results/counts/skips, environment, evidence,
   limitations and remaining gates.
8. Update ledgers only for evidence produced on the identified ref/artifact.

Never stage, commit, push, reset, rebase, stash, clean or discard repository
changes without separate explicit authorization. A future push requires the
exact authorization phrase `CONFIRM PUSH`.
