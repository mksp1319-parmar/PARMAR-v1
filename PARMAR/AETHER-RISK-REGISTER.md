# AETHER Risk Register

**Snapshot:** 2026-11-10. Scores are qualitative planning assessments, not
probability estimates: likelihood and impact use High/Medium/Low. “Open” means
no acceptance evidence closes the risk. An existing architecture NO-GO is
treated as an active release blocker, not a low-likelihood risk.

| ID | Risk | Likelihood / impact | Current status | Mitigation / evidence required | Owner / trigger |
|---|---|---|---|---|---|
| R-01 | cgroup admission race or surviving writer can repopulate after observed empty state | High / Critical | OPEN, RELEASE NO-GO | Native supported-kernel tests; enforceably fence every writer; independent observer, durable evidence/ACK; independent security acceptance. If any authority remains, preserve NO-GO. | Security architecture owner; before any Gate D claim. |
| R-02 | Process-group kill or namespace proof is mistaken for OS containment | High / Critical | OPEN | Explicit invariant and negative tests; logs/claims distinguish app policy from OS enforcement; prohibit remote browsing. | Desktop security owner; every isolation change. |
| R-03 | Current modified runtime workflows have not been accepted on the actual hosted runner | High / High | OPEN/BLOCKED | Review current YAML/script/test diff; after exact user authorization run required-mode workflow; no bypass/skip; preserve raw logs/artifact. | Desktop runtime owner; Phase 2.1. |
| R-04 | Desktop browser source passes mocks while Electron/Chromium renderer, preload, IPC or lifecycle fails live | High / High | OPEN/BLOCKED | Packaged runtime acceptance with required live checks, screenshots, process tree and no skips. | Desktop runtime owner; Gate C. |
| R-05 | Historical desktop test totals refer to different test inventories/refs and are combined or misreported | High / Medium | OPEN | Retain separate 282 tests (277 passed/5 skipped), 283 tests (279 passed/4 skipped), and 283 tests (278 passed/5 skipped) reports with provenance; record exact ref and command for every future result. | Evidence curator; every ledger update. |
| R-06 | Uncommitted desktop, Android, workflow, and documentation changes are overwritten or misattributed to HEAD | High / High | ACTIVE | Snapshot complete status before every task; exact allowlist; do not stage/reset/clean/stash; inspect post-diff. | Every contributor; every prompt. |
| R-07 | Android historical build/test outputs are treated as fresh current-worktree device evidence | High / High | OPEN | Pin JDK/Gradle/SDK; rerun tests/build on exact ref; install on emulator and physical device; retain hashes and logs. | Android owner; Stage 4. |
| R-08 | Android engine addition violates offline contract or expands manifest permissions unexpectedly | Medium / Critical | OPEN | Separate architecture decision; inspect merged manifest/dependencies/network behavior; Gate E before browsing. | Android security owner; before Stage 5. |
| R-09 | iOS plan is described as an implemented browser or desktop architecture is copied despite platform constraints | Medium / High | OPEN | Keep iOS NOT STARTED; current Apple platform/engine/entitlement research and native project/device evidence. | iOS owner; before Stage 6 implementation. |
| R-10 | Desktop, Android and iOS silently diverge in data schemas, migrations or deletion scope | High / High | OPEN | Versioned schemas/golden fixtures, compatibility rules, per-platform migration and parity matrix; no forced identical implementation. | Cross-platform data owner; before import/export/sync. |
| R-11 | Persistent profiles or private sessions leak cookies/cache/site data across contexts or after crash | Medium / Critical | OPEN | Independent on-disk inspection after close/crash/kill/reboot; cross-profile attempts; no private-mode claim until accepted. | Browser storage owner; before profiles/private advertised. |
| R-12 | “Clear history” or category deletion falsely implies cookies/cache/all site data are erased | Medium / High | OPEN | Seed each class; test actual deletion scope and failures; review UI copy against data inventory. | Privacy/product owner; before data-controls release. |
| R-13 | Permission policy defaults or per-site revocation are bypassed by engine, child or assistant | Medium / Critical | OPEN | Deny-by-default live prompts, revocation tests, origin validation and AI non-authority. | Security/platform owners; before Gate E. |
| R-14 | Download handling permits path traversal, overwrite, execution or misleading safety claims | Medium / High | OPEN | Controlled hostile fixtures, safe path and overwrite tests, no auto-open/execute, honest warnings and recovery. | Browser feature owner; before downloads release. |
| R-15 | PARMAR/VOKKI becomes an unrestricted browser controller or sensitive action is performed without approval | Medium / Critical | OPEN | Versioned authenticated allowlist, AETHER-side checks, visible action preview, cancellation and audit tests. | PARMAR/AETHER integration owner; Stage 8. |
| R-16 | Microphone state is hidden, voice capability is fake, or camera is silently captured | Low/Medium / Critical | OPEN | Optional permission prompt, clear active indicator and stop control, device testing; camera recording prohibited. | VOKKI owner; before any voice feature. |
| R-17 | AETHER brand copies Chrome/Google or another browser identity; PARMAR emblem is altered or AETHER is presented as a PARMAR sub-product | Medium / High | OPEN | Original AETHER asset provenance, independent identity review, canonical PARMAR source/package hash and visual aspect-fit review. Review the current desktop “AETHER — PARMAR” / “by PARMAR” labels against the separate-identity requirement. | Product/design owner; every artifact. |
| R-18 | External AI/provider sends page content, browsing data or identifiers without informed consent | Medium / High | OPEN | Provider/data-flow ADR, explicit scoped disclosure and approval before each external-processing feature, retention/opt-out and network audit. Ordinary browsing must work with AI disabled. | Privacy/AI owner; before AI features. |
| R-19 | Update or dependency/build pipeline is compromised or cannot be rolled back safely | Medium / Critical | OPEN | SBOM, signed provenance/artifacts, protected signing, least-privilege CI, tamper/rollback/interruption tests. | Release/supply-chain owner; before Gate G. |
| R-20 | Product claims support on Windows/macOS/iOS/Android without actual platform runtime/device evidence | High / High | OPEN | Declare narrow supported matrix; per-platform build/install/runtime/security/device proof. | Product/release owner; every release. |
| R-21 | Logs/support bundle leak credentials, cookies, private URLs/content or tokens | Medium / High | OPEN | Structured field allowlist, redaction canaries, packaged diagnostics test, explicit export review. | Observability/privacy owner; before support export. |
| R-22 | Corruption, disk-full, interrupted write or crash produces silent empty data or destroys user records | Medium / High | OPEN | Failure injection, transactional migration/backup and visible recovery; no success-shaped fallback. | Storage owner; before persistent data release. |
| R-23 | Accessibility/localization gaps block users or critical security/permission state is inaccessible | Medium / High | OPEN | Platform-specific screen-reader/keyboard/text-scaling/contrast/RTL acceptance. | UX/accessibility owner; Gate F. |
| R-24 | Workflow dispatch occurs because YAML appears ready, without user authorization | Low/Medium / High | CONTROL REQUIRED | Separate prepare/review/authorize/run/result-review; exact workflow/ref authorization before dispatch; no CI run during roadmap task. | Workflow operator; every run. |
| R-25 | Generated `.gradle`, `build`, `node_modules`, APK and test reports obscure source/test provenance | High / Medium | ACTIVE | Classify generated artifacts; record exact build provenance; do not treat presence as a fresh build; do not delete pre-existing files. | Evidence curator; every baseline. |
| R-26 | Signing identity, license obligations, or platform distribution requirements are discovered late | Medium / High | OPEN | Early legal/platform review, license inventory, signing owner, distribution decision and documented limitation. | Release/legal owner; before platform support commitment. |
| R-27 | Search provider/category behavior, suggestions or query handling is assumed from a hard-coded endpoint; query or history data is transmitted/retained without a product decision | Medium / High | OPEN | Define a provider-neutral query/result contract, provider and category selection, explicit suggestions disclosure, user provider choice, query-history controls and privacy/offline behavior. Do not select or enable a provider without approval and all applicable gates. | Search/product/privacy owners; before search implementation. |
| R-28 | AI research presents generated text as verified, invents citations, or conceals source gaps, stale/conflicting evidence or research limits | Medium / High | OPEN | Source-linked claim model, source validation method, provenance labels, conflict/freshness handling, citation validation and explicit limitations; test fabricated/missing/unavailable-source cases. | AI/research owner; before any AI research claim. |

## Release-blocking risk handling

- R-01/R-02 are hard security blockers. No later feature work can turn them
  into “accepted” by changing labels or relying on tests that do not exercise
  host authority.
- R-03/R-04 block Gate C; do not treat a workflow YAML edit as acceptance.
- R-07/R-08/R-09/R-20 block claims for the corresponding mobile/desktop
  platforms.
- R-11 through R-16 block browser data/permission/integration/assistant claims
  until the relevant runtime evidence exists.
- R-17 blocks brand acceptance; source digest alone is not visual or bundled
  proof.
- R-27 blocks provider-backed search and suggestions until their architecture,
  disclosure and security prerequisites are approved.
- R-28 blocks source-backed AI/research claims until provenance and citation
  handling are implemented and independently validated.
- R-19/R-20/R-26 block Gate G.

Reassess each risk after a concrete evidence-bearing change. Record mitigation,
exact ref/artifact, test output and residual status in this file and the
[completion ledger](./AETHER-COMPLETION-LEDGER.md); do not silently close a
risk after code-only implementation.
