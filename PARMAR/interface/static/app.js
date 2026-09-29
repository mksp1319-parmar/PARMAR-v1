const STORAGE_KEYS = {
  sessions: 'parmar-sessions-v1',
  settings: 'parmar-settings-v1',
  audit: 'parmar-audit-v1',
};

const defaultSettings = {
  language: 'en',
  theme: 'midnight',
  animationIntensity: 'normal',
  reducedMotion: false,
  phonePermission: true,
  provider: 'local-demo',
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
  newSessionBtn: document.getElementById('new-session-btn'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  chatThread: document.getElementById('chat-thread'),
  chatInput: document.getElementById('chat-input'),
  chatSubmit: document.getElementById('chat-submit'),
  runScenario: document.getElementById('run-scenario'),
  runScenarioSecondary: document.getElementById('run-scenario-secondary'),
  loadDemo: document.getElementById('load-demo'),
  navButtons: Array.from(document.querySelectorAll('.nav-item')),
  views: Array.from(document.querySelectorAll('.section-view')),
  wakeBtn: document.getElementById('wake-btn'),
  vokiState: document.getElementById('voki-state'),
  providerStatus: document.getElementById('provider-status'),
  settingsProvider: document.getElementById('settings-provider'),
  phonePermissionToggle: document.getElementById('phone-permission-toggle'),
  simulatePhoneSafe: document.getElementById('simulate-phone-safe'),
  simulatePhoneRisk: document.getElementById('simulate-phone-risk'),
  phoneStatusLabel: document.getElementById('phone-status-label'),
  phonePolicyLabel: document.getElementById('phone-policy-label'),
};

const state = {
  sessions: readJson(STORAGE_KEYS.sessions, []),
  audit: readJson(STORAGE_KEYS.audit, []),
  settings: loadSettings(),
  currentSessionId: null,
  requestSequence: 0,
  requestInFlight: false,
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function loadSettings() {
  const stored = readJson(STORAGE_KEYS.settings, {});
  return { ...defaultSettings, ...stored };
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
  if (state.requestInFlight) return null;
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
  if (dom.providerStatus) dom.providerStatus.textContent = String(settings.provider || 'local-demo').toUpperCase();
  if (dom.settingsProvider) dom.settingsProvider.textContent = String(settings.provider || 'local-demo').toUpperCase();
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

function setBadge(status) {
  if (!dom.statusPill) return;
  const normalized = normalizeStatus(status);
  dom.statusPill.classList.remove('status-safe', 'status-warning', 'status-danger');

  if (normalized === 'BLOCKED' || normalized === 'REJECTED' || normalized === 'RISK_DETECTED') {
    dom.statusPill.classList.add('status-danger');
    dom.statusPill.textContent = 'BLOCKED';
    return;
  }

  if (normalized === 'APPROVAL_REQUIRED' || normalized === 'WAITING_FOR_HUMAN') {
    dom.statusPill.classList.add('status-warning');
    dom.statusPill.textContent = 'WAITING';
    return;
  }

  dom.statusPill.classList.add('status-safe');
  dom.statusPill.textContent = 'SAFE';
}

function selectSection(sectionName) {
  dom.navButtons.forEach((button) => {
    const active = button.dataset.section === sectionName;
    button.classList.toggle('active', active);
  });

  dom.views.forEach((view) => {
    const active = view.dataset.section === sectionName;
    view.classList.toggle('active', active);
  });

  const sectionLabels = {
    home: 'Overview',
    chat: 'Conversation',
    safety: 'Safety review',
    phone: 'Phone awareness',
    simulator: 'Scenario room',
    audit: 'Activity',
    settings: 'Preferences',
  };
  if (dom.viewTitle) dom.viewTitle.textContent = sectionLabels[sectionName] || 'PARMAR';
  document.body.dataset.activeSection = sectionName;
  if (window.innerWidth <= 920) {
    document.body.classList.remove('sidebar-open');
    dom.sidebarToggle?.setAttribute('aria-expanded', 'false');
    dom.sidebarToggle?.setAttribute('aria-label', 'Open navigation');
  }
}

function ensureCurrentSession() {
  if (!state.currentSessionId) {
    const session = {
      id: `session-${Date.now()}`,
      title: 'New PARMAR session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    state.sessions = [session, ...state.sessions].slice(0, 12);
    state.currentSessionId = session.id;
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessions));
  }

  return state.sessions.find((session) => session.id === state.currentSessionId) || state.sessions[0];
}

function persistedSessionList() {
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessions));
}

function renderHistory() {
  if (!dom.historyList) return;

  if (!state.sessions.length) {
    dom.historyList.innerHTML = '<li class="history-empty">No saved sessions yet.</li>';
    return;
  }

  dom.historyList.innerHTML = state.sessions.slice(0, 6).map((session) => {
    const firstUserMessage = session.messages.find((message) => message.role === 'user');
    const title = session.title || firstUserMessage?.text || 'Session';
    const snippet = String(title).slice(0, 48);
    return `
      <li>
        <button class="history-item" data-session-id="${session.id}">
          <span>${escapeHtml(snippet)}</span>
          <small>${escapeHtml(session.status || 'READY')}</small>
        </button>
      </li>
    `;
  }).join('');

  dom.historyList.querySelectorAll('.history-item').forEach((button) => {
    button.addEventListener('click', () => {
      const sessionId = button.dataset.sessionId;
      if (!sessionId) return;
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) return;
      state.currentSessionId = sessionId;
      renderSessionMessages();
      const latest = session.messages.at(-1);
      if (latest && latest.role === 'assistant') {
        const analysis = latest.analysis || {};
        updateState(analysis);
      }
    });
  });
}

function renderSessionMessages() {
  if (!dom.chatThread) return;
  const session = ensureCurrentSession();
  dom.chatThread.innerHTML = '';

  if (!session.messages.length) {
    dom.chatThread.innerHTML = '<div class="message assistant"><div class="message-bubble">PARMAR is watching the decision boundary, explaining risk, and keeping the human in control.</div></div>';
    return;
  }

  session.messages.forEach((message) => {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message.text;
    wrapper.appendChild(bubble);
    dom.chatThread.appendChild(wrapper);
  });

  dom.chatThread.scrollTop = dom.chatThread.scrollHeight;
}

function addMessageToSession(role, text, analysis) {
  const session = ensureCurrentSession();
  const entry = { role, text, analysis, timestamp: new Date().toISOString() };
  session.messages.push(entry);
  session.updatedAt = Date.now();
  if (role === 'user') {
    session.title = text.slice(0, 40) || 'PARMAR session';
  }
  if (role === 'assistant') session.status = analysis?.status || 'READY';
  persistedSessionList();
  renderHistory();
  renderSessionMessages();
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
    request: request || 'No request',
    status: normalizeStatus(status),
    riskLevel: normalizeStatus(riskLevel),
    message: message || 'Governance review recorded.',
    timestamp: new Date().toISOString(),
  };
  state.audit = [entry, ...state.audit].slice(0, 12);
  localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(state.audit));
  renderAuditEntries();
}

function renderApproval(result) {
  const analysis = result?.analysis || result || {};
  const requiresApproval = Boolean(analysis.human_approval_required || result?.human_approval_required);
  const lifecycleState = normalizeStatus(analysis.lifecycle?.current_state || result?.lifecycle?.current_state || '');
  const status = normalizeStatus(analysis.status || result?.status || '');
  const pending = lifecycleState === 'WAITING_FOR_HUMAN' || (!lifecycleState && status === 'APPROVAL_REQUIRED' && requiresApproval);

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

function updateState(result) {
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
    || (!hasLifecycle && !hasEnforcement)) {
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

  const auditText = `${resolved.status} — ${resolved.message}`;
  addAuditEntry(resolved.request, status, resolved.riskLevel, auditText);
  return true;
}

function showRequestUnavailable(message) {
  if (dom.statusMessage) dom.statusMessage.textContent = message;
  if (dom.systemState) dom.systemState.textContent = 'UNAVAILABLE';
  if (dom.outcomeState) dom.outcomeState.textContent = 'Unavailable';
  if (dom.statusPill) {
    dom.statusPill.classList.remove('status-safe', 'status-danger');
    dom.statusPill.classList.add('status-warning');
    dom.statusPill.textContent = 'UNAVAILABLE';
  }
}

async function analyzeRequest() {
  const request = dom.requestInput.value.trim();
  if (!request) {
    dom.requestInput.focus();
    return;
  }

  const requestId = beginRequest();
  if (requestId === null) return;
  if (dom.statusMessage) dom.statusMessage.textContent = 'Request sent. Waiting for PARMAR’s response.';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, language: state.settings.language }),
    });
    if (!response.ok) throw new Error('Analysis request failed');
    const result = await response.json();
    if (requestId !== state.requestSequence) return;
    if (!updateState(result)) throw new TypeError('Invalid analysis response');
    addMessageToSession('assistant', result.message || 'PARMAR review complete.', result);
    appendRequestHistory(request, result.status || 'SAFE');
  } catch {
    if (requestId !== state.requestSequence) return;
    showRequestUnavailable('PARMAR could not complete the review. No result was received. Please try again.');
    addMessageToSession('assistant', 'PARMAR could not complete the review. Please try again.', { status: 'UNAVAILABLE' });
  } finally {
    finishRequest(requestId);
  }
}

function appendRequestHistory(request, status) {
  const safeRequest = request.trim();
  if (!safeRequest) return;
  const entry = {
    id: `history-${Date.now()}`,
    title: safeRequest.slice(0, 40),
    status: normalizeStatus(status),
    createdAt: Date.now(),
    messages: [{ role: 'user', text: safeRequest }],
  };
  state.sessions = [entry, ...state.sessions.filter((item) => item.title !== safeRequest.slice(0, 40))].slice(0, 12);
  persistedSessionList();
  renderHistory();
}

async function submitDecision(decision) {
  const request = dom.requestInput.value.trim();
  if (!request) return;
  const requestId = beginRequest();
  if (requestId === null) return;

  try {
    const response = await fetch('/api/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, decision, language: state.settings.language }),
    });
    if (!response.ok) throw new Error('Approval request failed');
    const result = await response.json();
    if (requestId !== state.requestSequence) return;
    if (!updateState(result)) throw new TypeError('Invalid approval response');
    addMessageToSession('assistant', result.message || 'Human decision processed.', result);
    appendRequestHistory(request, result.status || 'SAFE');
  } catch {
    if (requestId === state.requestSequence) showRequestUnavailable('The decision could not be submitted. No approval result was received.');
  } finally {
    finishRequest(requestId);
  }
}

async function submitChatMessage() {
  const text = (dom.chatInput?.value || '').trim();
  if (!text) return;
  const requestId = beginRequest();
  if (requestId === null) return;

  addMessageToSession('user', text, {});
  if (dom.chatInput) dom.chatInput.value = '';
  if (dom.statusMessage) dom.statusMessage.textContent = 'Message sent. Waiting for PARMAR’s response.';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, language: state.settings.language }),
    });
    if (!response.ok) throw new Error('Chat request failed');
    const result = await response.json();
    if (requestId !== state.requestSequence) return;
    const provider = String(result.provider || state.settings.provider || 'local-demo').toUpperCase();
    state.settings.provider = provider.toLowerCase();
    persistSettings();
    if (dom.providerStatus) dom.providerStatus.textContent = provider;
    if (dom.settingsProvider) dom.settingsProvider.textContent = provider;
    const reply = result.message || 'PARMAR reviewed the request and responded.';
    if (!updateState(result.analysis || result)) throw new TypeError('Invalid chat response');
    addMessageToSession('assistant', reply, result.analysis || result);
    dom.requestInput.value = text;
  } catch {
    if (requestId !== state.requestSequence) return;
    showRequestUnavailable('The chat service could not respond. No decision result was received.');
    addMessageToSession('assistant', 'The chat service could not respond. Please try again.', { status: 'UNAVAILABLE' });
  } finally {
    finishRequest(requestId);
  }
}

async function loadScenarios() {
  try {
    const response = await fetch('/api/scenarios');
    const payload = await response.json();
    const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];

    const options = scenarios.map((scenario) => {
      const value = scenario.proposed_ai_action || scenario.simulated_user_intent || scenario.description || scenario.scenario_id || '';
      const label = scenario.description || scenario.scenario_id || 'Scenario';
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    if (dom.simulatorSelect) dom.simulatorSelect.innerHTML = options || '<option value="">No scenarios</option>';
    if (dom.simulatorSelectSecondary) dom.simulatorSelectSecondary.innerHTML = options || '<option value="">No scenarios</option>';
  } catch (_error) {
    if (dom.simulatorSelect) dom.simulatorSelect.innerHTML = '<option value="">Scenarios unavailable</option>';
    if (dom.simulatorSelectSecondary) dom.simulatorSelectSecondary.innerHTML = '<option value="">Scenarios unavailable</option>';
  }
}

async function togglePhonePermission(enabled) {
  state.settings.phonePermission = enabled;
  persistSettings();
  try {
    const response = await fetch('/api/phone', {
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
    const response = await fetch('/api/phone', {
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
    button.addEventListener('click', () => selectSection(button.dataset.section));
  });

  if (dom.sidebarToggle) {
    dom.sidebarToggle.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('sidebar-open');
      dom.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
      dom.sidebarToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    });
  }

  document.addEventListener('pointerdown', (event) => {
    if (!document.body.classList.contains('sidebar-open')) return;
    if (dom.sidebar?.contains(event.target) || dom.sidebarToggle?.contains(event.target)) return;
    document.body.classList.remove('sidebar-open');
    dom.sidebarToggle?.setAttribute('aria-expanded', 'false');
    dom.sidebarToggle?.setAttribute('aria-label', 'Open navigation');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      document.body.classList.remove('sidebar-open');
      dom.sidebarToggle?.setAttribute('aria-expanded', 'false');
      dom.sidebarToggle?.setAttribute('aria-label', 'Open navigation');
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
      const selected = dom.simulatorSelect?.value || '';
      if (!selected) return;
      dom.requestInput.value = selected;
      analyzeRequest();
    });
  }

  if (dom.runScenarioSecondary) {
    dom.runScenarioSecondary.addEventListener('click', () => {
      const selected = dom.simulatorSelectSecondary?.value || '';
      if (!selected) return;
      dom.requestInput.value = selected;
      selectSection('home');
      analyzeRequest();
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
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitChatMessage();
      }
    });
  }

  if (dom.newSessionBtn) {
    dom.newSessionBtn.addEventListener('click', () => {
      invalidatePendingRequest();
      state.currentSessionId = null;
      ensureCurrentSession();
      renderSessionMessages();
      if (dom.requestInput) dom.requestInput.value = '';
      if (dom.chatInput) dom.chatInput.value = '';
      state.settings.provider = 'local-demo';
      persistSettings();
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
  ensureCurrentSession();
  renderHistory();
  renderSessionMessages();
  renderAuditEntries();
  renderPhoneStatus();
  loadScenarios();
  bindEvents();
  applySettings();
  setVokiState('IDLE');
  selectSection('home');
}

initialize();
