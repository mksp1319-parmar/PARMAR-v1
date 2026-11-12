const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'interface', 'static', 'app.js'),
  'utf8',
);

function functionSource(name) {
  const match = appSource.match(new RegExp(`(?:async\\s+)?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

class Element {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.dataset = {};
    this.children = [];
    this.focusCount = 0;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  focus() {
    this.focusCount += 1;
  }
}

function makeProfileContext({ request, activeProfileId, profiles } = {}) {
  const firstProfileId = '00000000-0000-4000-8000-000000000001';
  const secondProfileId = '00000000-0000-4000-8000-000000000002';
  const state = {
    authMode: 'authenticated',
    activeProfileId: activeProfileId ?? firstProfileId,
    profiles: profiles ?? [
      { profile_id: firstProfileId, name: 'Personal' },
      { profile_id: secondProfileId, name: 'Work' },
    ],
    profilesLoading: false,
    profileSwitching: false,
    profileError: false,
    profileFeedback: '',
    profileLoadGeneration: 0,
    authEpoch: 4,
    historyLoadGeneration: 2,
    historySelectionGeneration: 1,
    historySelectionId: 'old-selection',
    historyLoading: true,
    historyError: false,
    pendingApprovalId: 'pending-review',
    conversationId: 'old-conversation',
    currentSessionId: 'old-conversation',
    sessions: [{ id: 'old-conversation', messages: [] }],
    serverConversationIds: new Set(['old-conversation']),
  };
  const dom = {
    profileControls: new Element(),
    profileSelector: new Element(),
    activeProfileName: new Element(),
    profileStatus: new Element(),
    profileNameInput: new Element(),
    profileCreateButton: new Element(),
    chatInput: new Element(),
  };
  const calls = [];
  const events = [];
  const refreshes = [];
  const services = {
    apiRequest: request || (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        active_profile: { profile_id: secondProfileId, name: 'Work' },
      }),
    })),
    clearActiveConversationId: () => calls.push(['clear-active-conversation']),
    renderHistory: () => calls.push(['render-history']),
    renderSessionMessages: () => calls.push(['render-messages']),
    resetReviewState: (message) => calls.push(['reset-review', message]),
    publishConversationSelection: (...args) => events.push(args),
    notifyProfileSelection: () => calls.push(['notify-profile-selection']),
    refreshServerConversationHistory: async (options) => {
      refreshes.push(options);
      state.historyLoading = false;
      state.historyError = false;
      state.sessions = [{ id: 'new-profile-conversation', messages: [] }];
      state.serverConversationIds = new Set(['new-profile-conversation']);
    },
    clearAuthenticatedState: (message) => {
      calls.push(['clear-authenticated-state', message]);
      state.authMode = 'anonymous';
      state.activeProfileId = null;
    },
    renderProfileControls: null,
  };
  const context = vm.createContext({
    state,
    dom,
    document: { createElement: () => new Element() },
    apiRequest: services.apiRequest,
    clearActiveConversationId: services.clearActiveConversationId,
    renderHistory: services.renderHistory,
    renderSessionMessages: services.renderSessionMessages,
    resetReviewState: services.resetReviewState,
    publishConversationSelection: services.publishConversationSelection,
    notifyProfileSelection: services.notifyProfileSelection,
    refreshServerConversationHistory: services.refreshServerConversationHistory,
    clearAuthenticatedState: services.clearAuthenticatedState,
    PROFILE_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  });
  vm.runInContext([
    functionSource('isProfileId'),
    functionSource('renderProfileControls'),
    functionSource('clearProfileConversationState'),
    functionSource('setActiveProfile'),
    functionSource('createAuthenticatedProfile'),
    'globalThis.profileUi = { renderProfileControls, setActiveProfile, createAuthenticatedProfile };',
  ].join('\n'), context);
  return { context, state, dom, calls, events, refreshes, firstProfileId, secondProfileId };
}

function response(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  };
}

test('profile controls show the verified active profile and owned options', () => {
  const ui = makeProfileContext();
  ui.context.profileUi.renderProfileControls();

  assert.equal(ui.dom.profileControls.hidden, false);
  assert.equal(ui.dom.activeProfileName.textContent, 'Personal');
  assert.equal(ui.dom.profileSelector.value, ui.firstProfileId);
  assert.deepEqual(
    ui.dom.profileSelector.children.slice(1).map((option) => [option.value, option.textContent]),
    [
      [ui.firstProfileId, 'Personal'],
      [ui.secondProfileId, 'Work'],
    ],
  );
});

test('profile switching posts only the selected profile, clears stale state, and refreshes its history', async () => {
  const calls = [];
  const ui = makeProfileContext({
    request: async (url, options) => {
      calls.push([url, options]);
      return response({
        active_profile: { profile_id: ui.secondProfileId, name: 'Work' },
      });
    },
  });

  assert.equal(await ui.context.profileUi.setActiveProfile(ui.secondProfileId), true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/session/profile');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { profile_id: ui.secondProfileId });
  assert.equal(ui.state.activeProfileId, ui.secondProfileId);
  assert.equal(ui.state.conversationId, null);
  assert.equal(ui.state.pendingApprovalId, null);
  assert.equal(ui.refreshes.length, 1);
  assert.equal(ui.refreshes[0].navigateToChat, false);
  assert.equal(ui.state.sessions[0].id, 'new-profile-conversation');
  assert.deepEqual(ui.events, [[null, true]]);
  assert.match(ui.state.profileFeedback, /Showing conversations for Work/);
});

test('unauthorized profile selection preserves the active profile and reports the server denial', async () => {
  const ui = makeProfileContext({ request: async () => response({}, 404) });

  assert.equal(await ui.context.profileUi.setActiveProfile(ui.secondProfileId), false);

  assert.equal(ui.state.authMode, 'authenticated');
  assert.equal(ui.state.activeProfileId, ui.firstProfileId);
  assert.equal(ui.state.conversationId, 'old-conversation');
  assert.equal(ui.refreshes.length, 0);
  assert.equal(ui.state.profileError, true);
  assert.match(ui.state.profileFeedback, /not available to this session/);
});

test('expired session response cannot restore a profile or refresh conversations', async () => {
  const ui = makeProfileContext({
    request: async () => {
      ui.state.authEpoch += 1;
      ui.state.authMode = 'anonymous';
      ui.state.activeProfileId = null;
      return response({}, 401);
    },
  });

  assert.equal(await ui.context.profileUi.setActiveProfile(ui.secondProfileId), false);

  assert.equal(ui.state.authMode, 'anonymous');
  assert.equal(ui.state.activeProfileId, null);
  assert.equal(ui.refreshes.length, 0);
});

test('creating a profile sends only its name, then selects it through the ownership-checked endpoint', async () => {
  const createdProfileId = '00000000-0000-4000-8000-000000000003';
  const calls = [];
  let ui;
  ui = makeProfileContext({
    activeProfileId: null,
    profiles: [],
    request: async (url, options) => {
      calls.push([url, options]);
      if (url === '/api/identity/profiles') {
        return response({ profile_id: createdProfileId, name: 'Family' }, 201);
      }
      return response({ active_profile: { profile_id: createdProfileId, name: 'Family' } });
    },
  });
  ui.dom.profileNameInput.value = ' Family ';
  let prevented = false;

  await ui.context.profileUi.createAuthenticatedProfile({
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(calls[0][0], '/api/identity/profiles');
  assert.deepEqual(JSON.parse(calls[0][1].body), { name: 'Family' });
  assert.equal(calls[1][0], '/api/session/profile');
  assert.deepEqual(JSON.parse(calls[1][1].body), { profile_id: createdProfileId });
  assert.equal(ui.state.activeProfileId, createdProfileId);
  assert.equal(ui.dom.profileNameInput.value, '');
  assert.equal(ui.refreshes.length, 1);
});