const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticDir = path.join(__dirname, '..', 'interface', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(staticDir, 'styles.css'), 'utf8');

function functionSource(name) {
  const match = appSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

function homeSection() {
  const section = html.match(
    /<section class="section-view active home-command-center" data-section="home"[\s\S]*?(?=<section class="section-view" data-section="voki")/,
  );
  assert.ok(section, 'Expected the Home section to precede the dedicated VOKKI section.');
  return section[0];
}

test('Home is a distinct command center and the existing Core and VOKKI workspaces remain separate', () => {
  const home = homeSection();
  assert.match(home, /PARMAR \/ COMMAND CENTER/);
  assert.match(home, /id="home-readiness-state"/);
  assert.match(home, /id="home-continue-list"/);
  assert.match(home, /Start something new/);
  assert.match(home, /Needs your attention/);
  for (const category of ['Conversations', 'Research', 'Simulations', 'Decisions']) {
    assert.match(home, new RegExp(`>${category}<`));
  }
  assert.match(home, /System reassurance/);
  assert.match(home, /data-voki-home-avatar/);
  assert.match(home, /data-voki-default-image src="\/static\/assets\/voki\/default-avatar\.png"/);
  assert.doesNotMatch(home, /data-voki-interface|parmar-core/);

  assert.match(html, /data-section="core" data-nav-key="core" aria-label="PARMAR Core"/);
  assert.match(html, /id="section-core" aria-labelledby="core-title"/);
  assert.match(html, /id="section-voki" aria-labelledby="voki-interface-title"/);
  assert.match(html, /data-voki-default-image src="\/static\/assets\/voki\/default-avatar\.png"/);
  assert.equal((html.match(/id="request-input"/g) || []).length, 1);
  assert.equal((html.match(/id="analyze-btn"/g) || []).length, 1);
  assert.match(html, /data-section="home" data-nav-key="home"/);
  assert.match(appSource, /selectSection\('home'\);[\s\S]*?refreshAuthenticationState\(\{ navigateToChat: false \}\)/);
});

test('Home actions navigate to the existing workflows', () => {
  const navigations = [];
  const calls = [];
  const chatInput = { focus() { calls.push('focus-chat'); } };
  const requestInput = { focus() { calls.push('focus-request'); } };
  const context = vm.createContext({
    dom: {
      newSessionBtn: { click() { calls.push('new-session'); } },
      researchMode: { checked: false },
      chatInput,
      requestInput,
      vokiInput: { focus() { calls.push('focus-voki'); } },
      approvalActions: { querySelector() { return { focus() { calls.push('focus-approval'); } }; } },
    },
    selectSection: (...args) => navigations.push(args),
    closeWorkspacePanel() {},
  });
  vm.runInContext(functionSource('navigateWorkspaceAction'), context);
  const navigate = context.navigateWorkspaceAction;

  navigate({ dataset: { action: 'new-chat' } });
  assert.deepEqual(calls.splice(0), ['new-session']);
  assert.deepEqual(navigations.pop(), ['chat', 'new-chat']);

  navigate({ dataset: { action: 'research-chat' } });
  assert.equal(context.dom.researchMode.checked, true);
  assert.deepEqual(calls.splice(0), ['focus-chat']);
  assert.deepEqual(navigations.pop(), ['chat']);

  navigate({ dataset: { section: 'core', homeFocus: 'request' } });
  assert.deepEqual(calls.splice(0), ['focus-request']);
  assert.deepEqual(navigations.pop(), ['core', 'core']);

  navigate({ dataset: { section: 'simulator' } });
  assert.deepEqual(navigations.pop(), ['simulator', 'simulator']);
  navigate({ dataset: { section: 'safety' } });
  assert.deepEqual(navigations.pop(), ['safety', 'safety']);

  assert.match(functionSource('bindEvents'), /dom\.analyzeBtn\.addEventListener\('click', analyzeRequest\)/);
  assert.match(functionSource('analyzeRequest'), /apiRequest\('\/api\/analyze'/);
  assert.match(functionSource('evaluateScenario'), /apiRequest\('\/api\/scenarios\/evaluate'/);
  assert.match(html, /id="section-safety"/);
});

test('Continue and Recent Work use persisted conversations, actual research, and existing audit entries', () => {
  const renderHome = functionSource('renderHome');
  const renderHistory = functionSource('renderHistory');
  const continueConversation = functionSource('continueConversation');
  const addAuditEntry = functionSource('addAuditEntry');
  const updateState = functionSource('updateState');

  assert.match(renderHome, /state\.sessions\.filter/);
  assert.match(renderHome, /state\.serverConversationIds\.has\(session\.id\)/);
  assert.match(renderHome, /message\.analysis\?\.research/);
  assert.match(renderHome, /entry\.kind === 'simulation'/);
  assert.match(renderHome, /entry\.kind === 'decision'/);
  assert.match(renderHistory, /renderHome\(\)/);
  assert.match(continueConversation, /selectServerConversation\(selected\.id\)/);
  assert.match(continueConversation, /renderSessionMessages\(\)/);
  assert.match(addAuditEntry, /localStorage\.setItem\(STORAGE_KEYS\.audit, JSON\.stringify\(state\.audit\)\)/);
  assert.match(updateState, /scenarioSimulation \? 'simulation' : 'decision'/);
  assert.match(appSource, /STORAGE_KEYS = \{[\s\S]*?localDemoSessions: 'parmar-sessions-v1'[\s\S]*?audit: 'parmar-audit-v1'/);
  assert.doesNotMatch(appSource, /home-work-history|home-activity-history|home-recent-storage/);
});

test('Needs Attention is gated by a genuine pending approval and returns to its existing controls', () => {
  const renderHome = functionSource('renderHome');
  const navigate = functionSource('navigateWorkspaceAction');
  assert.match(renderHome, /state\.pendingApprovalId/);
  assert.match(renderHome, /readinessState === 'WAITING_FOR_HUMAN'/);
  assert.match(renderHome, /!dom\.approvalActions\.hidden/);
  assert.match(homeSection(), /data-home-focus="approval"/);
  assert.match(navigate, /dom\.approvalActions\?\.querySelector\('button\[data-decision\]'\)\?\.focus\(\)/);
  assert.match(appSource, /apiRequest\('\/api\/approval'/);
});

test('Home motion is reduced with the user preference and follows real review state', () => {
  const reducedMotion = styles.slice(styles.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(styles, /\.home-voki-presence\[data-lifecycle-state="THINKING"\] \.home-voki-halo-inner/);
  assert.match(styles, /\.home-voki-presence\[data-lifecycle-state="WAITING_FOR_HUMAN"\] \.home-voki-halo/);
  assert.match(reducedMotion, /home-voki-presence\[data-lifecycle-state="THINKING"\]/);
  assert.match(html, /id="settings-reduced-motion"/);
});

test('Home and dedicated VOKKI use the canonical avatar through the shared real lifecycle renderer', () => {
  const avatarSource = fs.readFileSync(path.join(staticDir, 'voki-avatar.js'), 'utf8');
  const appInitialize = functionSource('initialize');
  const setVokiState = functionSource('setVokiState');
  const avatarAsset = fs.readFileSync(path.join(staticDir, 'assets', 'voki', 'default-avatar.png'));
  assert.match(avatarSource, /source: 'reference-crop'/);
  assert.match(avatarSource, /reference: 'file_00000000bd50820b9c027852032b8da5\.png'/);
  assert.match(avatarSource, /asset: '\/static\/assets\/voki\/default-avatar\.png'/);
  assert.match(avatarSource, /data-voki-default-image/);
  assert.deepEqual(avatarAsset.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.match(appInitialize, /state\.homeVokiAvatar = new window\.PARMARVOKKIAvatar\.VOKKIAvatarPresentation/);
  assert.match(setVokiState, /state\.homeVokiAvatar\?\.setLifecycle/);
  for (const lifecycle of ['LISTENING', 'THINKING', 'ANALYZING', 'RISK_CHECK', 'WAITING_FOR_HUMAN', 'RESPONSE_SAFETY', 'RELEASED', 'WITHHELD', 'BLOCKED', 'PROVIDER_FAILED']) {
    assert.match(avatarSource, new RegExp(`\\b${lifecycle}:`));
  }
  assert.match(html, /id="section-chat"/);
  assert.match(html, /id="section-core"/);
});
