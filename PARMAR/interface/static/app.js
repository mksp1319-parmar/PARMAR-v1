const STORAGE_KEYS = {
  localDemoSessions: 'parmar-sessions-v1',
  settings: 'parmar-settings-v1',
  audit: 'parmar-audit-v1',
  memories: 'parmar-memories-v1',
};
const MAX_SAVED_MEMORIES = 25;
const PROVIDER_IDS = new Set(['local-demo', 'openai', 'gemini', 'claude', 'http-json']);
const RESPONSE_SAFETY_STATES = new Set(['PASS', 'REVIEW', 'BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
const SUPPRESSED_RESPONSE_SAFETY_STATES = new Set(['BLOCK', 'UNCERTAIN', 'NOT_CHECKED']);
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
  if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'response_safety')) return null;
  const status = result.response_safety?.status;
  if (RESPONSE_SAFETY_STATES.has(status)) return status;
  return 'NOT_CHECKED';
}

function responseSafetyMessage(status) {
  return {
    BLOCK: 'PARMAR withheld the provider response after a response policy check.',
    UNCERTAIN: 'PARMAR withheld the provider response because its checks could not resolve a concern.',
    NOT_CHECKED: 'PARMAR could not validate the provider response, so the generated text was withheld.',
  }[status] || 'PARMAR withheld the provider response.';
}

function safeChatReply(result) {
  const status = responseSafetyStatus(result) || 'NOT_CHECKED';
  const message = typeof result?.message === 'string' ? result.message : '';
  if (status === 'NOT_CHECKED' && ['BLOCKED', 'APPROVAL_REQUIRED'].includes(result?.analysis?.status)) {
    const requestMessage = result.analysis.message;
    return typeof requestMessage === 'string'
      ? sanitizeSensitiveText(requestMessage).trim()
      : responseSafetyMessage(status);
  }
  if (SUPPRESSED_RESPONSE_SAFETY_STATES.has(status)) {
    return responseSafetyMessage(status);
  }
  return sanitizeSensitiveText(message).trim();
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
  if (!SUPPRESSED_RESPONSE_SAFETY_STATES.has(status)) return stored;
  stored = suppressCandidateContent(stored);
  if (stored && typeof stored === 'object') {
    stored.message = safeChatReply(result);
  }
  return stored;
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
  vokiVoiceEnabled: false,
};

const lifecyclePresentation = {
  IDLE: { className: 'idle', label: 'READY' },
  LISTENING: { className: 'listening', label: 'LISTENING' },
  THINKING: { className: 'thinking', label: 'THINKING' },
  ANALYZING: { className: 'analyzing', label: 'ANALYZING' },
  RISK_CHECK: { className: 'risk-check', label: 'RISK CHECK' },
  WAITING_FOR_HUMAN: { className: 'waiting-human', label: 'WAITING FOR HUMAN' },
  SAFE_RESPONSE: { className: 'safe-response', label: 'SAFE RESPONSE' },
  BLOCKED: { className: 'blocked', label: 'BLOCKED' },
};

const vokiChatPresentation = {
  IDLE: { label: 'Idle', note: 'Ready when you are.' },
  LISTENING: { label: 'Listening', note: 'Following your text input. No microphone access.' },
  THINKING: { label: 'Thinking', note: 'Waiting for PARMAR’s response.' },
  RESPONDING: { label: 'Responding', note: 'PARMAR’s validated response is available.' },
  APPROVAL_REQUIRED: { label: 'Approval required', note: 'PARMAR requires a human decision. Vokki cannot approve it.' },
  BLOCKED: { label: 'Blocked', note: 'PARMAR withheld this request or response under its safety checks.' },
  REVIEW: { label: 'Review required', note: 'PARMAR’s response needs human review; this is not an approval.' },
  ERROR: { label: 'Unavailable', note: 'PARMAR could not complete the request. No result was received.' },
  LOCAL_DEMO: { label: 'Local demo', note: 'Local-demo mode is active. PARMAR safety controls remain in force.' },
};

const legacyStatusLifecycle = {
  SAFE: 'SAFE_RESPONSE',
  APPROVED: 'SAFE_RESPONSE',
  APPROVAL_REQUIRED: 'WAITING_FOR_HUMAN',
  REJECTED: 'BLOCKED',
  RISK_DETECTED: 'RISK_CHECK',
};
const supportedResultStatuses = new Set([
  ...Object.keys(lifecyclePresentation),
  ...Object.keys(legacyStatusLifecycle),
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
  historyStatus: document.getElementById('history-status'),
  newSessionBtn: document.getElementById('new-session-btn'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  researchPanel: document.getElementById('research-workspace'),
  researchToggle: document.getElementById('research-toggle'),
  researchClose: document.getElementById('research-close'),
  chatThread: document.getElementById('chat-thread'),
  chatInput: document.getElementById('chat-input'),
  chatSubmit: document.getElementById('chat-submit'),
  chatVoki: document.getElementById('chat-voki'),
  vokiChatState: document.getElementById('voki-chat-state'),
  vokiChatNote: document.getElementById('voki-chat-note'),
  vokiVoiceToggle: document.getElementById('voki-voice-toggle'),
  vokiVoiceLabel: document.getElementById('voki-voice-label'),
  vokiVoiceStatus: document.getElementById('voki-voice-status'),
  vokiVisibilityToggle: document.getElementById('voki-visibility-toggle'),
  vokiAvatarStage: document.getElementById('voki-avatar-stage'),
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
  settings: loadSettings(),
  currentSessionId: null,
  conversationId: null,
  authMode: 'checking',
  csrfToken: null,
  authEpoch: 0,
  serverConversationIds: new Set(),
  pendingApprovalId: null,
  requestSequence: 0,
  requestInFlight: false,
  vokiSpeechToken: 0,
  vokiMinimized: false,
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    if (key === STORAGE_KEYS.localDemoSessions) historyStorageUnavailable = true;
    return fallback;
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
    vokiVoiceEnabled: stored?.vokiVoiceEnabled === true,
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
    state.csrfToken = null;
    state.conversationId = null;
    state.currentSessionId = null;
    state.sessions = [];
    state.pendingApprovalId = null;
    state.serverConversationIds.clear();
    state.localDemoSessions = loadSessions();
    state.sessions = state.localDemoSessions;
    state.memories = loadMemories();
    state.memoryConsent = false;
    state.currentSessionId = state.sessions[0]?.id || null;
    state.audit = loadAudit();
    if (dom.chatModeLabel) dom.chatModeLabel.textContent = 'Local demo';
    if (dom.authStatus) {
      dom.authStatus.hidden = !message;
      dom.authStatus.textContent = message || '';
    }
    renderHistory();
    renderSessionMessages();
    renderAuditEntries();
    renderMemories();
    resetReviewState(message);
    stopVokiSpeech('LOCAL_DEMO');
    selectSection(state.currentSessionId ? 'chat' : 'home');
    if (dom.logoutBtn) dom.logoutBtn.hidden = true;
    if (broadcast) notifyOtherTabs('session-ended');
  }
}

async function refreshAuthenticationState({ expired = false, broadcast = false } = {}) {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Session status is unavailable');
    const payload = await response.json();
    if (payload?.authenticated === true && typeof payload.csrf_token === 'string') {
      const enteringAuthenticated = state.authMode !== 'authenticated';
      if (enteringAuthenticated) {
        invalidatePendingRequest();
        state.authEpoch += 1;
        stopVokiSpeech('IDLE');
        state.sessions = [];
        state.memories = [];
        state.memoryConsent = false;
        state.currentSessionId = null;
        state.conversationId = null;
        state.pendingApprovalId = null;
        state.serverConversationIds.clear();
        state.audit = [];
        state.memories = [];
        state.memoryConsent = false;
      }
      state.authMode = 'authenticated';
      state.csrfToken = payload.csrf_token;
      state.localDemoSessions = loadSessions();
      renderHistory();
      renderSessionMessages();
      renderAuditEntries();
      renderMemories();
      if (enteringAuthenticated) await refreshAuthenticatedMemories();
      if (state.authMode !== 'authenticated') return false;
      if (dom.chatModeLabel) dom.chatModeLabel.textContent = 'Authenticated session';
      if (dom.authStatus) dom.authStatus.hidden = true;
      if (dom.logoutBtn) dom.logoutBtn.hidden = false;
      return true;
    }
    if (state.authMode !== 'anonymous') {
      clearAuthenticatedState(
        expired ? 'Your authenticated session expired. You are now using local demo mode.' : '',
        { broadcast },
      );
    }
    return false;
  } catch (_error) {
    if (state.authMode === 'checking') {
      state.authMode = 'anonymous';
      stopVokiSpeech('LOCAL_DEMO');
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

    if (dom.logoutBtn) dom.logoutBtn.hidden = state.authMode !== 'authenticated';
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
      || !Array.isArray(payload.memories)
    ) return;
    state.memoryConsent = payload.consent;
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
  if (dom.vokiVoiceToggle) dom.vokiVoiceToggle.checked = Boolean(settings.vokiVoiceEnabled);
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
  return String(value || 'SAFE').toUpperCase();
}

function displayList(value, fallback) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' • ');
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

function setVokiState(rawState) {
  const key = normalizeStatus(rawState);
  const presentation = lifecyclePresentation[key] || lifecyclePresentation.IDLE;

  if (dom.parmarCore) {
    dom.parmarCore.className = `parmar-core ${presentation.className}`;
  }

  document.body.dataset.vokiState = lifecyclePresentation[key] ? key : 'IDLE';
  if (dom.vokiState) {
    dom.vokiState.textContent = presentation.label;
  }
}

function setChatVokiState(rawState) {
  const key = Object.hasOwn(vokiChatPresentation, rawState) ? rawState : 'ERROR';
  const presentation = vokiChatPresentation[key];
  if (dom.chatVoki) dom.chatVoki.dataset.state = key;
  if (dom.vokiChatState) dom.vokiChatState.textContent = presentation.label;
  if (dom.vokiChatNote) dom.vokiChatNote.textContent = presentation.note;
  document.body.dataset.chatVokiState = key;
}

function chatVokiResponseState(result) {
  const responseStatus = normalizeStatus(result?.status);
  if (result?.provider_error || responseStatus.startsWith('PROVIDER_')) return 'ERROR';

  const analysis = result?.analysis || result;
  const requestStatus = normalizeStatus(analysis?.status || responseStatus);
  const lifecycleState = normalizeStatus(analysis?.lifecycle?.current_state);
  if (
    requestStatus === 'APPROVAL_REQUIRED'
    || lifecycleState === 'WAITING_FOR_HUMAN'
    || analysis?.decision?.requires_human_approval === true
  ) return 'APPROVAL_REQUIRED';
  if (['BLOCKED', 'REJECTED'].includes(requestStatus) || lifecycleState === 'BLOCKED') return 'BLOCKED';

  const safetyStatus = responseSafetyStatus(result) || 'NOT_CHECKED';
  if (safetyStatus === 'REVIEW') return 'REVIEW';
  if (safetyStatus !== 'PASS') return 'BLOCKED';
  if (String(result?.provider || '').toLowerCase() === 'local-demo') return 'LOCAL_DEMO';
  return 'RESPONDING';
}

function speechSynthesisAvailable() {
  return Boolean(window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function');
}

function syncVokiControls() {
  const available = speechSynthesisAvailable();
  const enabled = available && Boolean(state.settings.vokiVoiceEnabled);
  if (dom.vokiVoiceToggle) {
    dom.vokiVoiceToggle.disabled = !available;
    dom.vokiVoiceToggle.checked = enabled;
  }
  if (dom.vokiVoiceLabel) {
    dom.vokiVoiceLabel.textContent = available ? `Voice ${enabled ? 'on' : 'off'}` : 'Voice unavailable';
  }
  if (dom.vokiVoiceStatus) {
    dom.vokiVoiceStatus.textContent = !available
      ? 'Browser speech synthesis is unavailable. Text chat remains available.'
      : enabled
        ? 'Browser speech is on. PARMAR responses will be read aloud.'
        : 'Browser speech is off. PARMAR responses remain text only.';
  }
}

function stopVokiSpeech(nextState = 'IDLE') {
  state.vokiSpeechToken += 1;
  if (speechSynthesisAvailable()) window.speechSynthesis.cancel();
  if (dom.chatVoki) dom.chatVoki.dataset.voiceActive = 'false';
  setChatVokiState(nextState);
}

function speakVokiResponse(text, responseState) {
  if (!state.settings.vokiVoiceEnabled) {
    setChatVokiState(responseState);
    return;
  }
  if (!speechSynthesisAvailable()) {
    setChatVokiState(responseState);
    syncVokiControls();
    return;
  }

  const speechToken = ++state.vokiSpeechToken;
  const utterance = new window.SpeechSynthesisUtterance(String(text));
  utterance.lang = state.settings.language === 'hi' ? 'hi-IN' : state.settings.language === 'mix' ? 'en-IN' : 'en-US';
  utterance.rate = 0.96;
  utterance.onstart = () => {
    if (speechToken === state.vokiSpeechToken) {
      if (dom.chatVoki) dom.chatVoki.dataset.voiceActive = 'true';
      setChatVokiState('RESPONDING');
    }
  };
  utterance.onend = () => {
    if (speechToken === state.vokiSpeechToken) {
      if (dom.chatVoki) dom.chatVoki.dataset.voiceActive = 'false';
      setChatVokiState(responseState === 'LOCAL_DEMO' ? 'LOCAL_DEMO' : 'IDLE');
    }
  };
  utterance.onerror = () => {
    if (speechToken === state.vokiSpeechToken) {
      if (dom.chatVoki) dom.chatVoki.dataset.voiceActive = 'false';
      setChatVokiState('ERROR');
    }
  };

  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch (_error) {
    if (dom.chatVoki) dom.chatVoki.dataset.voiceActive = 'false';
    setChatVokiState('ERROR');
  }
}

function syncVokiVisibility() {
  if (dom.vokiAvatarStage) dom.vokiAvatarStage.hidden = state.vokiMinimized;
  if (dom.vokiVisibilityToggle) {
    dom.vokiVisibilityToggle.textContent = state.vokiMinimized ? 'Show avatar' : 'Minimize';
    dom.vokiVisibilityToggle.setAttribute('aria-expanded', String(!state.vokiMinimized));
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

  if (normalized === 'APPROVAL_REQUIRED' || normalized === 'WAITING_FOR_HUMAN') {
    dom.statusPill.classList.add('status-warning');
    dom.statusPill.textContent = 'REVIEW REQUIRED';
    return;
  }

  dom.statusPill.classList.add('status-safe');
  dom.statusPill.textContent = 'SAFE';
}

function syncSidebarToggle() {
  if (!dom.sidebarToggle) return;
  if (window.innerWidth <= 920) {
    const isOpen = document.body.classList.contains('sidebar-open');
    dom.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
    dom.sidebarToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    return;
  }
  document.body.classList.remove('sidebar-open');
  const isExpanded = !document.body.classList.contains('sidebar-collapsed');
  dom.sidebarToggle.setAttribute('aria-expanded', String(isExpanded));
  dom.sidebarToggle.setAttribute('aria-label', isExpanded ? 'Collapse navigation' : 'Expand navigation');
}

function setResearchOpen(open, restoreFocus = false) {
  const wasOpen = document.body.classList.contains('research-open');
  const isOpen = Boolean(open) && window.innerWidth <= 1100;
  document.body.classList.toggle('research-open', isOpen);
  dom.researchToggle?.setAttribute('aria-expanded', String(isOpen));
  dom.researchToggle?.setAttribute('aria-label', isOpen ? 'Close Research workspace' : 'Open Research workspace');
  if (isOpen) {
    document.body.classList.remove('sidebar-open');
    syncSidebarToggle();
    dom.researchClose?.focus({ preventScroll: true });
  } else if (wasOpen && restoreFocus) {
    dom.researchToggle?.focus({ preventScroll: true });
  }
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

  const sectionLabels = {
    home: 'PARMAR Core',
    chat: 'Chats / History',
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
  if (window.innerWidth <= 920) {
    document.body.classList.remove('sidebar-open');
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
        : 'The selected provider is local demo; notes are not sent to an external provider in this request.'} Local-demo notes remain in this browser. Do not save passwords, tokens, private keys, or other secrets.`
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
      ? 'Consent to store server memories'
      : 'Local-demo memory preference';
  }
  if (dom.memoryEnabledDescription) {
    dom.memoryEnabledDescription.textContent = authenticated
      ? enabled
        ? 'You consented to storing notes on this server. Relevant notes may be used as untrusted chat context.'
        : 'Server memory storage is off. Give consent before saving or updating notes.'
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
    for (const memory of [...state.memories]) {
      await deleteMemory(memory.id);
      if (state.authMode !== 'authenticated') return;
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
  const conversations = state.sessions
    .filter((session) => (
      state.authMode !== 'authenticated' || state.serverConversationIds.has(session.id)
    ))
    .filter((session) => session.messages.length > 0)
    .sort((first, second) => Number(second.updatedAt || 0) - Number(first.updatedAt || 0));

  if (dom.historyStatus) {
    dom.historyStatus.hidden = !historyStorageUnavailable;
    dom.historyStatus.textContent = historyStorageUnavailable
      ? 'Conversation history is unavailable in this browser. Existing data could not be read or saved.'
      : '';
  }

  dom.historyList.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = state.authMode === 'authenticated'
      ? 'Server conversation history is not available in this view yet.'
      : historyStorageUnavailable
        ? 'Saved conversations cannot be displayed.'
        : 'No conversations yet.';
    dom.historyList.appendChild(empty);
    return;
  }

  conversations.forEach((session) => {
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
      dateElement.textContent = 'Server conversation';
    } else {
      const updatedAt = Number(session.updatedAt || session.createdAt);
      dateElement.textContent = Number.isFinite(updatedAt)
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(updatedAt))
        : 'Saved locally';
    }
    button.append(titleElement, dateElement);
    button.addEventListener('click', () => {
      const selected = state.sessions.find((entry) => entry.id === button.dataset.sessionId);
      if (!selected) return;
      invalidatePendingRequest();
      state.currentSessionId = selected.id;
      state.conversationId = state.authMode === 'authenticated' ? selected.id : null;
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

function resetReviewState(message = 'PARMAR is ready for a request.') {
  state.pendingApprovalId = null;
  setVokiState('IDLE');
  setBadge('SAFE');
  document.body.dataset.state = 'IDLE';
  if (dom.riskLevel) dom.riskLevel.textContent = '—';
  if (dom.approvalState) dom.approvalState.textContent = 'Not assessed';
  if (dom.outcomeState) dom.outcomeState.textContent = 'Ready';
  if (dom.systemState) dom.systemState.textContent = 'READY';
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

function appendThinkingIndicator() {
  const message = document.createElement('div');
  message.className = 'message assistant thinking-message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-label', 'PARMAR is thinking');

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
  bubble.className = 'message-bubble thinking-bubble';
  const label = document.createElement('span');
  label.textContent = 'Thinking';
  const dots = document.createElement('span');
  dots.className = 'thinking-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.textContent = '...';
  bubble.append(label, dots);
  content.append(meta, bubble);
  message.append(avatar, content);
  dom.chatThread?.appendChild(message);
  if (dom.chatThread) dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
  return message;
}

function renderSessionMessages(animateLatest = false) {
  if (!dom.chatThread) return;
  const session = state.sessions.find((entry) => entry.id === state.currentSessionId);
  dom.chatThread.replaceChildren();

  if (!session || !session.messages.length) {
    renderEmptyChatState();
    return;
  }

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
    bubble.textContent = String(message.text ?? '');

    const safetyStatus = role === 'assistant' ? responseSafetyStatus(message.analysis) : null;
    if (safetyStatus) {
      const safetyNote = document.createElement('small');
      safetyNote.className = 'response-safety-note';
      safetyNote.dataset.status = safetyStatus;
      safetyNote.textContent = responseSafetyLabels[safetyStatus];
      content.appendChild(safetyNote);
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.appendChild(createCopyButton(bubble.textContent));

    content.append(meta, bubble, actions);
    wrapper.append(avatar, content);
    dom.chatThread.appendChild(wrapper);
  });

  dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
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
  const safeText = sanitizeSensitiveText(suppressed ? safeChatReply(analysis) : text);
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
  if (session.id === state.currentSessionId) renderSessionMessages(true);
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
  const lifecycle = analysis.lifecycle || result?.lifecycle || null;
  const reportedState = String(lifecycle?.current_state || '').toUpperCase();
  const status = normalizeStatus(analysis.status || result?.status || reportedState || 'UNAVAILABLE');
  const requestedLifecycle = normalizeStatus(lifecycle?.current_state || legacyStatusLifecycle[status] || 'IDLE');
  const lifecycleState = lifecyclePresentation[requestedLifecycle] ? requestedLifecycle : 'IDLE';
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
  const lifecycleState = String(analysis?.lifecycle?.current_state || result?.lifecycle?.current_state || '').toUpperCase();
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
  setVokiState('IDLE');
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

async function submitChatMessage() {
  const text = (dom.chatInput?.value || '').trim();
  if (!text) return;
  const requestId = beginRequest();
  if (requestId === null) return;

  const authenticated = state.authMode === 'authenticated';
  const authEpoch = state.authEpoch;
  const requestedConversationId = authenticated ? state.conversationId : null;
  let currentSession = authenticated
    ? state.sessions.find((session) => session.id === requestedConversationId)
    : ensureCurrentSession();
  let sessionId = currentSession?.id || null;
  stopVokiSpeech('THINKING');
  if (!authenticated || currentSession) {
    appendMessageToSession(sessionId, 'user', text, {});
  }
  if (dom.chatInput) dom.chatInput.value = '';
  resizeChatInput();
  const thinkingMessage = appendThinkingIndicator();
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
      state.currentSessionId = conversationId;
      state.serverConversationIds.add(conversationId);
      currentSession = {
        id: conversationId,
        title: '',
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
    if (!updateState(result.analysis || result)) throw new TypeError('Invalid chat response');
    if (authenticated) state.serverConversationIds.add(result.conversation_id);
    appendMessageToSession(sessionId, 'assistant', reply, result);
    const vokiResponseState = chatVokiResponseState(result);
    if (vokiResponseState === 'RESPONDING' || vokiResponseState === 'LOCAL_DEMO') {
      speakVokiResponse(reply, vokiResponseState);
    } else {
      setChatVokiState(vokiResponseState);
    }
    dom.requestInput.value = text;
  } catch {
    if (requestId !== state.requestSequence) return;
    if (state.currentSessionId === sessionId) {
      showRequestUnavailable('The chat service could not respond. No decision result was received.');
      setChatVokiState('ERROR');
    }
    if (sessionId) {
      appendMessageToSession(sessionId, 'assistant', 'The chat service could not respond. Please try again.', { status: 'UNAVAILABLE' });
    }
  } finally {
    thinkingMessage.remove();
    finishRequest(requestId);
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

function bindEvents() {
  document.querySelectorAll('.nav-item, .text-button[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.action === 'new-chat') {
        dom.newSessionBtn?.click();
        selectSection('chat', 'new-chat');
        return;
      }
      if (button.dataset.action === 'research') {
        selectSection('chat', 'research');
        if (window.innerWidth <= 1100) setResearchOpen(true);
        else dom.researchPanel?.focus({ preventScroll: true });
        return;
      }
      selectSection(button.dataset.section, button.dataset.navKey || button.dataset.section);
    });
  });

  if (dom.sidebarToggle) {
    dom.sidebarToggle.addEventListener('click', () => {
      if (window.innerWidth <= 920) {
        setResearchOpen(false);
        document.body.classList.toggle('sidebar-open');
      } else {
        document.body.classList.toggle('sidebar-collapsed');
      }
      syncSidebarToggle();
    });
  }

  dom.researchToggle?.addEventListener('click', () => {
    setResearchOpen(!document.body.classList.contains('research-open'));
  });
  dom.researchClose?.addEventListener('click', () => setResearchOpen(false, true));

  window.addEventListener('resize', () => {
    syncSidebarToggle();
    if (window.innerWidth > 1100) setResearchOpen(false);
  });

  document.addEventListener('pointerdown', (event) => {
    if (document.body.classList.contains('sidebar-open')) {
      if (dom.sidebar?.contains(event.target) || dom.sidebarToggle?.contains(event.target)) return;
      document.body.classList.remove('sidebar-open');
      syncSidebarToggle();
    }
    if (document.body.classList.contains('research-open')) {
      if (dom.researchPanel?.contains(event.target) || dom.researchToggle?.contains(event.target)) return;
      setResearchOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.body.classList.contains('sidebar-open')) {
        document.body.classList.remove('sidebar-open');
        syncSidebarToggle();
      }
      if (document.body.classList.contains('research-open')) setResearchOpen(false, true);
    }
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
    dom.chatInput.addEventListener('focus', () => {
      if (!state.requestInFlight && !(speechSynthesisAvailable() && window.speechSynthesis.speaking)) {
        setChatVokiState('LISTENING');
      }
    });
    dom.chatInput.addEventListener('blur', () => {
      if (dom.chatVoki?.dataset.state === 'LISTENING') setChatVokiState('IDLE');
    });
  }

  if (dom.vokiVoiceToggle) {
    dom.vokiVoiceToggle.addEventListener('change', () => {
      state.settings.vokiVoiceEnabled = Boolean(dom.vokiVoiceToggle.checked);
      persistSettings();
      syncVokiControls();
      if (!state.settings.vokiVoiceEnabled) stopVokiSpeech('IDLE');
    });
  }

  if (dom.vokiVisibilityToggle) {
    dom.vokiVisibilityToggle.addEventListener('click', () => {
      state.vokiMinimized = !state.vokiMinimized;
      syncVokiVisibility();
    });
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
      stopVokiSpeech('IDLE');
      state.currentSessionId = null;
      state.conversationId = null;
      state.pendingApprovalId = null;
      if (state.authMode !== 'authenticated') ensureCurrentSession();
      renderSessionMessages();
      renderHistory();
      selectSection('chat', 'chat');
      if (dom.requestInput) dom.requestInput.value = '';
      if (dom.chatInput) dom.chatInput.value = '';
      setVokiState('IDLE');
      setBadge('SAFE');
      document.body.dataset.state = 'IDLE';
      if (dom.riskLevel) dom.riskLevel.textContent = '—';
      if (dom.approvalState) dom.approvalState.textContent = 'Not assessed';
      if (dom.outcomeState) dom.outcomeState.textContent = 'Ready';
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
      if (dom.systemState) dom.systemState.textContent = 'READY';
      if (dom.statusMessage) dom.statusMessage.textContent = 'PARMAR is ready for a request.';
    });
  }

  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener('click', logoutAuthenticatedSession);
  }

  if (dom.wakeBtn) {
    dom.wakeBtn.addEventListener('click', () => {
      if (dom.statusMessage) dom.statusMessage.textContent = 'Enter a request for PARMAR to review.';
    });
  }

  if (dom.parmarCore) {
    let acknowledgementTimer;
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
    dom.parmarCore.addEventListener('click', () => {
      dom.parmarCore.classList.remove('acknowledged');
      requestAnimationFrame(() => dom.parmarCore.classList.add('acknowledged'));
      window.clearTimeout(acknowledgementTimer);
      acknowledgementTimer = window.setTimeout(() => dom.parmarCore.classList.remove('acknowledged'), 700);
    });
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
  bindEvents();
  applySettings();
  setVokiState('IDLE');
  setChatVokiState(state.settings.provider === 'local-demo' ? 'LOCAL_DEMO' : 'IDLE');
  syncVokiControls();
  syncVokiVisibility();
  syncSidebarToggle();
  selectSection('home');
  configureCrossTabAuthentication();
  refreshAuthenticationState();
}

initialize();
