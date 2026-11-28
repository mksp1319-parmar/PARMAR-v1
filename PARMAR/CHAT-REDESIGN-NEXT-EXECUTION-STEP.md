# PARMAR CHAT REDESIGN — NEXT EXECUTION STEP

You are working on PARMAR v1.

Your objective is to prepare the existing Chat redesign for safe, production-grade implementation.

## STEP 1 — Re-read the complete blueprint

Read all five documents:

1. CHAT-CURRENT-STATE-AUDIT.md
2. CHAT-FEATURE-MATRIX.md
3. CHAT-REDESIGN-SPEC.md
4. CHAT-IMPLEMENTATION-PLAN.md
5. CHAT-REGRESSION-RISK-REGISTER.md

Do not rely on previous summaries. Inspect the actual repository and current worktree.

## STEP 2 — Establish the security prerequisite

Investigate the incomplete atomic authorization fence.

- Identify the exact missing implementation and dependencies.
- Identify required product-owner, security and privacy approvals.
- Determine how authenticated Chat can become operational safely.
- Preserve fail-closed behavior.
- Never bypass authentication, authorization, consent or safety controls.
- Do not activate an unapproved provider integration.

If approval is required, prepare a precise decision brief rather than fabricating approval.

## STEP 3 — Prepare the complete Chat implementation architecture

Design the implementation around:

- Premium ChatGPT/Claude/Gemini-quality conversation experience.
- Responsive desktop, tablet and mobile layouts.
- Conversation history and search.
- New chat, rename, delete and archive.
- Streaming response architecture.
- Markdown, code blocks and syntax highlighting.
- Copy and regenerate actions.
- Message editing.
- File and image attachment architecture.
- Model/provider selection.
- Research mode and citations.
- Voice integration with VOKKI.
- Persistent conversations and context management.
- Accessible keyboard navigation.
- Offline/local AI compatibility.

Reuse existing PARMAR services wherever appropriate.

## STEP 4 — Define real functionality

Every proposed control must have a defined backend action, state transition, permission requirement and error state.

No decorative controls, fake streaming, simulated AI responses, misleading progress indicators or nonfunctional buttons.

Do not expose capabilities that are not operational.

## STEP 5 — Responsive design

Define exact component behavior for:

- Desktop
- Tablet
- Mobile

Preserve PARMAR's existing identity, navigation and VOKKI integration.

Do not damage Home, AETHER, VOKKI, memory or existing conversation functionality.

## STEP 6 — Implementation readiness review

Produce:

- Architecture and dependency map.
- Component inventory.
- API contract changes.
- Data model requirements.
- Security and privacy requirements.
- Migration requirements.
- Test matrix.
- Ordered implementation phases.
- Explicit acceptance criteria.

Correct documentation inconsistencies yourself and re-review the result.

## STRICT GIT RULES

- Preserve unrelated existing work.
- No staging.
- No commits.
- No pushing.
- No destructive changes.
- No weakening security controls.

## COMPLETION STANDARD

Do not simply report incomplete findings.

Resolve everything within existing authority, validate your conclusions, and clearly identify genuine external approval dependencies.

At completion, provide the exact next implementation phase and its acceptance criteria.

Do not start application-code modifications in this preparation step.
