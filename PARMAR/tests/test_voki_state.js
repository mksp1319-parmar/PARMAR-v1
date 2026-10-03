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
  ${functionSource('normalizeStatus')}
  ${functionSource('responseSafetyStatus')}
  const vokiChatPresentation = ${presentationMatch[1]};
  ${functionSource('setChatVokiState')}
  ${functionSource('chatVokiResponseState')}
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

  for (const state of states) {
    context.setChatVokiState(state);
    assert.equal(dom.chatVoki.dataset.state, state);
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
