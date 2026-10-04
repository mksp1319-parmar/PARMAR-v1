const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'interface', 'static', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

function functionSource(name) {
  const match = appSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

const presentationMatch = appSource.match(/const vokiChatPresentation = (\{[\s\S]*?\n\});/);
assert.ok(presentationMatch, 'Expected Vokki presentation states to exist in app.js');
const lifecyclePresentationMatch = appSource.match(/const lifecyclePresentation = (\{[\s\S]*?\n\});/);
assert.ok(lifecyclePresentationMatch, 'Expected lifecycle presentation states to exist in app.js');

const dom = {
  chatVoki: { dataset: {} },
  vokiChatState: { textContent: '' },
  vokiChatNote: { textContent: '' },
};
const context = vm.createContext({
  dom,
  document: { body: { dataset: {} } },
});
vm.runInContext(`
  const RESPONSE_SAFETY_STATES = new Set(['PASS', 'REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
  const SUPPRESSED_RESPONSE_SAFETY_STATES = new Set(['REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
  const sanitizeSensitiveText = (value) => String(value);
  const sanitizeStoredValue = (value) => value;
  ${functionSource('normalizeStatus')}
  ${functionSource('responseSafetyStatus')}
  ${functionSource('suppressCandidateContent')}
  ${functionSource('safeChatReply')}
  ${functionSource('sanitizeResponseForHistory')}
  const lifecyclePresentation = ${lifecyclePresentationMatch[1]};
  const vokiChatPresentation = ${presentationMatch[1]};
  ${functionSource('resolveResultShape')}
  ${functionSource('setChatVokiState')}
  ${functionSource('chatVokiResponseState')}
  globalThis.normalizeStatus = normalizeStatus;
  globalThis.responseSafetyStatus = responseSafetyStatus;
  globalThis.safeChatReply = safeChatReply;
  globalThis.sanitizeResponseForHistory = sanitizeResponseForHistory;
  globalThis.lifecyclePresentation = lifecyclePresentation;
  globalThis.resolveResultShape = resolveResultShape;
  globalThis.setChatVokiState = setChatVokiState;
  globalThis.chatVokiResponseState = chatVokiResponseState;
`, context);

test('Vokki renders every requested interaction state', () => {
  const states = [
    'IDLE',
    'LISTENING',
    'THINKING',
    'RESPONDING',
    'APPROVAL_REQUIRED',
    'BLOCKED',
    'REVIEW',
    'ERROR',
    'LOCAL_DEMO',
  ];
  const visualStates = {
    RESPONDING: 'RESPONDING',
    APPROVAL_REQUIRED: 'PAUSED',
    BLOCKED: 'PAUSED',
    REVIEW: 'PAUSED',
    LOCAL_DEMO: 'LOCAL_DEMO',
  };

  for (const state of states) {
    context.setChatVokiState(state);
    assert.equal(dom.chatVoki.dataset.state, visualStates[state] || state);
    assert.equal(context.document.body.dataset.chatVokiState, state);
    assert.ok(dom.vokiChatState.textContent);
    assert.ok(dom.vokiChatNote.textContent);
  }
});

test('PARMAR chat and response-safety results map to distinct Vokki states', () => {
  const map = context.chatVokiResponseState;
  const safe = { status: 'SAFE', provider: 'openai', response_safety: { status: 'PASS' } };

  assert.equal(map(safe), 'RESPONDING');
  assert.equal(map({ status: 'SAFE', provider: 'local-demo', response_safety: { status: 'PASS' } }), 'LOCAL_DEMO');
  assert.equal(map({ status: 'APPROVAL_REQUIRED', response_safety: { status: 'NOT_CHECKED' } }), 'APPROVAL_REQUIRED');
  assert.equal(map({ status: 'BLOCKED', response_safety: { status: 'NOT_CHECKED' } }), 'BLOCKED');
  assert.equal(map({ status: 'SAFE', response_safety: { status: 'REVIEW' } }), 'REVIEW');
  assert.equal(map({ status: 'SAFE', response_safety: { status: 'BLOCK' } }), 'BLOCKED');
  assert.equal(map({ status: 'PROVIDER_UNAVAILABLE' }), 'ERROR');
  assert.equal(map({ status: 'SAFE', provider_error: true }), 'ERROR');
});

test('authoritative contract safety and release facts take precedence over response fields', () => {
  const baseContract = {
    lifecycle: { state: 'RELEASED' },
    request_review: { status: 'SAFE' },
    approval: { status: 'NOT_REQUIRED' },
    provider: { status: 'COMPLETED' },
    response_safety: { status: 'PASS' },
    response_disposition: 'RELEASED',
  };

  assert.equal(
    context.responseSafetyStatus({
      status: 'SAFE',
      response_safety: { status: 'BLOCK' },
      voki_contract: baseContract,
    }),
    'PASS',
  );
  assert.equal(context.chatVokiResponseState({
    status: 'SAFE',
    provider: 'openai',
    response_safety: { status: 'BLOCK' },
    voki_contract: baseContract,
  }), 'RESPONDING');
  assert.equal(context.chatVokiResponseState({
    status: 'SAFE',
    provider: 'openai',
    response_safety: { status: 'PASS' },
    voki_contract: {
      ...baseContract,
      response_safety: { status: 'BLOCK' },
      response_disposition: 'WITHHELD',
    },
  }), 'BLOCKED');
});

test('withheld content stays hidden and provider failures remain distinct', () => {
  const withheld = {
    status: 'SAFE',
    provider: 'multi-model',
    message: 'Candidate response that must remain hidden.',
    response_safety: { status: 'PASS' },
    orchestration: { candidates: [{ content: 'candidate', output: 'candidate' }] },
    voki_contract: {
      provider: { status: 'COMPLETED' },
      response_safety: { status: 'PASS' },
      response_disposition: 'WITHHELD',
    },
  };
  assert.equal(context.safeChatReply(withheld), 'PARMAR withheld the provider response.');
  const history = context.sanitizeResponseForHistory(withheld);
  assert.equal(history.message, 'PARMAR withheld the provider response.');
  assert.equal(history.orchestration.candidates[0].content, null);
  assert.equal(history.orchestration.candidates[0].output, null);

  const providerFailure = {
    status: 'PROVIDER_UNAVAILABLE',
    provider_error: true,
    message: 'The configured provider is unavailable.',
    response_safety: { status: 'NOT_CHECKED' },
    voki_contract: {
      provider: { status: 'FAILED' },
      response_safety: { status: 'NOT_CHECKED' },
      response_disposition: 'NOT_APPLICABLE',
    },
  };
  assert.equal(context.chatVokiResponseState(providerFailure), 'ERROR');
  assert.equal(context.safeChatReply(providerFailure), 'The configured provider is unavailable.');
});

test('unknown and unavailable states never receive the safe badge', () => {
  const classes = new Set();
  const badge = { classList: {
    remove: (...values) => values.forEach((value) => classes.delete(value)),
    add: (value) => classes.add(value),
  } };
  const badgeContext = vm.createContext({
    dom: { statusPill: badge },
    normalizeStatus: context.normalizeStatus,
  });
  vm.runInContext(functionSource('setBadge'), badgeContext);

  badgeContext.setBadge('UNKNOWN');
  assert.equal(badge.textContent, 'NOT ASSESSED');
  assert.equal(classes.has('status-safe'), false);

  badgeContext.setBadge('UNAVAILABLE');
  assert.equal(badge.textContent, 'UNAVAILABLE');
  assert.equal(classes.has('status-safe'), false);

  badgeContext.setBadge('ENFORCEMENT_ALLOWED');
  assert.equal(badge.textContent, 'PERMISSION GRANTED');
  assert.equal(classes.has('status-safe'), false);

  badgeContext.setBadge('SAFE');
  assert.equal(badge.textContent, 'SAFE');
  assert.equal(classes.has('status-safe'), true);
});

test('late responses are ignored and logout or expiry clears the prior Vokki state', () => {
  const submit = functionSource('submitChatMessage');
  const staleGuard = submit.indexOf('if (requestId !== state.requestSequence || authEpoch !== state.authEpoch) return;');
  const stateMapping = submit.indexOf('chatVokiResponseState(result)');
  assert.ok(staleGuard >= 0 && stateMapping > staleGuard);

  const clearAuthenticatedState = functionSource('clearAuthenticatedState');
  assert.ok(clearAuthenticatedState.includes('invalidatePendingRequest();'));
  assert.ok(clearAuthenticatedState.includes("stopVokiSpeech('LOCAL_DEMO');"));

  const refreshAuthenticationState = functionSource('refreshAuthenticationState');
  assert.ok(refreshAuthenticationState.includes("stopVokiSpeech('LOCAL_DEMO');"));
});

test('Vokki mapping is presentation-only and cannot invoke approval or authorization', () => {
  const mapping = functionSource('chatVokiResponseState');
  assert.doesNotMatch(mapping, /apiRequest|approve|authorize|enforcement|fetch\(/i);
});

test('unknown backend lifecycle and browser-only states remain explicit', () => {
  assert.equal(context.normalizeStatus(undefined), 'UNKNOWN');
  assert.equal(context.resolveResultShape({ status: 'SAFE' }).lifecycleState, 'UNKNOWN');
  assert.equal(context.lifecyclePresentation.SAFE_RESPONSE, undefined);
  assert.equal(context.resolveResultShape({
    status: 'SAFE',
    lifecycle: { current_state: 'SAFE_RESPONSE' },
  }).lifecycleState, 'UNKNOWN');
  assert.equal(
    context.resolveResultShape({
      status: 'SAFE',
      voki_contract: { lifecycle: { state: 'UNKNOWN' } },
    }).lifecycleState,
    'UNKNOWN',
  );
  assert.ok(appSource.includes("stopVokiSpeech('HTTP_WAITING')"));
  assert.ok(appSource.includes("setChatVokiState('TEXT_INPUT_FOCUSED')"));
  assert.ok(appSource.includes("dataset.speechState = 'QUEUED'"));
  assert.ok(appSource.includes("dataset.speechState = 'SPEAKING'"));
  assert.ok(appSource.includes("dataset.speechState = 'ENDED'"));
  assert.ok(appSource.includes("dataset.speechState = 'ERROR'"));
  assert.ok(appSource.includes("dataset.speechState = wasActive ? 'CANCELLED' : 'IDLE'"));
  assert.match(appSource, /SUPPRESSED_RESPONSE_SAFETY_STATES = new Set\(\['REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED'\]\)/);
});
