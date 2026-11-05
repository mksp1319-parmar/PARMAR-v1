# PARMAR AETHER Native Mobile Offline Shell Contract

Status: implementation contract; no native mobile implementation is implied.

This document specifies the first native Android and iOS AETHER milestone. It
is based on the A97/A98 product and data reviews and the A99 approved decisions.
It does not authorize network browsing or change the desktop security policy.

## 1. Mandatory offline-shell boundary

The Android and iOS offline shell MUST:

- Keep `REMOTE_BROWSING_ENABLED=false` in the desktop application.
- Contain no Android `WebView`, iOS `WKWebView`, browser engine, external
  navigation, search request, DNS activity, VPN implementation, or external
  browser handoff.
- Make no external network requests, including analytics, remote images, fonts,
  crash uploads, or PARMAR/VOKKI service calls.
- Provide no user-facing control that overrides the network restriction.
- Request no permissions for browsing, sites, downloads, location, camera,
  microphone, or broad file access.
- Never generate fake pages, page previews, loading/progress indicators,
  history, downloads, or approval events.
- Store no browser credentials, cookies, tokens, or other secrets in shared
  metadata.
- Treat URLs as sensitive metadata. A bookmark or restored URL is not stored
  page content.
- Preserve explicit, action-specific human approval. A VOKKI suggestion is not
  an approval and grants no browser authority.
- Display the canonical PARMAR emblem without modification and verify the
  bundled asset SHA-256 against the value in section 3.

The offline shell is a native local-data application with browser identity. It
is not an internet browser and must not be described as one.

## 2. First implementation milestone

The smallest useful milestone (M1) consists only of:

1. Native AETHER Home screen.
2. Locally persisted tab descriptors.
3. Locally persisted bookmarks and local-only search/edit/delete.
4. Locally persisted settings limited to implemented offline preferences and
   privacy/data controls.
5. Honest empty History and Downloads screens.
6. PARMAR/VOKKI information screen with no service call or implied approval.

The address/search affordance is visibly disabled, accessible, and explains
that browsing is disabled. A local bookmark form may accept a user-entered
credential-free HTTPS URL as metadata, but it MUST NOT navigate, resolve DNS,
preview the page, or hand the address to another app. A bookmark may create a
local saved-URL tab descriptor; selecting that descriptor displays its saved
metadata only.

Every visible interactive control MUST perform its documented local action or
be a clearly labelled disabled control with an explanation. Informational text
is not presented as a button. Empty History and Downloads screens contain no
fake refresh, retry, import, or clear action.

## 3. Canonical asset

Canonical emblem:

- Path: `PARMAR/interface/static/assets/parmar-emblem.png`
- Type: PNG, 552 x 548 pixels, RGB
- Required SHA-256:
  `d2327d8b5853a4c9dd5e43b8a776c3f91a962276b37cd1c8e136cab7db81c98d`

The application build/test MUST hash the source and bundled copy and fail if
either digest differs from the required value. Do not crop, recolor, resample,
regenerate, or replace the emblem. Display it with aspect fit. Asset-hash
equality verifies bytes, not visual layout.

## 4. Platform-neutral data contract

These are recommended JSON-equivalent schemas for fixtures and interchange,
not a mandate to use JSON as either platform's persistence format. Each record
has an exact field allowlist, UUID identifiers, strict types, and a
`schemaVersion` of `1`. Unknown fields and versions MUST be rejected without
rewriting the source data. Timestamps are nonnegative Unix epoch milliseconds
in UTC. URL fields are canonical credential-free HTTPS URLs, limited to 2048
characters.

### Tab descriptor

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "kind": "new",
  "url": null,
  "title": null,
  "pinned": false,
  "order": 0,
  "createdAt": 0,
  "updatedAt": 0
}
```

`kind` is `new` or `saved-url`. `new` requires `url: null`; `saved-url`
requires a valid URL. A title, when present, is user-entered metadata, not
evidence of a loaded page. The session envelope stores ordered descriptors
and an `activeTabId` that is null only when no tabs exist. M1 supports at most
16 descriptors. Restoring a saved URL restores metadata only.

### Bookmark

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "url": "https://example.test/",
  "title": "Saved address",
  "createdAt": 0,
  "updatedAt": 0
}
```

Bookmark titles are nonempty after trimming and at most 300 characters.
Canonical URLs are unique. M1 supports at most 500 bookmarks. A bookmark is
an address only; there is no "open" operation in M1.

### History

History has no M1 record type that the application may create or persist.
The screen always reports an honest empty state. Do not synthesize visits from
typed addresses, bookmark edits, tab creation, selection, or restoration.
Do not import desktop history or describe imported history as native activity.

### Downloads

Downloads have no M1 record type that the application may create or persist.
The screen always reports an honest empty state. No browser download,
download record, file import, or desktop download import is part of M1.

### Local preferences

```json
{
  "schemaVersion": 1,
  "appearance": "dark",
  "startupBehavior": "start-page"
}
```

Only implemented local preferences may be added. Network enablement,
provider/search configuration, browser credentials, permissions, and secrets
are forbidden fields. M1 follows OS accessibility settings; it does not
duplicate system font scale or reduced-motion state as user preferences.

### Private-session metadata

Private browsing is not an M1 feature. If a later local-only private tab
descriptor is introduced, its metadata is memory-only and MUST NOT be included
in any persistent envelope, backup, export, diagnostic log, or migration.
Closing it discards in-memory metadata. This is not a claim of secure erasure
or absence of OS artifacts.

## 5. Persistence, migration, corruption, and deletion

### Platform-native persistence

- Android: use native persistence adapters (recommended: Room for tab and
  bookmark records, DataStore for preferences). Do not share a desktop JSON
  file or use it as an authority.
- iOS: use native persistence adapters (recommended: Core Data for tab and
  bookmark records, UserDefaults for preferences, subject to the selected
  minimum iOS version and migration review).
- Keep schemas and validation fixtures platform-neutral; storage, lifecycle,
  transaction, backup, and error handling remain platform-specific.
- Do not persist History or Downloads in M1 because neither has genuine M1
  events or artifacts.
- Treat URLs and bookmark titles as sensitive. Exclude M1 stores from
  unreviewed cloud/device backup. Use platform data protection and sandboxing,
  but do not claim per-record encryption unless implemented and verified.

### Migration and import

- There is no automatic desktop-to-mobile migration.
- Desktop history and download records MUST NOT be imported or represented as
  native mobile browsing activity.
- M1 has no import flow. Any future user-initiated migration requires a
  separate approved design, preview, confirmation, provenance labeling, and
  compatibility tests. It must not import history/downloads as native events.
- Schema migrations are explicit sequential functions (`N -> N+1`), deterministic,
  bounded, and tested with fixtures. Validate the new representation and
  commit it atomically before retiring the previous version.
- Unknown future versions, invalid records, and migration failures preserve
  the original data and surface an error; never reset to defaults silently.

### Corruption and storage errors

- Read, parse, validation, migration, and write failures are visible and
  reported. Do not claim a save or deletion succeeded unless the platform
  persistence operation confirms it.
- Never silently truncate records, partially accept corrupt input, overwrite
  an unknown schema, or clear data as recovery.
- A recovery/quarantine feature requires a separate design. It must preserve
  original bytes and report the outcome.
- A successful delete means the app's addressed records were removed; it does
  not prove secure erasure from flash storage, backups, OS snapshots, or other
  artifacts.

### Partial deletion contract

Clear operations are atomic per category, not across all categories. M1
categories are `tabs`, `bookmarks`, and `preferences`. Empty `history`,
`downloads`, and unimplemented/private categories are not deletion targets.

Return and display an outcome for every requested category:

- `deleted`: category data was present and the deletion was confirmed.
- `already-empty`: category was confirmed empty.
- `failed`: deletion failed; data is retained where possible and the error is
  shown. A category adapter MUST make deletion atomic or report the exact
  residual state; if it cannot determine that state, report an explicit
  indeterminate failure and never claim the category was cleared.
- `not-attempted`: the operation did not run for that category.

Overall result is `complete` only when every requested category is `deleted`
or `already-empty`. Any `failed` or `not-attempted` result makes the overall
result `partial` or `failed`, never success. The UI lists each category and
offers retry for failed categories. A failure in one platform store must not
hide successful deletion in another. No “everything wiped” or secure-erasure
claim is permitted after partial failure.

## 6. Product copy and design tokens

### Required copy

- Status: **“Offline shell · remote browsing is disabled.”**
- Address/search: **“Address and search are unavailable while browsing is disabled.”**
- Saved URL tab: **“Saved URL only · page content is not stored.”**
- Empty History: **“No browsing history has been recorded in this offline shell.”**
- Empty Downloads: **“No browser downloads. This shell does not download pages or files.”**
- Bookmarks: **“Bookmarks store addresses, not page content.”**
- PARMAR/VOKKI: **“VOKKI suggestions do not approve browser actions. Any future approval is explicit and limited to the action shown.”**
- Partial delete: **“Some data could not be deleted. Review the category results below.”**

Do not use “secure,” “anonymous,” “fully private,” “page saved,” “downloaded,”
or “approved” unless the corresponding behavior is implemented and evidenced.

### Shared token names

Token names define intent only; Compose and SwiftUI map them to native systems
independently:

- `color.canvas`, `color.surface`, `color.text.primary`,
  `color.text.secondary`, `color.accent.copper`,
  `color.status.restricted`, `color.border.subtle`
- `space.*`, `radius.card`, `radius.control`
- `type.display`, `type.title`, `type.body`, `type.caption`
- `size.target.minimum`
- `motion.reduce`

Use dark obsidian/graphite surfaces, warm readable text, and restrained
copper/amber accents. Do not use Google branding. Follow system contrast,
font scaling, and reduced-motion preferences. Platform layouts and navigation
remain native and need not be identical.

## 7. Visible controls and behavior

| Screen/control | Required behavior |
|---|---|
| Home / AETHER emblem | Displays the unchanged local emblem; tapping the Home control returns to Home. |
| Address/search | Disabled with accessible explanation; no editable submission, URL resolution, search, DNS, handoff, or network activity. |
| Tabs | New creates a local descriptor. Select changes active descriptor. Pin/reorder updates local metadata. Close deletes the descriptor and updates selection. A bookmark may create a `saved-url` descriptor without opening it. |
| Bookmarks | Add/edit/remove/search local metadata. Remove requires confirmation. No Open/Visit control. |
| History | Back/navigation only; honest empty-state content. No refresh, import, fake result, or synthetic event control. |
| Downloads | Back/navigation only; honest empty-state content. No fake retry, import, progress, or download action. |
| Settings | Change only implemented local settings. Provide category-specific and clear-all deletion with per-category outcomes. |
| PARMAR/VOKKI information | Shows local informational content. No live status, chat, approval request, or submit action. |
| Navigation/back | Returns through native shell screens only; never opens an external destination. |

Any destructive action requires a clear confirmation. Disabled controls must
be announced as unavailable and explain why. Informational labels must not
look or behave like controls.

## 8. Platform-specific implementation and acceptance

### Android — Kotlin + Jetpack Compose

M1 implementation uses native Compose navigation, forms, lists, and dialogs.
Use app-private storage, Room for structured descriptors/bookmarks, and
DataStore for local preferences (subject to dependency review). Do not declare
`INTERNET`, a VPN service, broad storage permissions, or background services.
Use Android system bars, cutouts, gesture/predictive back, font scaling, and
accessible semantics. The local shell must not create a WebView.

**Android acceptance**

- Build/config inspection confirms no WebView dependency, `INTERNET`
  permission, VPN service, external intents, or network client.
- Home, tabs, bookmarks, settings, History, Downloads, and PARMAR/VOKKI
  screens work using native navigation and local data only.
- Local tab operations persist/reload correctly; a saved URL is never loaded.
- Bookmark add/edit/remove/search is local and validates URL/title; no open
  action exists.
- History and Downloads remain empty across launch, restart, and tab operations.
- Per-category and clear-all deletion report exact outcomes when each storage
  adapter is independently forced to fail.
- TalkBack, font scaling, small/large phone, tablet/foldable, rotation, and
  process recreation tests pass.
- Network observation during all M1 flows records no external request.

### iOS — SwiftUI

M1 implementation uses native SwiftUI navigation, forms, lists, and
confirmation sheets. Use Core Data for structured descriptors/bookmarks and
UserDefaults for local preferences, subject to deployment-target and migration
review. Apply file protection and backup exclusion deliberately. Do not add
WKWebView, Network Extension, URLSession/Network framework requests, or
external URL opening.

**iOS acceptance**

- Target/build inspection confirms no WKWebView, WebKit browser view,
  Network Extension, external URL handoff, or application networking path.
- Home, tabs, bookmarks, settings, History, Downloads, and PARMAR/VOKKI
  screens use native SwiftUI navigation and local data only.
- Local tab operations persist/reload correctly; saved URLs remain inert.
- Bookmark add/edit/remove/search is local and validates URL/title; no open
  action exists.
- History and Downloads remain empty across launch, restart, and tab operations.
- Per-category and clear-all deletion report exact outcomes when each storage
  adapter is independently forced to fail.
- VoiceOver, Dynamic Type, small/large iPhone, iPad split layout, rotation, and
  app lifecycle tests pass.
- Network observation during all M1 flows records no external request.

### Shared contract

Only data schemas, design-token names, product copy, validation vectors, and
expected test fixtures are shared. Do not share UI runtime, persistence,
permissions, platform security code, or assumptions about lifecycle behavior.

## 9. Dependency-ordered implementation checklist and test matrix

### Implementation order

1. Approve token/copy and data schema fixtures; verify the emblem hash.
2. Create independent Android Compose and iOS SwiftUI offline shells with no
   WebView or network capability.
3. Add platform-native tab/bookmark/settings stores with strict validation,
   atomic per-category operations, and migration fixtures.
4. Add honest empty History/Downloads screens; do not create persistence or
   import code for them.
5. Add local PARMAR/VOKKI information screen without a service connection.
6. Add category and clear-all deletion outcomes, partial-failure UX and retry.
7. Complete platform accessibility, device layout, lifecycle, no-network and
   logo-hash tests before M1 acceptance.

### Test matrix

| Test area | Shared/contract fixture | Android Compose/device | iOS SwiftUI/device |
|---|---|---|---|
| Logo identity | Source and bundled SHA-256 equal required digest | Asset resource digest and aspect-fit inspection | Asset catalog digest and aspect-fit inspection |
| Schema validation | IDs, exact fields, versions, URL scheme/credentials/length, limits, timestamps | Repository round-trip and invalid-data rejection | Repository round-trip and invalid-data rejection |
| Tabs | Create/select/close/pin/reorder; active ID/order consistency; saved URL inert | Room persistence, restart/process recreation, back behavior | Core Data persistence, restart/background restoration |
| Bookmarks | Add/edit/remove/search; canonical URL uniqueness; no network action | Compose local form and persistence errors | SwiftUI local form and persistence errors |
| History | No M1 record writer; no synthetic event or desktop import | Empty after all M1 flows and restart | Empty after all M1 flows and restart |
| Downloads | No M1 record writer, transfer, artifact or desktop import | Empty after all M1 flows and restart | Empty after all M1 flows and restart |
| Preferences | Allowed fields only; no network override/secrets | DataStore values and migration | UserDefaults values and migration |
| Private metadata | Serialization fixture rejects private fields | No persistent private metadata path in M1 | No persistent private metadata path in M1 |
| Migration/corruption | Sequential migration fixtures; unknown version and corrupt bytes preserved | Inject read/write/migration failure | Inject read/write/migration failure |
| Deletion | `deleted`/`already-empty`/`failed`/`not-attempted`; partial aggregation | Independently fail tabs, bookmarks, preferences and clear-all | Independently fail tabs, bookmarks, preferences and clear-all |
| Accessibility/layout | Required labels, unavailable state, destructive confirmation | TalkBack, font scale, phones/tablets/foldables | VoiceOver, Dynamic Type, iPhone/iPad |
| No-network boundary | Static forbidden-dependency/config checks | Device/emulator request observation across all flows | Simulator/device request observation across all flows |
| PARMAR/VOKKI | Copy and no-approval semantics | Verify info-only screen, no service call | Verify info-only screen, no service call |

Deletion tests MUST prove that if one category fails while others succeed,
the result is not described as a complete wipe; the failed category remains
visible and retryable. Include failures before, during, and after each
category operation where the persistence adapter allows injection.

## 10. Future network-browser gates

Network browsing is explicitly outside M1. A later proposal is ineligible for
implementation until all of these are separately approved:

1. Platform-specific threat model and egress boundary for Android and iOS.
2. Written proof that DNS, main-frame and subresource traffic, redirects,
   WebSockets, direct sockets, proxy paths, and external handoffs cannot bypass
   policy.
3. Demonstrated fail-closed behavior on service loss, process death, OS
   revocation, network transitions, and device restart.
4. Required OS entitlements, managed-device constraints, app-store rules, and
   distribution approval confirmed for each supported platform/region.
5. Independent device evidence correlating requests to the enforcing
   boundary; callbacks, mocks, and policy rejections do not count as
   kernel/network-denial evidence.
6. Human approval protocol that is explicit, action-specific, expiring, and
   revocable; no VOKKI blanket authorization.
7. Separate approved designs for search providers, browsing history,
   downloads, permissions, private browsing, session restore, backup, and
   sensitive-data retention.
8. Independent security review and a documented rollback plan.

Until every applicable gate passes, network capability remains absent from
the mobile shell and `REMOTE_BROWSING_ENABLED=false` remains unchanged on
desktop.

## 11. Unresolved decisions before implementation

- Minimum supported Android API/WebView provider and iOS version.
- Final persistent-record limits and whether sessions persist between app
  launches.
- Backup/export policy and platform-specific at-rest protection requirements.
- Whether URL/title data requires application-level encryption beyond platform
  sandbox/data protection; no such encryption claim is made here.
- Exact dark-theme token values, typography scale, and tablet navigation
  details after native accessibility review.
- Whether any future import is desired; M1 default is no import.
- Any future network-browser, search, history, download, private browsing, or
  per-site permission design; none is approved by this contract.

## 12. Explicit exclusions

M1 excludes web content rendering, remote navigation/search, external browser
handoff, DNS, VPN/Network Extension, WebView/WKWebView, network permissions,
browser downloads, history events, desktop migration, private browsing UI,
credentials/autofill, cloud sync, page archives, and live PARMAR/VOKKI
integration. No build, app launch, or network test in a future implementation
may be represented as completed until its platform-specific acceptance
evidence is retained and reviewed.
