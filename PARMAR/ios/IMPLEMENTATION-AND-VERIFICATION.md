# AETHER iOS implementation and verification requirements

Status: NOT STARTED. No iOS project, Xcode project, Swift package, or Swift
source exists in this repository. This document describes the native project
to create; it is not evidence of an iOS implementation or build.

## Required native structure

Create an Xcode project with an iOS application target named `Aether` and a
unit/UI test target. Use SwiftUI navigation and native forms, lists, and
confirmation dialogs. Do not add `WKWebView`, WebKit browser views, URL
session/network clients, Network Extension, external URL opening, browser
engine, or an internet permission/entitlement.

Suggested source layout:

```text
PARMAR/ios/
  Aether.xcodeproj/
  Aether/
    App/AetherApp.swift
    Navigation/AetherDestination.swift
    Screens/HomeView.swift
    Screens/TabsView.swift
    Screens/BookmarksView.swift
    Screens/HistoryView.swift
    Screens/DownloadsView.swift
    Screens/SettingsView.swift
    Screens/PrivacyView.swift
    Screens/ParmarVokkiView.swift
    Data/AetherPersistenceController.swift
    Data/BookmarkRepository.swift
    Data/TabRepository.swift
    Data/BookmarkURLValidator.swift
    Resources/Assets.xcassets/PARMAR.emblemset/
  AetherTests/
    BookmarkURLValidatorTests.swift
    BookmarkRepositoryTests.swift
    TabRepositoryTests.swift
    DeletionCoordinatorTests.swift
    OfflineContractTests.swift
  AetherUITests/
    NavigationAndAccessibilityTests.swift
    OfflineShellTests.swift
```

The emblem must be copied byte-for-byte from
`../interface/static/assets/parmar-emblem.png`, displayed with aspect fit, and
checked against SHA-256
`d2327d8b5853a4c9dd5e43b8a776c3f91a962276b37cd1c8e136cab7db81c98d` both as
the source asset and from the built application bundle.

## Data and behavior requirements

- Implement Core Data persistence for tab descriptors and bookmarks, using an
  explicit model version and sequential, tested migrations. Use UserDefaults
  only for a separately approved, implemented local preference.
- Persist UUID IDs, schema version, canonical credential-free HTTPS URLs,
  optional user-entered tab titles, nonempty bookmark labels, and nonnegative
  UTC epoch-millisecond timestamps. Enforce the shared 16-tab and 500-bookmark
  limits, URL/title bounds, uniqueness, ordering, and active-tab referential
  integrity transactionally.
- Treat restored tab URLs as metadata only. Never resolve, load, preview, or
  hand off them. Do not write History or Downloads records.
- Keep stores in the app sandbox, apply file protection, and exclude sensitive
  metadata from cloud backup and device transfer. Do not claim secure
  erasure, encryption, or anonymity without independent evidence.
- Show loading and storage errors instead of success-shaped empty data. Unknown
  schema versions, corrupt rows, and migration failures must preserve the
  source where possible and remain visible.
- Clear tabs and bookmarks as separate atomic category operations. Show
  `deleted`, `already-empty`, `failed`, or `not-attempted` per requested
  category; provide retry for failures and require action-specific user
  confirmation.
- Keep History and Downloads honestly empty, address/search visibly disabled,
  and PARMAR/VOKKI content informational only. VOKKI suggestions do not
  authorize browser actions.
- Follow `../AETHER-MOBILE-OFFLINE-CONTRACT.md` for required copy, design
  tokens, accessibility, offline behavior, and exclusions.

## Verification gates

On an Apple development host, run the project’s focused tests and build using
the actual selected Xcode scheme and simulator destination, for example:

```sh
xcodebuild test -project PARMAR/ios/Aether.xcodeproj \
  -scheme Aether \
  -destination 'platform=iOS Simulator,name=<available iPhone simulator>'
```

Record the selected Xcode and SDK versions, exact destination, exit code,
passed/failed/skipped counts, and any signing or simulator limitation. Do not
report a build or test as passed unless that command was executed on the Apple
host.

Acceptance additionally requires:

1. Inspect target capabilities and linked frameworks for absence of WebKit
   browsing, network clients, Network Extension, and external URL handoff.
2. Verify source and built-bundle emblem hashes and aspect-fit presentation.
3. Test migration, persistence across relaunch/process termination, active-tab
   restoration, bookmark add/edit/remove/search, bounds, duplicate URLs, and
   corruption/error states.
4. Inject independent storage failures for tabs and bookmarks and verify
   per-category partial deletion and retry semantics.
5. Run VoiceOver and Dynamic Type checks; exercise small and large iPhones,
   iPad split layouts, rotation, and app lifecycle restoration.
6. Observe simulator/device network activity throughout all M1 flows and
   retain evidence of no application-originated external request.

No iOS build, simulator, device, persistence, logo-bundle, accessibility, or
network verification has been performed by this document.
