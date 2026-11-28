const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticDir = path.join(__dirname, '..', 'interface', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(staticDir, 'styles.css'), 'utf8');
const premiumStyles = fs.readFileSync(path.join(staticDir, 'premium.css'), 'utf8');

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

test('Home matches the reference-led dashboard while Core and VOKKI remain separate', () => {
  const home = homeSection();
  assert.match(home, /PARMAR \/ YOUR PERSONAL AI/);
  assert.match(home, /id="home-readiness-state"/);
  assert.match(home, /id="home-continue-list"/);
  assert.match(home, /id="home-activity-title">Recent Activity/);
  assert.match(home, /id="home-memory-highlights"/);
  assert.match(home, /class="home-quick-grid"/);
  assert.match(home, /class="home-chat-composer"/);
  assert.match(home, /id="home-clock"/);
  assert.match(home, /Weather<br \/>not connected/);
  assert.match(home, /Needs your attention/);
  for (const action of ['Ask Anything', 'Research in Chat', 'Open AETHER', 'View Memory', 'Talk to VOKKI', 'Use Simulator', 'Open Approvals', 'System Settings']) {
    assert.match(home, new RegExp(`>${action}<`));
  }
  assert.equal((home.match(/data-action="research-chat"/g) || []).length, 1);
  assert.match(home, /data-section="voki"><span class="home-quick-icon"/);
  assert.doesNotMatch(home, />Search Web<|>Run Research<|>Request Approval</);
  assert.match(html, /id="global-search-input"/);
  assert.match(appSource, /No saved memories yet\./);
  assert.match(home, /data-voki-home-avatar/);
  assert.match(home, /data-voki-default-image src="\/static\/assets\/voki\/Vokki-screen\.png"/);
  assert.doesNotMatch(home, /data-voki-interface|parmar-core/);

  assert.match(html, /data-section="core" data-nav-key="core" aria-label="Decision review"/);
  assert.match(html, /id="section-core" aria-labelledby="core-title"/);
  assert.match(html, /id="section-voki" aria-labelledby="voki-interface-title"/);
  assert.match(html, /data-voki-default-image src="\/static\/assets\/voki\/Vokki-screen\.png"/);
  assert.equal((html.match(/id="request-input"/g) || []).length, 1);
  assert.equal((html.match(/id="analyze-btn"/g) || []).length, 1);
  assert.match(html, /data-section="home" data-nav-key="home"/);
  assert.match(appSource, /selectSection\('home'\);[\s\S]*?refreshAuthenticationState\(\{ navigateToChat: false \}\)/);
});

test('Home search and composer use loaded data and the existing PARMAR chat flow', () => {
  const searchRecords = functionSource('homeSearchRecords');
  const openSearchResult = functionSource('openHomeSearchResult');
  const sendHomeChatMessage = functionSource('sendHomeChatMessage');
  const renderMemoryHighlights = functionSource('renderHomeMemoryHighlights');

  assert.match(searchRecords, /state\.sessions/);
  assert.match(searchRecords, /state\.memories/);
  assert.match(searchRecords, /researchHistoryRecords\(\)/);
  assert.match(searchRecords, /state\.audit/);
  assert.match(openSearchResult, /continueConversation\(record\.sessionId\)/);
  assert.match(openSearchResult, /selectSection\('memory'\)/);
  assert.match(sendHomeChatMessage, /dom\.chatInput\.value = message/);
  assert.match(sendHomeChatMessage, /submitChatMessage\(\)/);
  assert.match(renderMemoryHighlights, /state\.memories/);
  assert.match(functionSource('bindEvents'), /dom\.homeChatComposer\?\.addEventListener\('submit', sendHomeChatMessage\)/);
});

test('The classic glass hamburger meets its size and line contract and toggles navigation', () => {
  const toggle = html.match(/<button class="sidebar-toggle"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(toggle, 'Expected the original sidebar toggle in the top navigation.');
  assert.equal((toggle[1].match(/<span><\/span>/g) || []).length, 2);
  assert.match(toggle[0], /aria-expanded="false" aria-controls="sidebar"/);
  assert.match(premiumStyles, /\.sidebar-toggle\s*\{[^}]*width:\s*35px;[^}]*height:\s*35px;[^}]*border-radius:\s*5px;/);
  assert.match(premiumStyles, /\.sidebar-toggle span\s*\{[^}]*width:\s*14px;[^}]*background:\s*#d3c9b9;/);
  assert.match(premiumStyles, /\.sidebar-toggle:hover\s*\{[^}]*border-color:\s*rgba\(200, 157, 105, 0\.4\);[^}]*background:\s*#1b1916;/);
  assert.doesNotMatch(premiumStyles, /\.sidebar-toggle\[aria-expanded="true"\]\s+span/);
  assert.match(
    premiumStyles,
    /@media \(max-width: 640px\)[\s\S]*?\.sidebar-toggle \{\s*width: 34px;\s*height: 34px;/,
  );
  assert.doesNotMatch(styles, /\.topbar-left \.sidebar-toggle[^{}]*\{[^}]*display:\s*none/);
  assert.match(
    functionSource('bindEvents'),
    /dom\.sidebarToggle\.addEventListener\('click', \(\) => toggleWorkspacePanel\('left', dom\.sidebarToggle\)\)/,
  );
  assert.match(functionSource('toggleWorkspacePanel'), /workspacePanels\[side\]/);
});

test('Primary navigation and accessible secondary workspaces retain their labels and icons', () => {
  const sidebar = html.match(/<aside class="sidebar" id="sidebar"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(sidebar, 'Expected the original sidebar navigation.');
  const options = [
    ['Home', 'home'],
    ['Chats', 'chat'],
    ['VOKKI', 'voki'],
    ['AETHER', 'aether'],
    ['Marketplace', 'marketplace'],
    ['Learning Workspace', 'learning'],
    ['Research', 'research'],
    ['Decision review', 'core'],
    ['Risk &amp; Safety', 'safety'],
    ['Simulation', 'simulator'],
    ['Memory', 'memory'],
    ['Approvals', 'approvals'],
    ['Knowledge', 'knowledge'],
    ['Workflow', 'workflow'],
    ['Agent Studio', 'agents'],
    ['Analytics', 'analytics'],
    ['System Status', 'system'],
    ['Settings', 'settings'],
    ['Customize', 'customize'],
    ['Phone Awareness', 'phone'],
    ['Activity', 'audit'],
  ];
  const entries = [...sidebar.matchAll(/<button class="nav-item[^"]*"([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(entries.length, options.length);

  for (const [index, [label, section]] of options.entries()) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [, attributes, content] = entries[index];
    assert.match(content, new RegExp(`<span>${escapedLabel}</span>`), `Missing sidebar label ${label}`);
    assert.match(attributes, new RegExp(`data-section="${section}"`), `Incorrect destination for ${label}`);
    assert.match(attributes, /\btitle="/, `Missing tooltip for ${label}`);
    assert.match(content, /class="nav-mark nav-icon" aria-hidden="true"><svg/, `Missing icon for ${label}`);
  }

  assert.match(html, /id="new-session-btn"[^>]*aria-label="New Chat"[^>]*title="New Chat"/);
  assert.match(html, /data-customize-category="integrations"/);
  assert.doesNotMatch(sidebar, /data-section="integrations"/);
  assert.match(styles, /body\.sidebar-collapsed \.nav-item > span:not\(\.nav-mark\)/);
  const redesignStyles = styles.slice(styles.indexOf('/* Reference-led PARMAR Home command center */'));
  assert.doesNotMatch(redesignStyles, /\.(?:nav-label|sidebar-section-label|nav-item > span:not\(\.nav-mark\))[^{}]*\{\s*display:\s*none/);
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

  navigate({ dataset: { section: 'voki' } });
  assert.deepEqual(calls.splice(0), ['focus-voki']);
  assert.deepEqual(navigations.pop(), ['voki', 'voki']);

  navigate({ dataset: { section: 'approvals', navKey: 'approvals', homeFocus: 'approval' } });
  assert.deepEqual(calls.splice(0), ['focus-approval']);
  assert.deepEqual(navigations.pop(), ['approvals', 'approvals']);

  assert.match(functionSource('bindEvents'), /dom\.analyzeBtn\.addEventListener\('click', analyzeRequest\)/);
  assert.match(functionSource('analyzeRequest'), /apiRequest\('\/api\/analyze'/);
  assert.match(functionSource('evaluateScenario'), /apiRequest\('\/api\/scenarios\/evaluate'/);
  assert.match(html, /id="section-safety"/);
  assert.match(html, /<strong>Open AETHER<\/strong><small>Check availability<\/small>/);
  assert.match(html, /UNAVAILABLE IN THIS BUILD/);
});

test('Continue and Recent Work use persisted conversations, actual research, and existing audit entries', () => {
  const renderHome = functionSource('renderHome');
  const researchHistoryRecords = functionSource('researchHistoryRecords');
  const renderHistory = functionSource('renderHistory');
  const continueConversation = functionSource('continueConversation');
  const addAuditEntry = functionSource('addAuditEntry');
  const updateState = functionSource('updateState');

  assert.match(renderHome, /state\.sessions\.filter/);
  assert.match(renderHome, /state\.serverConversationIds\.has\(session\.id\)/);
  assert.match(researchHistoryRecords, /message\.analysis\?\.research/);
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

test('proactive VOKKI events originate from accepted chat results, not scenario or phone simulations', () => {
  const publish = functionSource('publishVerifiedVokiEvent');
  const chat = functionSource('submitChatMessage');
  const scenario = functionSource('evaluateScenario');
  const phone = functionSource('runPhoneSimulation');

  assert.match(publish, /PARMARVOKKISpeech\?\.createProactiveEvent\(result\)/);
  assert.match(publish, /parmar-verified-voki-event/);
  assert.match(chat, /publishVerifiedVokiEvent\(result\)/);
  assert.doesNotMatch(scenario, /publishVerifiedVokiEvent|parmar-verified-voki-event/);
  assert.doesNotMatch(phone, /publishVerifiedVokiEvent|parmar-verified-voki-event/);
});

test('Home motion is reduced with the user preference and follows real review state', () => {
  assert.match(styles, /\.home-voki-presence\[data-lifecycle-state="THINKING"\] \.home-voki-halo-inner/);
  assert.match(styles, /\.home-voki-presence\[data-lifecycle-state="WAITING_FOR_HUMAN"\] \.home-voki-halo/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-voki-presence\[data-lifecycle-state="RISK_CHECK"\] \.home-voki-halo-inner\s*\{\s*animation:\s*none;/,
  );
  assert.match(html, /id="settings-reduced-motion"/);
});

test('Home and dedicated VOKKI use the canonical avatar through the shared real lifecycle renderer', () => {
  const avatarSource = fs.readFileSync(path.join(staticDir, 'voki-avatar.js'), 'utf8');
  const premiumStyles = fs.readFileSync(path.join(staticDir, 'premium.css'), 'utf8');
  const appInitialize = functionSource('initialize');
  const setVokiState = functionSource('setVokiState');
  const avatarAsset = fs.readFileSync(path.join(staticDir, 'assets', 'voki', 'Vokki-screen.png'));
  const originalAsset = fs.readFileSync(path.join(staticDir, 'assets', 'voki', 'Vokki.png'));
  const provenance = JSON.parse(fs.readFileSync(
    path.join(staticDir, 'assets', 'voki', 'Vokki-screen.provenance.json'),
    'utf8',
  ));
  const suppliedReference = fs.readFileSync(path.join(__dirname, '..', '..', 'Vokki.png'));
  const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.match(avatarSource, /source: 'provided-reference'/);
  assert.match(avatarSource, /reference: 'Vokki-screen\.png'/);
  assert.match(avatarSource, /sourceAsset: 'Vokki\.png'/);
  assert.match(avatarSource, /asset: '\/static\/assets\/voki\/Vokki-screen\.png'/);
  assert.match(avatarSource, /data-voki-default-image/);
  assert.deepEqual(avatarAsset.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(originalAsset, suppliedReference);
  assert.equal(avatarAsset.readUInt32BE(16), 1097);
  assert.equal(avatarAsset.readUInt32BE(20), 615);
  assert.equal(sha256(avatarAsset), provenance.sha256);
  assert.equal(sha256(originalAsset), provenance.sourceSha256);
  assert.deepEqual(provenance.crop, { x: 125, y: 83, width: 1097, height: 615 });
  assert.equal(provenance.opaque, true);
  assert.equal((html.match(/src="\/static\/assets\/voki\/Vokki-screen\.png"/g) || []).length, 2);
  const homeAvatar = html.match(/<div class="home-voki-presence"[\s\S]*?<\/div>/)?.[0];
  const workspaceAvatar = html.match(/<div class="voki-avatar"[\s\S]*?<\/div>/)?.[0];
  assert.match(homeAvatar || '', /src="\/static\/assets\/voki\/Vokki-screen\.png"/);
  assert.match(workspaceAvatar || '', /src="\/static\/assets\/voki\/Vokki-screen\.png"/);
  const homeComposer = html.match(/<form class="home-chat-composer"[\s\S]*?<\/form>/)?.[0];
  assert.ok(homeComposer);
  assert.doesNotMatch(homeComposer, /<img\b/);
  assert.match(premiumStyles, /\.home-voki-avatar-image\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(premiumStyles, /\.voki-avatar\s*\{\s*width:\s*min\(100%, 620px\);/);
  assert.match(premiumStyles, /body\[data-active-section="voki"\] \.voki-avatar\s*\{\s*width:\s*100%;/);
  assert.match(appInitialize, /state\.homeVokiAvatar = new window\.PARMARVOKKIAvatar\.VOKKIAvatarPresentation/);
  assert.match(setVokiState, /state\.homeVokiAvatar\?\.setLifecycle/);
  assert.match(setVokiState, /dom\.homeVokiStatus\.textContent = presentation\.label/);
  assert.match(html, /id="home-voki-status">STATE UNAVAILABLE<\/small>/);
  for (const lifecycle of ['LISTENING', 'THINKING', 'ANALYZING', 'RISK_CHECK', 'WAITING_FOR_HUMAN', 'RESPONSE_SAFETY', 'RELEASED', 'WITHHELD', 'BLOCKED', 'PROVIDER_FAILED']) {
    assert.match(avatarSource, new RegExp(`\\b${lifecycle}:`));
  }
  assert.match(html, /id="section-chat"/);
  assert.match(html, /id="section-core"/);
});

test('PARMAR logo variants are available at their responsive app entry points', () => {
  const logo = fs.readFileSync(path.join(staticDir, 'assets', 'parmar-logo.png'));
  const emblem = fs.readFileSync(path.join(staticDir, 'assets', 'parmar-emblem.png'));
  const wordmark = fs.readFileSync(path.join(staticDir, 'assets', 'parmar-wordmark.png'));
  const premiumStyles = fs.readFileSync(path.join(staticDir, 'premium.css'), 'utf8');
  assert.deepEqual(logo.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(emblem.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(wordmark.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.match(html, /rel="icon" type="image\/png" href="\/static\/assets\/parmar-emblem\.png"/);
  assert.match(html, /class="sidebar-brand-emblem" src="\/static\/assets\/parmar-emblem\.png"/);
  assert.match(html, /class="sidebar-brand-wordmark" src="\/static\/assets\/parmar-wordmark\.png"/);
  assert.match(html, /class="mobile-brand-emblem" src="\/static\/assets\/parmar-emblem\.png"/);
  assert.match(html, /class="mobile-brand-wordmark" src="\/static\/assets\/parmar-wordmark\.png"/);
  assert.equal((html.match(/src="\/static\/assets\/parmar-wordmark\.png"/g) || []).length, 2);
  assert.doesNotMatch(html, /chat-brand-logo/);
  assert.doesNotMatch(html.match(/<a class="brand-block sidebar-brand"[\s\S]*?<\/a>/)?.[0] || '', /parmar-logo\.png/);
  assert.match(premiumStyles, /\.sidebar-brand-lockup\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;/s);
  assert.match(premiumStyles, /\.sidebar-brand-emblem\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
  assert.match(premiumStyles, /\.sidebar-brand-wordmark\s*\{[^}]*width:\s*min\(100px,/s);
  assert.match(premiumStyles, /\.mobile-brand-emblem\s*\{[^}]*width:\s*25px;[^}]*height:\s*25px;/s);
  assert.match(premiumStyles, /body\.sidebar-collapsed \.sidebar-brand-wordmark\s*\{\s*display:\s*none;/);
});
