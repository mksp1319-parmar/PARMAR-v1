const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const presentation = require('../interface/static/chat-presentation.js');
const { interpretContract } = require('../interface/static/voki-interface.js');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'interface', 'static', 'app.js'),
  'utf8',
);

function functionSource(name) {
  const match = appSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

function appResponseGuard() {
  const context = vm.createContext({
    window: { PARMARChatPresentation: presentation },
  });
  vm.runInContext(`
    const RESPONSE_SAFETY_STATES = new Set(['PASS', 'REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
    const SUPPRESSED_RESPONSE_SAFETY_STATES = new Set(['REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
    const sanitizeSensitiveText = (value) => String(value);
    const sanitizeStoredValue = (value) => value;
    ${functionSource('normalizeStatus')}
    ${functionSource('responseSafetyStatus')}
    ${functionSource('responseSafetyMessage')}
    ${functionSource('isUnconfirmedCandidateResponse')}
    ${functionSource('safeChatReply')}
    ${functionSource('suppressCandidateContent')}
    ${functionSource('sanitizeResponseForHistory')}
    globalThis.safeChatReply = safeChatReply;
    globalThis.sanitizeResponseForHistory = sanitizeResponseForHistory;
  `, context);
  return context;
}

function response(overrides = {}) {
  return {
    provider: 'example',
    message: 'Candidate content must not escape the release guard.',
    voki_contract: {
      lifecycle: { state: 'RELEASED' },
      request_review: { status: 'SAFE' },
      provider: { status: 'COMPLETED' },
      response_safety: { status: 'PASS' },
      response_disposition: 'RELEASED',
      ...overrides,
    },
  };
}

test('unknown or legacy lifecycle values remain explicitly unknown', () => {
  assert.equal(interpretContract({}).lifecycleState, 'UNKNOWN');
  assert.equal(interpretContract({ lifecycle: { state: 'SAFE_RESPONSE' } }).lifecycleState, 'UNKNOWN');
  assert.equal(interpretContract({ lifecycle: { state: 'RELEASED' } }).lifecycleState, 'RELEASED');
});

test('Chat exposes candidate text only when the authoritative release contract is coherent', () => {
  const guard = appResponseGuard();
  assert.equal(guard.safeChatReply(response()), 'Candidate content must not escape the release guard.');

  const mismatches = [
    { lifecycle: { state: 'WITHHELD' } },
    { provider: { status: 'FAILED' } },
    { response_safety: { status: 'UNCERTAIN' } },
    { response_disposition: 'WITHHELD' },
  ];
  for (const mismatch of mismatches) {
    const candidate = response(mismatch);
    const visibleText = guard.safeChatReply(candidate);
    assert.doesNotMatch(visibleText, /Candidate content/);
    assert.equal(presentation.isAuthoritativelyReleased(candidate), false);
  }
});

test('provider failure, approval pending, and response-safety withholding stay distinguishable', () => {
  const guard = appResponseGuard();
  const failed = {
    provider_error: true,
    message: 'Candidate content must not escape the failure path.',
    orchestration: { candidates: [{ content: 'candidate', output: 'candidate' }] },
    voki_contract: { provider: { status: 'FAILED' } },
  };
  assert.equal(guard.safeChatReply(failed), 'The configured provider is unavailable. No response was released.');
  const failedHistory = guard.sanitizeResponseForHistory(failed);
  assert.equal(failedHistory.orchestration.candidates[0].content, null);
  assert.doesNotMatch(failedHistory.message, /Candidate content/);
  const approval = {
    status: 'APPROVAL_REQUIRED',
    analysis: { status: 'APPROVAL_REQUIRED', message: 'A human decision is required.' },
    voki_contract: {
      lifecycle: { state: 'WAITING_FOR_HUMAN' },
      request_review: { status: 'APPROVAL_REQUIRED' },
      provider: { status: 'NOT_STARTED' },
      response_safety: { status: 'NOT_CHECKED' },
      response_disposition: 'NOT_APPLICABLE',
    },
  };
  assert.equal(guard.safeChatReply(approval), 'A human decision is required.');

  for (const status of ['REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']) {
    const withheld = response({
      lifecycle: { state: 'WITHHELD' },
      response_safety: { status },
      response_disposition: 'WITHHELD',
    });
    assert.doesNotMatch(guard.safeChatReply(withheld), /Candidate content/);
    const stored = guard.sanitizeResponseForHistory(withheld);
    assert.equal(stored.orchestration, undefined);
    assert.doesNotMatch(stored.message, /Candidate content/);
  }
});

test('Chat waiting and reveal remain presentation-only and cancellable on rerender', () => {
  const renderer = functionSource('renderSessionMessages');
  const waiting = functionSource('appendWaitingIndicator');
  const cancel = functionSource('cancelChatResponseReveal');
  assert.match(waiting, /Waiting for PARMAR…/);
  assert.doesNotMatch(waiting, /Thinking|ANALYZING|RISK_CHECK/);
  assert.match(renderer, /cancelChatResponseReveal\(\)/);
  assert.match(renderer, /startProgressiveReveal/);
  assert.match(renderer, /isAuthoritativelyReleased\(message\.analysis\)/);
  assert.match(cancel, /state\.chatRevealCancel\?\.\(\)/);
  assert.match(functionSource('renderSessionMessages'), /createCopyButton\(String\(message\.text \?\? ''\)\)/);
  assert.doesNotMatch(appSource, /setChatVokiState|speechSynthesis|chat-voki/);
});

test('historical rendering and workspace changes invalidate any in-flight reveal', () => {
  const renderer = functionSource('renderSessionMessages');
  const history = functionSource('renderHistory');
  const bindEvents = functionSource('bindEvents');
  assert.match(renderer, /revealLatestAssistant = false/);
  assert.match(renderer, /&& index === session\.messages\.length - 1/);
  assert.match(renderer, /role === 'assistant'/);
  assert.match(history, /renderSessionMessages\(\)/);
  assert.match(bindEvents, /dom\.newSessionBtn\.addEventListener/);
  assert.match(bindEvents, /invalidatePendingRequest\(\);[\s\S]*?renderSessionMessages\(\);/);
});

test('the existing composer still submits once on Enter and preserves Shift+Enter and IME input', () => {
  assert.match(appSource, /event\.key === 'Enter' && !event\.shiftKey && !event\.isComposing/);
  assert.match(appSource, /function beginRequest\(\) \{[\s\S]*?state\.requestInFlight/);
  assert.match(functionSource('submitChatMessage'), /if \(requestId === null\) return;/);
  assert.match(appSource, /dom\.chatInput\.addEventListener\('input', resizeChatInput\)/);
});
