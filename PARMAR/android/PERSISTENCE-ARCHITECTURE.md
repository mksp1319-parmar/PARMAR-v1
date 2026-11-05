# AETHER Android Local Persistence Architecture

Status: native SQLite persistence is implemented in source but has not been
built or device-verified. This document records the current implementation and
its remaining verification requirements.

## 1. Current implementation

This section records the current source implementation. It is not a claim that
the Android application has been built or run.

### Bookmarks

- [`LocalAetherDatabase.kt`](app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt)
  uses app-private SQLite tables and transactional writes. Bookmark rows have
  UUID IDs, canonical unique URLs, nonempty labels, timestamps, and record
  schema version 1. The repository enforces the 500-record bound, add/update/
  remove, and URL/title validation; it performs no network operation.
- Omitted or blank titles persist as `Saved address`, not as an inferred site
  title. Reads validate the stored UUID, URL, title, timestamp, and schema
  version and surface a storage error rather than returning an empty fallback.
- [`BookmarksScreen.kt`](app/src/main/kotlin/org/parmar/aether/ui/bookmarks/BookmarksScreen.kt)
  provides add/edit/search, local details, saved-URL-tab creation, and
  confirmation before removal. There is no Open/Visit action.

### Tabs

- [`LocalTabsSession.kt`](app/src/main/kotlin/org/parmar/aether/ui/tabs/LocalTabsSession.kt)
  models UUID tab descriptors, kind, inert saved URL, optional user title,
  pin/order, timestamps, schema version, and active tab ID.
- [`LocalAetherDatabase.kt`](app/src/main/kotlin/org/parmar/aether/data/LocalAetherDatabase.kt)
  persists tabs and the active ID transactionally, enforces the 16-descriptor
  limit, restores metadata only, and updates ordering/active selection when a
  tab is pinned, moved, or closed.
- [`AetherApplication.kt`](app/src/main/kotlin/org/parmar/aether/AetherApplication.kt)
  owns the database for the application lifetime. [`AetherApp.kt`](app/src/main/kotlin/org/parmar/aether/ui/AetherApp.kt)
  loads the stored data and presents loading/storage-error states instead of a
  success-shaped empty state.
- [`TabsScreen.kt`](app/src/main/kotlin/org/parmar/aether/ui/tabs/TabsScreen.kt)
  supports local creation, selection, pinning, reordering, and confirmed close.
  A saved-URL tab displays metadata only and never opens a page.

### History, Downloads, Settings, Privacy, and navigation

- [`HistoryScreen.kt`](app/src/main/kotlin/org/parmar/aether/ui/HistoryScreen.kt)
  and [`DownloadsScreen.kt`](app/src/main/kotlin/org/parmar/aether/ui/DownloadsScreen.kt)
  show shared honest empty-state content. There are no history or download
  models, repositories, writers, files, or transfer operations.
- [`SettingsScreen.kt`](app/src/main/kotlin/org/parmar/aether/ui/SettingsScreen.kt)
  displays app metadata and current status. It has no preferences repository,
  persisted setting, or theme selector.
- [`PrivacyScreen.kt`](app/src/main/kotlin/org/parmar/aether/ui/PrivacyScreen.kt)
  offers confirmed tab/bookmark category deletion and clear-all, displays
  category outcomes, and allows retry for a failed category. History and
  Downloads are not deletion targets because they remain empty.
- [`AetherDestination.kt`](app/src/main/kotlin/org/parmar/aether/ui/navigation/AetherDestination.kt)
  declares the native routes. [`AetherApp.kt`](app/src/main/kotlin/org/parmar/aether/ui/AetherApp.kt)
  owns the `NavHost` and currently wires these screens and callbacks.
- [`AndroidManifest.xml`](app/src/main/AndroidManifest.xml) declares no
  permissions and disables backup. Backup/data-extraction rules explicitly
  exclude the database. Source-manifest inspection is not proof of merged
  manifest or device behavior.

### Build and tests

- [`app/build.gradle.kts`](app/build.gradle.kts) and
  [`gradle/libs.versions.toml`](gradle/libs.versions.toml) retain the existing
  Compose, Navigation Compose, and JUnit dependency set. Persistence uses
  Android's built-in SQLite APIs; no network, WebView, Room, or DataStore
  dependency was added.
- Unit tests cover URL/title validation, duplicates, update identity, the
  bookmark limit, tab close/active-selection rules, and contract copy. They do
  not prove SQLite transactions, process restoration, UI instrumentation, or
  runtime offline behavior.
- The Android unit-test command was attempted with Gradle offline mode but
  could not resolve the uncached Android Gradle Plugin. No Android build or
  device test has been verified.

## 2. Implemented storage choice

The source uses Android's built-in **SQLiteOpenHelper** for structured
bookmark and tab metadata. Room was recommended in the original proposal, but
was not added because its dependencies were not present and fetching packages
was not authorized. SQLite is app-private and adds no third-party dependency.
This is a deliberate implementation deviation; Room remains a future
refactor option, not a prerequisite for the current offline milestone.

The database has explicit version 1, exact columns, a unique index via the
bookmark URL constraint, and transaction-scoped mutations. Upgrade and
downgrade paths fail closed rather than destructively replacing unknown data.
Any future schema change requires an explicit sequential migration and
fixtures before incrementing the database version.

The current Settings screen has no functional preference. No preference store
or speculative preference field is added. If a local preference is approved,
use a strict key allowlist and surface read/write errors.

No desktop JSON store, external service, network synchronization, cloud
account, or shared PARMAR backend is an authority for Android data.

## 3. Persistent records and invariants

The platform-neutral allowlisted schemas in
[`../AETHER-MOBILE-OFFLINE-CONTRACT.md`](../AETHER-MOBILE-OFFLINE-CONTRACT.md)
remain authoritative. SQLite rows map to those schemas without adding
page contents, secrets, or unapproved fields.

### Bookmarks

Persist only:

- Stable UUID identifier.
- Canonical credential-free HTTPS URL, maximum 2,048 characters.
- Nonempty title, maximum 300 characters after trimming. If the user omitted
  the optional title, persist a generic label such as `Saved address`; do not
  invent a site title.
- `createdAt` and `updatedAt` UTC Unix epoch milliseconds.
- Record schema version 1. The SQLite database schema version is maintained
  independently.

Preserve the current URL rules: trim; require an absolute hierarchical HTTPS
URI and a host; reject user information and invalid ports; lowercase scheme
and host; remove port 443; normalize path dot segments; map an empty path to
`/`; preserve query and fragment; reject canonical URLs over the limit. No DNS
lookup, preview, navigation, or network request is part of validation.

Enforce uniqueness on the canonical URL with a database unique index as well
as repository validation, so concurrent add attempts cannot create duplicates.
Duplicate equality is exact equality after the canonicalization above; query
and fragment remain significant.

Enforce the 500-record maximum inside a transaction, not only in the UI.
Adding a duplicate returns a duplicate outcome and does not overwrite the
existing bookmark. Updating a bookmark is a separate explicit repository
operation: preserve its stable ID and original creation time, validate the
new URL/title, refresh `updatedAt`, and reject a URL colliding with another
record. Removal addresses the stable ID. No open/visit operation exists.

### Tabs

Persist only approved local descriptor metadata:

- UUID `id`.
- `kind`: `new` or `saved-url`.
- `url`: null for `new`; canonical credential-free HTTPS URL for `saved-url`.
- Optional user-entered title only; no inferred page title.
- `pinned`, display `order`, `createdAt`, and `updatedAt`.
- Session envelope `activeTabId`, null only when no tabs exist.
- Record and database schema versions as required by the contract/storage.

Enforce the contract's maximum of 16 descriptors in a transaction. Preserve
ordering and active selection on insert, close, pin, reorder, and restore.
Closing a tab deletes its descriptor and selects a remaining descriptor
according to the explicit selection policy; the last tab leaves
`activeTabId = null`.

Restoring `new` or `saved-url` records restores metadata only. It must not
resolve, open, preview, reload, or hand off a URL. Never persist page contents,
browser caches, screenshots, cookies, credentials, tokens, renderer state, or
session secrets. Private-session data, if approved in a later milestone, is
memory-only and excluded from every database, backup, export, diagnostic, and
migration.

### History

Keep History empty and without a writer, persistent table, or migration input
until actual browsing is separately approved and exists. The current shell has
no browsing events; do not derive visits from typed bookmark input, bookmark
changes, tab creation, selection, restoration, or navigation between app
screens.

For a future, separately approved feature, a candidate schema would require a
UUID, canonical URL, user-visible title if actually observed, actual visit
timestamp, and provenance/event type, with bounded retention and deletion
rules. That schema is **not part of this design's current database** and
cannot be populated by current features.

### Downloads

Keep Downloads empty without a record table, writer, transfer, import, or
fabricated file. Current local bookmarks and tabs are not downloads.

A future, separately approved transfer feature would need an independently
reviewed metadata schema (for example UUID, locally owned file reference,
actual transfer state and timestamps), file ownership/cleanup rules, and
security review. It is **not part of this design's current database**; do not
store fake progress, filenames, or completion results.

## 4. Schema, atomicity, corruption, and migration

1. The current SQLite database schema is version 1. Record-level
   `schema_version` is also stored and validated as version 1.
2. No upgrade migration is currently defined. `onUpgrade` and `onDowngrade`
   fail closed rather than replacing unknown data. Before incrementing the
   database version, add explicit sequential migrations and fixtures for
   bounds, URL rules, IDs, titles, timestamps, tab order, and active-tab
   integrity.
3. Bookmark and tab mutations, including duplicate/limit checks and active
   selection/order updates, run in SQLite transactions. Each category clear is
   atomic independently; clear-all attempts each category separately.
4. No destructive migration fallback, silent default replacement, or
   automatic database deletion/recreation is configured. Unknown versions and
   invalid rows surface as storage errors rather than empty data.
5. The UI presents initial loading and storage-error states. Corruption and
   unavailable-database recovery behavior still requires device-level
   fault-injection verification; no recovery guarantee is claimed.
6. If a future recovery or export path is approved, it must be local, explicit,
   user-confirmed, bounded, and reviewed for URL sensitivity. No recovery
   upload or cloud copy is allowed.

## 5. Ownership and API boundaries

The current source responsibilities are:

- **Database provider:** `AetherApplication` owns one `LocalAetherDatabase`.
  It performs local SQLite work only.
- **BookmarkRepository:** `LocalAetherDatabase` implements validated
  `list/add/update/remove` and transactional clear operations. It enforces
  canonical URL uniqueness, the 500 limit, stable UUIDs, and title rules.
- **Tab operations:** `LocalAetherDatabase` transactionally creates, closes,
  activates, pins, and reorders descriptors; restore returns metadata only.
- **Preferences:** no preference store exists because no local preference has
  been approved and implemented.
- **UI state:** `AetherApp` loads stored records and surfaces
  `AetherStorageException` messages. Screens do not receive a database handle
  except through the app composition root.
- **Migration responsibility:** database version 1 currently has no
  migration path. A future version change must add explicit sequential
  migrations before shipping.

Storage failures must be surfaced as typed outcomes with actionable
user-facing status where appropriate. Broad catches, silent fallbacks, and
success-shaped empty results are prohibited.

## 6. Deletion, lifecycle, backup, and privacy

### Deletion semantics

- Bookmark removal deletes only the addressed record; clear-bookmarks is a
  separately confirmed, transactional category operation.
- Tab close deletes only the addressed tab and updates active selection
  atomically. Clear-tabs is separately confirmed and affects only tab metadata.
- Preference deletion affects only implemented preference keys.
- Clear-all is a coordinator across categories, not a single cross-store
  transaction. Return a result for each requested category:
  `deleted`, `already-empty`, `failed`, or `not-attempted`. Overall success
  requires every requested category to be `deleted` or `already-empty`.
- History and Downloads are not deletion targets while there are no records or
  writers. Do not display them as successfully cleared.
- Report the exact category results and failure; never claim all data was
  erased when some categories failed or were not attempted.
- A confirmed deletion means the addressed application records were removed.
  It does not prove secure erasure from flash storage, SQLite/WAL remnants,
  backups, OS snapshots, or other artifacts.

### App and process lifecycle

Committed bookmark and tab metadata is stored in the app-private SQLite
database and is read when the app composition is initialized. A restored tab is
an offline descriptor, never a request to load its URL. Restart and
process-death restoration are implemented in source but remain unverified
until an Android build and device/emulator test are available. Private-session
metadata remains excluded and is not an M1 feature.

### Local boundary and backups

Keep the database and any future DataStore in app-private storage. Do not add
sync, account services, telemetry, external storage, export, or import. The
manifest disables backup and provides explicit database exclusions for cloud
backup and device transfer. Merged-manifest and device behavior still require
verification on supported Android versions.

Treat bookmark URLs and titles as sensitive metadata. Never store browser
credentials, cookies, authentication headers, provider secrets, page content,
or private-tab state. Do not claim encryption, secure deletion, anonymity, or
complete privacy; this design does not implement or verify those properties.

## 7. Remaining verification plan

Source-level tests cover bookmark rules and tab selection behavior. The
following database, lifecycle, UI, and runtime checks remain unverified:

1. **Repository persistence:** add and close the app/repository, reopen it,
   and verify bookmark URL/title/stable ID and tab metadata round-trip.
2. **Process recreation:** recreate the process/application owner and verify
   restoration without relying on Compose `remember` state.
3. **Bookmark validation and duplicates:** reject non-HTTPS, malformed,
   credentialed, overlong, invalid-port, and oversized-title input; verify
   every normalization rule and duplicate equivalence, including query and
   fragment significance.
4. **Record limits:** verify the 500th bookmark/16th tab is accepted and the
   next record is rejected atomically, including concurrent add attempts.
5. **Tab restoration:** verify ordering, active-tab referential integrity,
   close behavior, and that restoring `saved-url` never resolves or loads a
   website.
6. **Migration:** test every sequential migration using versioned fixtures,
   including valid conversion, invalid rows, unknown versions, rollback, and
   preservation on failure. No upgrade migration exists at database version 1.
7. **Corruption and unavailable storage:** inject read/write and migration
   failures; verify the UI receives an explicit error, does not show false
   emptiness, and does not report successful mutation.
8. **Deletion:** force independent SQLite failures and verify per-record
   removal, category clear, already-empty, failure, and partial/complete
   aggregate outcomes. Confirm History and Downloads are not reported as
   deletion targets while empty.
9. **Offline boundary:** use static dependency/manifest checks and runtime
   instrumentation appropriate to the eventual environment to verify no
   network request, DNS lookup, WebView, external handoff, or remote sync is
   introduced by storage or restore.
10. **Backup policy:** inspect merged manifest and backup/data-extraction
    behavior on supported Android versions; verify the sensitive database and
    preferences are excluded as designed.

## 8. Remaining implementation and verification gate

The source implementation uses native SQLite, a UUID metadata schema, backup
exclusions, a local persistence owner, and category deletion controls without
adding packages or changing the compile/target SDK matrix. The required
Android Gradle Plugin is not available in the local offline cache, so Android
build, unit-test, merged-manifest, and device acceptance remain blocked.
Do not treat source inspection or pure unit tests as proof of restart,
corruption, accessibility, backup, or no-network behavior.
