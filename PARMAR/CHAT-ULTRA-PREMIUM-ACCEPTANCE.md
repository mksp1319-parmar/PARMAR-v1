# PARMAR Chat — Ultra-Premium Acceptance Blueprint

**Status:** Phase 1 acceptance and test strategy  
**Scope:** visual-first Chat redesign; implementation remains gated by existing authorization and data decisions

## 1. Release gates

The ultra-premium redesign is not complete merely because it looks better. Every gate below must pass:

1. Repository and branding preservation.
2. Truthful capabilities and SEC-07 fencing.
3. Desktop, tablet, mobile and short-height visual acceptance.
4. Keyboard, focus and touch-target acceptance.
5. Existing behavior regressions.
6. No new cross-workspace cascade damage.

## 2. Functional acceptance

| ID | Criterion | Evidence |
|---|---|---|
| F01 | Home remains startup and existing workspace navigation remains intact. | Existing navigation test suites and browser smoke. |
| F02 | New Chat clears a new conversation/draft state as implemented and does not create an authenticated server record without an approved send path. | Existing/new drawer tests. |
| F03 | History search states loaded-only scope and filters only loaded records. | `chat-responsive.spec.cjs` draft/search tests. |
| F04 | Switching conversations preserves unsent drafts per session and New Chat does not silently retain old text. | Existing draft test. |
| F05 | Copy copies exact safe plain-text message content and reports copied/unavailable honestly. | Existing copy test. |
| F06 | Research remains opt-in and uses the existing request path. Failure restores the draft and no alternate provider is selected. | Existing research failure test. |
| F07 | Offline state disables send and preserves the draft. | Existing offline test. |
| F08 | Authenticated Chat stays denied and dispatches zero `/api/chat` requests while the fence is active. | Existing authenticated-denial test. |
| F09 | Character count uses Unicode-aware code points and caps at exactly 4,000. | Existing 4,000-character test. |
| F10 | VOKKI navigation opens the existing separate workspace and preserves canonical assets. | VOKKI and navigation suites. |
| F11 | Attachments remain disabled and unconnected. | Disabled DOM control and no upload route. |
| F12 | No model/provider selector, true streaming, stop/cancel, rich Markdown, edit/regenerate/delete/rename/archive, or memory control is falsely shown. | DOM and behavior review. |

## 3. Visual acceptance

### Desktop 1440×1000

- document width equals or is less than viewport;
- 760 px reading/composer targets are centered or consistently aligned;
- history rail is approximately 268 px;
- no message, status, heading or composer overlap;
- composer and Send remain within the viewport;
- page heading and transcript do not compete for dominance;
- PARMAR wordmark and existing emblem maintain exact assets/aspect ratios.

### Tablet 768×1024

- history is closed by default using compact modal behavior;
- opening history creates a scrim and 320–340 px drawer;
- drawer opening, selection and Escape restore focus;
- thread remains independently scrollable;
- composer controls have 44 px targets;
- no horizontal overflow.

### Mobile 390×844

- page uses independent mobile composition, not desktop shrink;
- global and Chat history panels do not overlap unexpectedly;
- outer gutter is 12 px;
- textarea does not trigger iOS zoom under 16 px font;
- Send and icon controls remain 44 px hit targets;
- no page horizontal overflow.

### Short mobile 390×460

- availability, textarea and Send remain visible;
- input/send bottom bounds stay within viewport;
- suggested prompts are compact or hidden;
- thread has a usable minimum viewport;
- virtual keyboard behavior remains grounded in `100dvh` and safe-area rules.

## 4. Component acceptance

| Component | Requirement |
|---|---|
| History rail/drawer | Search scope, New chat, close, rows, scrim and focus trap are truthful and accessible. |
| Conversation topline | Compact, non-wrapping, state-bearing and independent of availability copy. |
| Availability band | One or two clear lines; no false status; text plus dot/label. |
| Welcome state | Centered but restrained; one monogram, one heading, one explanation, useful prompts. |
| Thread | 760 px maximum desktop reading column, independent overflow, no untrusted HTML. |
| User message | Modest bubble; no oversized card; exact text preserving whitespace. |
| Assistant message | Unboxed/plain-text by default; clear metadata; only Copy action. |
| Composer | 16 px radius, 56 px textarea base desktop, 44 px compact tools, 48 px Send desktop. |
| Character count | 4,000 limit is exact and near-limit state is legible. |
| Status controls | Disabled controls remain discoverable and explain their missing capability. |

## 5. Accessibility acceptance

- At least 44 px target for every compact-layout control.
- Visible `:focus-visible` uses a high-contrast ring and offset.
- History drawer has modal semantics and Escape/focus restoration at compact widths.
- Tab is trapped only inside an open compact drawer.
- The textarea has an accessible label and description.
- Status text is concise and uses polite live regions.
- The thread is keyboard-scrollable and message copy remains in focus order.
- All icon-only controls have accessible names.
- No color-only information for status.
- 200% browser zoom does not produce page overflow or inaccessible controls.
- Reduced motion disables Chat-specific transitions.
- Mobile safe-area bottom/keyboard behavior is tested.

## 6. Security acceptance

The following remain mandatory and unchanged:

- `RuntimeNoGo` still rejects authenticated Chat.
- SEC-07 remains BLOCKED until written authority approval and approved implementation exist.
- `/api/chat` is not dispatched for denied authenticated state.
- No provider/model setting bypasses server authorization.
- No browser credentials or provider calls are introduced.
- No Local Demo history migrates silently to server history.
- No rich HTML is derived from provider output.
- No stale response is inserted after conversation, profile or auth switch.
- No research/source data is shown for withheld, failed or unvalidated output.
- VOKKI remains separate and no voice/composer duplicate controller is introduced.

## 7. Test strategy

### Required Playwright

Run the existing `chat-responsive.spec.cjs` suite and extend it only for newly implemented behavior:

- desktop 1440×1000;
- tablet 768×1024;
- mobile 390×844;
- short-height 390×460;
- optional keyboard-open variant;
- history open/close/escape/focus;
- drafts and loaded-history search;
- copy exact text;
- research failure/draft restoration;
- offline and auth-denied state;
- character limit;
- no horizontal document overflow;
- send hit target and 44 px compact targets.

Screenshot output must be saved under `interface/visual-tests/artifacts/screenshots/after/` after human inspection.

### Required regression suites

Use the existing repository suites rather than replacing them:

- full Playwright suite;
- Python Chat, auth, privacy and UI-state suites;
- Node Chat, VOKKI, navigation and design/reference suites;
- JavaScript syntax and `git diff --check`;
- `test_conversation_http.py` for no-go/no-side-effect ordering;
- VOKKI cross-workspace conversation/voice tests.

No passing mock test is evidence of live provider reachability or production authorization.

## 8. Regression risks

| Priority | Risk | Mitigation |
|---|---|---|
| P0 | Authenticated fence weakened or provider call moved ahead of authorization | Preserve pre-effect no-go order and zero-effect/zero-provider tests. |
| P0 | Candidate provider content exposed before release | Preserve authoritative release contract and plain-text rendering. |
| P1 | CSS leak changes VOKKI, AETHER or Home | Scope every new rule under Chat and rerun unrelated suites/screenshots. |
| P1 | Refactor conflates Local Demo and AI | Preserve exact availability copy and no provider label. |
| P1 | History or draft logic loses unsent text | Test every conversation switch and New Chat. |
| P1 | Mobile composer covers or clips the thread | Test keyboard/short-height and independent scroll. |
| P1 | Drawer's focus trap or Escape is broken | Test focus first/last, background, and restoration. |
| P1 | Rich Markdown/security becomes the default accidentally | Keep text-only until a vetted parser/sanitizer is approved. |
| P2 | Repeated legacy CSS keeps visual changes unpredictable | Consolidate Chat rules into the scoped stylesheet before visual fixes. |
| P2 | Motion suggests provider progress | Use restrained 140/220 ms transitions only; reduced-motion reset. |

## 9. Prioritized implementation sequence

1. Consolidate duplicate Chat CSS and establish exact tokens.
2. Recompose the workspace shell and history behavior.
3. Simplify empty state and conversation topline.
4. Improve transcript/message hierarchy under plain-text constraints.
5. Rebuild the composer and mobile toolbar.
6. Independent desktop/tablet/mobile/short-height visual refinement.
7. Keyboard, accessibility and overflow verification.
8. Screenshot repeat/fix pass and final Git-status report.
9. Only after external approvals: authenticated Chat, streaming, Markdown, provider/model, history mutation, memory, attachment, and conversation research expansion.

## 10. Phase 1 completion checklist

- [ ] Design specification describes actual DOM and state names.
- [ ] Exact shared tokens, breakpoints and 44 px touch rules are documented.
- [ ] Comparison matrix is qualitative and no 99% claim is made.
- [ ] Local Demo, denied, offline, error and unavailable states are explicit.
- [ ] SEC-07 and provider/research/attachment boundaries are preserved.
- [ ] Existing controls and screenshots are referenced.
- [ ] Test strategy covers existing suites and four target screenshots.
- [ ] Three deliverables agree on architecture, breakpoints and capability gates.

## 11. Outstanding Phase 2 dependencies

- Security approval and implementation of an atomic authorization/effect fence.
- Product decisions for provider/model, streaming, history mutations and voice placement.
- Privacy approval for external provider/research, memory and any attachment egress.
- Operations/provider decisions for credentials, pricing, reachability and limits.
- Security review for Markdown parser/sanitizer and source/link rendering.
- Human screenshot acceptance after implementation.

## 12. Actual implementation evidence

**Implementation result:** The Chat workspace now uses the Gemini-inspired Chat-scoped visual architecture defined in this document set. It preserves the existing Chat DOM, request behavior, draft/search/history behavior, Copy, Research opt-in, offline/denied states and VOKKI navigation.

**Screenshots inspected:**

- `interface/visual-tests/artifacts/screenshots/after/chat-desktop-1440x1000.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-tablet-768x1024.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-390x844.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-short-390x460.png`

**Test evidence:**

- 31/31 Playwright tests passed.
- 326/326 focused Python Chat/auth/privacy/UI-state tests passed.
- 97/97 focused Node Chat presentation/research/VOKKI tests passed.
- JavaScript syntax and `git diff --check` passed.

**Visual review:** No page overflow, composer overlap, clipped Send hit target or cross-viewport layout break was observed in the four required captures. Desktop retains a two-level navigation/history structure; tablet and mobile use independent drawer and composer behavior.

**Remaining blocker:** SEC-07 remains blocked and no authenticated AI inference is enabled. The implementation does not claim live provider readiness, streaming, attachments, rich Markdown or authenticated AI.
