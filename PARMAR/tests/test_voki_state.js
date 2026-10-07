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
  const continueConversation = functionSource('continueConversation');
  const selectHistory = appSource.match(/async function selectServerConversation\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const bindEvents = functionSource('bindEvents');
  assert.match(renderer, /revealLatestAssistant = false/);
  assert.match(renderer, /&& index === session\.messages\.length - 1/);
  assert.match(renderer, /role === 'assistant'/);
  assert.match(continueConversation, /renderSessionMessages\(\)/);
  assert.match(selectHistory, /renderSessionMessages\(\)/);
  assert.match(bindEvents, /dom\.newSessionBtn\.addEventListener/);
  assert.match(bindEvents, /invalidatePendingRequest\(\);[\s\S]*?renderSessionMessages\(\);/);
});

test('authenticated history is fetched, selected, and rendered immediately without changing VOKKI state', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'interface', 'static', 'app.js'),
    'utf8',
  );
  const renderHistory = functionSource('renderHistory');
  const refreshHistory = appSource.match(/async function refreshServerConversationHistory\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const selectHistory = appSource.match(/async function selectServerConversation\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(refreshHistory);
  assert.ok(selectHistory);
  assert.match(refreshHistory, /apiRequest\('\/api\/conversations'/);
  assert.match(refreshHistory, /const serverIds = new Set/);
  assert.match(renderHistory, /state\.serverConversationIds\.has\(session\.id\)/);
  assert.match(renderHistory, /button\.classList\.toggle\('active', session\.id === state\.currentSessionId\)/);
  assert.match(renderHistory, /continueConversation\(button\.dataset\.sessionId\)/);
  assert.match(selectHistory, /apiRequest\(`\/api\/conversations\/\$\{encodeURIComponent\(conversationId\)\}`/);
  assert.match(selectHistory, /cancelChatResponseReveal\(\)/);
  assert.match(selectHistory, /historySelectionGeneration/);
  assert.doesNotMatch(selectHistory, /historyLoadGeneration/);
  assert.match(selectHistory, /state\.currentSessionId = conversationId/);
  assert.match(selectHistory, /renderSessionMessages\(\)/);
  assert.doesNotMatch(selectHistory, /renderSessionMessages\([^)]*,\s*true\)/);
  assert.doesNotMatch(selectHistory, /resetReviewState|setVokiState|updateState/);
  assert.match(renderHistory, /No conversations yet\./);
});

test('startup restores conversation history without leaving Home, while normal selection still opens Chat', () => {
  const authRefresh = appSource.match(/async function refreshAuthenticationState\([\s\S]*?\n\}/)?.[0];
  const unauthenticatedTransition = functionSource('clearAuthenticatedState');
  const historyRefresh = appSource.match(/async function refreshServerConversationHistory\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const selectHistory = appSource.match(/async function selectServerConversation\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const initialize = functionSource('initialize');

  assert.ok(authRefresh);
  assert.ok(historyRefresh);
  assert.ok(selectHistory);
  assert.match(initialize, /selectSection\('home'\)[\s\S]*?refreshAuthenticationState\(\{ navigateToChat: false \}\)/);
  assert.match(authRefresh, /refreshServerConversationHistory\(\{ navigateToChat \}\)/);
  assert.match(authRefresh, /if \(navigateToChat\) selectSection\(state\.currentSessionId \? 'chat' : 'home'\)/);
  assert.match(authRefresh, /broadcast, navigateToChat/);
  assert.match(unauthenticatedTransition, /if \(navigateToChat\) selectSection\(state\.currentSessionId \? 'chat' : 'home'\)/);
  assert.match(historyRefresh, /selectServerConversation\(restoreConversationId, \{ navigateToChat \}\)/);
  assert.match(selectHistory, /if \(navigateToChat\) selectSection\('chat', 'chat'\)/);
  assert.match(selectHistory, /\{ navigateToChat = true \} = \{\}/);
  assert.match(appSource, /void selectServerConversation\(selected\.id\)/);
});

test('Home and PARMAR Core are separate visible destinations', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'interface', 'static', 'index.html'),
    'utf8',
  );
  const homeNav = html.match(/<button class="nav-item(?: [^"]*)?" data-section="home" data-nav-key="home"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(homeNav);
  assert.match(homeNav[0], /aria-label="Home"/);
  assert.match(homeNav[1], /<span>Home<\/span>/);
  assert.match(html, /data-section="core" data-nav-key="core" aria-label="PARMAR Core"/);
  assert.match(html, /id="section-core" aria-labelledby="core-title"/);

  const bindEvents = functionSource('bindEvents');
  assert.match(bindEvents, /querySelectorAll\('\.nav-item,[\s\S]*?button\.addEventListener\('click', \(\) => navigateWorkspaceAction\(button\)\)/);

  const navButton = {
    dataset: { section: 'home', navKey: 'home' },
    active: false,
    classList: { toggle(_name, value) { navButton.active = value; } },
  };
  const homeView = {
    dataset: { section: 'home' },
    active: false,
    classList: { toggle(_name, value) { homeView.active = value; } },
  };
  const context = vm.createContext({
    workspacePanels: { right: 'closed', left: 'open' },
    closeWorkspacePanel() {},
    dom: { navButtons: [navButton], views: [homeView], viewTitle: { textContent: '' } },
    document: {
      body: { dataset: { activeSection: 'chat' } },
      querySelectorAll() { return []; },
    },
    window: { scrollY: 0 },
    motionIsReduced: () => false,
    isCompactPanelViewport: () => false,
    syncSidebarToggle() {},
  });
  vm.runInContext(
    `${functionSource('selectSection')}\nselectSection(dom.navButtons[0].dataset.section, dom.navButtons[0].dataset.navKey);`,
    context,
  );

  assert.equal(navButton.active, true);
  assert.equal(homeView.active, true);
  assert.equal(context.document.body.dataset.activeSection, 'home');
  assert.equal(context.dom.viewTitle.textContent, 'Home');
});

test('authenticated reload restores only a server-listed conversation and clears stale selections', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'interface', 'static', 'app.js'),
    'utf8',
  );
  const refreshHistory = appSource.match(/async function refreshServerConversationHistory\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const selectHistory = appSource.match(/async function selectServerConversation\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  const storageRead = functionSource('readActiveConversationId');
  const storageWrite = functionSource('storeActiveConversationId');
  const storageClear = functionSource('clearActiveConversationId');
  const unauthenticatedTransition = functionSource('clearAuthenticatedState');
  const authRefresh = appSource.match(/async function refreshAuthenticationState\([\s\S]*?\n\}/)?.[0];
  assert.ok(refreshHistory);
  assert.ok(selectHistory);
  assert.ok(authRefresh);
  assert.match(authRefresh, /await refreshServerConversationHistory\(\{ navigateToChat \}\)/);
  assert.match(authRefresh, /state\.csrfToken !== payload\.csrf_token/);
  assert.match(authRefresh, /if \(authenticatedSessionChanged\) clearActiveConversationId\(\)/);
  assert.match(refreshHistory, /const storedConversationId = readActiveConversationId\(\)/);
  assert.match(refreshHistory, /serverIds\.has\(storedConversationId\)/);
  assert.match(refreshHistory, /await selectServerConversation\(restoreConversationId, \{ navigateToChat \}\)/);
  assert.match(refreshHistory, /clearActiveConversationId\(\)/);
  assert.match(selectHistory, /storeActiveConversationId\(conversationId\)/);
  assert.match(storageRead, /sessionStorage\.getItem/);
  assert.match(storageRead, /return typeof value === 'string'[\s\S]*?test\(value\)/);
  assert.match(storageWrite, /sessionStorage\.setItem/);
  assert.match(storageWrite, /ACTIVE_CONVERSATION_KEY, conversationId/);
  assert.match(storageClear, /sessionStorage\.removeItem/);
  assert.match(unauthenticatedTransition, /state\.csrfToken = null/);
  assert.match(unauthenticatedTransition, /clearActiveConversationId\(\)/);
  assert.match(authRefresh, /payload\?\.authenticated === true/);
  assert.match(authRefresh, /clearAuthenticatedState\(/);
  assert.doesNotMatch(storageWrite, /localStorage/);
  assert.doesNotMatch(storageWrite, /session_token|csrf|user_id|owner/i);
  assert.doesNotMatch(storageRead, /csrf|session.token|user_id|owner/i);
});

test('New Chat cancels reveals and clears the active conversation without creating history', () => {
  const bindEvents = functionSource('bindEvents');
  assert.match(bindEvents, /dom\.newSessionBtn\.addEventListener\('click', \(\) => \{[\s\S]*?cancelChatResponseReveal\(\)/);
  assert.match(bindEvents, /state\.currentSessionId = null;[\s\S]*?state\.conversationId = null;/);
  assert.match(bindEvents, /state\.historyLoadGeneration \+= 1/);
  assert.match(bindEvents, /state\.pendingApprovalId = null/);
  assert.match(bindEvents, /if \(state\.authMode === 'authenticated'\) clearActiveConversationId\(\)/);
  assert.doesNotMatch(bindEvents.split("dom.newSessionBtn.addEventListener('click', () => {")[1]?.split('\n    });')[0] || '', /apiRequest\(['"]\/api\/chat/);
});

test('VOKKI Reject is never bound to the Chat/Home approval handler', () => {
  const decisions = [];
  const homeControls = ['APPROVE', 'REJECT', 'INFO', 'ALTERNATIVE'].map((decision) => ({
    dataset: { decision },
    addEventListener(eventName, callback) {
      assert.equal(eventName, 'click');
      this.click = callback;
    },
  }));
  const vokiReject = {
    className: 'reject-btn',
    dataset: { vokiDecision: 'REJECT' },
    addEventListener() {
      throw new Error('VOKKI control must not be bound by the Chat/Home handler.');
    },
  };
  const context = vm.createContext({
    dom: {
      approvalActions: {
        querySelectorAll(selector) {
          assert.equal(selector, 'button[data-decision]');
          return homeControls;
        },
      },
    },
    submitDecision: (decision) => decisions.push(decision),
  });
  vm.runInContext(`${functionSource('bindHomeApprovalActions')}\nbindHomeApprovalActions();`, context);

  homeControls[1].click();

  assert.deepEqual(decisions, ['REJECT']);
  assert.equal(vokiReject.dataset.decision, undefined);
});

test('local VOKKI reads and writes through Chat sessions without owning a transcript', () => {
  const getConversation = functionSource('getLocalVokiConversation');
  const appendMessage = functionSource('appendLocalVokiConversationMessage');
  const newChat = functionSource('bindEvents');
  const vokiSource = fs.readFileSync(
    path.join(__dirname, '..', 'interface', 'static', 'voki-interface.js'),
    'utf8',
  );
  assert.match(getConversation, /state\.sessions/);
  assert.match(getConversation, /ensureCurrentSession\(\)/);
  assert.match(appendMessage, /appendMessageToSession\(sessionId, 'user'/);
  assert.match(appendMessage, /appendMessageToSession\(sessionId, 'assistant'/);
  assert.match(newChat, /publishConversationSelection\(session\?\.id \?\? null\)/);
  assert.match(functionSource('continueConversation'), /publishConversationSelection\(selected\.id, true\)/);
  assert.match(functionSource('submitChatMessage'), /publishConversationSelection\(authenticated \? result\.conversation_id : sessionId, true\)/);
  assert.match(vokiSource, /parmar-conversation-selection-changed[\s\S]*?activateConversation\(detail\.conversationId, \{ refresh: detail\.refresh === true \}\)/);
  assert.doesNotMatch(vokiSource, /recentMessages/);
});

test('the existing composer still submits once on Enter and preserves Shift+Enter and IME input', () => {
  assert.match(appSource, /event\.key === 'Enter' && !event\.shiftKey && !event\.isComposing/);
  assert.match(appSource, /function beginRequest\(\) \{[\s\S]*?state\.requestInFlight/);
  assert.match(functionSource('submitChatMessage'), /if \(requestId === null\) return;/);
  assert.match(appSource, /dom\.chatInput\.addEventListener\('input', resizeChatInput\)/);
});
