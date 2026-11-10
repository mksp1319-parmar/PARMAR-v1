# AETHER Platform and Feature Matrix

**Snapshot:** 2026-11-10. Status describes evidence in this repository, not
planned behavior. A visible screen does not imply a feature is complete.
“PARTIAL” means some source/policy exists but the full user flow or required
verification is absent. “NOT STARTED” means no product implementation evidence
for that platform feature. See the [completion ledger](./AETHER-COMPLETION-LEDGER.md)
for historical test totals and current worktree boundaries.

## Platform summary

| Platform | Current verified state | Runtime/release state |
|---|---|---|
| Desktop | Electron prototype with shell, tabs, navigation policy, local data, profiles, download approval and Linux process-separation source. `REMOTE_BROWSING_ENABLED=false`. | Packaged startup/renderer/IPC/profile behavior is not currently accepted. Existing test totals conflict and include skips. Linux security architecture is NO-GO; Windows/macOS parity unverified. |
| Android | Native Compose offline shell with local SQLite tab/bookmark foundation and privacy/data deletion UI; no engine/network permission in current offline contract. | XML test reports (26 tests, 0 failures, dated 2026-11-07) are historical. No fresh build/device evidence in this task. |
| iOS | Planning/verification document only; no Xcode/Swift project or native tests. | NOT STARTED; no Apple build/device evidence. |
| Shared | Offline contract documents proposed platform-neutral records; actual implementations are duplicated platform-specific JavaScript/Kotlin. No executable shared data-contract module was found in the initial inventory. | Cross-platform schema, migration, import/export, sync and parity acceptance absent. |

## Product identity assessment

The required product definition is **AETHER — The AI-Native Browser**: an
independent, premium, cross-platform browser with a complete browser
foundation; AI is integrated but optional and never required for ordinary
browsing. This is product scope, not an engineering-completion claim.

The current desktop browser markup uses both `AETHER — PARMAR` as its document
title and “by PARMAR” beside the AETHER name in
[`PARMAR/desktop/browser.html`](./desktop/browser.html). That observed
presentation risks making AETHER appear to be a PARMAR sub-product and needs
an authorized identity review; no UI/code change is made by this documentation
review. Android source presents AETHER and has an informational PARMAR/VOKKI
screen; this does not establish a shipped or accepted independent brand.
[`PARMAR/ios/IMPLEMENTATION-AND-VERIFICATION.md`](./ios/IMPLEMENTATION-AND-VERIFICATION.md)
describes a plan only.

Keep the identities and marks separate. PARMAR/VOKKI is optional integration,
not AETHER identity or a prerequisite for browser/AI functionality. Do not use
Google/Chrome branding, imply affiliation, or copy another browser's design.

## Universal search capability matrix

These are required product capabilities; source or a disabled control is not a
working search feature. Status is based on implementation evidence in this
checkout, not runtime acceptance.

| Requirement | Desktop | Android | iOS | Scope / evidence / dependency |
|---|---|---|---|---|
| General web search | PARTIAL; input resolver recognizes a query, but `REMOTE_BROWSING_ENABLED=false` blocks requests | NOT STARTED; offline shell explicitly disables address/search | NOT STARTED; planning document explicitly excludes search/network | No search runtime is verified. Complete browser runtime and security gates precede network use. |
| Direct URL navigation | PARTIAL; HTTPS parsing exists; remote navigation is denied | NOT STARTED; local saved URLs remain inert | NOT STARTED; plan forbids external navigation | Preserve URL-vs-query intent and safe URL/scheme checks; Gate D/E and platform acceptance remain prerequisites. |
| Image search | NOT STARTED | NOT STARTED | NOT STARTED | No category adapter, result surface or acceptance evidence. |
| Video search, including YouTube results | NOT STARTED | NOT STARTED | NOT STARTED | No category adapter or video result support evidenced; do not imply YouTube affiliation. |
| News search | NOT STARTED | NOT STARTED | NOT STARTED | No category adapter/result surface evidenced. |
| Academic and research search | NOT STARTED | NOT STARTED | NOT STARTED | No source-discovery, validation or research workflow evidenced. |
| Shopping and product discovery | NOT STARTED | NOT STARTED | NOT STARTED | No product-result support or sponsored-result disclosure policy evidenced. |
| Local places and services | NOT STARTED | NOT STARTED | NOT STARTED | No local search or location permission flow; any location use requires separate explicit design/consent. |
| Search suggestions and autocomplete | NOT STARTED; markup has autocomplete disabled and no suggestion implementation evidenced | NOT STARTED | NOT STARTED | Specify whether and when typed queries leave the device; no silent suggestion requests. |
| Search history | UNKNOWN; existing browsing-history source does not establish search-query recording or its privacy behavior | NOT STARTED | NOT STARTED | Decide if distinct search history exists, retention/deletion controls, and private-session exclusions before implementation. |
| Search-provider selection | NOT STARTED as a user-selectable feature; current desktop resolver hard-codes a DuckDuckGo HTML endpoint | NOT STARTED | NOT STARTED | Existing hard-coded endpoint is not an approved product choice. Provider-neutral contract and explicit provider decision required; no provider selected in this review. |
| Result provenance and sponsored labels | NOT STARTED | NOT STARTED | NOT STARTED | Define source attribution, sponsored-result identification and ranking transparency; no misleading sponsored results. |
| Reliable online/offline search behavior | BLOCKED for remote requests by current desktop security gate; offline behavior is only PARTIAL source/policy evidence | PARTIAL offline local-data shell; no online browser | NOT STARTED; plan-only offline shell | Online browser operation depends on approved security architecture, authorization and platform runtime tests. Offline use must not require AI or a remote provider. |

### Provider-neutral architecture requirements

Before any search implementation, define a versioned query/intent contract
(direct URL vs query, category, provider preference, locale/region only when
user-selected, cancellation and safe error states), provider adapter
capabilities, result/provenance metadata, and a user-controlled provider
preference. Keep provider choice and provider-specific contracts OPEN until
approved; this matrix does not recommend or authorize a service. Specify
suggestion-query disclosure separately from submitted searches, search-history
retention/deletion, private-mode exclusions, and clear sponsored labels. Search
must remain usable without AI. An unavailable provider or offline connection
must result in an honest error, not fake results or progress.

Desktop has Electron `WebContentsView`, an address parser and navigation policy,
but remote browsing stays disabled and no real search results are verified.
Android's source manifest declares no permissions and the Compose shell holds
local tab/bookmark metadata; no browser engine is present in the inspected
source. The iOS planning document explicitly excludes WebKit/network browsing,
so its offline-only plan must be reconciled with product scope in a platform
decision before implementation. No platform/runtime parity is established.

## Integrated AI and deep-research capability matrix

| Capability | Desktop | Android | iOS | Required boundary / current evidence |
|---|---|---|---|---|
| Natural-language web questions | NOT STARTED | NOT STARTED | NOT STARTED | No browser AI implementation or provider/model decision evidenced. |
| Contextual assistance for current webpage | NOT STARTED | NOT STARTED | NOT STARTED | Requires a user-triggered, scoped page-context grant and explicit external-processing disclosure where applicable. |
| Webpage summarization | NOT STARTED | NOT STARTED | NOT STARTED | Must distinguish source text from generated summary and disclose omissions/uncertainty. |
| Multi-source comparison | NOT STARTED | NOT STARTED | NOT STARTED | Requires actual source retrieval, links, source coverage and disagreement handling. |
| AI-assisted research | NOT STARTED | NOT STARTED | NOT STARTED | No research workspace or validated workflow evidenced. |
| Source links and citations | NOT STARTED | NOT STARTED | NOT STARTED | No citation pipeline; fabricated citations are prohibited. |
| Verified source content vs generated answers | NOT STARTED | NOT STARTED | NOT STARTED | Product requirement: visibly label provenance; only label content verified when it has been checked against the linked source. |
| User-controlled AI permissions and data disclosure | NOT STARTED | NOT STARTED | NOT STARTED | No AI processing path or consent/revocation controls evidenced. No hidden transmission of page/browsing data. |
| Deep research: source discovery | NOT STARTED | NOT STARTED | NOT STARTED | No discovery implementation; source categories and coverage must be stated. |
| Deep research: source validation | NOT STARTED | NOT STARTED | NOT STARTED | Define identity, relevance, freshness, primary-source preference and conflict checks before claims of validation. |
| Deep research: citation handling | NOT STARTED | NOT STARTED | NOT STARTED | Link every source-based claim to an accessible source; disclose missing or unavailable citations. |
| Deep research: organization | NOT STARTED | NOT STARTED | NOT STARTED | No saved research project, notes or collection flow evidenced; retention/export is undecided. |
| Deep research: limitations | NOT STARTED | NOT STARTED | NOT STARTED | Disclose retrieval scope, unavailable sources, uncertainty, stale/conflicting evidence and generated content. |

AI is not a browser dependency. When disabled, unavailable, or offline, normal
address navigation and ordinary search must remain independent of it. Explicit
consent to AI processing cannot bypass browser security gates, site permissions,
or private-session boundaries.

## Feature matrix

Security dependency abbreviations:

- **D** — keep remote browsing disabled; no network/engine launch without
  separate authorization.
- **G1** — approved threat model and architecture.
- **G2** — runtime acceptance.
- **G3** — independently verified containment/admission and durable evidence.
- **G4** — explicit remote-browsing authorization after Gate D.
- **P** — platform-specific security/device acceptance.
- **I** — authenticated PARMAR/VOKKI interface and human approval.
- **R** — release/build/sign/update acceptance.

| # | Feature | Desktop status | Android status | iOS status | Shared contract | Security dependency | Test evidence now | Remaining work / acceptance gate |
|---:|---|---|---|---|---|---|---|---|
| 1 | Startup and shutdown | PARTIAL | PARTIAL (offline shell source) | NOT STARTED | None verified | G2, P | Desktop lifecycle tests reported historically; Android XML suites not lifecycle proof; no device/runtime | Packaged desktop and device start/stop, graceful/forced, restart and crash tests. |
| 2 | Address bar | PARTIAL; input parser/UI exists, remote denied | NOT STARTED; offline affordance disabled | NOT STARTED | None | D, G1, G2, G3, G4, P | Unit/policy tests reported; no live navigation | Functional verified URL/search flow only after Gate E; Android/iOS engine acceptance first. |
| 3 | Search | PARTIAL; provider resolution exists but requests blocked | NOT STARTED | NOT STARTED | No provider schema | G1, G3, G4, P | Parser/unit evidence only | Provider selection, disclosure, safe search flow and runtime network tests. |
| 4 | Navigation | PARTIAL; explicit navigation policy denies remote access | NOT STARTED | NOT STARTED | No navigation contract | G1, G3, G4, P | Policy tests, not runtime/network containment | HTTPS, redirects, cancel, offline/error, schemes and OS containment acceptance. |
| 5 | Back/forward/reload | PARTIAL in desktop shell source | NOT STARTED | NOT STARTED | None | G2, G4, P | Source/test inventory only; packaged behavior not verified | Actual engine history/navigation behavior and disabled state under Gate D. |
| 6 | Tabs | PARTIAL; desktop tabs, Android local metadata tabs | NOT STARTED | NOT STARTED | Proposed offline tab record only | G2, G4, P | Unit/persistence tests historical; no engine tab runtime | Engine-backed create/close/reorder/switch/limit/persist/crash tests. |
| 7 | Tab restoration | PARTIAL; desktop persisted session source | PARTIAL; local descriptors restore metadata only | NOT STARTED | Proposed record in mobile contract | D, G2, P | Desktop persistence runtime report exists but exact current ref unknown; Android unit XML historical | Prove no unauthorized URL load; process death, crash, migration and private-session exclusions. |
| 8 | Bookmarks | PARTIAL; desktop store/UI source | PARTIAL; SQLite/repository/screens source | NOT STARTED | Proposed bookmark record only | G2, P | Desktop unit reports; Android bookmark tests in historical XML | Fresh packaged/device CRUD, import/export, invalid data, limits and recovery. |
| 9 | History | PARTIAL; desktop store/handlers | NOT STARTED; empty screen only | NOT STARTED | None verified | G1, P | Desktop unit source/tests; no runtime deletion proof | Real visit recording, search, retention and selective deletion end-to-end. |
| 10 | Downloads | PARTIAL; approval and utility source | NOT STARTED; honest empty shell | NOT STARTED | None | G1, G2, P | Policy tests only; no live download accepted | Approval, path safety, dangerous content, progress/cancel/retry/recovery on device. |
| 11 | Profiles | PARTIAL; persistent profile/partition source | NOT STARTED | NOT STARTED | None verified | G1, G2, G3, P | Profile-storage Electron runtime pass reported for one historical Xvfb run; source/ref not independently matched | Independent per-profile cookies/site storage isolation, delete/export policy and recovery on supported OS. |
| 12 | Private browsing | NOT STARTED as complete, tested feature | NOT STARTED | NOT STARTED | None | G1, G3, P | No verified artifact cleanup evidence | Ephemeral context, no persistence after close/crash/kill, independent disk inspection before claim. |
| 13 | Cookies | PARTIAL; engine profile partitions imply storage boundary but controls incomplete | NOT STARTED | NOT STARTED | None | G1, G3, P | No per-category verified deletion evidence | Inspect/clear cookie jar per profile/site and prove UI scope. |
| 14 | Cache | PARTIAL; engine cache exists, complete user control unproven | NOT STARTED | NOT STARTED | None | G1, G3, P | No accepted cache deletion test | Seed, inspect, clear per-site/profile/private and test interruption. |
| 15 | Site storage | PARTIAL; full local-storage/IndexedDB/service-worker controls incomplete | NOT STARTED | NOT STARTED | None | G1, G3, P | No complete storage-class evidence | Enumerate and independently verify each engine storage class and deletion scope. |
| 16 | Permissions | PARTIAL; default-deny policy exists, per-site controls incomplete | NOT STARTED for web-site grants; offline shell requests none | NOT STARTED | No permission contract | G1, P | Desktop policy tests only | Real prompt/deny/grant/revoke matrix; camera/mic/location/notifications/clipboard/pop-up/file. |
| 17 | Site settings | NOT STARTED as complete site-specific UI | NOT STARTED | NOT STARTED | None | G1, P | No site settings runtime evidence | Per-origin settings with validation, reset, persistence and revocation tests. |
| 18 | Privacy controls | PARTIAL; desktop and Android privacy screens/source exist | PARTIAL; local tabs/bookmarks deletion flows | NOT STARTED | Offline deletion semantics documented | G1, P | Android UI/unit evidence historical; no device | Seed every category; distinguish empty/failed/not attempted; truthful labels and recovery. |
| 19 | Data deletion | PARTIAL; persistent browser data categories incomplete | PARTIAL; local category delete for tabs/bookmarks | NOT STARTED | Proposed category semantics only | G1, G3, P | Unit tests not OS storage proof | Full per-category/profile/private deletion and independently observed artifacts. |
| 20 | Import/export | NOT STARTED as verified product flow | NOT STARTED | NOT STARTED | Proposal only | G1, P | None | Versioned strict schema, corruption/partial import/duplicate/backups and cross-platform fixtures. |
| 21 | Themes | PARTIAL; settings source exists, operability not fully verified | PARTIAL; settings screen exists but no functional preference is evidenced | NOT STARTED | None | P | No fresh preference persistence evidence | Theme control persists/affects all screens and supports accessibility. |
| 22 | Accessibility | UNKNOWN; source affordances have no complete acceptance evidence | UNKNOWN; Compose source has no complete acceptance evidence | NOT STARTED | No shared accessibility contract | P | No complete assistive-tech acceptance | Screen reader, keyboard/focus, contrast, text scale, reduced motion and error announcements per platform. |
| 23 | Localization | NOT STARTED as complete localization | PARTIAL strings resource exists; translations incomplete/unknown | NOT STARTED | None verified | P | No locale test evidence | Externalize/translate, Unicode/date/time/RTL, completeness checks. |
| 24 | Crash recovery | PARTIAL; desktop lifecycle/persistence handling source | PARTIAL; DB error/migration handling source | NOT STARTED | None | G2, P | Unit tests historical; no broad crash/device injection | Crash/forced kill/corrupt store/interrupted write recovery and durable user messaging. |
| 25 | AI assistance | NOT STARTED in scoped desktop browser runtime | NOT STARTED | NOT STARTED | No assistant contract | G1, I | No verified runtime feature | Provider/data disclosure, explicit context scope, cancellation and human-governed actions. |
| 26 | PARMAR integration | NOT STARTED as authenticated scoped browser interface | NOT STARTED (information screen only) | NOT STARTED | None | I, G1 | UI text only; not integration evidence | Versioned auth, permission, revocation, audit, forged request and unavailable-counterpart tests. |
| 27 | VOKKI integration | NOT STARTED as browser-controlled optional capability | NOT STARTED (informational screen only) | NOT STARTED | None | I, P | No voice/AI runtime evidence | Explicit activation/permission/visible mic state/cancel; never silent camera; no fake capability. |
| 28 | Offline behavior | PARTIAL; remote browsing fail-closed configuration/source | PARTIAL; mobile offline contract and local shell | NOT STARTED | Offline contract | D, P | Source contract/policy tests; no complete runtime network observation | Egress observation across app flows; honest offline/error behavior on each platform. |
| 29 | Remote browsing security | NO-GO | NOT STARTED; offline-only | NOT STARTED | None | G1, G2, G3, G4, P | Linux policy/namespace tests do not prove admission freeze/containment | Close controller authority/race, independent observer and native evidence; retain disabled flag until authorization. |
| 30 | Packaging | PARTIAL; historic Linux directory/AppImage evidence | PARTIAL; debug APK/build outputs exist historically | NOT STARTED | None | R, P | Package-content/build reports historical; no current all-platform installation | Current exact-ref packages, signed contents and clean install/runtime per declared platform. |
| 31 | Updates | NOT STARTED | NOT STARTED | NOT STARTED | None | R, G1 | No update path evidence | Signed metadata/payload, rollback, replay/tamper/interrupted update recovery. |
| 32 | Signing | NOT STARTED for release signing | NOT STARTED for release signing | NOT STARTED | None | R | No verified release signatures | Define/protect identities and independently verify each actual distribution artifact. |
| 33 | Support diagnostics | PARTIAL; desktop logs exist, no complete redacted support bundle | NOT STARTED | NOT STARTED | None | G1, P | No packaged redaction/export acceptance | Correlation IDs and support export with tests proving secrets/private content excluded. |

## Shared-contract scope and status

`PARMAR/AETHER-MOBILE-OFFLINE-CONTRACT.md` is a design/behavior contract, not
an executable shared module. Desktop storage is JavaScript/Electron; Android
storage is Kotlin/SQLite. Existing iOS requirements propose native Core Data
and SwiftUI but explicitly disclaim implementation. No shared production
schema package, cross-platform migrations, sync service, or import/export
implementation was identified. Treat any “shared” record as a proposal until
golden fixtures are consumed and validated by each platform.

## Matrix update policy

Change a status only when the corresponding code, tests, artifact and evidence
exist for the exact platform/ref. Record command/device, date, limitations and
acceptance gate in the [completion ledger](./AETHER-COMPLETION-LEDGER.md).
Never infer platform parity from a shared mock, screenshot, or another OS's
build.
