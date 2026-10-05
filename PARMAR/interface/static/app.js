const STORAGE_KEYS = {
  localDemoSessions: 'parmar-sessions-v1',
  settings: 'parmar-settings-v1',
  audit: 'parmar-audit-v1',
  memories: 'parmar-memories-v1',
};
const ACTIVE_CONVERSATION_KEY = 'parmar-active-conversation-v1';
const MAX_SAVED_MEMORIES = 25;
const PANEL_DRAWER_BREAKPOINT = 1100;
const PANEL_TRANSITION_MS = 260;
const PANEL_EDGE_ZONE = 24;
const PANEL_DIRECTION_LOCK = 10;
const PROVIDER_IDS = new Set(['local-demo', 'openai', 'gemini', 'claude', 'http-json']);
const RESPONSE_SAFETY_STATES = new Set(['PASS', 'REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
const SUPPRESSED_RESPONSE_SAFETY_STATES = new Set(['REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
const responseSafetyLabels = {
  PASS: 'No configured response issue detected; factual accuracy is not verified.',
  REVIEW: 'Response needs human review; this is not an approval.',
  BLOCK: 'Response withheld by PARMAR policy checks.',
  UNCERTAIN: 'Response withheld because checks were inconclusive.',
  NOT_CHECKED: 'Response was not checked and is not shown.',
};
let historyStorageUnavailable = false;
const sensitiveMemoryPatterns = [
  /\b(?:password|passwd|pwd|passcode|secret|credential|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:entication)?[\s_-]?token|client[\s_-]?secret)\b\s*(?:is|[:=])\s*\S+/i,
  /\bAuthorization\s*:\s*[^\r\n]*/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/i,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/,
];

function sanitizeSensitiveText(value) {
  if (typeof value !== 'string') return '';
  return sensitiveMemoryPatterns.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
}

function publishConversationSelection(conversationId, refresh = false) {
  window.dispatchEvent(new CustomEvent('parmar-conversation-selection-changed', {
    detail: {
      conversationId: typeof conversationId === 'string' ? conversationId : null,
      authenticated: state.authMode === 'authenticated',
      refresh,
    },
  }));
}

function sanitizeStoredValue(value) {
  if (typeof value === 'string') return sanitizeSensitiveText(value);
  if (Array.isArray(value)) return value.map(sanitizeStoredValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:api[_-]?key|authorization|password|secret|credential)$/i.test(key))
      .map(([key, item]) => [key, sanitizeStoredValue(item)]));
  }
  return value;
}

function responseSafetyStatus(result) {
  if (!result || typeof result !== 'object') return null;
  const contract = result.voki_contract || result.analysis?.voki_contract;
  if (!contract && !Object.hasOwn(result, 'response_safety')) return null;
  const status = contract
    ? contract.response_safety?.status
    : result.response_safety?.status;
  if (RESPONSE_SAFETY_STATES.has(status)) return status;
  return 'NOT_CHECKED';
}

function responseSafetyMessage(status) {
  return {
    REVIEW: 'PARMAR withheld the provider response pending human review.',
    BLOCK: 'PARMAR withheld the provider response after a response policy check.',
    UNCERTAIN: 'PARMAR withheld the provider response because its checks could not resolve a concern.',
    NOT_CHECKED: 'PARMAR could not validate the provider response, so the generated text was withheld.',
  }[status] || 'PARMAR withheld the provider response.';
}

function safeChatReply(result) {
  const contract = result?.voki_contract || result?.analysis?.voki_contract;
  const message = typeof result?.message === 'string' ? result.message : '';
  if (
    contract?.provider?.status === 'FAILED'
    || result?.provider_status === 'FAILED'
    || result?.provider_error
  ) {
    return 'The configured provider is unavailable. No response was released.';
  }
  if (
    contract?.provider?.status === 'COMPLETED'
    && contract.response_disposition !== 'RELEASED'
  ) {
    return 'PARMAR withheld the provider response.';
  }

  const status = responseSafetyStatus(result) || 'NOT_CHECKED';
  if (status === 'NOT_CHECKED' && ['BLOCKED', 'APPROVAL_REQUIRED'].includes(result?.analysis?.status)) {
    const requestMessage = result.analysis.message;
    return typeof requestMessage === 'string'
      ? sanitizeSensitiveText(requestMessage).trim()
      : responseSafetyMessage(status);
  }
  if (SUPPRESSED_RESPONSE_SAFETY_STATES.has(status)) {
    return responseSafetyMessage(status);
  }
  if (isUnconfirmedCandidateResponse(result)) {
    return 'PARMAR could not confirm this provider response as released.';
  }
  if (!window.PARMARChatPresentation?.isAuthoritativelyReleased(result)) {
    return 'PARMAR could not confirm this response as released.';
  }
  return sanitizeSensitiveText(message).trim();
}

function isUnconfirmedCandidateResponse(result) {
  const contract = result?.voki_contract || result?.analysis?.voki_contract;
  if (
    result?.provider_error
    || contract?.provider?.status === 'FAILED'
    || result?.provider_status === 'FAILED'
  ) return false;
  const requestStatus = normalizeStatus(
    contract?.request_review?.status || result?.analysis?.status || result?.status,
  );
  if (
    ['BLOCKED', 'REJECTED', 'APPROVAL_REQUIRED'].includes(requestStatus)
    && contract?.provider?.status !== 'COMPLETED'
  ) return false;
  if (window.PARMARChatPresentation?.isAuthoritativelyReleased(result)) return false;
  return contract?.provider?.status === 'COMPLETED'
    || Boolean(typeof result?.message === 'string' && result.message.trim())
    || (!contract && typeof result?.provider === 'string' && result.provider_status !== 'FAILED');
}

function suppressCandidateContent(value) {
  if (Array.isArray(value)) return value.map(suppressCandidateContent);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'candidates' && Array.isArray(item)) {
      return [key, item.map((candidate) => ({
        ...suppressCandidateContent(candidate),
        content: null,
        output: null,
      }))];
    }
    return [key, suppressCandidateContent(item)];
  }));
}

function sanitizeResponseForHistory(result) {
  let stored = sanitizeStoredValue(result);
  const status = responseSafetyStatus(result) ?? (typeof result?.provider === 'string' ? 'NOT_CHECKED' : null);
  const contract = result?.voki_contract || result?.analysis?.voki_contract;
  const completedButWithheld = contract?.provider?.status === 'COMPLETED'
    && contract.response_disposition !== 'RELEASED';
  const unconfirmedCandidate = isUnconfirmedCandidateResponse(result);
  const providerFailed = contract?.provider?.status === 'FAILED'
    || result?.provider_status === 'FAILED'
    || result?.provider_error === true;
  if (!SUPPRESSED_RESPONSE_SAFETY_STATES.has(status) && !completedButWithheld && !unconfirmedCandidate && !providerFailed) return stored;
  stored = suppressCandidateContent(stored);
  if (stored && typeof stored === 'object') {
    stored.message = safeChatReply(result);
  }
  return stored;
}

function panelGestureAxis(deltaX, deltaY) {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < PANEL_DIRECTION_LOCK) return 'pending';
  return Math.abs(deltaX) > Math.abs(deltaY) * 1.4 ? 'horizontal' : 'vertical';
}

function panelOpenFraction(side, wasOpen, deltaX, panelWidth) {
  const normalizedDelta = deltaX / Math.max(panelWidth, 1);
  if (side === 'left') return wasOpen ? 1 + normalizedDelta : normalizedDelta;
  return wasOpen ? 1 - normalizedDelta : -normalizedDelta;
}

function shouldOpenPanelAfterGesture(openFraction, velocityTowardOpen, deltaX) {
  if (Math.abs(velocityTowardOpen) > 0.55 && Math.abs(deltaX) >= 24) {
    return velocityTowardOpen > 0;
  }
  return openFraction >= 0.48;
}

function containsSensitiveMemory(text) {
  return sensitiveMemoryPatterns.some((pattern) => pattern.test(text));
}

function loadSessions() {
  const stored = readJson(STORAGE_KEYS.localDemoSessions, []);
  if (!Array.isArray(stored)) {
    historyStorageUnavailable = true;
    return [];
  }

  const seenIds = new Set();
  return sanitizeStoredValue(stored).filter((session) => {
    if (!session || typeof session.id !== 'string' || !session.id || !Array.isArray(session.messages)) return false;
    if (seenIds.has(session.id)) return false;
    seenIds.add(session.id);
    session.messages = session.messages.filter((message) => (
      message && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string'
    ));
    return session.messages.length > 0;
  }).sort((first, second) => Number(second.updatedAt || second.createdAt || 0) - Number(first.updatedAt || first.createdAt || 0));
}

function loadAudit() {
  const stored = readJson(STORAGE_KEYS.audit, []);
  const audit = Array.isArray(stored) ? sanitizeStoredValue(stored) : [];
  try {
    localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(audit));
  } catch (_error) {
    // Keep sanitized audit data in memory when storage is unavailable.
  }
  return audit;
}

const defaultSettings = {
  language: 'en',
  theme: 'midnight',
  animationIntensity: 'normal',
  reducedMotion: false,
  phonePermission: true,
  provider: 'local-demo',
  memoryEnabled: false,
};

const lifecyclePresentation = {
  UNKNOWN: { className: 'unknown', label: 'STATE UNAVAILABLE' },
  IDLE: { className: 'idle', label: 'READY' },
  LISTENING: { className: 'listening', label: 'LISTENING' },
  THINKING: { className: 'thinking', label: 'THINKING' },
  ANALYZING: { className: 'analyzing', label: 'ANALYZING' },
  RISK_CHECK: { className: 'risk-check', label: 'RISK CHECK' },
  WAITING_FOR_HUMAN: { className: 'waiting-human', label: 'WAITING FOR HUMAN' },
  ENFORCEMENT_ALLOWED: { className: 'thinking', label: 'PERMISSION GRANTED' },
  PROVIDER: { className: 'thinking', label: 'PROVIDER' },
  RESPONSE_SAFETY: { className: 'risk-check', label: 'RESPONSE CHECK' },
  RELEASED: { className: 'safe-response', label: 'RESPONSE RELEASED' },
  WITHHELD: { className: 'waiting-human', label: 'RESPONSE WITHHELD' },
  PROVIDER_FAILED: { className: 'blocked', label: 'PROVIDER UNAVAILABLE' },
  BLOCKED: { className: 'blocked', label: 'BLOCKED' },
};

const supportedResultStatuses = new Set([
  ...Object.keys(lifecyclePresentation),
  'SAFE',
  'APPROVED',
  'APPROVAL_REQUIRED',
  'REJECTED',
  'RISK_DETECTED',
  'BLOCKED',
]);

const dom = {
  statusPill: document.getElementById('status-pill'),
  systemState: document.getElementById('system-state'),
  viewTitle: document.getElementById('view-title'),
  statusMessage: document.getElementById('status-message'),
  riskLevel: document.getElementById('risk-level'),
  approvalState: document.getElementById('approval-state'),
  outcomeState: document.getElementById('outcome-state'),
  requestInput: document.getElementById('request-input'),
  analyzeBtn: document.getElementById('analyze-btn'),
  pipelineEl: document.getElementById('pipeline'),
  riskCenterEl: document.getElementById('risk-center'),
  explanationList: document.getElementById('explanation-list'),
  approvalAction: document.getElementById('approval-action'),
  approvalRisk: document.getElementById('approval-risk'),
  approvalConflicts: document.getElementById('approval-conflicts'),
  approvalSafety: document.getElementById('approval-safety'),
  approvalAlternative: document.getElementById('approval-alternative'),
  approvalStateTag: document.getElementById('approval-state-tag'),
  approvalActions: document.querySelector('.approval-actions'),
  auditList: document.getElementById('audit-list'),
  auditListSecondary: document.getElementById('audit-list-secondary'),
  phoneBox: document.getElementById('phone-box'),
  parmarCore: document.getElementById('parmar-core'),
  vokiInput: document.querySelector('[data-voki-input]'),
  miniDot: document.getElementById('mini-dot'),
  scenarioList: document.getElementById('scenario-list'),
  simulatorSelect: document.getElementById('simulator-select'),
  simulatorSelectSecondary: document.getElementById('simulator-select-secondary'),
  languageSelect: document.getElementById('language-select'),
  settingsLanguage: document.getElementById('settings-language'),
  settingsTheme: document.getElementById('settings-theme'),
  settingsAnimation: document.getElementById('settings-animation'),
  settingsReducedMotion: document.getElementById('settings-reduced-motion'),
  settingsPhoneToggle: document.getElementById('settings-phone-toggle'),
  historyList: document.getElementById('history-list'),
  historyFilter: document.getElementById('history-filter'),
  historyStatus: document.getElementById('history-status'),
  newSessionBtn: document.getElementById('new-session-btn'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarClose: document.getElementById('sidebar-close'),
  mainPanel: document.querySelector('.main-panel'),
  discoveryPanel: document.getElementById('discovery-panel'),
  discoveryToggle: document.getElementById('discovery-toggle'),
  discoveryClose: document.getElementById('discovery-close'),
  capabilityToolbar: document.querySelector('.capability-toolbar'),
  discoveryTriggers: Array.from(document.querySelectorAll('[data-discovery-target]')),
  discoverySections: Array.from(document.querySelectorAll('.discovery-section')),
  panelScrim: document.getElementById('panel-scrim'),
  chatThread: document.getElementById('chat-thread'),
  chatInput: document.getElementById('chat-input'),
  chatSubmit: document.getElementById('chat-submit'),
  researchMode: document.getElementById('research-mode'),
  memoryEnabledToggle: document.getElementById('memory-enabled-toggle'),
  memoryEnabledLabel: document.getElementById('memory-enabled-label'),
  memoryEnabledDescription: document.getElementById('memory-enabled-description'),
  memoryPrivacyNote: document.getElementById('memory-privacy-note'),
  memoryForm: document.getElementById('memory-form'),
  memoryInput: document.getElementById('memory-entry-input'),
  memorySaveBtn: document.querySelector('#memory-form button[type="submit"]'),
  memoryFeedback: document.getElementById('memory-feedback'),
  memoryList: document.getElementById('memory-list'),
  memoryCount: document.getElementById('memory-count'),
  memoryClearAll: document.getElementById('memory-clear-all'),
  memoryEmpty: document.getElementById('memory-empty'),
  runScenario: document.getElementById('run-scenario'),
  runScenarioSecondary: document.getElementById('run-scenario-secondary'),
  loadDemo: document.getElementById('load-demo'),
  navButtons: Array.from(document.querySelectorAll('.nav-item')),
  views: Array.from(document.querySelectorAll('.section-view')),
  wakeBtn: document.getElementById('wake-btn'),
  vokiState: document.getElementById('voki-state'),
  providerStatus: document.getElementById('provider-status'),
  settingsProvider: document.getElementById('settings-provider'),
  logoutBtn: document.getElementById('logout-btn'),
  authStatus: document.getElementById('auth-status'),
  authStateLabel: document.getElementById('auth-state-label'),
  developmentAuthNote: document.getElementById('development-auth-note'),
  developmentLoginBtn: document.getElementById('development-login-btn'),
  refreshSessionBtn: document.getElementById('refresh-session-btn'),
  chatModeLabel: document.getElementById('chat-mode-label'),
  phonePermissionToggle: document.getElementById('phone-permission-toggle'),
  simulatePhoneSafe: document.getElementById('simulate-phone-safe'),
  simulatePhoneRisk: document.getElementById('simulate-phone-risk'),
  phoneStatusLabel: document.getElementById('phone-status-label'),
  phonePolicyLabel: document.getElementById('phone-policy-label'),
};

const state = {
  sessions: [],
  localDemoSessions: [],
  audit: [],
  memories: [],
  memoryConsent: false,
  memoryStorage: null,
  settings: loadSettings(),
  currentSessionId: null,
  historyQuery: '',
  conversationId: null,
  authMode: 'checking',
  authenticationState: 'LOCAL_DEMO',
  developmentAuthAvailable: false,
  csrfToken: null,
  authEpoch: 0,
  serverConversationIds: new Set(),
  historyLoading: false,
  historyError: false,
  historySelectionId: null,
  historyLoadGeneration: 0,
  historySelectionGeneration: 0,
  pendingApprovalId: null,
  requestSequence: 0,
  requestInFlight: false,
  chatRevealGeneration: 0,
  chatRevealCancel: null,
};

const workspacePanels = { left: 'closed', right: 'closed' };
const panelFocusOrigins = { left: null, right: null };
const panelTransitionTimers = { left: null, right: null };
let panelGesture = null;
let gestureResetTimer = null;
let lastCompactPanelViewport = window.innerWidth <= PANEL_DRAWER_BREAKPOINT;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    if (key === STORAGE_KEYS.localDemoSessions) historyStorageUnavailable = true;
    return fallback;
  }
}

function readActiveConversationId() {
  try {
    const value = sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
    return typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value
      : null;
  } catch (_error) {
    return null;
  }
}

function storeActiveConversationId(conversationId) {
  if (
    typeof conversationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)
  ) return;
  try {
    sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
  } catch (_error) {
    // The server remains authoritative if browser session storage is unavailable.
  }
}

function clearActiveConversationId() {
  try {
    sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch (_error) {
    // Clearing in-memory state still prevents stale history from being displayed.
  }
}

function loadSettings() {
  const stored = readJson(STORAGE_KEYS.settings, {});
  return {
    ...defaultSettings,
    language: ['en', 'hi', 'mix'].includes(stored?.language) ? stored.language : defaultSettings.language,
    theme: ['midnight', 'aurora', 'violet'].includes(stored?.theme) ? stored.theme : defaultSettings.theme,
    animationIntensity: ['normal', 'reduced'].includes(stored?.animationIntensity) ? stored.animationIntensity : defaultSettings.animationIntensity,
    reducedMotion: stored?.reducedMotion === true,
    phonePermission: stored?.phonePermission !== false,
    provider: PROVIDER_IDS.has(stored?.provider) ? stored.provider : defaultSettings.provider,
    memoryEnabled: stored?.memoryEnabled === true,
  };
}

function loadMemories() {
  const memories = readJson(STORAGE_KEYS.memories, []);
  if (!Array.isArray(memories)) return [];
  return memories
    .filter((memory) => memory && typeof memory.id === 'string' && typeof memory.text === 'string')
    .slice(0, MAX_SAVED_MEMORIES);
}

function persistMemories(memories) {
  if (state.authMode !== 'anonymous') return false;
  try {
    localStorage.setItem(STORAGE_KEYS.memories, JSON.stringify(memories));
    return true;
  } catch (_error) {
    return false;
  }
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  applySettings();
}

function setRequestPending(pending) {
  state.requestInFlight = pending;
  const controls = [
    dom.analyzeBtn,
    dom.chatSubmit,
    dom.researchMode,
    ...document.querySelectorAll('[data-voki-submit], [data-voki-decision]'),
    ...document.querySelectorAll('.approval-actions button'),
  ].filter(Boolean);
  controls.forEach((control) => {
    control.disabled = pending;
    control.setAttribute('aria-busy', String(pending));
  });
  document.body.dataset.requestPending = String(pending);
}

function beginRequest() {
  if (state.requestInFlight || state.authMode === 'checking' || state.logoutInProgress) return null;
  state.requestSequence += 1;
  setRequestPending(true);
  return state.requestSequence;
}

function finishRequest(requestId) {
  if (requestId !== state.requestSequence) return;
  setRequestPending(false);
}

function invalidatePendingRequest() {
  state.requestSequence += 1;
  setRequestPending(false);
}

function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (state.authMode === 'authenticated' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!state.csrfToken) {
      return Promise.reject(new Error('Authenticated request is missing its CSRF token'));
    }
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  return fetch(path, { ...options, headers }).then(async (response) => {
    if (state.authMode === 'authenticated' && [401, 403, 404].includes(response.status)) {
      await refreshAuthenticationState({ expired: true, broadcast: true });
    }
    return response;
  });
}

function notifyOtherTabs(reason) {
  const message = { type: 'authentication-ended', reason, timestamp: Date.now() };
  if (state.authChannel) {
    state.authChannel.postMessage(message);
    return;
  }
  try {
    localStorage.setItem('parmar-auth-notification', JSON.stringify(message));
  } catch (_error) {
    // This fallback is a notification only; the server remains authoritative.
  }
}

function clearAuthenticatedState(message, { broadcast = false } = {}) {
  if (state.authMode === 'authenticated' || state.authMode === 'checking') {
    invalidatePendingRequest();
    state.authEpoch += 1;
    state.authMode = 'anonymous';
    state.authenticationState = 'LOCAL_DEMO';
    state.csrfToken = null;
    state.conversationId = null;
    clearActiveConversationId();
    state.currentSessionId = null;
    state.sessions = [];
    state.pendingApprovalId = null;
    state.serverConversationIds.clear();
    state.localDemoSessions = loadSessions();
    state.sessions = state.localDemoSessions;
    state.memories = loadMemories();
    state.memoryConsent = false;
    state.memoryStorage = null;
    state.currentSessionId = state.sessions[0]?.id || null;
    state.audit = loadAudit();
    renderAuthenticationControls();
    window.dispatchEvent(new CustomEvent('parmar-auth-state-changed'));
    publishConversationSelection(null);
    if (dom.authStatus) {
      dom.authStatus.hidden = !message;
      dom.authStatus.textContent = message || '';
    }
    renderHistory();
    renderSessionMessages();
    renderAuditEntries();
    renderMemories();
    resetReviewState(message);
    selectSection(state.currentSessionId ? 'chat' : 'home');
    if (broadcast) notifyOtherTabs('session-ended');
  }
}

function renderAuthenticationControls() {
  const authenticated = state.authMode === 'authenticated';
  if (dom.authStateLabel) {
    dom.authStateLabel.textContent = state.authenticationState === 'DEVELOPMENT_UNVERIFIED'
      ? 'Development Session — Unverified Identity'
      : authenticated
        ? 'Authenticated Session'
        : 'Anonymous / Local Demo';
  }
  if (dom.chatModeLabel) {
    dom.chatModeLabel.textContent = authenticated
      ? (state.authenticationState === 'DEVELOPMENT_UNVERIFIED'
        ? 'Development session — unverified'
        : 'Authenticated session')
      : 'Local demo';
  }
  if (dom.developmentLoginBtn) {
    dom.developmentLoginBtn.hidden = authenticated || !state.developmentAuthAvailable;
    dom.developmentLoginBtn.disabled = state.authMode === 'checking' || state.developmentLoginInProgress;
  }
  if (dom.developmentAuthNote) {
    dom.developmentAuthNote.hidden = authenticated || !state.developmentAuthAvailable;
  }
  if (dom.logoutBtn) dom.logoutBtn.hidden = !authenticated;
  if (dom.refreshSessionBtn) dom.refreshSessionBtn.hidden = !authenticated;
}

async function refreshAuthenticationState({ expired = false, broadcast = false } = {}) {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Session status is unavailable');
    const payload = await response.json();
    if (payload?.authenticated === true && typeof payload.csrf_token === 'string') {
      const enteringAuthenticated = state.authMode !== 'authenticated';
      const authenticatedSessionChanged = state.authMode === 'authenticated'
        && state.csrfToken !== null
        && state.csrfToken !== payload.csrf_token;
      if (enteringAuthenticated || authenticatedSessionChanged) {
        invalidatePendingRequest();
        state.authEpoch += 1;
        window.dispatchEvent(new CustomEvent('parmar-auth-state-changed'));
        state.sessions = [];
        state.memories = [];
        state.memoryConsent = false;
        state.memoryStorage = null;
        state.currentSessionId = null;
        state.conversationId = null;
        state.pendingApprovalId = null;
        state.serverConversationIds.clear();
        state.audit = [];
        state.memories = [];
        state.memoryConsent = false;
        if (authenticatedSessionChanged) clearActiveConversationId();
      }
      state.authMode = 'authenticated';
      state.authenticationState = payload.authentication_state === 'DEVELOPMENT_UNVERIFIED'
        ? 'DEVELOPMENT_UNVERIFIED'
        : 'AUTHENTICATED';
      state.developmentAuthAvailable = payload.development_auth_available === true;
      state.csrfToken = payload.csrf_token;
      state.localDemoSessions = loadSessions();
      renderHistory();
      renderSessionMessages();
      renderAuditEntries();
      renderMemories();
      if (enteringAuthenticated) await refreshAuthenticatedMemories();
      if (state.authMode !== 'authenticated') return false;
      await refreshServerConversationHistory();
      if (state.authMode !== 'authenticated') return false;
      window.dispatchEvent(new CustomEvent('parmar-auth-session-ready', {
        detail: {
          authenticated: true,
          identityScope: typeof payload.identity_scope === 'string'
            && /^[a-f0-9]{64}$/.test(payload.identity_scope)
            ? payload.identity_scope
            : null,
          conversationId: state.conversationId,
        },
      }));
      renderAuthenticationControls();
      if (dom.authStatus) dom.authStatus.hidden = true;
      return true;
    }
    state.developmentAuthAvailable = payload?.development_auth_available === true;
    if (state.authMode !== 'anonymous') {
      clearAuthenticatedState(
        expired ? 'Your authenticated session expired. You are now using local demo mode.' : '',
        { broadcast },
      );
    }
    renderAuthenticationControls();
    return false;
  } catch (_error) {
    if (state.authMode === 'checking') {
      state.authMode = 'anonymous';
      state.authenticationState = 'LOCAL_DEMO';
      state.developmentAuthAvailable = false;
      state.localDemoSessions = loadSessions();
      state.sessions = state.localDemoSessions;
      state.memories = loadMemories();
      state.memoryConsent = false;
      state.audit = loadAudit();
      renderHistory();
      renderSessionMessages();
      renderAuditEntries();
      renderMemories();
      state.currentSessionId = state.sessions[0]?.id || null;
      if (state.currentSessionId) renderSessionMessages();
      selectSection(state.currentSessionId ? 'chat' : 'home');
    } else if (expired) {
      clearAuthenticatedState(
        'Your authenticated session could not be verified. You are now using local demo mode.',
        { broadcast: true },
      );
    }

    renderAuthenticationControls();
    return false;
  }
}

async function refreshAuthenticatedMemories() {
  const epoch = state.authEpoch;
  try {
    const response = await apiRequest('/api/memory', { cache: 'no-store' });
    if (!response.ok) throw new Error('Authenticated memory could not be loaded');
    const payload = await response.json();
    if (
      epoch !== state.authEpoch
      || state.authMode !== 'authenticated'
      || typeof payload?.consent !== 'boolean'
      || payload?.storage !== 'DURABLE_LOCAL'
      || !Array.isArray(payload.memories)
    ) return;
    state.memoryConsent = payload.consent;
    state.memoryStorage = payload.storage;
    state.memories = payload.memories
      .filter((record) => record
        && typeof record.memory_id === 'string'
        && typeof record.content === 'string')
      .map((record) => ({
        id: record.memory_id,
        text: record.content,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        provenance: record.provenance,
      }));
    renderMemories();
  } catch (_error) {
    if (epoch === state.authEpoch && state.authMode === 'authenticated') {
      setMemoryFeedback('Server memory is unavailable. No browser memory was substituted.', true);
    }
  }
}

async function setAuthenticatedMemoryConsent(granted) {
  if (state.authMode !== 'authenticated') return;
  try {
    const response = await apiRequest('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'consent', granted }),
    });
    if (!response.ok) throw new Error('Memory consent update was refused');
    const result = await response.json();
    if (state.authMode !== 'authenticated' || typeof result?.consent !== 'boolean') return;
    state.memoryConsent = result.consent;
    setMemoryFeedback(result.consent
      ? 'Server memory consent is on. Saving still requires an explicit Save action.'
      : 'Server memory consent was revoked. Existing notes remain available for review or deletion.');
    renderMemories();
  } catch (_error) {
    if (dom.memoryEnabledToggle) dom.memoryEnabledToggle.checked = state.memoryConsent;
    setMemoryFeedback('Could not update server memory consent.', true);
  }
}

function configureCrossTabAuthentication() {
  if ('BroadcastChannel' in window) {
    state.authChannel = new BroadcastChannel('parmar-auth-state');
    state.authChannel.addEventListener('message', (event) => {
      if (event.data?.type === 'authentication-ended') {
        refreshAuthenticationState({ expired: true });
      }
    });
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== 'parmar-auth-notification' || !event.newValue) return;
    let notification;
    try {
      notification = JSON.parse(event.newValue);
    } catch (_error) {
      return;
    }
    if (notification?.type === 'authentication-ended') {
      refreshAuthenticationState({ expired: true });
    }
  });
}

function applySettings() {
  const settings = state.settings;
  document.body.dataset.theme = settings.theme;
  document.body.dataset.animation = settings.animationIntensity;
  document.body.classList.toggle('reduced-motion', Boolean(settings.reducedMotion));
  if (motionIsReduced() && dom.parmarCore) {
    dom.parmarCore.style.setProperty('--tilt-x', '0deg');
    dom.parmarCore.style.setProperty('--tilt-y', '0deg');
  }
  if (dom.languageSelect) dom.languageSelect.value = settings.language;
  if (dom.settingsLanguage) dom.settingsLanguage.value = settings.language;
  if (dom.settingsTheme) dom.settingsTheme.value = settings.theme;
  if (dom.settingsAnimation) dom.settingsAnimation.value = settings.animationIntensity;
  if (dom.settingsReducedMotion) dom.settingsReducedMotion.checked = Boolean(settings.reducedMotion);
  if (dom.settingsPhoneToggle) dom.settingsPhoneToggle.checked = Boolean(settings.phonePermission);
  if (dom.phonePermissionToggle) dom.phonePermissionToggle.checked = Boolean(settings.phonePermission);
  if (dom.memoryEnabledToggle) dom.memoryEnabledToggle.checked = Boolean(settings.memoryEnabled);
  if (dom.providerStatus) dom.providerStatus.textContent = String(settings.provider || 'local-demo').toUpperCase();
  if (dom.settingsProvider) dom.settingsProvider.value = settings.provider;
}

function motionIsReduced() {
  return Boolean(
    state.settings.reducedMotion
    || state.settings.animationIntensity === 'reduced'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeStatus(value) {
  return String(value || 'UNKNOWN').toUpperCase();
}

function displayList(value, fallback) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' • ');
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

function setVokiState(rawState) {
  const key = normalizeStatus(rawState);
  const presentation = lifecyclePresentation[key] || lifecyclePresentation.UNKNOWN;

  if (dom.parmarCore) {
    dom.parmarCore.className = `parmar-core ${presentation.className}`;
  }

  document.body.dataset.vokiState = lifecyclePresentation[key] ? key : 'UNKNOWN';
  if (dom.vokiState) {
    dom.vokiState.textContent = presentation.label;
  }
}

function setBadge(status) {
  if (!dom.statusPill) return;
  const normalized = normalizeStatus(status);
  dom.statusPill.classList.remove('status-safe', 'status-warning', 'status-danger');

  if (normalized === 'BLOCKED' || normalized === 'REJECTED' || normalized === 'RISK_DETECTED') {
    dom.statusPill.classList.add('status-danger');
    dom.statusPill.textContent = normalized === 'RISK_DETECTED' ? 'RISK DETECTED' : 'BLOCKED';
    return;
  }

  if (normalized === 'SAFE' || normalized === 'RELEASED') {
    dom.statusPill.classList.add('status-safe');
    dom.statusPill.textContent = normalized === 'RELEASED' ? 'RESPONSE RELEASED' : 'SAFE';
    return;
  }

  if ([
    'APPROVAL_REQUIRED',
    'WAITING_FOR_HUMAN',
    'ENFORCEMENT_ALLOWED',
    'APPROVED',
    'REVIEW',
    'WITHHELD',
  ].includes(normalized)) {
    dom.statusPill.classList.add('status-warning');
    dom.statusPill.textContent = ({
      APPROVAL_REQUIRED: 'REVIEW REQUIRED',
      WAITING_FOR_HUMAN: 'REVIEW REQUIRED',
      ENFORCEMENT_ALLOWED: 'PERMISSION GRANTED',
      APPROVED: 'APPROVED',
      REVIEW: 'RESPONSE REVIEW',
      WITHHELD: 'RESPONSE WITHHELD',
    })[normalized];
    return;
  }

  dom.statusPill.textContent = ({
    UNKNOWN: 'NOT ASSESSED',
    UNAVAILABLE: 'UNAVAILABLE',
    PROVIDER_FAILED: 'PROVIDER UNAVAILABLE',
  })[normalized] || normalized.replaceAll('_', ' ');
}

function syncSidebarToggle() {
  if (!dom.sidebarToggle) return;
  if (window.innerWidth <= PANEL_DRAWER_BREAKPOINT) {
    const isOpen = ['opening', 'open'].includes(workspacePanels.left);
    dom.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
    dom.sidebarToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    return;
  }
  document.body.classList.remove('sidebar-open');
  const isExpanded = !document.body.classList.contains('sidebar-collapsed');
  dom.sidebarToggle.setAttribute('aria-expanded', String(isExpanded));
  dom.sidebarToggle.setAttribute('aria-label', isExpanded ? 'Collapse navigation' : 'Expand navigation');
}

function isCompactPanelViewport() {
  return window.innerWidth <= PANEL_DRAWER_BREAKPOINT;
}

function panelElement(side) {
  return side === 'left' ? dom.sidebar : dom.discoveryPanel;
}

function panelTriggers(side) {
  return side === 'left'
    ? [dom.sidebarToggle]
    : [dom.discoveryToggle, ...dom.discoveryTriggers];
}

function syncWorkspaceAccessibility(activeSide = null) {
  const compact = isCompactPanelViewport();
  const active = compact && activeSide && workspacePanels[activeSide] !== 'closed';
  if (dom.mainPanel) dom.mainPanel.inert = Boolean(active);

  for (const side of ['left', 'right']) {
    const panel = panelElement(side);
    if (!panel) continue;
    const visible = !compact || (active && side === activeSide);
    panel.inert = !visible;
    panel.setAttribute('aria-hidden', String(!visible));
    if (compact && visible) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
    }
    const expanded = compact
      ? visible && ['opening', 'open'].includes(workspacePanels[side])
      : ['opening', 'open'].includes(workspacePanels[side]);
    for (const trigger of panelTriggers(side)) {
      trigger?.setAttribute('aria-expanded', String(expanded));
      if (trigger === dom.sidebarToggle) {
        trigger.setAttribute('aria-label', compact
          ? expanded ? 'Close navigation' : 'Open navigation'
          : expanded ? 'Collapse navigation' : 'Expand navigation');
      } else if (trigger === dom.discoveryToggle) {
        trigger.setAttribute('aria-label', compact
          ? expanded ? 'Close Discovery' : 'Open Discovery'
          : 'Focus Discovery panel');
      }
    }
  }

  if (dom.panelScrim) dom.panelScrim.hidden = !active;
  if (!active) {
    document.body.classList.remove('workspace-drawer-open');
    if (dom.panelScrim) dom.panelScrim.style.removeProperty('opacity');
  } else {
    document.body.classList.add('workspace-drawer-open');
  }
}

function applyWorkspacePanelState(side, nextState, { immediate = false } = {}) {
  const panel = panelElement(side);
  if (!panel) return;
  window.clearTimeout(panelTransitionTimers[side]);
  workspacePanels[side] = nextState;
  document.body.dataset[side === 'left' ? 'leftPanelState' : 'rightPanelState'] = nextState;

  const isVisible = ['opening', 'open'].includes(nextState);
  if (isCompactPanelViewport()) {
    document.body.classList.toggle(side === 'left' ? 'sidebar-open' : 'discovery-open', isVisible);
  } else if (side === 'left') {
    document.body.classList.toggle('sidebar-collapsed', !isVisible);
  } else {
    document.body.classList.toggle('discovery-collapsed', !isVisible);
  }

  syncWorkspaceAccessibility(isCompactPanelViewport() && nextState !== 'closed' ? side : null);
  if (!immediate && ['opening', 'closing'].includes(nextState)) {
    panelTransitionTimers[side] = window.setTimeout(
      () => finishWorkspacePanelTransition(side),
      PANEL_TRANSITION_MS + 60,
    );
  }
}

function finishWorkspacePanelTransition(side) {
  const current = workspacePanels[side];
  if (current !== 'opening' && current !== 'closing') return;
  window.clearTimeout(panelTransitionTimers[side]);
  const nextState = current === 'opening' ? 'open' : 'closed';
  applyWorkspacePanelState(side, nextState, { immediate: true });

  if (nextState === 'closed' && !['opening', 'open', 'closing'].includes(workspacePanels[side === 'left' ? 'right' : 'left'])) {
    const focusOrigin = panelFocusOrigins[side];
    panelFocusOrigins[side] = null;
    focusOrigin?.focus?.({ preventScroll: true });
  }
}

function openWorkspacePanel(side, trigger = document.activeElement) {
  const panel = panelElement(side);
  if (!panel) return;
  if (isCompactPanelViewport()) {
    const otherSide = side === 'left' ? 'right' : 'left';
    if (workspacePanels[otherSide] !== 'closed') {
      applyWorkspacePanelState(otherSide, 'closed', { immediate: true });
      panelFocusOrigins[otherSide] = null;
    }
    panelFocusOrigins[side] = trigger;
  }
  if (!isCompactPanelViewport() && workspacePanels[side] === 'open') return;
  applyWorkspacePanelState(side, 'opening');

  if (isCompactPanelViewport()) {
    const closeButton = side === 'left' ? dom.sidebarClose : dom.discoveryClose;
    closeButton?.focus({ preventScroll: true });
  }
}

function closeWorkspacePanel(side, { restoreFocus = true } = {}) {
  if (workspacePanels[side] === 'closed' || workspacePanels[side] === 'closing') return;
  if (!restoreFocus) panelFocusOrigins[side] = null;
  applyWorkspacePanelState(side, 'closing');
}

function toggleWorkspacePanel(side, trigger) {
  if (['opening', 'open'].includes(workspacePanels[side])) {
    closeWorkspacePanel(side);
  } else {
    openWorkspacePanel(side, trigger);
  }
}

function syncWorkspacePanels() {
  const compact = isCompactPanelViewport();
  if (compact) {
    const focusedSide = ['left', 'right'].find((side) => panelElement(side)?.contains(document.activeElement));
    document.body.classList.remove('sidebar-collapsed', 'discovery-collapsed');
    for (const side of ['left', 'right']) {
      window.clearTimeout(panelTransitionTimers[side]);
      panelFocusOrigins[side] = null;
      applyWorkspacePanelState(side, 'closed', { immediate: true });
      panelElement(side)?.style.removeProperty('--gesture-x');
    }
    if (focusedSide) panelTriggers(focusedSide)[0]?.focus({ preventScroll: true });
  } else {
    document.body.classList.remove('sidebar-open', 'discovery-open', 'workspace-drawer-open');
    if (dom.panelScrim) dom.panelScrim.hidden = true;
    applyWorkspacePanelState('left', document.body.classList.contains('sidebar-collapsed') ? 'closed' : 'open', { immediate: true });
    applyWorkspacePanelState('right', document.body.classList.contains('discovery-collapsed') ? 'closed' : 'open', { immediate: true });
  }
  syncSidebarToggle();
  syncWorkspaceAccessibility();
}

function handleWorkspaceResize() {
  if (panelGesture) finishPanelGesture(null, true);
  const compact = isCompactPanelViewport();
  if (compact !== lastCompactPanelViewport) syncWorkspacePanels();
  else {
    syncSidebarToggle();
    syncWorkspaceAccessibility(
      compact ? ['left', 'right'].find((side) => workspacePanels[side] !== 'closed') : null,
    );
  }
  lastCompactPanelViewport = compact;
}

function openDiscoveryTarget(targetId, trigger) {
  const section = dom.discoverySections.find((item) => item.id === `discovery-${targetId}`);
  document.body.dataset.discoveryTarget = targetId;
  dom.discoveryTriggers.forEach((button) => {
    if (button.dataset.discoveryTarget === targetId) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  openWorkspacePanel('right', trigger);
  section?.scrollIntoView({ behavior: motionIsReduced() ? 'auto' : 'smooth', block: 'nearest' });
}

function onWorkspacePanelTransitionEnd(event, side) {
  if (event.target === panelElement(side) && event.propertyName === 'transform') {
    finishWorkspacePanelTransition(side);
  }
}

function panelGestureExcluded(target) {
  return Boolean(target?.closest?.(
    'input, textarea, select, button, a, [contenteditable="true"], #parmar-core, .chat-thread, .chat-composer, [data-panel-gesture-ignore]',
  ));
}

function startPanelGesture(event) {
  if (!isCompactPanelViewport() || !event.isPrimary || event.pointerType === 'mouse' || event.button !== 0) return;
  if (panelGestureExcluded(event.target) || window.getSelection?.()?.toString()) return;
  window.clearTimeout(gestureResetTimer);
  document.body.dataset.gestureState = 'idle';

  const x = event.clientX;
  const openSide = ['left', 'right'].find((side) => ['opening', 'open'].includes(workspacePanels[side]));
  let side = null;
  let wasOpen = false;
  if (openSide) {
    const panel = panelElement(openSide);
    if (!panel?.contains(event.target)) return;
    side = openSide;
    wasOpen = true;
  } else if (x <= PANEL_EDGE_ZONE) {
    side = 'left';
  } else if (x >= window.innerWidth - PANEL_EDGE_ZONE) {
    side = 'right';
  } else {
    return;
  }

  panelGesture = {
    side,
    wasOpen,
    pointerId: event.pointerId,
    target: event.target,
    startX: x,
    startY: event.clientY,
    lastX: x,
    lastY: event.clientY,
    startedAt: performance.now(),
    locked: false,
  };
}

function movePanelGesture(event) {
  if (!panelGesture || event.pointerId !== panelGesture.pointerId) return;
  if (window.getSelection?.()?.toString()) {
    finishPanelGesture(null, true);
    return;
  }
  const gesture = panelGesture;
  const deltaX = event.clientX - gesture.startX;
  const deltaY = event.clientY - gesture.startY;
  if (!gesture.locked) {
    const axis = panelGestureAxis(deltaX, deltaY);
    if (axis === 'pending') return;
    if (axis === 'vertical') {
      document.body.dataset.gestureState = 'cancelled';
      panelGesture = null;
      gestureResetTimer = window.setTimeout(() => {
        if (document.body.dataset.gestureState === 'cancelled') document.body.dataset.gestureState = 'idle';
        gestureResetTimer = null;
      }, PANEL_TRANSITION_MS);
      return;
    }
    gesture.locked = true;
    document.body.classList.add('panel-dragging');
    try {
      gesture.target.setPointerCapture?.(gesture.pointerId);
    } catch {}
  }

  event.preventDefault();
  gesture.lastX = event.clientX;
  gesture.lastY = event.clientY;
  const panel = panelElement(gesture.side);
  const panelWidth = panel?.getBoundingClientRect().width || window.innerWidth * 0.82;
  const openFraction = Math.max(0, Math.min(1, panelOpenFraction(gesture.side, gesture.wasOpen, deltaX, panelWidth)));
  panel?.style.setProperty('--gesture-x', `${deltaX}px`);
  if (dom.panelScrim) {
    dom.panelScrim.hidden = false;
    dom.panelScrim.style.opacity = String(openFraction * 0.64);
  }
  document.body.dataset.gestureState = gesture.side === 'left' ? 'tracking-left' : 'tracking-right';
}

function finishPanelGesture(event, cancelled = false) {
  if (!panelGesture || (event && event.pointerId !== panelGesture.pointerId)) return;
  const gesture = panelGesture;
  panelGesture = null;
  const panel = panelElement(gesture.side);
  const deltaX = (event?.clientX ?? gesture.lastX) - gesture.startX;
  const deltaY = (event?.clientY ?? gesture.lastY) - gesture.startY;
  const elapsed = Math.max(1, performance.now() - gesture.startedAt);
  const velocityX = cancelled ? 0 : deltaX / elapsed;
  const width = panel?.getBoundingClientRect().width || window.innerWidth * 0.82;
  const progress = Math.max(0, Math.min(1, panelOpenFraction(gesture.side, gesture.wasOpen, deltaX, width)));
  const velocityTowardOpen = (gesture.side === 'left' ? 1 : -1) * velocityX;
  const shouldOpen = !cancelled && gesture.locked
    && shouldOpenPanelAfterGesture(progress, velocityTowardOpen, deltaX);

  document.body.classList.remove('panel-dragging');
  panel?.style.removeProperty('--gesture-x');
  if (dom.panelScrim) dom.panelScrim.style.removeProperty('opacity');
  document.body.dataset.gestureState = cancelled || !gesture.locked ? 'cancelled' : 'committed';

  if (cancelled) {
    if (!gesture.wasOpen && dom.panelScrim) dom.panelScrim.hidden = true;
  } else if (gesture.locked) {
    if (shouldOpen) openWorkspacePanel(gesture.side, panelFocusOrigins[gesture.side] || document.activeElement);
    else if (gesture.wasOpen) closeWorkspacePanel(gesture.side);
    else {
      if (dom.panelScrim) dom.panelScrim.hidden = true;
      document.body.dataset.gestureState = 'cancelled';
    }
  } else if (panelGestureAxis(deltaX, deltaY) === 'vertical') {
    document.body.dataset.gestureState = 'cancelled';
  }

  window.clearTimeout(gestureResetTimer);
  gestureResetTimer = window.setTimeout(() => {
    if (document.body.dataset.gestureState === 'committed' || document.body.dataset.gestureState === 'cancelled') {
      document.body.dataset.gestureState = 'idle';
    }
    gestureResetTimer = null;
  }, PANEL_TRANSITION_MS);
}

function selectSection(sectionName, navKey = sectionName) {
  dom.navButtons.forEach((button) => {
    const active = button.dataset.navKey
      ? button.dataset.navKey === navKey
      : button.dataset.section === sectionName;
    button.classList.toggle('active', active);
  });

  dom.views.forEach((view) => {
    const active = view.dataset.section === sectionName;
    view.classList.toggle('active', active);
  });

  document.querySelectorAll('.capability-toolbar [data-section]').forEach((button) => {
    const active = button.dataset.section === sectionName;
    button.classList.toggle('is-current', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  const sectionLabels = {
    home: 'PARMAR Core',
    chat: 'Chats / History',
    voki: 'VOKKI',
    safety: 'Risk & Safety',
    phone: 'Phone Awareness',
    simulator: 'Simulation',
    audit: 'Activity',
    memory: 'Memory',
    tools: 'Tools / Plugins',
    system: 'System Status',
    settings: 'Settings',
  };
  if (dom.viewTitle) dom.viewTitle.textContent = sectionLabels[sectionName] || 'PARMAR';
  document.body.dataset.activeSection = sectionName;
  if (isCompactPanelViewport()) {
    for (const side of ['left', 'right']) {
      if (workspacePanels[side] !== 'closed') closeWorkspacePanel(side);
    }
  }
  syncSidebarToggle();
}

function ensureCurrentSession() {
  const current = state.sessions.find((session) => session.id === state.currentSessionId);
  return current || createSession();
}

function createSession() {
  let randomId;
  do {
    randomId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  } while (state.sessions.some((session) => session.id === `session-${randomId}`));
  const session = {
    id: `session-${randomId}`,
    title: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.sessions = [session, ...state.sessions.filter((entry) => entry.messages.length > 0)];
  state.currentSessionId = session.id;
  renderHistory();
  return session;
}

function persistedSessionList() {
  if (state.authMode === 'authenticated') {
    renderHistory();
    return false;
  }
  state.sessions = sanitizeStoredValue(state.sessions);
  if (historyStorageUnavailable) {
    renderHistory();
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEYS.localDemoSessions, JSON.stringify(state.sessions));
    return true;
  } catch (_error) {
    historyStorageUnavailable = true;
    renderHistory();
    return false;
  }
}

function setMemoryFeedback(message, isError = false) {
  if (!dom.memoryFeedback) return;
  dom.memoryFeedback.textContent = message;
  dom.memoryFeedback.classList.toggle('is-error', isError);
}

function renderMemories() {
  const memories = state.memories;
  const authenticated = state.authMode === 'authenticated';
  const enabled = authenticated ? state.memoryConsent : Boolean(state.settings.memoryEnabled);
  if (dom.memoryPrivacyNote) {
    const base = 'Relevant consented server notes may be used as untrusted context in authenticated chat and cannot control PARMAR safety or approvals.';
    const externalProvider = state.settings.provider !== 'local-demo';
    dom.memoryPrivacyNote.textContent = authenticated
      ? `${base} ${externalProvider
        ? 'The selected provider is external; if it is authorized for this request, matched notes may be included in its request.'
        : 'The selected provider is local demo; notes are not sent to an external provider in this request.'} Authenticated notes are stored durably on this server’s local disk (not encrypted at rest), until you delete them. Each note is limited to 400 characters, with up to 25 notes. Local-demo notes remain in this browser. Do not save passwords, tokens, private keys, or other secrets.`
      : 'Authenticated notes stay on the server. Local-demo notes stay in this browser and are not added to chat. Do not save passwords, tokens, private keys, or other secrets.';
  }
  if (dom.memoryEnabledToggle) dom.memoryEnabledToggle.checked = enabled;
  if (dom.memoryEnabledToggle) dom.memoryEnabledToggle.disabled = state.authMode === 'checking';
  if (dom.memorySaveBtn) {
    dom.memorySaveBtn.disabled = state.authMode === 'checking' || (authenticated && !state.memoryConsent);
  }
  if (dom.memoryEnabledLabel) dom.memoryEnabledLabel.textContent = enabled ? 'Enabled' : 'Disabled';
  const memoryTitle = document.getElementById('memory-storage-title');
  if (memoryTitle) {
    memoryTitle.textContent = authenticated
      ? state.memoryStorage === 'DURABLE_LOCAL'
        ? 'Authenticated durable memory'
        : 'Authenticated memory status unavailable'
      : 'Local-demo memory preference';
  }
  if (dom.memoryEnabledDescription) {
    dom.memoryEnabledDescription.textContent = authenticated
      ? state.memoryStorage === 'DURABLE_LOCAL'
        ? enabled
          ? 'Durable local storage is enabled by your consent. Notes remain until you delete them and may be used only as untrusted context.'
          : 'Durable local storage is available, but consent is off. Existing notes remain available for review or deletion and are not used in Chat.'
        : 'Durable memory status could not be confirmed. Saving and retrieval are unavailable until the server responds.'
      : 'Local-demo notes stay in this browser and are not added to chat.';
  }
  if (dom.memoryCount) dom.memoryCount.textContent = `${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}`;
  if (dom.memoryClearAll) dom.memoryClearAll.disabled = memories.length === 0;
  if (dom.memoryEmpty) dom.memoryEmpty.hidden = memories.length > 0;
  if (!dom.memoryList) return;

  const items = memories.map((memory) => {
    const item = document.createElement('li');
    item.className = 'memory-item';
    const text = document.createElement('p');
    text.className = 'memory-item-text';
    text.textContent = memory.text;
    const details = document.createElement('div');
    details.className = 'memory-item-details';
    const origin = document.createElement('span');
    origin.textContent = 'Saved by you';
    details.appendChild(origin);
    if (memory.createdAt && Number.isFinite(Date.parse(memory.createdAt))) {
      const created = document.createElement('time');
      created.dateTime = memory.createdAt;
      created.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(memory.createdAt));
      details.appendChild(created);
    }

    const actions = document.createElement('div');
    actions.className = 'memory-item-actions';
    const edit = document.createElement('button');
    edit.className = 'memory-delete';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.title = 'Edit this memory';
    edit.disabled = authenticated && !state.memoryConsent;
    edit.addEventListener('click', () => editMemory(memory.id));
    const remove = document.createElement('button');
    remove.className = 'memory-delete';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.title = 'Delete this memory';
    remove.setAttribute('aria-label', `Delete memory: ${memory.text.slice(0, 80)}`);
    remove.addEventListener('click', () => deleteMemory(memory.id));
    actions.append(edit, remove);

    const body = document.createElement('div');
    body.className = 'memory-item-body';
    body.append(text, details);
    item.append(body, actions);
    return item;
  });
  dom.memoryList.replaceChildren(...items);
}

async function addMemory(event) {
  event.preventDefault();
  if (state.authMode === 'checking') {
    setMemoryFeedback('Checking session before saving memory.', true);
    return;
  }
  const text = (dom.memoryInput?.value || '').trim();
  if (!text) {
    setMemoryFeedback('Enter a note before saving.', true);
    dom.memoryInput?.focus();
    return;
  }
  if (text.length > 400) {
    setMemoryFeedback('Memories must be 400 characters or fewer.', true);
    return;
  }
  if (containsSensitiveMemory(text)) {
    setMemoryFeedback('This looks like a credential or secret. It was not saved.', true);
    return;
  }
  if (state.authMode === 'authenticated') {
    if (!state.memoryConsent) {
      setMemoryFeedback('Give explicit server memory consent before saving a note.', true);
      return;
    }
    try {
      const response = await apiRequest('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', content: text }),
      });
      if (!response.ok) {
        setMemoryFeedback('The server refused this memory. Check consent and try again.', true);
        return;
      }
      if (state.authMode !== 'authenticated') return;
      if (dom.memoryInput) dom.memoryInput.value = '';
      setMemoryFeedback('Memory saved to your authenticated account.');
      await refreshAuthenticatedMemories();
    } catch (_error) {
      setMemoryFeedback('Server memory is unavailable. The note was not saved locally.', true);
    }
    return;
  }
  if (state.memories.length >= MAX_SAVED_MEMORIES) {
    setMemoryFeedback('Memory is full. Delete an entry before saving another.', true);
    return;
  }
  if (state.memories.some((memory) => memory.text.toLocaleLowerCase() === text.toLocaleLowerCase())) {
    setMemoryFeedback('That memory is already saved.', true);
    return;
  }

  const memory = {
    id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: new Date().toISOString(),
  };
  const nextMemories = [memory, ...state.memories];
  if (!persistMemories(nextMemories)) {
    setMemoryFeedback('Could not save to this browser. Check available storage and try again.', true);
    return;
  }
  state.memories = nextMemories;
  if (dom.memoryInput) dom.memoryInput.value = '';
  setMemoryFeedback('Memory saved in this browser.');
  renderMemories();
}

async function editMemory(memoryId) {
  if (state.authMode === 'checking') return;
  const current = state.memories.find((memory) => memory.id === memoryId);
  if (!current) return;
  const content = window.prompt('Edit this saved memory', current.text);
  if (content === null) return;
  const text = content.trim();
  if (!text || text.length > 400 || containsSensitiveMemory(text)) {
    setMemoryFeedback('Memory must contain 1 to 400 characters and cannot contain obvious credentials.', true);
    return;
  }
  if (state.authMode === 'authenticated') {
    if (!state.memoryConsent) {
      setMemoryFeedback('Give explicit server memory consent before updating a note.', true);
      return;
    }
    try {
      const response = await apiRequest('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', memory_id: memoryId, content: text }),
      });
      if (!response.ok) {
        setMemoryFeedback('The server refused this update. Check consent and try again.', true);
        return;
      }
      setMemoryFeedback('Memory updated on the server.');
      await refreshAuthenticatedMemories();
    } catch (_error) {
      setMemoryFeedback('Server memory is unavailable. The note was not changed.', true);
    }
    return;
  }
  const nextMemories = state.memories.map((memory) => (
    memory.id === memoryId ? { ...memory, text, updatedAt: new Date().toISOString() } : memory
  ));
  if (!persistMemories(nextMemories)) {
    setMemoryFeedback('Could not update browser storage. Try again.', true);
    return;
  }
  state.memories = nextMemories;
  renderMemories();
}

async function deleteMemory(memoryId) {
  if (state.authMode === 'checking') return;
  if (state.authMode === 'authenticated') {
    try {
      const response = await apiRequest('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', memory_id: memoryId }),
      });
      if (!response.ok) {
        setMemoryFeedback('Memory could not be deleted.', true);
        return;
      }
      setMemoryFeedback('Memory deleted from the server.');
      await refreshAuthenticatedMemories();
    } catch (_error) {
      setMemoryFeedback('Server memory is unavailable. The note was not deleted.', true);
    }
    return;
  }
  const nextMemories = state.memories.filter((memory) => memory.id !== memoryId);
  if (nextMemories.length === state.memories.length) return;
  if (!persistMemories(nextMemories)) {
    setMemoryFeedback('Could not update browser storage. Try again.', true);
    return;
  }
  state.memories = nextMemories;
  setMemoryFeedback('Memory deleted.');
  renderMemories();
}

async function clearAllMemories() {
  if (state.authMode === 'checking') return;
  if (!state.memories.length) return;
  const storageLocation = state.authMode === 'authenticated' ? 'server' : 'this browser';
  if (!window.confirm(`Delete all saved memories from ${storageLocation}? This cannot be undone.`)) return;
  if (state.authMode === 'authenticated') {
    try {
      const response = await apiRequest('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_all' }),
      });
      if (!response.ok) throw new Error('Durable memory clear was refused');
      const result = await response.json();
      if (state.authMode !== 'authenticated' || result?.deleted !== true) return;
      setMemoryFeedback(`All saved server memories were deleted (${Number(result.deleted_count) || 0}).`);
      await refreshAuthenticatedMemories();
    } catch (_error) {
      setMemoryFeedback('Server memory could not be cleared. Some or all notes may remain.', true);
    }
    return;
  }
  if (!persistMemories([])) {
    setMemoryFeedback('Could not update browser storage. Try again.', true);
    return;
  }
  state.memories = [];
  setMemoryFeedback('All saved memories were deleted.');
  renderMemories();
}

function renderHistory() {
  if (!dom.historyList) return;
  const query = state.historyQuery.trim().toLocaleLowerCase();
  const conversations = state.sessions
    .filter((session) => (
      state.authMode !== 'authenticated' || state.serverConversationIds.has(session.id)
    ))
    .filter((session) => (
      session.messages.length > 0
      || (state.authMode === 'authenticated' && state.serverConversationIds.has(session.id))
    ))
    .filter((session) => {
      if (!query) return true;
      const firstUserMessage = session.messages.find((message) => message.role === 'user');
      const title = String(session.title || firstUserMessage?.text || '').toLocaleLowerCase();
      return title.includes(query) || session.messages.some((message) => String(message.text || '').toLocaleLowerCase().includes(query));
    })
    .sort((first, second) => Number(second.updatedAt || 0) - Number(first.updatedAt || 0));

  if (dom.historyStatus) {
    const statusText = state.authMode === 'authenticated'
      ? state.historySelectionId
        ? 'Loading conversation…'
        : state.historyLoading
          ? 'Loading conversation history…'
          : state.historyError
            ? 'Conversation history could not be loaded. Please try again.'
            : ''
      : historyStorageUnavailable
        ? 'Conversation history is unavailable in this browser. Existing data could not be read or saved.'
        : '';
    dom.historyStatus.hidden = !statusText;
    dom.historyStatus.textContent = statusText;
  }

  dom.historyList.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = query
      ? 'No loaded conversations match this filter.'
      : state.authMode === 'authenticated'
      ? state.historyLoading
        ? 'Loading conversations…'
        : state.historyError
          ? 'No conversations are available right now.'
          : 'No conversations yet.'
      : historyStorageUnavailable
        ? 'Saved conversations cannot be displayed.'
        : 'No conversations yet.';
    dom.historyList.appendChild(empty);
    return;
  }

  let previousGroup = null;
  conversations.forEach((session) => {
    const timestamp = Number(session.updatedAt || session.createdAt);
    const group = historyGroupLabel(timestamp);
    if (group !== previousGroup) {
      const heading = document.createElement('li');
      heading.className = 'history-group-label';
      heading.textContent = group;
      heading.setAttribute('aria-hidden', 'true');
      dom.historyList.appendChild(heading);
      previousGroup = group;
    }
    const firstUserMessage = session.messages.find((message) => message.role === 'user');
    const title = session.title || firstUserMessage?.text || 'PARMAR response';
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'history-item';
    button.type = 'button';
    button.dataset.sessionId = session.id;
    button.classList.toggle('active', session.id === state.currentSessionId);
    if (session.id === state.currentSessionId) button.setAttribute('aria-current', 'page');

    const titleElement = document.createElement('span');
    titleElement.textContent = String(title).slice(0, 56);
    const dateElement = document.createElement('small');
    if (state.authMode === 'authenticated') {
      const updatedAt = Number(session.updatedAt || session.createdAt);
      dateElement.textContent = Number.isFinite(updatedAt)
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(updatedAt))
        : 'Server conversation';
    } else {
      const updatedAt = Number(session.updatedAt || session.createdAt);
      dateElement.textContent = Number.isFinite(updatedAt)
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(updatedAt))
        : 'Saved locally';
    }
    button.append(titleElement, dateElement);
    button.disabled = state.historySelectionId === session.id;
    button.addEventListener('click', () => {
      const selected = state.sessions.find((entry) => entry.id === button.dataset.sessionId);
      if (!selected) return;
      if (state.authMode === 'authenticated') {
        void selectServerConversation(selected.id);
        return;
      }
      invalidatePendingRequest();
      state.currentSessionId = selected.id;
      state.conversationId = state.authMode === 'authenticated' ? selected.id : null;
      publishConversationSelection(null);
      state.pendingApprovalId = null;
      if (dom.chatInput) dom.chatInput.value = '';
      resizeChatInput();
      const lastUserMessage = [...selected.messages].reverse().find((message) => message.role === 'user');
      if (dom.requestInput) dom.requestInput.value = lastUserMessage?.text || '';
      renderSessionMessages();
      const latestAssistant = [...selected.messages].reverse().find((message) => message.role === 'assistant');
      if (state.authMode === 'authenticated') {
        resetReviewState('Conversation selected. PARMAR will review your next request.');
      } else if (!latestAssistant?.analysis || !updateState(latestAssistant.analysis)) {
        resetReviewState('Conversation selected. No saved safety review is available.');
      }
      renderHistory();
      selectSection('chat', 'chat');
    });
    item.appendChild(button);
    dom.historyList.appendChild(item);
  });
}

async function refreshServerConversationHistory() {
  if (state.authMode !== 'authenticated') return;
  const generation = ++state.historyLoadGeneration;
  const authEpoch = state.authEpoch;
  state.historyLoading = true;
  state.historyError = false;
  renderHistory();
  let restoreConversationId = null;
  try {
    const response = await apiRequest('/api/conversations', { cache: 'no-store' });
    if (!response.ok) throw new Error('History unavailable');
    const payload = await response.json();
    if (generation !== state.historyLoadGeneration || authEpoch !== state.authEpoch || state.authMode !== 'authenticated') return;
    if (!Array.isArray(payload?.conversations)) throw new TypeError('Invalid conversation history');
    const existing = new Map(state.sessions.map((session) => [session.id, session]));
    const conversations = payload.conversations.filter((item) => (
      item
      && typeof item.conversation_id === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.conversation_id)
      && typeof item.title === 'string'
      && item.title.trim()
    )).map((item) => {
      const previous = existing.get(item.conversation_id);
      return {
        id: item.conversation_id,
        title: item.title.trim().slice(0, 56),
        createdAt: Date.parse(item.created_at) || Date.now(),
        updatedAt: Date.parse(item.updated_at) || Date.now(),
        messages: previous?.messages || [],
      };
    });
    const serverIds = new Set(conversations.map((item) => item.id));
    state.serverConversationIds = serverIds;
    state.sessions = conversations;
    if (state.conversationId && !serverIds.has(state.conversationId)) {
      state.conversationId = null;
      state.currentSessionId = null;
      clearActiveConversationId();
      renderSessionMessages();
    } else if (!state.conversationId) {
      const storedConversationId = readActiveConversationId();
      if (storedConversationId && serverIds.has(storedConversationId)) {
        restoreConversationId = storedConversationId;
      } else if (storedConversationId) {
        clearActiveConversationId();
      }
    }
  } catch (_error) {
    if (generation === state.historyLoadGeneration && authEpoch === state.authEpoch && state.authMode === 'authenticated') {
      state.historyError = true;
    }
  } finally {
    if (generation === state.historyLoadGeneration && authEpoch === state.authEpoch && state.authMode === 'authenticated') {
      state.historyLoading = false;
      renderHistory();
      if (restoreConversationId && !state.conversationId) {
        await selectServerConversation(restoreConversationId);
      }
    }
  }
}

async function selectServerConversation(conversationId) {
  if (state.authMode !== 'authenticated' || !state.serverConversationIds.has(conversationId)) return;
  invalidatePendingRequest();
  cancelChatResponseReveal();
  const generation = ++state.historySelectionGeneration;
  const authEpoch = state.authEpoch;
  state.historySelectionId = conversationId;
  state.historyError = false;
  renderHistory();
  try {
    const response = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Conversation unavailable');
    const payload = await response.json();
    if (generation !== state.historySelectionGeneration || authEpoch !== state.authEpoch || state.authMode !== 'authenticated') return;
    if (
      payload?.conversation_id !== conversationId
      || !Array.isArray(payload.messages)
      || !payload.messages.every((message) => (
        message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
      ))
    ) throw new TypeError('Invalid conversation');
    let session = state.sessions.find((item) => item.id === conversationId);
    if (!session) return;
    session.title = typeof payload.title === 'string' ? payload.title.slice(0, 56) : session.title;
    session.createdAt = Date.parse(payload.created_at) || session.createdAt;
    session.updatedAt = Date.parse(payload.updated_at) || session.updatedAt;
    session.messages = payload.messages.map((message) => ({
      role: message.role,
      text: message.content,
      timestamp: message.created_at,
      analysis: message.research && message.role === 'assistant'
        ? { research: message.research, persisted_release: true }
        : null,
    }));
    state.currentSessionId = conversationId;
    state.conversationId = conversationId;
    storeActiveConversationId(conversationId);
    publishConversationSelection(conversationId);
    if (dom.chatInput) dom.chatInput.value = '';
    resizeChatInput();
    renderSessionMessages();
    renderHistory();
    selectSection('chat', 'chat');
  } catch (_error) {
    if (generation === state.historySelectionGeneration && authEpoch === state.authEpoch && state.authMode === 'authenticated') {
      state.historyError = true;
    }
  } finally {
    if (generation === state.historySelectionGeneration && authEpoch === state.authEpoch && state.authMode === 'authenticated') {
      state.historySelectionId = null;
      renderHistory();
    }
  }
}

function historyGroupLabel(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Earlier';
  const date = new Date(timestamp);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const daysOld = Math.floor((startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (daysOld <= 0) return 'Today';
  if (daysOld === 1) return 'Yesterday';
  if (daysOld < 7) return 'Previous 7 days';
  return 'Earlier';
}

function resetReviewState(message = 'PARMAR is ready for a request.') {
  state.pendingApprovalId = null;
  setVokiState('UNKNOWN');
  setBadge('UNKNOWN');
  document.body.dataset.state = 'UNKNOWN';
  if (dom.riskLevel) dom.riskLevel.textContent = '—';
  if (dom.approvalState) dom.approvalState.textContent = 'Not assessed';
  if (dom.outcomeState) dom.outcomeState.textContent = 'Not assessed';
  if (dom.systemState) dom.systemState.textContent = 'NOT ASSESSED';
  if (dom.statusMessage) dom.statusMessage.textContent = message;
  dom.pipelineEl?.replaceChildren();
  dom.riskCenterEl?.replaceChildren();
  dom.explanationList?.replaceChildren();
  if (dom.approvalActions) dom.approvalActions.hidden = true;
  if (dom.approvalStateTag) dom.approvalStateTag.textContent = 'No decision pending';
  if (dom.approvalAction) dom.approvalAction.textContent = 'No active proposal';
  if (dom.approvalRisk) dom.approvalRisk.textContent = '—';
  if (dom.approvalConflicts) dom.approvalConflicts.textContent = 'No explicit conflict detected.';
  if (dom.approvalSafety) dom.approvalSafety.textContent = 'Awaiting review.';
  if (dom.approvalAlternative) dom.approvalAlternative.textContent = 'A recommendation will appear when available.';
}

function resizeChatInput() {
  if (!dom.chatInput) return;
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = `${Math.min(dom.chatInput.scrollHeight, 180)}px`;
}

function renderEmptyChatState() {
  const emptyState = document.createElement('div');
  emptyState.className = 'chat-empty-state';

  const emblem = document.createElement('div');
  emblem.className = 'chat-empty-emblem';
  emblem.setAttribute('aria-hidden', 'true');
  emblem.textContent = 'P';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'chat-empty-eyebrow';
  eyebrow.textContent = 'A human-led space to think';

  const heading = document.createElement('h2');
  heading.textContent = 'What would you like to work through?';

  const description = document.createElement('p');
  description.textContent = 'Share a question or decision. PARMAR can help surface trade-offs and risks; the choice stays with you.';

  const starters = document.createElement('div');
  starters.className = 'chat-starters';
  starters.setAttribute('aria-label', 'Suggested starting points');
  [
    'Help me compare two options',
    'Review a privacy concern',
    'Think through a difficult trade-off',
  ].forEach((prompt) => {
    const button = document.createElement('button');
    button.className = 'chat-starter';
    button.type = 'button';
    button.textContent = prompt;
    button.addEventListener('click', () => {
      if (!dom.chatInput) return;
      dom.chatInput.value = prompt;
      resizeChatInput();
      dom.chatInput.focus();
    });
    starters.appendChild(button);
  });

  emptyState.append(emblem, eyebrow, heading, description, starters);
  dom.chatThread.replaceChildren(emptyState);
}

function createCopyButton(text) {
  const button = document.createElement('button');
  button.className = 'message-copy';
  button.type = 'button';
  button.textContent = '⧉';
  button.setAttribute('aria-label', 'Copy message');
  button.title = 'Copy message';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = '✓';
      button.setAttribute('aria-label', 'Message copied');
      button.title = 'Message copied';
    } catch (_error) {
      button.textContent = '!';
      button.setAttribute('aria-label', 'Copy unavailable');
      button.title = 'Copy unavailable';
    }
    window.setTimeout(() => {
      button.textContent = '⧉';
      button.setAttribute('aria-label', 'Copy message');
      button.title = 'Copy message';
    }, 1400);
  });
  return button;
}

function cancelChatResponseReveal() {
  state.chatRevealGeneration += 1;
  state.chatRevealCancel?.();
  state.chatRevealCancel = null;
}

function appendWaitingIndicator(researchRequested = false) {
  const message = document.createElement('div');
  message.className = 'message assistant waiting-message message-entering';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-label', researchRequested
    ? 'Research request in progress; waiting for PARMAR response'
    : 'Waiting for PARMAR response');

  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = 'P';

  const content = document.createElement('div');
  content.className = 'message-content';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = 'PARMAR';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble waiting-bubble';
  bubble.textContent = researchRequested
    ? 'Research request in progress… Waiting for PARMAR’s response. This is transport status only.'
    : 'Waiting for PARMAR…';
  content.append(meta, bubble);
  message.append(avatar, content);
  dom.chatThread?.appendChild(message);
  if (dom.chatThread) dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
  return message;
}

function renderSessionMessages(animateLatest = false, revealLatestAssistant = false) {
  if (!dom.chatThread) return;
  cancelChatResponseReveal();
  const session = state.sessions.find((entry) => entry.id === state.currentSessionId);
  dom.chatThread.replaceChildren();

  if (!session || !session.messages.length) {
    renderEmptyChatState();
    return;
  }

  let revealTargets = null;
  session.messages.forEach((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;
    if (animateLatest && index === session.messages.length - 1) wrapper.classList.add('message-entering');
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', `${role === 'assistant' ? 'PARMAR' : 'Your'} message`);

    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = role === 'assistant' ? 'P' : 'Y';

    const content = document.createElement('div');
    content.className = 'message-content';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const author = document.createElement('span');
    author.textContent = role === 'assistant' ? 'PARMAR' : 'You';
    meta.appendChild(author);
    if (message.timestamp && Number.isFinite(Date.parse(message.timestamp))) {
      const time = document.createElement('time');
      time.dateTime = message.timestamp;
      time.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.timestamp));
      meta.appendChild(time);
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const revealThisMessage = revealLatestAssistant
      && role === 'assistant'
      && index === session.messages.length - 1
      && window.PARMARChatPresentation?.isAuthoritativelyReleased(message.analysis);
    if (revealThisMessage) {
      const visibleText = document.createElement('span');
      visibleText.className = 'message-bubble-visual';
      const accessibleText = document.createElement('span');
      accessibleText.className = 'sr-only';
      bubble.append(visibleText, accessibleText);
      revealTargets = { visibleText, accessibleText, text: String(message.text ?? '') };
    } else {
      bubble.textContent = String(message.text ?? '');
    }

    const safetyStatus = role === 'assistant' ? responseSafetyStatus(message.analysis) : null;
    if (safetyStatus) {
      const safetyNote = document.createElement('small');
      safetyNote.className = 'response-safety-note';
      safetyNote.dataset.status = safetyStatus;
      safetyNote.textContent = responseSafetyLabels[safetyStatus];
      content.appendChild(safetyNote);
    }
    if (role === 'assistant') {
      window.PARMARChatPresentation?.renderResearchResult(content, message.analysis);
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.appendChild(createCopyButton(String(message.text ?? '')));

    content.append(meta, bubble, actions);
    wrapper.append(avatar, content);
    dom.chatThread.appendChild(wrapper);
  });

  dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
  if (revealTargets) {
    const revealGeneration = state.chatRevealGeneration;
    state.chatRevealCancel = window.PARMARChatPresentation.startProgressiveReveal({
      ...revealTargets,
      reducedMotion: motionIsReduced(),
      isCurrent: () => (
        state.chatRevealGeneration === revealGeneration
        && dom.chatThread.contains(revealTargets.visibleText)
      ),
      onComplete: () => {
        if (state.chatRevealGeneration === revealGeneration) state.chatRevealCancel = null;
      },
    });
  }
}

function addMessageToSession(role, text, analysis) {
  const session = ensureCurrentSession();
  return appendMessageToSession(session.id, role, text, analysis);
}

function appendMessageToSession(sessionId, role, text, analysis) {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session) return false;
  const firstUserMessage = role === 'user'
    && !session.messages.some((message) => message.role === 'user');
  const safetyStatus = role === 'assistant'
    ? responseSafetyStatus(analysis) ?? (typeof analysis?.provider === 'string' ? 'NOT_CHECKED' : null)
    : null;
  const suppressed = SUPPRESSED_RESPONSE_SAFETY_STATES.has(safetyStatus);
  const unconfirmedCandidate = role === 'assistant' && isUnconfirmedCandidateResponse(analysis);
  const safeText = sanitizeSensitiveText(suppressed || unconfirmedCandidate ? safeChatReply(analysis) : text);
  const storedAnalysis = role === 'assistant' ? sanitizeResponseForHistory(analysis) : sanitizeStoredValue(analysis);
  const entry = { role, text: safeText, analysis: storedAnalysis, timestamp: new Date().toISOString() };
  session.messages.push(entry);
  session.updatedAt = Date.now();
  if (firstUserMessage) {
    session.title = safeText.slice(0, 40) || 'PARMAR session';
  }
  if (role === 'assistant') session.status = analysis?.status || 'READY';
  persistedSessionList();
  renderHistory();
  if (session.id === state.currentSessionId) {
    const releasedAssistant = role === 'assistant'
      && window.PARMARChatPresentation?.isAuthoritativelyReleased(analysis);
    renderSessionMessages(true, Boolean(releasedAssistant));
  }
  return true;
}

function renderAuditEntries() {
  const entries = state.audit.slice(0, 6);

  const markup = entries.map((entry) => `
    <div class="audit-item">
      <strong>${escapeHtml(entry.status || 'STATUS')}</strong>
      <span>${escapeHtml(entry.message || entry.request || 'No audit record.')}</span>
    </div>
  `).join('');

  if (dom.auditList) dom.auditList.innerHTML = markup || '<div class="audit-item"><strong>NO RECORDS</strong><span>No governance activity captured yet.</span></div>';
  if (dom.auditListSecondary) dom.auditListSecondary.innerHTML = markup || '<div class="audit-item"><strong>NO RECORDS</strong><span>No governance activity captured yet.</span></div>';
}

function addAuditEntry(request, status, riskLevel, message) {
  const entry = {
    request: sanitizeSensitiveText(request || 'No request'),
    status: normalizeStatus(status),
    riskLevel: normalizeStatus(riskLevel),
    message: sanitizeSensitiveText(message || 'Governance review recorded.'),
    timestamp: new Date().toISOString(),
  };
  state.audit = [entry, ...state.audit].slice(0, 12);
  if (state.authMode !== 'authenticated') {
    localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(state.audit));
  }
  renderAuditEntries();
}

function renderApproval(result) {
  const analysis = result?.analysis || result || {};
  const requiresApproval = Boolean(analysis.human_approval_required || result?.human_approval_required);
  const lifecycleState = normalizeStatus(analysis.lifecycle?.current_state || result?.lifecycle?.current_state || '');
  const status = normalizeStatus(analysis.status || result?.status || '');
  const pending = lifecycleState === 'WAITING_FOR_HUMAN' && Boolean(analysis.approval_id || result?.approval_id);

  if (dom.approvalActions) dom.approvalActions.hidden = !pending;
  if (dom.approvalStateTag) {
    dom.approvalStateTag.textContent = pending
      ? 'Your decision is needed'
      : lifecycleState === 'BLOCKED' || status === 'BLOCKED'
        ? 'Stopped by safety controls'
        : 'No decision pending';
  }

  if (dom.approvalAction) dom.approvalAction.textContent = analysis.request || result?.request || 'No active action';
  if (dom.approvalRisk) dom.approvalRisk.textContent = String(analysis.risk?.risk_level || result?.risk?.risk_level || 'LOW').toUpperCase();
  if (dom.approvalConflicts) {
    dom.approvalConflicts.textContent = displayList(
      analysis.conflict?.reasons || result?.conflict?.reasons,
      'No explicit conflict detected.',
    );
  }
  if (dom.approvalSafety) {
    const checks = [
      analysis.privacy?.status,
      analysis.autonomy?.status,
      analysis.emergency_gate?.status,
      result?.privacy?.status,
      result?.autonomy?.status,
      result?.emergency_gate?.status,
    ].filter(Boolean);
    dom.approvalSafety.textContent = checks.length ? checks.join(' • ') : 'All checks passed.';
  }
  if (dom.approvalAlternative) {
    const alt = (analysis.mediation?.alternatives || result?.safer_alternatives || [{ message: 'Continue with a narrower, consent-first option.' }])[0];
    dom.approvalAlternative.textContent = alt?.message || 'Continue with a narrower, consent-first option.';
  }

  if (!requiresApproval) {
    if (dom.approvalAction) dom.approvalAction.textContent = 'No action requires approval';
    if (dom.approvalConflicts) dom.approvalConflicts.textContent = 'No explicit conflict detected.';
    if (dom.approvalSafety) dom.approvalSafety.textContent = 'All checks passed.';
  }
}

function renderRiskCenter(result) {
  const analysis = result?.analysis || result || {};
  const risk = analysis.risk_center || analysis.risk || {};
  const categories = Array.isArray(analysis.risk_center?.risk_categories)
    ? analysis.risk_center.risk_categories.join(', ')
    : Object.entries(risk.category_flags || {}).filter(([, enabled]) => enabled).map(([key]) => key).join(', ');
  const entries = [
    ['Risk level', String(risk.risk_level || 'LOW').toUpperCase()],
    ['Detected intent', analysis.intent?.intent || risk.detected_intent || 'unknown'],
    ['Impact', categories || 'none_detected'],
    ['Reasoning', analysis.risk_center?.reason_for_decision || risk.summary || 'Policy evaluation completed.'],
  ];

  if (dom.riskCenterEl) {
    const cards = entries.map(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      const labelElement = document.createElement('span');
      labelElement.className = 'label';
      labelElement.textContent = label;
      const valueElement = document.createElement('strong');
      valueElement.textContent = String(value);
      card.append(labelElement, valueElement);
      return card;
    });
    dom.riskCenterEl.replaceChildren(...cards);
  }
}

function renderExplainability(result) {
  const analysis = result?.analysis || result || {};
  const explanation = analysis.explanation || {};
  const entries = [
    `Request: ${analysis.request || explanation.what_requested || 'No request provided.'}`,
    `Detected: ${explanation.what_detected || analysis.intent?.summary || 'No intent detected.'}`,
    `Risks: ${displayList(explanation.what_risks_found || analysis.risk?.reasons, 'No specific risks found.')}`,
    `Conflict: ${displayList(explanation.what_conflict_found || analysis.conflict?.reasons, 'No conflict found.')}`,
    `Recommendation: ${explanation.what_parmar_recommends || 'Continue with a safer, consent-based review.'}`,
    `Human decision: ${explanation.what_human_decided || analysis.decision?.human_approval_status || 'PENDING HUMAN APPROVAL'}`,
  ];

  if (dom.explanationList) {
    const items = entries.map((entry) => {
      const item = document.createElement('li');
      item.textContent = entry;
      return item;
    });
    dom.explanationList.replaceChildren(...items);
  }
}

function renderPhoneCards(container, rows) {
  if (!container) return;
  const cards = rows.map(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'phone-card';
    const title = document.createElement('strong');
    title.textContent = `${label}:`;
    card.append(title, document.createTextNode(` ${String(value ?? '')}`));
    return card;
  });
  container.replaceChildren(...cards);
}

function renderPhoneStatus() {
  fetch('/api/phone')
    .then((response) => response.json())
    .then((status) => {
      if (!status || typeof status !== 'object' || Array.isArray(status)) throw new TypeError('Invalid phone status response');
      const enabled = Boolean(status.enabled);
      renderPhoneCards(dom.phoneBox, [
        ['Permission', status.permission],
        ['Current event', status.current_event],
        ['Policy', status.policy_decision],
        ['Note', status.message],
      ]);
      if (dom.phoneStatusLabel) dom.phoneStatusLabel.textContent = enabled ? 'Enabled' : 'Permission-gated';
      if (dom.phonePolicyLabel) dom.phonePolicyLabel.textContent = enabled ? 'Only simulated, privacy-safe events are allowed' : 'Blocked until permission is granted';
      if (dom.phonePermissionToggle) dom.phonePermissionToggle.checked = enabled;
      if (dom.settingsPhoneToggle) dom.settingsPhoneToggle.checked = enabled;
      state.settings.phonePermission = enabled;
      persistSettings();
    })
    .catch(() => {
      if (dom.phoneBox) dom.phoneBox.innerHTML = '<div class="phone-card"><strong>Phone awareness:</strong> offline</div>';
    });
}

function renderPipeline(result) {
  const pipeline = result?.pipeline || result?.analysis?.pipeline || [];
  if (!dom.pipelineEl) return;
  if (!Array.isArray(pipeline)) {
    dom.pipelineEl.replaceChildren();
    return;
  }
  const steps = pipeline.filter((step) => step && typeof step === 'object').map((step) => {
    const element = document.createElement('div');
    element.className = `pipeline-step ${String(step.state || '').toLowerCase().replace(/[^a-z-]/g, '')}`;
    const name = document.createElement('div');
    name.className = 'stage-name';
    name.textContent = String(step.name || 'STEP');
    const label = document.createElement('div');
    label.className = 'stage-label';
    label.textContent = String(step.label || 'Review');
    element.append(name, label);
    return element;
  });
  dom.pipelineEl.replaceChildren(...steps);
}

function resolveResultShape(result) {
  const analysis = result?.analysis || result || {};
  const contract = result?.voki_contract || analysis.voki_contract;
  const lifecycle = contract?.lifecycle || analysis.lifecycle || result?.lifecycle || null;
  const reportedState = String(lifecycle?.state || lifecycle?.current_state || '').toUpperCase();
  const status = normalizeStatus(analysis.status || result?.status || reportedState);
  const requestedLifecycle = normalizeStatus(reportedState);
  const lifecycleState = lifecyclePresentation[requestedLifecycle] ? requestedLifecycle : 'UNKNOWN';
  return {
    status,
    lifecycle,
    lifecycleState,
    message: analysis.message || result?.message || 'PARMAR returned a state without a summary.',
    request: analysis.request || result?.request || dom.requestInput?.value || '',
    riskLevel: String(analysis.risk?.risk_level || result?.risk?.risk_level || 'NOT REPORTED').toUpperCase(),
    humanApprovalRequired: Boolean(analysis.human_approval_required || result?.human_approval_required || analysis.decision?.requires_human_approval),
    data: analysis,
  };
}

function updateState(result, scenarioSimulation = false) {
  const analysis = result?.analysis || result;
  const contract = result?.voki_contract || analysis?.voki_contract;
  const lifecycleState = String(
    contract?.lifecycle?.state
    || analysis?.lifecycle?.current_state
    || result?.lifecycle?.current_state
    || 'UNKNOWN',
  ).toUpperCase();
  const resultStatus = String(analysis?.status || result?.status || '').toUpperCase();
  const hasLifecycle = Boolean(lifecyclePresentation[lifecycleState]);
  const enforcement = analysis?.enforcement;
  const hasEnforcement = enforcement
    && typeof enforcement === 'object'
    && !Array.isArray(enforcement)
    && typeof enforcement.status === 'string'
    && typeof enforcement.execution_allowed === 'boolean';
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)
    || (!hasLifecycle && !supportedResultStatuses.has(resultStatus))
    || (!hasLifecycle && !hasEnforcement && !scenarioSimulation)) {
    return false;
  }

  const resolved = resolveResultShape(result);
  const status = resolved.status;
  setVokiState(resolved.lifecycleState);
  setBadge(status);

  if (dom.systemState) dom.systemState.textContent = lifecyclePresentation[resolved.lifecycleState].label;
  if (dom.statusMessage) dom.statusMessage.textContent = resolved.message;
  if (dom.riskLevel) dom.riskLevel.textContent = resolved.riskLevel;
  if (dom.approvalState) dom.approvalState.textContent = resolved.humanApprovalRequired ? 'REQUIRED' : 'NOT REQUIRED';
  if (dom.outcomeState) dom.outcomeState.textContent = status === 'APPROVAL_REQUIRED' ? 'PENDING' : status === 'BLOCKED' ? 'BLOCKED' : 'READY';

  renderPipeline(resolved.data);
  renderRiskCenter(resolved.data);
  renderExplainability(resolved.data);
  renderApproval(resolved.data);
  document.body.dataset.state = resolved.lifecycleState;
  state.pendingApprovalId = analysis.approval_id || result?.approval_id || null;

  const auditText = `${resolved.status} — ${resolved.message}`;
  addAuditEntry(resolved.request, status, resolved.riskLevel, auditText);
  return true;
}

function showRequestUnavailable(message) {
  setVokiState('UNKNOWN');
  setBadge('UNAVAILABLE');
  document.body.dataset.state = 'UNAVAILABLE';
  if (dom.statusMessage) dom.statusMessage.textContent = message;
  if (dom.systemState) dom.systemState.textContent = 'UNAVAILABLE';
  if (dom.riskLevel) dom.riskLevel.textContent = '—';
  if (dom.approvalState) dom.approvalState.textContent = 'Not assessed';
  if (dom.outcomeState) dom.outcomeState.textContent = 'Unavailable';
  dom.pipelineEl?.replaceChildren();
  dom.riskCenterEl?.replaceChildren();
  dom.explanationList?.replaceChildren();
  if (dom.approvalActions) dom.approvalActions.hidden = true;
  if (dom.approvalStateTag) dom.approvalStateTag.textContent = 'No decision pending';
  if (dom.approvalAction) dom.approvalAction.textContent = 'No active proposal';
  if (dom.approvalRisk) dom.approvalRisk.textContent = '—';
  if (dom.approvalConflicts) dom.approvalConflicts.textContent = 'No explicit conflict detected.';
  if (dom.approvalSafety) dom.approvalSafety.textContent = 'Awaiting review.';
  if (dom.approvalAlternative) dom.approvalAlternative.textContent = 'A recommendation will appear when available.';
}

async function analyzeRequest() {
  const request = dom.requestInput.value.trim();
  if (!request) {
    dom.requestInput.focus();
    return;
  }

  const requestId = beginRequest();
  if (requestId === null) return;
  const sessionId = ensureCurrentSession().id;
  appendMessageToSession(sessionId, 'user', request, {});
  if (dom.statusMessage) dom.statusMessage.textContent = 'Request sent. Waiting for PARMAR’s response.';

  try {
    const response = await apiRequest('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, language: state.settings.language }),
    });
    if (!response.ok) throw new Error('Analysis request failed');
    const result = await response.json();
    if (requestId !== state.requestSequence) return;
    if (state.currentSessionId !== sessionId) {
      if (typeof result?.message !== 'string') throw new TypeError('Invalid analysis response');
      appendMessageToSession(sessionId, 'assistant', result.message, result);
      return;
    }
    if (!updateState(result)) throw new TypeError('Invalid analysis response');
    appendMessageToSession(sessionId, 'assistant', result.message || 'PARMAR review complete.', result);
  } catch {
    if (requestId !== state.requestSequence) return;
    if (state.currentSessionId === sessionId) {
      showRequestUnavailable('PARMAR could not complete the review. No result was received. Please try again.');
    }
    appendMessageToSession(sessionId, 'assistant', 'PARMAR could not complete the review. Please try again.', { status: 'UNAVAILABLE' });
  } finally {
    finishRequest(requestId);
  }
}

async function submitDecision(decision) {
  if (!state.pendingApprovalId) return;
  const requestId = beginRequest();
  if (requestId === null) return;
  const sessionId = ensureCurrentSession().id;

  try {
    const response = await apiRequest('/api/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval_id: state.pendingApprovalId, decision }),
    });
    if (!response.ok) throw new Error('Approval request failed');
    const result = await response.json();
    if (requestId !== state.requestSequence) return;
    if (state.currentSessionId !== sessionId) {
      if (typeof result?.message !== 'string') throw new TypeError('Invalid approval response');
      appendMessageToSession(sessionId, 'assistant', result.message, result);
      return;
    }
    if (!updateState(result)) throw new TypeError('Invalid approval response');
    appendMessageToSession(sessionId, 'assistant', result.message || 'Human decision processed.', result);
  } catch {
    if (requestId === state.requestSequence) {
      if (state.currentSessionId === sessionId) {
        showRequestUnavailable('The decision could not be submitted. No approval result was received.');
      }
      appendMessageToSession(sessionId, 'assistant', 'The decision could not be submitted. No approval result was received.', { status: 'UNAVAILABLE' });
    }
  } finally {
    finishRequest(requestId);
  }
}

async function logoutAuthenticatedSession() {
  if (state.authMode !== 'authenticated' || state.logoutInProgress) return;
  state.logoutInProgress = true;
  invalidatePendingRequest();
  if (dom.logoutBtn) dom.logoutBtn.disabled = true;
  let logoutConfirmed = false;
  try {
    const response = await apiRequest('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    logoutConfirmed = response.ok;
  } catch (_error) {
    logoutConfirmed = false;
  } finally {
    state.logoutInProgress = false;
    clearAuthenticatedState(
      logoutConfirmed
        ? 'Signed out. Your local demo conversations remain available.'
        : 'Logout could not be confirmed. Authenticated data was cleared from this view.',
      { broadcast: true },
    );
    if (dom.logoutBtn) dom.logoutBtn.disabled = false;
  }
}

async function startDevelopmentSession() {
  if (
    state.authMode !== 'anonymous'
    || !state.developmentAuthAvailable
    || state.developmentLoginInProgress
  ) return;
  state.developmentLoginInProgress = true;
  renderAuthenticationControls();
  if (dom.authStatus) {
    dom.authStatus.hidden = false;
    dom.authStatus.textContent = 'Starting an unverified local development session.';
  }
  try {
    const response = await fetch('/api/auth/development', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Development session could not be started.');
    const authenticated = await refreshAuthenticationState();
    if (!authenticated) throw new Error('The server did not confirm the development session.');
    if (dom.authStatus) {
      dom.authStatus.hidden = false;
      dom.authStatus.textContent = 'Development Session — Unverified Identity. This is not identity verification.';
    }
  } catch (_error) {
    if (dom.authStatus) {
      dom.authStatus.hidden = false;
      dom.authStatus.textContent = 'The local development session could not be started. No authenticated state was assumed.';
    }
  } finally {
    state.developmentLoginInProgress = false;
    renderAuthenticationControls();
  }
}

async function submitChatMessage() {
  const text = (dom.chatInput?.value || '').trim();
  if (!text) return;
  const researchRequested = Boolean(dom.researchMode?.checked);
  const requestId = beginRequest();
  if (requestId === null) return;

  const authenticated = state.authMode === 'authenticated';
  const authEpoch = state.authEpoch;
  const requestedConversationId = authenticated ? state.conversationId : null;
  let currentSession = authenticated
    ? state.sessions.find((session) => session.id === requestedConversationId)
    : ensureCurrentSession();
  let sessionId = currentSession?.id || null;
  if (!authenticated || currentSession) {
    appendMessageToSession(sessionId, 'user', text, {});
  }
  if (dom.chatInput) dom.chatInput.value = '';
  resizeChatInput();
  const waitingMessage = appendWaitingIndicator(researchRequested);
  if (dom.statusMessage) dom.statusMessage.textContent = 'Message sent. Waiting for PARMAR’s response.';

  try {
    const context = authenticated
      ? {}
      : {
        ...(currentSession?.messages.length
          ? { recent_messages: currentSession.messages.slice(-12).map((message) => ({
            role: message.role,
            content: message.text,
          })) }
          : {}),
      };
    const response = await apiRequest('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        language: state.settings.language,
        ...window.PARMARChatPresentation.researchRequestOption(researchRequested),
        ...(requestedConversationId ? { conversation_id: requestedConversationId } : {}),
        ...(Object.keys(context).length ? { context } : {}),
      }),
    });
    if (!response.ok) throw new Error('Chat request failed');
    const result = await response.json();
    if (requestId !== state.requestSequence || authEpoch !== state.authEpoch) return;
    if (authenticated && (
      state.authMode !== 'authenticated'
      || state.conversationId !== requestedConversationId
      || typeof result.conversation_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.conversation_id)
      || (requestedConversationId && result.conversation_id !== requestedConversationId)
    )) {
      throw new TypeError('Invalid authenticated conversation response');
    }
    const reply = safeChatReply(result);
    if (!reply) throw new TypeError('Invalid chat response');
    if (authenticated && !currentSession) {
      const conversationId = result.conversation_id;
      state.conversationId = conversationId;
      storeActiveConversationId(conversationId);
      publishConversationSelection(conversationId, true);
      state.currentSessionId = conversationId;
      state.serverConversationIds.add(conversationId);
      currentSession = {
        id: conversationId,
        title: text.slice(0, 56),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      state.sessions.unshift(currentSession);
      sessionId = conversationId;
      appendMessageToSession(sessionId, 'user', text, {});
    }
    if (state.currentSessionId !== sessionId) {
      if (!authenticated && sessionId) appendMessageToSession(sessionId, 'assistant', reply, result);
      return;
    }
    if (!result.provider_error) {
      const provider = String(result.provider || state.settings.provider || 'local-demo').toUpperCase();
      state.settings.provider = provider.toLowerCase();
      persistSettings();
      if (dom.providerStatus) dom.providerStatus.textContent = provider;
      if (dom.settingsProvider) dom.settingsProvider.textContent = provider;
      renderMemories();
    }
    if (!updateState(result)) throw new TypeError('Invalid chat response');
    if (authenticated) state.serverConversationIds.add(result.conversation_id);
    appendMessageToSession(sessionId, 'assistant', reply, result);
    if (authenticated) publishConversationSelection(result.conversation_id, true);
    dom.requestInput.value = text;
  } catch {
    if (requestId !== state.requestSequence) return;
    const failureMessage = researchRequested
      ? 'The research request could not be completed. No usable PARMAR research result was available.'
      : 'The chat service could not respond. Please try again.';
    if (state.currentSessionId === sessionId) {
      showRequestUnavailable(researchRequested
        ? 'The research request could not be completed. No usable PARMAR research result was available.'
        : 'The chat service could not respond. No decision result was received.');
    }
    if (sessionId) {
      appendMessageToSession(sessionId, 'assistant', failureMessage, {
        status: 'UNAVAILABLE',
        ...(researchRequested ? { research_client_error: true } : {}),
      });
    }
  } finally {
    waitingMessage.remove();
    finishRequest(requestId);
    if (authenticated && authEpoch === state.authEpoch && state.authMode === 'authenticated') {
      void refreshServerConversationHistory();
    }
  }
}

async function loadScenarios() {
  try {
    const response = await fetch('/api/scenarios');
    const payload = await response.json();
    const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];

    const options = scenarios.map((scenario) => {
      const label = scenario.description || scenario.scenario_id || 'Scenario';
      return `<option value="${escapeHtml(scenario.scenario_id || '')}">${escapeHtml(label)}</option>`;
    }).join('');

    if (dom.simulatorSelect) dom.simulatorSelect.innerHTML = options || '<option value="">No scenarios</option>';
    if (dom.simulatorSelectSecondary) dom.simulatorSelectSecondary.innerHTML = options || '<option value="">No scenarios</option>';
  } catch (_error) {
    if (dom.simulatorSelect) dom.simulatorSelect.innerHTML = '<option value="">Scenarios unavailable</option>';
    if (dom.simulatorSelectSecondary) dom.simulatorSelectSecondary.innerHTML = '<option value="">Scenarios unavailable</option>';
  }
}

async function evaluateScenario(select) {
  const scenarioId = select?.value || '';
  if (!scenarioId) return;
  const requestId = beginRequest();
  if (requestId === null) return;
  if (dom.statusMessage) dom.statusMessage.textContent = 'Scenario evaluation in progress.';

  try {
    const response = await apiRequest('/api/scenarios/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
    if (!response.ok) throw new Error('Scenario evaluation failed');
    const payload = await response.json();
    if (requestId !== state.requestSequence) return;
    if (!payload?.evaluation || !updateState(payload.result, true)) throw new TypeError('Invalid scenario evaluation response');
    const { expected_parmar_behavior: expected, actual_behavior: actual, passed } = payload.evaluation;
    if (dom.statusMessage) {
      dom.statusMessage.textContent = `Scenario ${passed ? 'matched' : 'did not match'} expected policy. Expected ${expected}; actual ${actual}.`;
    }
    if (dom.requestInput) dom.requestInput.value = payload.result.request;
  } catch {
    if (requestId === state.requestSequence) showRequestUnavailable('Scenario evaluation could not complete. No result was received.');
  } finally {
    finishRequest(requestId);
  }
}

async function togglePhonePermission(enabled) {
  state.settings.phonePermission = enabled;
  persistSettings();
  try {
    const response = await apiRequest('/api/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_permission', enabled }),
    });
    const result = await response.json();
    if (dom.phoneBox) {
      dom.phoneBox.innerHTML = `
        <div class="phone-card"><strong>Permission:</strong> ${result.status.permission}</div>
        <div class="phone-card"><strong>Current event:</strong> ${result.status.current_event}</div>
        <div class="phone-card"><strong>Policy:</strong> ${result.status.policy_decision}</div>
        <div class="phone-card"><strong>Note:</strong> ${result.status.message}</div>
      `;
    }
    if (dom.phoneStatusLabel) dom.phoneStatusLabel.textContent = enabled ? 'Enabled' : 'Permission-gated';
    if (dom.phonePolicyLabel) dom.phonePolicyLabel.textContent = enabled ? 'Only simulated, privacy-safe events are allowed' : 'Blocked until permission is granted';
  } catch (_error) {
    console.error(_error);
  }
}

async function runPhoneSimulation(mode) {
  const payload = mode === 'risk'
    ? { event_type: 'read_private_messages', source: 'simulated', permission_required: true, permission_granted: true, requested_data: ['messages', 'photos', 'contacts'] }
    : { event_type: 'battery_low', source: 'simulated', permission_required: false, permission_granted: true, requested_data: ['battery_level'] };

  try {
    const response = await apiRequest('/api/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'simulate_event', event: payload }),
    });
    if (!response.ok) throw new Error('Phone simulation request failed');
    const result = await response.json();
    const outcome = result?.result;
    if (!outcome || typeof outcome !== 'object' || !outcome.status) throw new TypeError('Invalid phone simulation response');
    renderPhoneCards(dom.phoneBox, [
      ['Event', outcome.event_type],
      ['Risk', outcome.risk_level],
      ['Status', outcome.status],
      ['Explanation', outcome.explanation || result.message],
    ]);
    addAuditEntry(payload.event_type, outcome.status, outcome.risk_level || 'UNKNOWN', outcome.explanation || result.message || 'Phone simulation recorded.');
  } catch {
    renderPhoneCards(dom.phoneBox, [['Phone awareness', 'Simulation unavailable. No result was received.']]);
  }
}

function activeWorkspaceDrawer() {
  if (!isCompactPanelViewport()) return null;
  return ['left', 'right'].find((side) => workspacePanels[side] !== 'closed') || null;
}

function trapWorkspacePanelFocus(event, side) {
  const panel = panelElement(side);
  const focusable = Array.from(panel?.querySelectorAll(
    'a[href], button:not(:disabled):not([hidden]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  ) || []).filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    panel?.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function bindEvents() {
  dom.developmentLoginBtn?.addEventListener('click', startDevelopmentSession);
  dom.logoutBtn?.addEventListener('click', logoutAuthenticatedSession);
  dom.refreshSessionBtn?.addEventListener('click', async () => {
    const authenticated = await refreshAuthenticationState({ expired: true });
    if (authenticated && dom.authStatus) {
      dom.authStatus.hidden = false;
      dom.authStatus.textContent = 'Authenticated session refreshed from the server.';
    }
  });

  document.querySelectorAll('.nav-item, .text-button[data-section], .capability-button[data-section], .capability-button[data-action], .capability-menu [data-section], .composer-voki[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.action === 'new-chat') {
        dom.newSessionBtn?.click();
        selectSection('chat', 'new-chat');
        return;
      }
      if (button.dataset.action === 'research-chat') {
        if (dom.researchMode) dom.researchMode.checked = true;
        selectSection('chat');
        closeWorkspacePanel('right');
        dom.chatInput?.focus();
        return;
      }
      selectSection(button.dataset.section, button.dataset.navKey || button.dataset.section);
      if (button.dataset.section === 'voki') dom.vokiInput?.focus({ preventScroll: true });
    });
  });
  dom.parmarCore?.addEventListener('click', () => {
    selectSection('voki');
    dom.vokiInput?.focus({ preventScroll: true });
  });

  window.addEventListener('parmar-voki-conversation-activated', (event) => {
    const conversationId = event?.detail?.conversationId;
    if (state.authMode !== 'authenticated'
      || typeof conversationId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) return;
    storeActiveConversationId(conversationId);
    void (async () => {
      await refreshServerConversationHistory();
      if (state.authMode === 'authenticated' && state.serverConversationIds.has(conversationId)) {
        await selectServerConversation(conversationId);
      }
    })();
  });
  window.addEventListener('parmar-voki-lifecycle-updated', (event) => {
    const lifecycleState = event?.detail?.lifecycleState;
    if (typeof lifecycleState === 'string' && lifecyclePresentation[lifecycleState]) {
      setVokiState(lifecycleState);
    }
  });

  dom.discoveryTriggers.forEach((button) => {
    button.addEventListener('click', () => openDiscoveryTarget(button.dataset.discoveryTarget, button));
  });

  dom.historyFilter?.addEventListener('input', () => {
    state.historyQuery = dom.historyFilter.value;
    renderHistory();
  });

  dom.capabilityToolbar?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const controls = Array.from(dom.capabilityToolbar.querySelectorAll(
      'button:not(:disabled), summary',
    )).filter((element) => element.getClientRects().length > 0);
    const index = controls.indexOf(event.target.closest('button, summary'));
    if (index < 0 || !controls.length) return;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
    event.preventDefault();
    controls[nextIndex].focus();
  });

  if (dom.sidebarToggle) {
    dom.sidebarToggle.addEventListener('click', () => toggleWorkspacePanel('left', dom.sidebarToggle));
  }

  dom.discoveryToggle?.addEventListener('click', () => {
    if (isCompactPanelViewport()) toggleWorkspacePanel('right', dom.discoveryToggle);
    else dom.discoveryPanel?.focus({ preventScroll: true });
  });
  dom.sidebarClose?.addEventListener('click', () => closeWorkspacePanel('left'));
  dom.discoveryClose?.addEventListener('click', () => closeWorkspacePanel('right'));
  dom.panelScrim?.addEventListener('click', () => {
    const side = activeWorkspaceDrawer();
    if (side) closeWorkspacePanel(side);
  });

  dom.sidebar?.addEventListener('transitionend', (event) => onWorkspacePanelTransitionEnd(event, 'left'));
  dom.discoveryPanel?.addEventListener('transitionend', (event) => onWorkspacePanelTransitionEnd(event, 'right'));
  window.addEventListener('resize', handleWorkspaceResize);

  document.addEventListener('pointerdown', startPanelGesture, { passive: true });
  document.addEventListener('pointermove', movePanelGesture, { passive: false });
  document.addEventListener('pointerup', (event) => finishPanelGesture(event));
  document.addEventListener('pointercancel', (event) => finishPanelGesture(event, true));
  window.addEventListener('blur', () => finishPanelGesture(null, true));

  document.addEventListener('keydown', (event) => {
    const activeSide = activeWorkspaceDrawer();
    if (event.key === 'Escape' && activeSide) {
      event.preventDefault();
      closeWorkspacePanel(activeSide);
      return;
    }
    if (event.key === 'Tab' && activeSide) trapWorkspacePanelFocus(event, activeSide);
  });

  if (dom.analyzeBtn) {
    dom.analyzeBtn.addEventListener('click', analyzeRequest);
  }

  if (dom.requestInput) {
    dom.requestInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        analyzeRequest();
      }
    });
  }

  if (dom.languageSelect) {
    dom.languageSelect.addEventListener('change', () => {
      state.settings.language = dom.languageSelect.value;
      persistSettings();
      if (dom.settingsLanguage) dom.settingsLanguage.value = state.settings.language;
      if (dom.requestInput.value.trim()) analyzeRequest();
    });
  }

  if (dom.settingsLanguage) {
    dom.settingsLanguage.addEventListener('change', () => {
      state.settings.language = dom.settingsLanguage.value;
      persistSettings();
      if (dom.languageSelect) dom.languageSelect.value = state.settings.language;
    });
  }

  if (dom.settingsTheme) {
    dom.settingsTheme.addEventListener('change', () => {
      state.settings.theme = dom.settingsTheme.value;
      persistSettings();
    });
  }

  if (dom.settingsAnimation) {
    dom.settingsAnimation.addEventListener('change', () => {
      state.settings.animationIntensity = dom.settingsAnimation.value;
      persistSettings();
    });
  }

  if (dom.settingsReducedMotion) {
    dom.settingsReducedMotion.addEventListener('change', () => {
      state.settings.reducedMotion = Boolean(dom.settingsReducedMotion.checked);
      persistSettings();
    });
  }

  if (dom.settingsPhoneToggle) {
    dom.settingsPhoneToggle.addEventListener('change', () => {
      togglePhonePermission(Boolean(dom.settingsPhoneToggle.checked));
    });
  }

  if (dom.phonePermissionToggle) {
    dom.phonePermissionToggle.addEventListener('change', () => {
      togglePhonePermission(Boolean(dom.phonePermissionToggle.checked));
    });
  }

  if (dom.simulatePhoneSafe) {
    dom.simulatePhoneSafe.addEventListener('click', () => runPhoneSimulation('safe'));
  }

  if (dom.simulatePhoneRisk) {
    dom.simulatePhoneRisk.addEventListener('click', () => runPhoneSimulation('risk'));
  }

  document.querySelectorAll('.approve-btn, .reject-btn, .info-btn, .alt-btn').forEach((button) => {
    button.addEventListener('click', () => {
      submitDecision(button.dataset.decision || 'APPROVE');
    });
  });

  if (dom.runScenario) {
    dom.runScenario.addEventListener('click', () => {
      evaluateScenario(dom.simulatorSelect);
    });
  }

  if (dom.runScenarioSecondary) {
    dom.runScenarioSecondary.addEventListener('click', () => {
      selectSection('home');
      evaluateScenario(dom.simulatorSelectSecondary);
    });
  }

  if (dom.loadDemo) {
    dom.loadDemo.addEventListener('click', () => {
      dom.requestInput.value = 'AI proposes to share private employee records with an external reviewer.';
      analyzeRequest();
    });
  }

  if (dom.chatSubmit) {
    dom.chatSubmit.addEventListener('click', submitChatMessage);
    dom.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitChatMessage();
      }
    });
    dom.chatInput.addEventListener('input', resizeChatInput);
  }

  if (dom.memoryEnabledToggle) {
    dom.memoryEnabledToggle.addEventListener('change', () => {
      if (state.authMode === 'authenticated') {
        setAuthenticatedMemoryConsent(Boolean(dom.memoryEnabledToggle.checked));
        return;
      }
      state.settings.memoryEnabled = Boolean(dom.memoryEnabledToggle.checked);
      persistSettings();
      renderMemories();
      setMemoryFeedback(state.settings.memoryEnabled
        ? 'Local memory preference enabled. Notes remain in this browser and are not added to chat.'
        : 'Local memory preference disabled.');
    });
  }

  if (dom.memoryForm) dom.memoryForm.addEventListener('submit', addMemory);
  if (dom.memoryClearAll) dom.memoryClearAll.addEventListener('click', clearAllMemories);

  if (dom.newSessionBtn) {
    dom.newSessionBtn.addEventListener('click', () => {
      invalidatePendingRequest();
      cancelChatResponseReveal();
      state.historyLoadGeneration += 1;
      state.historySelectionGeneration += 1;
      state.historyLoading = false;
      state.historyError = false;
      state.historySelectionId = null;
      state.currentSessionId = null;
      state.conversationId = null;
      if (state.authMode === 'authenticated') clearActiveConversationId();
      publishConversationSelection(null);
      state.pendingApprovalId = null;
      if (dom.researchMode) dom.researchMode.checked = false;
      if (state.authMode !== 'authenticated') ensureCurrentSession();
      renderSessionMessages();
      renderHistory();
      selectSection('chat', 'chat');
      if (dom.requestInput) dom.requestInput.value = '';
      if (dom.chatInput) dom.chatInput.value = '';
      resizeChatInput();
      setVokiState('UNKNOWN');
      setBadge('UNKNOWN');
      document.body.dataset.state = 'UNKNOWN';
      if (dom.riskLevel) dom.riskLevel.textContent = '—';
      if (dom.approvalState) dom.approvalState.textContent = 'Not assessed';
      if (dom.outcomeState) dom.outcomeState.textContent = 'Not assessed';
      if (dom.pipelineEl) dom.pipelineEl.replaceChildren();
      if (dom.riskCenterEl) dom.riskCenterEl.replaceChildren();
      if (dom.explanationList) dom.explanationList.replaceChildren();
      if (dom.approvalActions) dom.approvalActions.hidden = true;
      if (dom.approvalStateTag) dom.approvalStateTag.textContent = 'No decision pending';
      if (dom.approvalAction) dom.approvalAction.textContent = 'No active proposal';
      if (dom.approvalRisk) dom.approvalRisk.textContent = '—';
      if (dom.approvalConflicts) dom.approvalConflicts.textContent = 'No explicit conflict detected.';
      if (dom.approvalSafety) dom.approvalSafety.textContent = 'Awaiting review.';
      if (dom.approvalAlternative) dom.approvalAlternative.textContent = 'A recommendation will appear when available.';
      if (dom.systemState) dom.systemState.textContent = 'NOT ASSESSED';
      if (dom.statusMessage) dom.statusMessage.textContent = 'PARMAR is ready for a request.';
    });
  }

  if (dom.wakeBtn) {
    dom.wakeBtn.addEventListener('click', () => {
      if (dom.statusMessage) dom.statusMessage.textContent = 'Enter a request for PARMAR to review.';
    });
  }

  if (dom.parmarCore) {
    const resetVokiPointer = () => {
      dom.parmarCore.style.setProperty('--tilt-x', '0deg');
      dom.parmarCore.style.setProperty('--tilt-y', '0deg');
    };

    dom.parmarCore.addEventListener('pointermove', (event) => {
      if (motionIsReduced()) {
        resetVokiPointer();
        return;
      }
      if (event.pointerType === 'touch' && event.buttons === 0) return;
      const bounds = dom.parmarCore.getBoundingClientRect();
      const horizontal = Math.max(-0.5, Math.min(0.5, (event.clientX - bounds.left) / bounds.width - 0.5));
      const vertical = Math.max(-0.5, Math.min(0.5, (event.clientY - bounds.top) / bounds.height - 0.5));
      dom.parmarCore.style.setProperty('--tilt-x', `${horizontal * 4}deg`);
      dom.parmarCore.style.setProperty('--tilt-y', `${vertical * -4}deg`);
    });
    dom.parmarCore.addEventListener('pointerleave', resetVokiPointer);
    dom.parmarCore.addEventListener('pointerup', resetVokiPointer);
    dom.parmarCore.addEventListener('pointercancel', resetVokiPointer);
  }

  if (dom.requestInput) {
    dom.requestInput.addEventListener('input', () => {
      document.body.dataset.inputActive = dom.requestInput.value ? 'true' : 'false';
    });
  }
}

function initialize() {
  state.currentSessionId = null;
  renderHistory();
  renderSessionMessages();
  renderMemories();
  renderAuditEntries();
  renderPhoneStatus();
  loadScenarios();
  const vokiRoot = document.querySelector('[data-voki-interface]');
  if (vokiRoot && window.PARMARVOKKIInterface?.VOKKIInterface) {
    new window.PARMARVOKKIInterface.VOKKIInterface({
      root: vokiRoot,
      request: apiRequest,
      getLanguage: () => dom.languageSelect?.value || state.settings.language,
      beginRequest,
      finishRequest,
    });
  }
  bindEvents();
  applySettings();
  setVokiState('UNKNOWN');
  setBadge('UNKNOWN');
  document.body.dataset.state = 'UNKNOWN';
  renderAuthenticationControls();
  syncWorkspacePanels();
  selectSection(window.innerWidth <= 640 ? 'chat' : 'home');
  configureCrossTabAuthentication();
  refreshAuthenticationState();
}

initialize();
