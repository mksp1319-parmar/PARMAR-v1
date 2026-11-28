# PARMAR Chat — Gemini-Level Ultra-Premium Design Specification

**Status:** Phase 1 implementation-ready visual blueprint  
**Scope:** `PARMAR/interface/static/index.html`, `app.js`, Chat styles, and the existing Chat visual test  
**Implementation status:** Documentation only; no application behavior or authorization change

## 1. Repository-grounded baseline

The Chat implementation currently consists of:

- A single SPA section in `interface/static/index.html` at `#section-chat`.
- Chat state, drafts, history, availability, request sequencing, and safe response release in `interface/static/app.js`.
- Chat-specific visual rules in `interface/static/chat-redesign.css`, layered over shared rules in `interface/static/styles.css` and `interface/static/design-system.css`.
- The existing Playwright contract in `interface/visual-tests/chat-responsive.spec.cjs`.

The actual baseline screenshots are:

- `interface/visual-tests/artifacts/screenshots/after/chat-desktop-1440x1000.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-tablet-768x1024.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-390x844.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-short-390x460.png`

This specification raises visual quality without changing the backend or pretending unavailable capabilities work. The current architecture and copy do not establish an authenticated AI Chat path: SEC-07 remains blocked, and `RuntimeNoGo` stays fail closed.

## 2. Product direction

The target is Gemini-like in qualities—not in copied structure or identity:

- one calm primary canvas;
- minimal surrounding chrome;
- restrained sidebar and history hierarchy;
- a single visually clear, rounded composer;
- generous reading width and natural line rhythm;
- warm graphite surfaces and copper/amber only for state and emphasis;
- quiet controls that appear only when supported;
- transparent Local Demo, denied, offline, loading, and error states.

PARMAR is not a generic assistant. The canvas should remain human-led, with small status labels and no decorative AI imagery. The existing logo assets, wordmark, and VOKKI identity remain unchanged.

## 3. Component hierarchy

### 3.1 Global shell

1. Existing global sidebar remains the workspace navigation owner.
2. Existing topbar remains for global context/search and product-level controls.
3. Chat must occupy the remaining workspace area with no additional page-level dashboard.
4. The Chat heading is a compact context line, not a second dominant hero.

### 3.2 Chat workspace

```text
Chat workspace
├── Compact context header
├── Conversation history rail or modal drawer
├── Conversation canvas
│   ├── Conversation topline
│   ├── Availability/status band
│   ├── Scrollable message thread
│   ├── Composer
│   └── Keyboard/count disclosure
└── Modal scrim, only for compact history
```

The existing `conversation-surface`, `chat-history-panel`, `chat-main`, `chat-thread`, and `chat-composer` names are retained to preserve behavior. They should become the primary implementation scope; broad global `conversation-surface` and `.chat-composer` overrides must be removed or neutralized.

### 3.3 History rail

Desktop history is a quiet 268 px rail. It is inside Chat, separate from the 264 px global sidebar. The rail contains:

- a compact `History` label;
- a prominent `New chat` action;
- a close/collapse control;
- search for loaded conversations only;
- a truthful “Loaded in this session” scope note;
- Today / Yesterday / Previous 7 days / Earlier groups;
- one-line active-row title and optional relative time;
- loading, no-results, and storage-failure states.

No rename, archive, delete, folders, or model controls appear until real endpoints exist.

### 3.4 Conversation topline

Keep History, PARMAR wordmark, and state compact. The topline must show:

- a history toggle with `aria-expanded`;
- existing PARMAR wordmark without restyling or replacement;
- `Local Demo`, `Checking`, `Authenticated unavailable`, `Offline`, or `Error`;
- `Human-led` only as existing human-control identity.

Authentication controls and profile controls remain separate, compact rows. They must not compete with the message canvas.

### 3.5 Thread

The thread is the dominant surface. It has no enclosing message-card grid. At desktop:

- content reading width: 760 px;
- thread outer width: 760 px;
- assistant text maximum: 720 px;
- user bubble maximum: 620 px;
- avatar area: 32 px;
- gap to bubble: 12 px;
- between turns: 28–32 px.

Plain-text rendering remains `textContent` until a vetted Markdown/sanitizer path is approved.

User turns may use a subtly filled rounded surface. Assistant turns remain unboxed and editorial. Metadata is small and quiet. Copy is the only message action and has a 44 px mobile target.

### 3.6 Empty state

The empty state is restrained and vertically centered—not a marketing hero:

- 48 px monogram/emblem;
- 12 px amber eyebrow;
- 32–38 px editorial heading desktop;
- 16 px line-height 1.55 explanation;
- 3 suggested starting prompts;
- prompt chips with 44 px minimum height.

The current suggestion set remains valid:

- Review a privacy decision;
- Compare two approaches;
- Identify risks in a proposal.

The text must always disclose whether Local Demo or authenticated Chat is active.

### 3.7 Composer

The composer is the second visual anchor:

- 760 px maximum width;
- 16 px outer radius;
- 12 px textarea inset;
- 56 px minimum text area;
- 180 px maximum text area growth;
- 44 px action targets on compact layouts;
- 48 px Send target desktop;
- send in the bottom-right;
- Research checkbox left;
- unavailable Files control visibly disabled;
- VOKKI control opens the existing separate workspace;
- character count and keyboard hint in the quiet footer.

The textarea placeholder is the only prompt label. A 4,000 Unicode-code-point limit remains exact. The composer does not show Stop, Attach, model, voice, or streaming controls unless they are actually implemented.

## 4. Exact design tokens

Reuse the existing design-system variables. Chat additions must resolve to existing variables or deliberate aliases rather than introducing another token universe.

| Role | Token / value | Usage |
|---|---|---|
| Page | `--void` `#08090a` | outer workspace |
| Canvas | `--night` `#0e1012` | primary Chat surface |
| History | `--panel-strong` `#0d0f10` | rail |
| Raised | `--surface-raised` `#191c1e` | hover/temporary elevation |
| Primary text | `--text` / `--type-primary` `#f1eee8` | headings and assistant text |
| Secondary text | `--type-secondary` `#cbc7bf` | supporting copy |
| Tertiary | `--type-tertiary` `#908c84` | metadata/hints |
| Quiet | `--type-quiet` `#706e69` | count and low-priority labels |
| Accent | `--accent` `#c79a68` | status, focus, copper |
| Accent strong | `--accent-strong` `#e0bb8b` | strong focus |
| Accent text | `--accent-text` `#e5c89f` | readable amber text |
| Accent soft | `--accent-soft` `rgba(199,154,104,0.12)` | selection/hover |
| Line soft | `--line-soft` `rgba(207,198,183,0.09)` | separators |
| Line default | `--border` `rgba(207,198,183,0.14)` | surfaces |
| Line strong | `--line-bright` `rgba(220,211,195,0.30)` | focus boundaries |
| Surface radius | `--radius-surface` 16 px | workspace/composer |
| Control radius | `--radius-control` 10 px | buttons/search |
| Stage radius | `--radius-stage` 22 px | drawers/sheets only |
| Elevation | `--shadow` `0 18px 54px rgba(0,0,0,.34)` | surface |
| Deep elevation | `--shadow-deep` `0 30px 88px rgba(0,0,0,.54)` | modal drawer |
| Fast motion | `--motion-fast` 140 ms | hover/color |
| Mid motion | `--motion-mid` 220 ms | state/drawer |
| Slow motion | `--motion-slow` 420 ms | only optional large reveal |
| Premium easing | `--ease-premium` | controls |
| Settle easing | `--ease-settle` | drawer/panel |

Chat-specific alias values:

- `--chat-history-width: 268px`
- `--chat-tablet-history-width: 240px`
- `--chat-reading-width: 760px`
- `--chat-composer-width: 760px`
- `--chat-mobile-gutter: 12px`
- `--chat-touch-target: 44px`
- `--chat-safe-bottom: max(12px, env(safe-area-inset-bottom))`

### Typography

- UI sans: `"Avenir Next", Avenir, "Segoe UI Variable", system-ui, sans-serif`
- Heading serif remains available only for the empty-state and editorial heading: Georgia / Times New Roman.
- Heading: 34 px / 1.12 desktop; 28 px / 1.12 tablet; 24 px / 1.12 mobile.
- Context: 11–12 px / 1.4.
- Availability: 12–13 px / 1.5.
- Assistant: 15–16 px / 1.75 desktop; 14 px / 1.68 compact.
- Metadata: 11 px / 1.4.
- Prompt chip: 13 px / 1.4.
- Composer: 15 px / 1.55 desktop; 16 px mobile to reduce iOS zoom.

## 5. Responsive rules

### Desktop: 901–1600 px

- global sidebar follows existing `--sidebar-width: 264px`;
- Chat history rail 268 px, collapsed to a 44 px icon rail only in an approved implementation;
- workspace heading 72 px maximum;
- conversation-surface fills available height minus existing topbar/footer constraints;
- no page-level horizontal overflow.

### Wide desktop: above 1600 px

- keep thread/composer at 760 px;
- history remains 268 px;
- do not stretch text or controls merely to fill space.

### Tablet: 541–900 px

- Chat history becomes a modal drawer 320–340 px wide;
- global navigation behavior remains independent;
- drawer and scrim cover only the Chat workspace;
- topline wraps nothing; compact PARMAR wordmark and state remain visible;
- thread width is `min(100%, 760px)`;
- composer 44 px targets;
- history trigger and close are 44 px.

### Mobile: 390–540 px

- 12 px outer gutter;
- 10 px conversation-surface radius;
- no separate page heading paragraph;
- compact topline only;
- history as a left modal drawer, 34 px inset at the right as scrim;
- thread can scroll independently;
- composer stays in normal flow/flex bottom, never overlays the last message;
- hide icon labels on Files/VOKKI while preserving accessible labels;
- send remains 72 px wide minimum;
- textarea 16 px to avoid iOS zoom.

### Narrow mobile: 320–389 px

- 8 px outer gutter;
- hide topline History text but retain icon and 44 px target;
- hide large wordmark if needed before hiding Local Demo state;
- preserve send and Research 44 px targets;
- suggested prompts become full-width rows or a horizontal 44 px wrap.

### Short height: maximum 580 px

- hide/compact the page subtitle and suggested prompt chips;
- keep the availability band;
- reserve 12 px minimum between thread and composer;
- composer no more than 180 px;
- thread minimum 65 px mobile / 90 px broad;
- use `100dvh`, safe-area and keyboard resizing;
- on virtual-keyboard state, prioritize textarea and send over empty-state decoration.

## 6. Interaction states

### Checking

- state badge: `Checking`;
- availability text: server session is being verified;
- Send disabled;
- no claim of Local Demo inference until the anonymous state is confirmed.

### Anonymous / Local Demo

- badge: `Local Demo`;
- availability text: deterministic safety review, not conversational AI;
- Send enabled for an online, non-in-flight request;
- Research enabled only through the existing opt-in path;
- Local Demo history remains browser-local.

### Authenticated / denied

- badge: `Authenticated unavailable`;
- availability text exactly discloses active authorization fence;
- Send disabled;
- history may remain viewable only as already implemented;
- no provider dispatch or conversation mutation.

### Offline

- badge: `Offline`;
- Send disabled;
- no draft deletion;
- existing text is retained;
- re-enable only after `navigator.onLine` returns.

### Error

- badge: `Error`;
- draft restored;
- explicit manual retry only;
- no alternate-provider fallback;
- research state remains opt-in.

### Loading history

- retain the active canvas;
- show a compact status region;
- retry only on an explicit existing backend failure path.

### Empty history/search

- distinguish “No conversations yet” from “No loaded conversations match”;
- search scope must say loaded/session scope.

### Request transport

- existing waiting indicator is transport status only;
- never call it “thinking” or “streaming” if it is not provider progress;
- single-flight state remains;
- no false Stop control.

### Response withheld

- render the existing safe status text;
- no candidate text;
- no misleading success badge or source list.

## 7. CSS implementation boundary

Future implementation should:

- add only rules scoped below `#section-chat` or `.conversation-surface`;
- retire broad repeated Chat selectors from `styles.css` rather than append another override;
- prefer existing design-system variables;
- not restyle VOKKI, AETHER, Home, or global controls indirectly;
- keep `chat-redesign.css` as a single scoped owner for Chat presentation;
- remove `message-bubble` styles that conflict across global, design-system, and late stylesheet contexts;
- preserve `prefers-reduced-motion`.

## 8. Accessibility

- History drawer is `role="dialog"` and `aria-modal="true"` only at compact widths.
- Close and Escape restore focus to `#chat-history-toggle`.
- Tab order is cyclic inside the compact drawer.
- Scrim is behind the drawer and not keyboard focusable.
- All icon-only controls have accessible names.
- Send, history, close, search, Research, VOKKI, and copy targets are at least 44 px on compact layouts.
- Textarea has a visible label for assistive technology and remains described by hint, count, and availability.
- Status updates use concise `role="status"`/`aria-live="polite"` text.
- Thread is keyboard-scrollable and message actions remain in document focus order.
- Focus uses `--focus-ring` plus 3 px offset.
- No color-only safety meaning: labels accompany Local Demo, denied, offline, and error states.
- Contrast and 200% zoom remain operable.
- On mobile, avoid 16 px or smaller UI text for the editable textarea.

## 9. Functional controls

Supported now:

- New Chat;
- loaded-history search;
- conversation selection;
- draft preservation across in-session navigation;
- Copy;
- explicit Research opt-in;
- existing VOKKI navigation;
- offline/denied/error state handling.

Unavailable:

- provider/model selection;
- true streaming;
- stop/cancel;
- attachment upload;
- Markdown rich rendering;
- inline citation mapping;
- edit/regenerate/delete/archive/rename;
- memory context controls in Chat;
- voice in the Chat composer.

These unavailable items are omitted or labeled disabled according to existing truthfulness rules.

## 10. Security and release boundaries

- `RuntimeNoGo` and SEC-07 remain authoritative.
- Do not expose provider inventory as a working selector.
- No direct provider calls, browser credentials, or provider fallbacks.
- Keep Local Demo browser-local and clearly deterministic.
- Keep candidate output unrendered until response release rules pass.
- Preserve stale-response, profile-switch, logout, and conversation-switch guards.
- VOKKI identity assets and the separate voice workspace remain unchanged.

## 11. Implementation sequence

1. Consolidate the Chat cascade and remove duplicate global Chat overrides.
2. Establish the workspace shell and history rail/drawer.
3. Simplify the empty state and preserve existing prompt behavior.
4. Improve transcript/message hierarchy without introducing rich rendering.
5. Rebuild the composer around existing actions and exact 44 px targets.
6. Add or refine responsive rules by independent desktop/tablet/mobile pass.
7. Run keyboard, overflow, focus, draft, offline, denied, and screenshot tests.

## 12. Implementation status

The visual redesign was implemented in `interface/static/chat-redesign.css` as a single Chat-scoped cascade. The existing `index.html` structure and `app.js` behavior remain intact; no authorization, provider, attachment, streaming, rich-rendering or model-selection behavior was added.

Verified captures after implementation:

- `interface/visual-tests/artifacts/screenshots/after/chat-desktop-1440x1000.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-tablet-768x1024.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-390x844.png`
- `interface/visual-tests/artifacts/screenshots/after/chat-mobile-short-390x460.png`

Automated verification: 31 Playwright tests passed, 326 focused Python Chat/auth/privacy/UI-state tests passed, 97 focused Node Chat/presentation/VOKKI tests passed, JavaScript syntax passed, and `git diff --check` passed.

The visual shell is complete within the current repository; authenticated AI and externally gated capabilities remain unavailable under SEC-07 and the unchanged `RuntimeNoGo` fence.
