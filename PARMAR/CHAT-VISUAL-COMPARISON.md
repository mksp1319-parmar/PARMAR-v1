# PARMAR Chat — Visual Comparison

**Status:** Qualitative comparison, repository-grounded; no measured pixel similarity or fabricated reference

## 1. Reference basis

The visual target is a Gemini-inspired quality direction: minimal, spacious, calm, and strongly centered on the conversation. It does not copy Gemini branding, layout artifacts, or generated assets. No Gemini screenshot or formal style package was supplied with this repository. Therefore:

- this is a qualitative comparison;
- no 99% or exact-match claim is made;
- no external reference screenshot is represented as an approved PARMAR asset;
- the only factual before-state evidence is the four repository-captured after-screenshots listed below.

Repository baseline captures:

| Viewport | Repository path |
|---|---|
| 1440×1000 desktop | `interface/visual-tests/artifacts/screenshots/after/chat-desktop-1440x1000.png` |
| 768×1024 tablet | `interface/visual-tests/artifacts/screenshots/after/chat-tablet-768x1024.png` |
| 390×844 mobile | `interface/visual-tests/artifacts/screenshots/after/chat-mobile-390x844.png` |
| 390×460 short mobile | `interface/visual-tests/artifacts/screenshots/after/chat-mobile-short-390x460.png` |

Existing before-capture paths are also preserved:

- `interface/visual-tests/artifacts/screenshots/before/chat-desktop.png`
- `interface/visual-tests/artifacts/screenshots/before/chat-tablet.png`
- `interface/visual-tests/artifacts/screenshots/before/chat-mobile.png`

PARMAR’s distinct graphite/warm-white/copper identity is retained.

## 2. Comparison matrix

| Area | Current PARMAR evidence | Gemini-inspired target quality | Identified gap | Required change | Acceptance criterion |
|---|---|---|---|---|---|
| Workspace focus | Screenshot shows a bordered full workspace, page heading, status bands, history rail, topline and composer. | A quiet primary canvas with few competing outer panels and chrome. | Chat is information-rich but has multiple small bands and a relatively top-heavy shell. | Keep the same DOM, but reduce heading and status emphasis and let thread/composer dominate. | Desktop thread plus composer occupy the visual hierarchy; no redundant card or toolbar hierarchy. |
| Outer canvas | Deep charcoal with a bordered rounded surface and left history rail. | Broad, low-friction canvas with restrained surface boundaries. | Surface currently presents as a framed application module rather than an open conversation stage. | Soften border/gradient, keep surface rectangular or modestly rounded, and remove unused visual layers. | Surface reads as one canvas; no cyberpunk glow or dashboard-card appearance. |
| Sidebar | 262 px Chat rail plus 264 px global sidebar on desktop. | Compact, clear navigation and history, not a duplicate global menu. | Two navigation layers can compete, especially on tablet and mobile. | Preserve both owners but keep Chat rail narrower and visually subordinate to the global sidebar. | Each sidebar owner has a clear name/action; no duplicated controls or focus conflict. |
| History | Search, scope, “New chat,” title rows and a 262 px rail. | Fast, calm access to recent conversations and search. | Rows/labels are compact and status and rail chrome may feel dense. | Use 268 px rail, 44–48 px rows, clearer group labels and a single restrained new-chat action. | Keyboard order, search scope and active row are obvious; no false server-search promise. |
| Welcome state | P monogram, eyebrow, serif headline, description and three prompt chips. | Simple, confident prompt-led welcome with spacious but useful composition. | It is close, but can feel more like a status panel than an assistant canvas. | Reduce repeated PARMAR labels, retain one monogram/eyebrow and center prompt composition. | Empty state is calm and visible at all target heights without covering composer. |
| Prompt text | “A clearer view of your next decision.” | Warm, direct and contextually useful. | Good but safe-review language is secondary to the availability band. | Preserve the copy and status truthfulness; separate benefit copy from capability status. | Local Demo disclosure is explicit and not implied as AI inference. |
| Transcript | Plain text turns, 31 px avatars, 27 px separated rows, and copy action. | Natural, readable turn hierarchy with a spacious reading column. | Assistant text is centered in a 790 px thread but metadata/avatar/bubble weights may feel institutional. | Use 760 px thread, 720 px assistant text, 620 px user bubble, and 28–32 px turn spacing. | Long text is readable and no overflow, bubble clipping or cramped metadata occurs. |
| Typography | System sans plus Georgia empty headline. | Clear sans UI, excellent prose rhythm, selective editorial heading. | Small context labels and dense 0.54–0.84 rem text reduce hierarchy. | Consolidate to 15–16 px assistant prose, 34–38 px heading desktop, 11–12 px metadata. | Text passes visual hierarchy review and 200% zoom. |
| User message | Amber-tinted small bubble. | Conversational but restrained. | Bubble can be too small/technical compared with the canvas. | Keep a modest bubble with 16 px radius and 12–14 px inset. | User text is distinct without dominating assistant text or impersonating status UI. |
| Assistant message | Unboxed text with avatar and Copy. | Spacious, natural response text. | Copy and metadata occupy a small persistent row. | Keep Copy accessible but quiet; reserve richer actions for approved implementation. | Only Copy is visible and it produces exact released text. |
| Composer | Bordered 790 px composer with textarea and toolbar. | A prominent, rounded, floating-feeling prompt surface. | On desktop it is stable but fairly dense; on mobile, tools and labels compete for width. | Use 760 px max, 16 px radius, 56 px textarea base, 48 px desktop send, 44 px compact targets. | Composer remains readable and visible at desktop, tablet, mobile and 390×460. |
| Composer controls | Research, unavailable Files, VOKKI, Send, count and keyboard hint. | Clear primary send and a few honest secondary actions. | Files unavailable text may be visually prominent for a disabled capability; the toolbar can crowd narrow screens. | Keep Research, visibly disabled Files, and VOKKI alongside Send; hide unavailable tool labels on compact layouts and retain accessible names. | No fake control works; disabled and unavailable states are understandable. |
| Status | 39 px availability band with dot, text and alternate states. | Small, legible, non-alarming system context. | It occupies a strong horizontal band and can consume short-height space. | Retain a one-line band but compact it to 32–38 px and place it below topline. | Status wraps to no more than two lines; short-height layout remains usable. |
| Loading | Existing transport waiting row. | Existing request state, clearly distinct from provider generation. | A “waiting” row could be mistaken for provider streaming. | Use compact transport status and exact copy: waiting for a response/no provider stream. | It is never labeled or styled as token streaming. |
| Empty/offline/error/denied | Existing availability states in app.js and CSS. | State is legible without dominating or simulating recovery. | Red/amber colors and small copy may not remain clear on mobile. | Preserve state meaning, add text and dot; use existing accessible live region. | Send, drafts and status remain correct in automated state tests. |
| Mobile | 390 px screenshots show compact surface and 44 px controls. | Independent, focused mobile composition. | At 390 px the welcome hero may still consume too much space; short-height view only prioritizes composer. | Independently tune page heading, thread, prompts and composer; hide suggested prompts under 580 px. | 390×844 and 390×460 have no overflow and send remains hit-testable. |
| Tablet | 768 px history collapses to drawer. | Tablet is not a shrunken desktop. | Global and local navigation plus surface height need separate treatment. | 44 px drawer controls, 320–340 px drawer, 760 px reading column and independent composer fit. | Automated layout, focus and screenshot checks pass at 768×1024. |
| Short height | 390×460 composer remains visible in captured baseline. | Keyboard and compact-height layout prioritize active work. | Empty decoration can crowd or disappear unexpectedly. | Deactivate prompts and large emblem, compact status/topline and keep thread/composer usable. | Input and Send bottom within 460 px and no page overflow. |
| Animation | Existing message and panel transitions. | Small, optional motion that never implies backend state. | Some legacy reveal/hover transitions are not scoped and may imply activity. | Use 140/220 ms tokens and reduced-motion reset; no new shimmer or spinner. | Motion is disabled under preference and no animation implies provider progress. |
| Logo | Existing PARMAR wordmark and emblem. | Preserve premium identity. | Existing logo asset and placement must not change. | No logo replacement, recoloring or aspect-ratio change. | Current asset files and accessible names remain unchanged. |

## 3. Quantitative baseline, not equivalence

The repository test currently measures:

- no document horizontal overflow;
- no collapsed composer;
- send and composer bounds inside the viewport;
- 44 px targets at widths 900 px and below;
- 390×460 short-height input/send visibility;
- history focus and escape behavior.

It does not prove visual similarity to Gemini or any other external product. The next visual phase must add:

- screenshot pixel/storage inspection;
- optional structural geometry reports;
- human inspection;
- fix-and-repeat checks;
- no claimed percentage match.

## 4. Reference limitations

- No source Gemini reference image or permission-controlled asset set is included.
- Gemini is being used as a qualitative interface-quality direction, not a copy target.
- The exact font, product assets and proprietary visual details are not reconstructed.
- The result must retain PARMAR branding and be distinguishable.
- Success is acceptance against this matrix and user/test evidence, not an imagined similarity score.

## 5. Post-implementation visual result

The redesigned implementation was inspected at:

- `interface/visual-tests/artifacts/screenshots/after/chat-desktop-1440x1000.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-tablet-768x1024.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-390x844.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-short-390x460.png`

The implementation improves the canvas, composer, history and empty-state hierarchy while retaining PARMAR's original logo assets and Local Demo disclosure. The comparison remains qualitative: no external Gemini reference image was used and no percentage similarity is claimed.

## 6. Phase 2.1 visual acceptance audit

### Actual evidence reviewed

The four final captures were reopened after the correction pass:

| Viewport | Result | Actual evidence |
|---|---|---|
| 1440×1000 | Pass | 268 px history rail is present, the 760 px composer fits, the context heading is compact, and the thread/welcome/composer hierarchy is clear. |
| 768×1024 | Pass | History remains compact/drawer-oriented, the top line remains legible, and the 760 px reading/composer area is independent of the global sidebar. |
| 390×844 | Pass | Mobile has a focused canvas, 44 px controls, a compact status band and a bottom-visible composer with no horizontal overflow. The page-level explanatory subtitle is hidden. |
| 390×460 | Pass | The availability band, welcome heading, textarea and Send remain visible; prompts and decorative content give way to the active composer. |

### Criterion result

| Criterion | Audit result | Evidence |
|---|---|---|
| Workspace architecture | Pass | The existing SPA shell now presents a compact context header, history rail/drawer, focused canvas, availability state and composer. |
| Sidebar/navigation | Pass | The global sidebar and Chat history rail remain separate; mobile/tablet history uses the existing drawer/focus behavior. |
| Welcome screen | Pass | The P monogram, restrained eyebrow, editorial heading, disclosure and prompt chips form one compact empty-state hierarchy. |
| Conversation canvas | Pass | The surface is a single calm graphite canvas with a 760 px reading column and subtle copper state emphasis. |
| Message hierarchy | Implemented but no non-empty transcript capture was generated | Existing scoped DOM styles define separate metadata, avatar, assistant text, user bubble and Copy action. |
| Composer | Pass | 760 px desktop maximum, 16 px radius, 56 px textarea, 48 px desktop Send and 44 px compact targets are represented. |
| Typography/spacing | Pass | Contextual labels, assistant prose, empty headline and composer text have independent type scales and generous rhythm. |
| Surfaces/interactions | Pass | Borders, graphite surfaces, restrained copper, 44 px targets, focus and reduced-motion rules are consistent. |
| Mobile-independent layout | Pass | Mobile hides the page subtitle, reduces gutters and keeps controls independently sized rather than merely shrinking desktop. |
| Short-height behavior | Pass | Short-height capture keeps the composer visible and reduces decoration. |

### Genuine redesign versus restyling

The repository's existing Chat markup and behavior were already substantially added by the earlier Phase 2 work. The visual implementation is therefore primarily a CSS redesign of an existing component structure, not a new application architecture:

- `index.html` now contains the Chat workspace, history, topline, availability, thread and composer structure.
- `app.js` owns drafts, history, request sequencing, response release and availability behavior.
- `chat-redesign.css` replaces the former dedicated Chat cascade with a scoped, token-oriented visual system.
- No authenticated provider, model, streaming, attachment, Markdown or memory behavior was introduced by this audit.

This audit did not rewrite the component structure or business logic. It corrected the remaining mobile subtitle and compact desktop heading dimensions and added geometry assertions.

### Remaining visual differences

- No external Gemini reference screenshot or official reference geometry was supplied, so exact equivalence cannot be measured.
- The Chat shell remains a framed workspace rather than a completely borderless Gemini-style canvas. This is a deliberate PARMAR distinction and preserves existing navigation/security/status context.
- The empty state is more compact and safety-led than a consumer assistant welcome.
- No transcript with actual message rows was captured in the Phase 2 acceptance set, so assistant prose, metadata and user-bubble hierarchy remain visually unverified by screenshot rather than by CSS/test logic.
- SEC-07 intentionally prevents an authenticated conversation transcript from being produced for a real visual capture.

### Failures found and resolved

1. Mobile 390 px retained the page-level explanatory subtitle; it is now hidden at `max-width: 540px`.
2. Desktop history search/New Chat targets were below or close to the approved 44 px geometry; both now use 44 px minimum.
3. Desktop context heading measured 64.36 px after initial acceptance; compact padding/type were corrected and a measured test now requires no more than 58 px.

### Honest similarity assessment

The redesign is visually aligned with the requested Gemini-inspired qualities: focused canvas, restrained surfaces, quiet history, prominent composer and calm typography. It is not a pixel-copy or measured-match of Gemini. A similarity score is not claimed.

## 7. Phase 3 interaction inventory

| Interaction | Status | Repository evidence / behavior |
|---|---|---|
| New Chat | **WORKING** | `#new-session-btn` clears the current new-chat draft, invalidates the pending client request/reveal, clears the active conversation selection, resets Research and review state, and creates only a browser-local empty session for Local Demo. It does not create an authenticated server conversation. |
| History search/filter | **WORKING** | Both history inputs update `state.historyQuery`; filtering searches only loaded titles and messages. UI explicitly says search is limited to conversations available in this session. Empty result text distinguishes no loaded matches from no history. |
| Conversation selection | **WORKING** | Local selection swaps the displayed session and restores its draft. Authenticated selection uses the existing profile-scoped GET route, validates the response, and rejects stale generations. |
| Global sidebar collapse/expand | **WORKING** | Existing global toggle is independent of Chat history state; desktop uses collapsed/expanded navigation and compact view uses the global modal drawer. |
| Mobile Chat history drawer | **WORKING** | Below 900 px, Chat history uses `role="dialog"`, `aria-modal`, `inert`, scrim, close control, Escape, Tab trap, focus entry and focus restoration. Conversation selection/New Chat close the drawer. |
| Message composer / keyboard | **WORKING** | Enter follows the user preference, Shift+Enter creates a newline, Ctrl/⌘+Enter sends when configured, and IME composition is excluded from submission. Textarea grows to 180 px and Unicode input is capped at 4,000 code points. |
| Send enabled/disabled states | **WORKING** | Send is disabled during session checking, authenticated denial, offline state and in-flight requests; Local Demo can submit its deterministic review request while online. |
| Loading/empty/error/retry | **PARTIALLY WORKING** | Empty history, transport wait, offline, denial, and request failure states exist. Failed Chat requests restore the draft and require a manual re-send; there is no dedicated Chat Retry button. Authenticated history has explicit retry controls. |
| Message actions | **PARTIALLY WORKING** | Copy is implemented and copies exact displayed safe text. Edit, regenerate, delete, share and branch are not implemented and are not exposed. |
| Research control | **PARTIALLY WORKING** | Checkbox is off by default and adds only `research: true` to the existing `/api/chat` request. Actual results require configured/authorized backend research and a releasable response; failure restores the draft. |
| Responsive/touch interactions | **WORKING** | Chat history switches to a drawer at 900 px; tested touch targets are at least 44 px. Existing global sidebar edge gestures remain separate. |
| Accessibility | **PARTIALLY WORKING** | Labels, status live regions, semantic history list, active-row state, focus ring, drawer focus trap/Escape, focus restoration and reduced motion are present and browser-tested. Screen-reader testing and complete 200% zoom audit have not been performed. |
| File attachments | **BLOCKED** | Disabled control only. No Chat upload request path, provider serialization, or retention/consent lifecycle exists. |
| Authenticated conversational AI | **BLOCKED** | SEC-07 and `RuntimeNoGo` still deny authenticated `/api/chat` before conversation access/provider dispatch. |
| Provider/model selector | **NOT IMPLEMENTED** | No selector is rendered; provider inventory is not a capability selector. |
| True streaming / stop | **NOT IMPLEMENTED** | Current request is one-shot. Progressive reveal is presentation after the response; no stream/cancel contract exists. |
| Markdown/code rendering | **NOT IMPLEMENTED** | Message text remains safely inserted as plain text; no parser or syntax highlighter is loaded. |
| Voice in Chat composer | **NOT IMPLEMENTED** | VOKKI remains the separate voice workspace; Chat has a working Open VOKKI navigation action. |

### Phase 3 defects and corrections

1. The newly added mobile global-navigation independence test initially assumed its drawer would synchronously transition from `closing` to `closed`. The implementation intentionally has a transition state; the assertion now waits for the terminal state.
2. The first duplicate-send fixture aborted its mocked request immediately and therefore could not reliably assert the in-flight disabled state. It now holds the request open, checks that Send becomes disabled and that a second draft survives, then releases the failure.
3. A browser process exited intermittently while unrelated navigation/VOKKI tests were running in a broad suite. The Chat-only suite and the clipboard case were rerun in isolation and passed; the broader failures did not produce Chat assertion failures.

### Phase 3 verification

- Chat-only Playwright: **12 passed** (including viewport, search no-match, drawer close/focus, global-nav independence, keyboard submission, duplicate guard, draft retention, copy, Research failure, offline, auth denial and character limit).
- Focused Python authorization/privacy/Chat/UI-state: **209 passed**.
- Focused Node Chat presentation/research/VOKKI: **97 passed**.
- Clipboard test rerun alone: **1 passed**.
- Full visual suite: **30 passed, 3 failed from browser/page process closure**. The failing cases were unrelated settings/customize navigation, integration-draft navigation, and VOKKI desktop. In isolated follow-up, integration-draft and VOKKI desktop each passed; the settings/customize test again ended with `Target crashed` during its Customize-category iteration. Root cause is not established, so this broader suite is reported as not fully passing. The four Chat viewport cases and every Chat interaction passed in the full run.
- JavaScript syntax and `git diff --check`: passed.

The desktop and mobile captures listed in section 5 were reopened during this interaction audit. They show the current implementation's Local Demo disclosure, composer, history rail/drawer and welcome state. The audit did not create an authenticated transcript or alter SEC-07.

### Remaining Gemini-inspired interaction gaps

- No supplied Gemini reference makes interaction parity comparative rather than measurable.
- No transcript screenshot with actual message rows was generated in this cycle; message action coverage verifies Copy behavior against fixture history.
- Chat has no true streaming, model switching, attachments, message editing/regeneration or server-side conversation management; these are intentionally absent or blocked, not parity defects to fake.
- Screen-reader validation with assistive technology and a full 200% zoom pass remain follow-up accessibility work.

## 8. Phase 4 — full-screen workspace and bottom-space recovery

### Root cause

The empty lower area was caused by the layout hierarchy, not an obsolete bottom-navigation element:

- The Chat CSS assigned `flex` sizing and `flex-direction` to `#section-chat`, but the section remained `display: block`; its conversation surface therefore sized to intrinsic content instead of filling the section.
- At tablet widths, the global `.main-panel` also retained 110–112 px of bottom padding from the Home floating-composer layout. Chat has no bottom dock or composer in that reserved area.
- The app-level `.workspace-footer` followed the workspace and was clipped by Chat's `overflow: hidden`, leaving the visible bottom edge looking like an empty black strip.
- The global Home, VOKKI, and More-workspace navigation remains in the existing sidebar/drawer; no destination navigation was deleted.
- The mobile/tablet header also had a separate width defect: the original 552×548 emblem and 680×125 wordmark were rendered at intrinsic size. Browser geometry measured `.topbar-left` at 771 px on tablet and 763 px on mobile, pushing global search past the viewport. The source assets were not changed.

Before correction, browser geometry showed the 1440×1000 Chat surface ending at y=795 and the 390×844 surface ending at y=728, while the section continued to the viewport edge. The 768×1024 surface was 647 px high and ended at y=832. These measurements confirm that the unused space was not available conversation canvas.

### Implementation changes

- Made the Chat app shell and main panel exactly `100dvh`, with zero Chat-only outer padding and margins.
- Made `.workspace` and `#section-chat` actual flex columns, with the conversation surface growing to the remaining width and height.
- Removed the outer Chat card border, radius, and shadow so the conversation canvas is part of the application screen.
- Hid the redundant app footer only while Chat is active; Home and other destinations retain it.
- Removed the inherited reserved bottom padding for Chat and retained a safe-area inset below the composer.
- Kept only the transcript internally scrollable; the composer and keyboard hint remain at the bottom of the Chat workspace.
- Hid the secondary Chat eyebrow on short-height viewports rather than clipping it.
- Sized the original PARMAR header assets through CSS, made compact Chat headers allocate the remaining width to the working global-search field, and inset the page heading from the screen edge.
- Raised the compact navigation toggle to 44×44 px and extended responsive tests to measure the toggle and composer controls' width and height.
- Sidebar navigation stays functional and independent of the Chat history drawer.

### Phase 4 screenshot and geometry evidence

The Phase 4 screenshot output directory is `interface/visual-tests/artifacts/screenshots/phase4/`.

| Viewport | Screenshot | Evidence status |
|---|---|---|
| Before — desktop | `interface/visual-tests/artifacts/screenshots/after/chat-desktop-1440x1000.png` | Reopened before capture shows the boxed canvas and unused bottom area. |
| After — desktop | `interface/visual-tests/artifacts/screenshots/phase4/chat-desktop-1440x1000.png` | Fresh 1440×1000 Playwright capture after final changes; opened and inspected. Canvas reaches the viewport edges below the app header; footer is absent and the composer is visible. |
| Before — mobile | `interface/visual-tests/artifacts/screenshots/after/chat-mobile-390x844.png` | Reopened before capture shows the framed canvas and unused lower area. |
| After — tablet | `interface/visual-tests/artifacts/screenshots/phase4/chat-tablet-768x1024.png` | Fresh 768×1024 Playwright capture after final changes; opened and inspected with the global navigation drawer closed. |
| After — mobile | `interface/visual-tests/artifacts/screenshots/phase4/chat-mobile-390x844.png` | Fresh 390×844 Playwright capture after final changes; opened and inspected. Responsive logo/search are fully inside the viewport. |
| After — short mobile | `interface/visual-tests/artifacts/screenshots/phase4/chat-mobile-short-390x460.png` | Fresh 390×460 Playwright capture after final changes; opened and inspected. Heading fits, composer and Send remain visible. |

The final responsive Playwright cases passed at all four target dimensions. They assert the Chat section and conversation surface reach the viewport bottom, no horizontal overflow, the footer is hidden in Chat, the composer and Send remain visible, the global search stays within the viewport, and compact targets meet 44×44 px. The long-history case separately verifies transcript-only scrolling with a stationary composer. All four final screenshots were opened and visually inspected. The empty bottom strip is gone; its former area is conversation workspace, not a navigation/footer placeholder.

### Phase 4 regression results and crash investigation

- Final Chat responsive/interaction Playwright suite: **13 passed**.
- Final full visual Playwright suite, including Settings/Customize, all destinations, AETHER restrictions and VOKKI desktop/tablet/mobile: **34 passed**.
- The Settings/Customize test that had reproducible `Target crashed` failures later passed in isolation and in the full 34-test run. Reduced-motion navigation and the existing Back to Settings control avoid repeatedly launching smooth-scroll transitions. Earlier runs coincided with low shared-host memory; cgroup OOM counters were zero. There is no Chromium application stack trace to establish a single cause, so the prior intermittent renderer failure is recorded as no longer reproduced, not as a proven product-level fix.
- The mobile edge-navigation test initially sampled the drawer before its closing transition completed. It now waits for the existing closed state after selecting Chat; the isolated test and final full suite pass.
- Focused Python authorization/privacy/Chat/Research/UI-state/VOKKI selection: **468 passed**.
- Focused Node Chat/Research/Home/VOKKI regression group: **108 passed**.
- JavaScript syntax checks and `git diff --check`: passed.

### Security and remaining acceptance

- SEC-07 and `RuntimeNoGo` remain intact. No authenticated AI response, provider egress, denied-request conversation creation, model switching, streaming, or attachment handling was added.
- Local Demo remains explicitly deterministic safety review, not conversational AI.
- The four final captures show an integrated full-screen workspace at the requested sizes. They support a qualitative Gemini-inspired comparison only; there is no supplied Gemini reference screenshot or objective pixel-similarity score.
- Physical-device keyboard-inset behavior and assistive-technology/200% zoom checks were not available in this browser run. No remaining automated visual or navigation failure is known.
