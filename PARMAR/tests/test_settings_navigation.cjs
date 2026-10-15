const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticDir = path.join(__dirname, '..', 'interface', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(staticDir, 'styles.css'), 'utf8');

const categories = [
  'account',
  'personalization',
  'appearance',
  'language',
  'general',
  'notifications',
  'voice',
  'memory',
  'privacy',
  'safety',
  'integrations',
  'models',
  'research',
  'storage',
  'shortcuts',
  'help',
  'about',
  'advanced',
];

const categoryPanels = {
  account: ['account'],
  personalization: ['personalization'],
  appearance: ['appearance'],
  language: ['language'],
  general: ['general'],
  notifications: ['notifications'],
  voice: ['voice'],
  memory: ['memory'],
  privacy: ['security', 'history', 'privacy', 'ads'],
  safety: ['safety'],
  integrations: ['tools', 'remote-control'],
  models: ['providers'],
  research: ['workspace'],
  storage: ['storage'],
  shortcuts: ['shortcuts'],
  help: ['help'],
  about: ['about'],
  advanced: ['devices', 'diagnostics'],
};

function functionSource(name, nextName) {
  const declaration = new RegExp(`(?:async )?function ${name}\\(`).exec(app);
  const start = declaration?.index ?? -1;
  assert.notEqual(start, -1, `Missing function ${name}`);
  const followingDeclaration = new RegExp(`(?:async )?function ${nextName}\\(`).exec(app.slice(start + declaration[0].length));
  assert.ok(followingDeclaration, `Missing following function ${nextName}`);
  const end = start + declaration[0].length + followingDeclaration.index;
  return app.slice(start, end).trim();
}

function settingsMarkup() {
  const tabs = Array.from(html.matchAll(
    /<button class="settings-category(?: active)?" id="([^"]+)"[^>]*aria-controls="([^"]+)"[^>]*data-settings-category="([^"]+)"/g,
  ), (match) => ({
    id: match[1],
    panelIds: match[2].split(/\s+/),
    category: match[3],
    attributes: match[0],
  }  ));
  const panels = Array.from(html.matchAll(
    /<section class="settings-panel" id="([^"]+)"([^>]*)>/g,
  ), (match) => ({
    id: match[1],
    category: /data-settings-panel="([^"]+)"/.exec(match[2])?.[1],
    group: /data-settings-group="([^"]+)"/.exec(match[2])?.[1],
    searchTerms: /data-settings-search-terms="([^"]*)"/.exec(match[2])?.[1] || '',
    attributes: match[2],
    hidden: match[2].includes(' hidden'),
  }));
  return { tabs, panels };
}

test('Settings categories map to dedicated detail-page panels accessibly', () => {
  const { tabs, panels } = settingsMarkup();

  assert.deepEqual(tabs.map((tab) => tab.category), categories);
  assert.equal(panels.length, 23);
  assert.equal(new Set(tabs.map((tab) => tab.id)).size, categories.length);
  assert.equal(new Set(panels.map((panel) => panel.id)).size, panels.length);

  for (const tab of tabs) {
    const groupedPanels = panels.filter((panel) => panel.group === tab.category);
    assert.deepEqual(groupedPanels.map((panel) => panel.category).sort(), [...categoryPanels[tab.category]].sort());
    assert.deepEqual(tab.panelIds.sort(), categoryPanels[tab.category].map((id) => `settings-panel-${id}`).sort());
    assert.ok(groupedPanels.length, `Missing panels for ${tab.category}`);
    assert.doesNotMatch(tab.attributes, /settings-category-index|aria-selected|tabindex/);
    assert.match(
      html,
      new RegExp(`id="${tab.id}"[^>]*data-settings-description="[^"]+"`),
    );
  }
  assert.ok(panels.every((panel) => panel.hidden));
  const categoryMarkup = html.match(/<nav class="settings-category-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((categoryMarkup.match(/class="settings-category-icon"[^>]*><svg /g) || []).length, categories.length);
  assert.match(html, /id="settings-home-view"/);
  assert.match(html, /id="settings-detail-view"[^>]*hidden/);
  assert.match(html, /id="settings-back-button"[^>]*aria-label="Back to Settings" title="Back to Settings"/);
  assert.match(html, /id="settings-page-title" tabindex="-1"/);
  assert.match(html, /<nav class="settings-category-nav" aria-label="Settings categories">/);
  assert.doesNotMatch(categoryMarkup, />\s*\d{1,2}\s*</);
  for (const label of ['Appearance', 'Language', 'AI &amp; Models', 'Research', 'Keyboard Shortcuts', 'Help', 'About PARMAR']) {
    assert.ok(html.includes(`<span>${label}</span>`), `Missing category ${label}`);
  }
  assert.match(html, /id="settings-enter-to-send"/);
  assert.match(html, /id="settings-reset-local-preferences"/);
  assert.match(html, /id="settings-memory-state"/);
  assert.match(html, /id="settings-memory-count"/);
  assert.equal((html.match(/<li><span>[^<]+<\/span><span>[\s\S]*?<\/span><\/li>/g) || []).length >= 6, true);
});

test('category routes support direct loading, browser back/forward, and arrow-only back navigation', () => {
  const { tabs, panels } = settingsMarkup();
  let routeEntries = [{ state: { parmarSection: 'chat' }, url: 'https://parmar.test/?section=chat' }];
  let routeIndex = 0;
  const routeHistory = {
    get state() { return routeEntries[routeIndex].state; },
    pushState(state, _title, url) {
      routeEntries = routeEntries.slice(0, routeIndex + 1);
      routeEntries.push({ state, url: String(url) });
      routeIndex += 1;
    },
    replaceState(state, _title, url) {
      routeEntries[routeIndex] = { state, url: String(url) };
    },
    back() { routeIndex -= 1; },
    forward() { routeIndex += 1; },
  };
  const window = {
    history: routeHistory,
    scrollY: 120,
    scrollTo() {},
    location: {},
  };
  Object.defineProperty(window.location, 'href', {
    get() { return routeEntries[routeIndex].url; },
  });
  const categoryButtons = tabs.map((tab) => ({
    dataset: { settingsCategory: tab.category, settingsDescription: `Description for ${tab.category}` },
    textContent: tab.category,
    lastElementChild: { textContent: tab.category },
    querySelector() { return null; },
    setAttribute() {},
    classList: { toggle() {} },
    focus() {},
  }));
  const settingsPanels = panels.map((panel) => ({
    id: panel.id,
    dataset: { settingsPanel: panel.category, settingsGroup: panel.group },
    hidden: true,
  }));
  const dom = {
    settingsCategoryButtons: categoryButtons,
    settingsPanels,
    settingsHomeView: { hidden: false, focus() {} },
    settingsDetailView: { hidden: true },
    settingsPageTitle: { textContent: '', focus() {} },
    settingsPageDescription: { textContent: '' },
    settingsSearch: { focus() {} },
  };
  const runtime = {
    URL,
    window,
    dom,
    document: { body: { dataset: { activeSection: 'chat' } } },
    SETTINGS_CATEGORY_IDS: new Set(categories),
    WORKSPACE_SECTION_IDS: new Set(['home', 'chat', 'settings']),
    currentSettingsCategory: null,
    settingsHomeScrollPosition: 0,
    motionIsReduced: () => true,
  };
  runtime.selectSection = (section) => { runtime.document.body.dataset.activeSection = section; };
  vm.runInNewContext([
    functionSource('activateSettingsCategory', 'writeSettingsHistory'),
    functionSource('writeSettingsHistory', 'showSettingsHome'),
    functionSource('showSettingsHome', 'navigateSettingsCategory'),
    functionSource('workspaceScrollElement', 'workspaceScrollTop'),
    functionSource('workspaceScrollTop', 'scrollWorkspaceTo'),
    functionSource('scrollWorkspaceTo', 'selectSection'),
    functionSource('navigateSettingsCategory', 'openSettingsHome'),
    functionSource('restoreSettingsRoute', 'handleSettingsCategoryKeydown'),
  ].join('\n'), runtime);

  runtime.writeSettingsHistory(null);
  assert.match(window.location.href, /settings=home/);
  assert.equal(runtime.navigateSettingsCategory(categoryButtons[0]), true);
  assert.match(window.location.href, /settings=account/);
  assert.equal(dom.settingsHomeView.hidden, true);
  assert.equal(dom.settingsDetailView.hidden, false);
  assert.equal(dom.settingsPageTitle.textContent, 'account');
  assert.ok(settingsPanels.find((panel) => panel.id === 'settings-panel-account').hidden === false);

  routeHistory.back();
  runtime.restoreSettingsRoute({ state: routeHistory.state });
  assert.equal(dom.settingsHomeView.hidden, false);
  assert.equal(dom.settingsDetailView.hidden, true);
  routeHistory.forward();
  runtime.restoreSettingsRoute({ state: routeHistory.state });
  assert.equal(dom.settingsHomeView.hidden, true);
  assert.equal(dom.settingsDetailView.hidden, false);
  const historyLength = routeEntries.length;
  runtime.writeSettingsHistory('account');
  assert.equal(routeEntries.length, historyLength, 'Repeated route updates should not add duplicate history entries');

  routeEntries = [{ state: null, url: 'https://parmar.test/?settings=language' }];
  routeIndex = 0;
  runtime.restoreSettingsRoute(null);
  assert.equal(dom.settingsPageTitle.textContent, 'language');
  assert.equal(routeHistory.state.parmarSettingsFromHome, false);
  assert.match(html, /id="settings-back-button"[^>]*aria-label="Back to Settings"[^>]*title="Back to Settings"[^>]*>\s*<svg/);
  assert.doesNotMatch(html.match(/id="settings-back-button"[\s\S]*?<\/button>/)?.[0] || '', />\s*Back to Settings\s*</);
});

test('Settings search indexes the requested destinations and normalizes multiword queries', () => {
  const { panels } = settingsMarkup();
  const runtime = {};
  vm.runInNewContext(functionSource('settingsSearchMatches', 'settingsSearchEntries'), runtime);

  for (const [query, expectedGroup] of [
    ['language', 'language'],
    ['dark mode', 'appearance'],
    ['microphone', 'voice'],
    ['memory', 'memory'],
    ['notifications', 'notifications'],
    ['logout', 'account'],
    ['web search', 'research'],
    ['keyboard shortcuts', 'shortcuts'],
    ['enter to send', 'general'],
    ['restore preference defaults', 'storage'],
  ]) {
    const matched = panels.some((panel) => (
      panel.group === expectedGroup
      && runtime.settingsSearchMatches(
        query,
        `${panel.category} ${panel.group} ${panel.searchTerms}`,
      )
    ));
    assert.equal(matched, true, `Expected "${query}" to find ${expectedGroup}`);
  }
  assert.equal(runtime.settingsSearchMatches('', 'language'), false);
  assert.equal(runtime.settingsSearchMatches('memory account', 'saved memory'), false);
  assert.match(html, /id="settings-search"[^>]*aria-controls="settings-search-results"[^>]*aria-describedby="settings-search-status"/);
  assert.match(html, /id="settings-search-status" aria-live="polite"/);
  assert.match(html, /id="settings-save-status" role="status" aria-live="polite"/);
  assert.match(app, /window\.addEventListener\('popstate', restoreSettingsRoute\)/);
  assert.match(app, /function navigateSettingsCategory\(button/);
  assert.match(app, /function restoreSettingsRoute\(event\)/);
  assert.match(app, /dom\.settingsSearch\?\.addEventListener\('input', \(\) => renderSettingsSearch\(dom\.settingsSearch\.value\)\)/);
  assert.match(app, /settingsSearchEntries\(normalizedQuery\)\s*\.filter/);
  assert.match(app, /function focusSettingsSearchTarget\(result\)/);
  assert.match(app, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /id="settings-logout-btn" type="button" hidden>Logout<\/button>/);
  assert.match(html, /id="settings-open-research" type="button" data-action="research-chat"/);
  assert.match(app, /dom\.settingsLogoutBtn\?\.addEventListener\('click', \(\) => dom\.logoutBtn\?\.click\(\)\)/);
  assert.match(app, /dom\.settingsLogoutBtn\.hidden = !authenticated/);
  assert.match(styles, /\.settings-danger-button\s*\{[\s\S]*?font-weight: 700/);
  assert.match(app, /settings-workspace-link\[data-action\]/);
});

test('logout and web-search results focus only their existing actions', () => {
  const { tabs, panels } = settingsMarkup();
  const categoryLabels = {
    account: 'Account',
    personalization: 'Personalisation',
    appearance: 'Appearance',
    language: 'Language',
    general: 'General',
    notifications: 'Notifications',
    voice: 'Voice & VOKKI',
    memory: 'Memory',
    privacy: 'Privacy & Security',
    safety: 'AI Behaviour & Safety',
    integrations: 'Integrations',
    models: 'AI & Models',
    research: 'Research',
    storage: 'Storage & Offline',
    shortcuts: 'Keyboard Shortcuts',
    help: 'Help',
    about: 'About PARMAR',
    advanced: 'Advanced Settings',
    general: 'General',
  };
  const categoryButtons = tabs.map((tab) => ({
    dataset: { settingsCategory: tab.category },
    textContent: categoryLabels[tab.category],
  }));
  const settingsPanels = panels.map((panel) => {
    const markup = html.match(new RegExp(`<section class="settings-panel" id="${panel.id}"[\\s\\S]*?<\\/section>`))?.[0] || '';
    const heading = /<h2>(.*?)<\/h2>/.exec(markup)?.[1] || '';
    const description = /<div class="settings-panel-heading">[\s\S]*?<p>(.*?)<\/p>/.exec(markup)?.[1] || '';
    const controlId = /<(?:input|select|textarea)[^>]*id="([^"]+)"/.exec(markup)?.[1] || '';
    return {
      id: panel.id,
      dataset: {
        settingsPanel: panel.category,
        settingsGroup: panel.group,
        settingsSearchTerms: panel.searchTerms,
      },
      textContent: markup.replace(/<[^>]+>/g, ' '),
      querySelector(selector) {
        if (selector === 'h2') return { textContent: heading };
        if (selector === '.settings-panel-heading p') return { textContent: description };
        if (selector.startsWith('input')) return controlId ? { id: controlId } : null;
        return null;
      },
    };
  });
  const runtime = { dom: { settingsCategoryButtons: categoryButtons, settingsPanels } };
  vm.runInNewContext(
    `${functionSource('settingsSearchMatches', 'settingsSearchEntries')}\n${functionSource('settingsSearchEntries', 'renderSettingsSearch')}`,
    runtime,
  );

  const entries = runtime.settingsSearchEntries('logout')
    .filter((entry) => runtime.settingsSearchMatches('logout', entry.searchableText));
  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => entry.group === 'account' && entry.targetId === 'settings-logout-btn'));
  const memory = runtime.settingsSearchEntries('memory').find((entry) => entry.group === 'memory');
  assert.equal(memory.targetId, 'settings-open-memory');
  const voice = runtime.settingsSearchEntries('microphone').find((entry) => entry.group === 'voice');
  assert.equal(voice.targetId, 'settings-open-voki-voice');
  const webSearch = runtime.settingsSearchEntries('web search')
    .find((entry) => entry.panelId === 'settings-panel-workspace');
  assert.equal(webSearch.targetId, 'settings-open-research');
  const resetPreferences = runtime.settingsSearchEntries('restore preference defaults')
    .find((entry) => entry.group === 'storage');
  assert.equal(resetPreferences.targetId, 'settings-reset-local-preferences');
  const enterToSend = runtime.settingsSearchEntries('enter to send')
    .find((entry) => entry.group === 'general');
  assert.equal(enterToSend.targetId, 'settings-enter-to-send');
  const responseLength = runtime.settingsSearchEntries('response length')
    .find((entry) => entry.group === 'personalization');
  assert.equal(responseLength.targetId, 'settings-response-length');
  assert.match(html, /id="settings-response-length"/);
  assert.match(html, /id="settings-response-style"/);
  assert.match(html, /id="settings-custom-instructions"/);
  assert.match(app, /response_length: state\.settings\.responseLength/);
  assert.match(app, /response_style: state\.settings\.responseStyle/);
  assert.match(app, /custom_instructions: state\.settings\.customInstructions/);
  for (const unsupportedQuery of [
    'password',
    'two-factor',
    'email notifications',
    'ad tracking',
    'font size',
    'contrast',
  ]) {
    const unsupportedEntries = runtime.settingsSearchEntries(unsupportedQuery)
      .filter((entry) => runtime.settingsSearchMatches(unsupportedQuery, entry.searchableText));
    assert.equal(unsupportedEntries.length, 0, `Unsupported control "${unsupportedQuery}" must not be searchable`);
  }
});

test('personalisation values are validated from browser storage and sent on chat requests', () => {
  const runtime = {
    STORAGE_KEYS: { settings: 'parmar-settings-v1' },
    PROVIDER_IDS: new Set(['local-demo', 'openai', 'gemini', 'claude', 'http-json']),
    defaultSettings: { language: 'en', responseLength: 'balanced', responseStyle: 'normal', customInstructions: '' },
    readJson: () => ({
      responseLength: 'detailed',
      responseStyle: 'structured',
      customInstructions: 'Use concise headings.',
    }),
    sanitizeSensitiveText: (value) => value,
  };
  vm.runInNewContext(functionSource('loadSettings', 'loadMemories'), runtime);

  const settings = runtime.loadSettings();
  assert.equal(settings.responseLength, 'detailed');
  assert.equal(settings.responseStyle, 'structured');
  assert.equal(settings.customInstructions, 'Use concise headings.');

  for (const responseStyle of [
    'normal',
    'explanatory',
    'structured',
    'step_by_step',
    'educational',
    'professional',
    'conversational',
  ]) {
    runtime.readJson = () => ({ responseStyle });
    assert.equal(runtime.loadSettings().responseStyle, responseStyle);
    assert.match(html, new RegExp(`<option value="${responseStyle}">`));
  }

  runtime.readJson = () => ({ responseLength: 'unbounded', responseStyle: [], customInstructions: 42 });
  const invalidSettings = runtime.loadSettings();
  assert.equal(invalidSettings.responseLength, 'balanced');
  assert.equal(invalidSettings.responseStyle, 'normal');
  assert.equal(invalidSettings.customInstructions, '');
  assert.match(app, /response_length: state\.settings\.responseLength/);
  assert.match(app, /response_style: state\.settings\.responseStyle/);
  assert.match(app, /custom_instructions: state\.settings\.customInstructions/);
  assert.match(html, /id="settings-personalization-preview" aria-live="polite"/);
  assert.match(app, /renderPersonalizationPreview\(settings\)/);
  assert.match(app, /dom\.settingsPersonalizationPreview\.textContent/);
});

test('personalisation preview summarizes selected preferences as text, not generated output', () => {
  const preview = { textContent: '' };
  const runtime = { dom: { settingsPersonalizationPreview: preview } };
  vm.runInNewContext(
    functionSource('renderPersonalizationPreview', 'motionIsReduced'),
    runtime,
  );

  runtime.renderPersonalizationPreview({
    responseLength: 'detailed',
    responseStyle: 'step_by_step',
    customInstructions: 'Use <brief> examples.',
  });
  assert.equal(
    preview.textContent,
    'Detailed · Step-by-step. Custom guidance: Use <brief> examples.',
  );

  runtime.renderPersonalizationPreview({
    responseLength: 'balanced',
    responseStyle: 'conversational',
    customInstructions: '',
  });
  assert.equal(preview.textContent, 'Balanced · Conversational. No custom instructions.');
  assert.match(html, /not generated response text or a guarantee of model behavior/);
  assert.match(html, /Resets only theme, request language, response length and style, custom response instructions, animation intensity, reduced motion, and Enter-to-send/);
});

test('provider Settings report server configuration without claiming reachability', async () => {
  const createElement = (tagName) => ({
    tagName,
    className: '',
    textContent: '',
    children: [],
    append(...children) { this.children.push(...children); },
  });
  const providerList = {
    children: [],
    attributes: {},
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const refreshButton = { disabled: false };
  const runtime = {
    dom: {
      settingsProviderRoute: { textContent: '' },
      settingsProviderReadiness: { textContent: '' },
      settingsProviderCapabilities: { textContent: '' },
      settingsProviderList: providerList,
      settingsProviderRefresh: refreshButton,
    },
    document: { createElement },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        default_provider: 'openai',
        reachability: 'NOT_CHECKED',
        providers: [{
          id: 'openai',
          model_id: 'gpt-example-model',
          readiness: 'READY_FOR_TESTING',
          configuration_status: 'CONFIGURED',
          authorization_status: 'AUTHORIZED',
          capabilities: ['text_generation'],
          input_modalities: ['text'],
          output_modalities: ['text'],
          credential_configured: true,
        }, {
          id: 'claude',
          model_id: 'configured',
          readiness: 'NOT_CONFIGURED',
          configuration_status: 'NOT_CONFIGURED',
          authorization_status: 'NOT_AUTHORIZED',
          capabilities: [],
        }],
      }),
    }),
  };
  vm.runInNewContext([
    functionSource('loadProviderReadiness', 'renderProviderInventory'),
    functionSource('renderProviderInventory', 'initialize'),
  ].join('\n'), runtime);
  await runtime.loadProviderReadiness();
  assert.equal(runtime.dom.settingsProviderRoute.textContent, 'OPENAI');
  assert.match(runtime.dom.settingsProviderReadiness.textContent, /Reachability: NOT_CHECKED/);
  assert.match(runtime.dom.settingsProviderCapabilities.textContent, /text_generation/);
  assert.match(providerList.children[0].children.map((node) => node.textContent).join(' '), /gpt-example-model/);
  assert.match(providerList.children[0].children[0].children[0].textContent, /server-selected route/);
  const unconfiguredProviderText = providerList.children[1].children
    .map((node) => `${node.textContent} ${(node.children || []).map((child) => child.textContent).join(' ')}`)
    .join(' ');
  assert.match(unconfiguredProviderText, /NOT_CONFIGURED/);
  assert.match(unconfiguredProviderText, /model ID withheld by server/);
  assert.doesNotMatch(JSON.stringify(providerList), /credential_configured|api.?key|token/i);
  assert.equal(providerList.attributes['aria-busy'], 'false');
  assert.equal(refreshButton.disabled, false);

  let requestCount = 0;
  runtime.fetch = async () => {
    requestCount += 1;
    throw new Error('offline');
  };
  await runtime.loadProviderReadiness();
  assert.equal(requestCount, 1);
  assert.equal(runtime.dom.settingsProviderRoute.textContent, 'Unavailable');
  assert.match(runtime.dom.settingsProviderReadiness.textContent, /No readiness or connectivity was assumed/);
  assert.equal(providerList.children.length, 0);
  assert.equal(refreshButton.disabled, false);
});

test('saved-memory search filters only the currently loaded records', () => {
  const runtime = {};
  vm.runInNewContext(functionSource('filterSavedMemories', 'renderMemories'), runtime);
  const memories = [
    { id: 'one', text: 'Prefers concise summaries' },
    { id: 'two', text: 'Uses Python for analysis' },
  ];
  assert.deepEqual(
    Array.from(runtime.filterSavedMemories(memories, '  PYTHON '), (memory) => memory.id),
    ['two'],
  );
  assert.equal(runtime.filterSavedMemories(memories, '').length, 2);
  assert.match(html, /id="memory-search-input" type="search" aria-controls="memory-list"/);
  assert.match(html, /only loaded saved memories|currently loaded saved memories/i);
  assert.match(app, /dom\.memorySearch\?\.addEventListener\('input'/);
  assert.match(app, /state\.memoryQuery = dom\.memorySearch\.value/);
});

test('Chat Enter submission honors the validated browser preference', () => {
  const runtime = { state: { settings: { enterToSend: true } } };
  vm.runInNewContext(functionSource('chatEnterSends', 'initialize'), runtime);
  const event = (options = {}) => ({
    key: 'Enter',
    ...options,
  });

  assert.equal(runtime.chatEnterSends(event()), true);
  runtime.state.settings.enterToSend = false;
  assert.equal(runtime.chatEnterSends(event()), false);
  assert.equal(runtime.chatEnterSends(event({ ctrlKey: true })), true);
  assert.equal(runtime.chatEnterSends(event({ metaKey: true })), true);
  assert.match(
    app,
    /event\.key === 'Enter' && !event\.shiftKey && !event\.isComposing\s*&& chatEnterSends\(event\)/,
  );
});

test('Enter-to-send setting validates persisted values and defaults to the existing behavior', () => {
  const defaults = {
    language: 'en',
    theme: 'midnight',
    animationIntensity: 'normal',
    reducedMotion: false,
    enterToSend: true,
    phonePermission: true,
    provider: 'local-demo',
    memoryEnabled: false,
  };
  let stored = {};
  const runtime = {
    defaultSettings: defaults,
    STORAGE_KEYS: { settings: 'parmar-settings-v1' },
    PROVIDER_IDS: new Set(['local-demo']),
    readJson: () => stored,
  };
  vm.runInNewContext(functionSource('loadSettings', 'loadMemories'), runtime);

  assert.equal(runtime.loadSettings().enterToSend, true);
  stored = { enterToSend: false };
  assert.equal(runtime.loadSettings().enterToSend, false);
  stored = { enterToSend: 'false' };
  assert.equal(runtime.loadSettings().enterToSend, true);
});

test('restoring browser preference defaults confirms, persists, and preserves non-preference state', () => {
  let confirmed = false;
  let storageFails = true;
  let savedSettings = null;
  const state = {
    settings: {
      language: 'hi',
      theme: 'aurora',
      animationIntensity: 'reduced',
      reducedMotion: true,
      enterToSend: false,
      phonePermission: false,
      provider: 'openai',
      memoryEnabled: true,
    },
  };
  const previous = { ...state.settings };
  const defaults = {
    language: 'en',
    theme: 'midnight',
    animationIntensity: 'normal',
    reducedMotion: false,
    enterToSend: true,
  };
  const status = { hidden: true, textContent: '', dataset: {} };
  const runtime = {
    defaultSettings: defaults,
    state,
    window: { confirm: () => confirmed },
    localStorage: {
      setItem(_key, value) {
        if (storageFails) throw new Error('Storage unavailable');
        savedSettings = JSON.parse(value);
      },
    },
    STORAGE_KEYS: { settings: 'parmar-settings-v1' },
    dom: { settingsSaveStatus: status },
    applySettings() {},
  };
  vm.runInNewContext([
    functionSource('resetLocalPreferences', 'persistSettings'),
    functionSource('persistSettings', 'setRequestPending'),
  ].join('\n'), runtime);

  assert.equal(runtime.resetLocalPreferences(), false);
  assert.deepEqual({ ...state.settings }, previous);
  confirmed = true;
  assert.equal(runtime.resetLocalPreferences(), false);
  assert.deepEqual({ ...state.settings }, previous);
  assert.equal(status.dataset.status, 'error');
  storageFails = false;
  assert.equal(runtime.resetLocalPreferences(), true);
  assert.deepEqual(
    Object.fromEntries(Object.keys(defaults).map((key) => [key, savedSettings[key]])),
    defaults,
  );
  assert.equal(savedSettings.phonePermission, false);
  assert.equal(savedSettings.provider, 'openai');
  assert.equal(savedSettings.memoryEnabled, true);
  assert.equal(status.dataset.status, 'saved');
});

test('Account Settings disclose the production-authentication prerequisite without implying stored preferences', () => {
  const accountPanel = html.match(
    /<section class="settings-panel" id="settings-panel-account"[\s\S]*?<\/section>/,
  )?.[0] || '';
  assert.match(accountPanel, /Profile, billing, and server-backed personal preferences require a production trusted identity provider/);
  assert.match(accountPanel, /one shared, explicitly unverified identity/);
  assert.doesNotMatch(accountPanel, /name="(?:profile|email|billing|response-style|custom-instructions)"/);
});

test('Memory Settings reflect the real consent, storage, and saved-memory state', () => {
  const runtime = {
    state: {
      authMode: 'authenticated',
      memoryStorage: 'DURABLE_LOCAL',
      memoryConsent: true,
      memories: [{ id: 'owned-note', text: 'A saved note' }],
      settings: { memoryEnabled: false, provider: 'local-demo' },
    },
    dom: {
      settingsMemoryState: { textContent: '' },
      settingsMemoryCount: { textContent: '' },
    },
    document: { getElementById: () => null },
  };
  vm.runInNewContext([
    functionSource('filterSavedMemories', 'renderMemories'),
    functionSource('renderMemories', 'addMemory'),
  ].join('\n'), runtime);
  runtime.renderMemories();
  assert.match(runtime.dom.settingsMemoryState.textContent, /Authenticated server memory; consent enabled/);
  assert.equal(runtime.dom.settingsMemoryCount.textContent, '1 saved memory.');

  runtime.state.memoryStorage = null;
  runtime.renderMemories();
  assert.match(runtime.dom.settingsMemoryState.textContent, /could not be confirmed/);
  assert.match(runtime.dom.settingsMemoryCount.textContent, /unavailable/);

  runtime.state.authMode = 'anonymous';
  runtime.state.settings.memoryEnabled = false;
  runtime.renderMemories();
  assert.match(runtime.dom.settingsMemoryState.textContent, /Local Demo browser memory; consent disabled/);
});

test('Account Settings report the actual authentication state without implying verified identity', () => {
  const runtime = {
    state: {
      authMode: 'checking',
      authenticationState: 'LOCAL_DEMO',
      developmentLoginInProgress: false,
      logoutInProgress: false,
    },
    dom: { settingsAccountState: { textContent: '' } },
  };
  vm.runInNewContext(
    functionSource('renderAuthenticationControls', 'refreshAuthenticationState'),
    runtime,
  );

  runtime.renderAuthenticationControls();
  assert.match(runtime.dom.settingsAccountState.textContent, /Checking/);
  runtime.state.authMode = 'anonymous';
  runtime.renderAuthenticationControls();
  assert.match(runtime.dom.settingsAccountState.textContent, /Anonymous Local Demo/);
  runtime.state.authMode = 'authenticated';
  runtime.state.authenticationState = 'DEVELOPMENT_UNVERIFIED';
  runtime.renderAuthenticationControls();
  assert.match(runtime.dom.settingsAccountState.textContent, /explicitly unverified/);
  runtime.state.authenticationState = 'AUTHENTICATED';
  runtime.renderAuthenticationControls();
  assert.match(runtime.dom.settingsAccountState.textContent, /authenticated server session/);
});

test('Settings search results can be opened and traversed without a pointer', () => {
  const focused = [];
  const results = Array.from({ length: 3 }, (_item, index) => ({
    focus() { focused.push(index); },
    closest() { return this; },
  }));
  const dom = {
    settingsSearch: {
      setAttribute() {},
      focus() { focused.push('search'); },
    },
    settingsSearchResults: {
      hidden: false,
      querySelector() { return results[0]; },
      querySelectorAll() { return results; },
    },
    settingsSearchStatus: { textContent: '' },
  };
  const runtime = { dom };
  vm.runInNewContext(
    `${functionSource('handleSettingsSearchKeydown', 'handleSettingsSearchResultsKeydown')}\n${functionSource('handleSettingsSearchResultsKeydown', 'ensureCurrentSession')}`,
    runtime,
  );

  const inputEvent = { key: 'ArrowDown', prevented: false, preventDefault() { this.prevented = true; } };
  runtime.handleSettingsSearchKeydown(inputEvent);
  assert.equal(inputEvent.prevented, true);
  assert.deepEqual(focused.splice(0), [0]);

  for (const [key, index] of [['ArrowDown', 1], ['Home', 0], ['End', 2]]) {
    const event = {
      key,
      target: results[0],
      prevented: false,
      preventDefault() { this.prevented = true; },
    };
    runtime.handleSettingsSearchResultsKeydown(event);
    assert.equal(event.prevented, true);
    assert.deepEqual(focused.splice(0), [index]);
  }

  const returnToSearch = {
    key: 'ArrowUp',
    target: results[0],
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  runtime.handleSettingsSearchResultsKeydown(returnToSearch);
  assert.equal(returnToSearch.prevented, true);
  assert.deepEqual(focused, ['search']);
});

test('category activation opens only the panels belonging to the selected category', () => {
  const { tabs, panels } = settingsMarkup();
  const categoryButtons = tabs.map((tab) => ({
    dataset: { settingsCategory: tab.category },
    attributes: {},
    active: false,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    classList: {
      toggle(_name, active) {
        categoryButtons[tabs.indexOf(tab)].active = active;
      },
    },
  }));
  const settingsPanels = panels.map((panel) => ({
    dataset: { settingsPanel: panel.category, settingsGroup: panel.group },
    hidden: true,
  }));
  const dom = { settingsCategoryButtons: categoryButtons, settingsPanels };
  const runtime = { dom };
  vm.runInNewContext(functionSource('activateSettingsCategory', 'handleSettingsCategoryKeydown'), runtime);

  for (const [index, tab] of tabs.entries()) {
    assert.equal(runtime.activateSettingsCategory(categoryButtons[index]), true);
    assert.equal(categoryButtons[index].attributes['aria-current'], 'page');
    assert.equal(categoryButtons[index].active, true);
    const groupedPanels = settingsPanels.filter((panel) => panel.dataset.settingsGroup === tab.category);
    assert.ok(groupedPanels.length);
    assert.ok(groupedPanels.every((panel) => !panel.hidden));
    assert.equal(settingsPanels.filter((panel) => !panel.hidden).length, groupedPanels.length);
    assert.equal(categoryButtons.filter((button) => button.attributes['aria-current'] === 'page').length, 1);
  }
});

test('keyboard category navigation moves focus through the complete category list', () => {
  const { tabs } = settingsMarkup();
  const categoryButtons = tabs.map((tab) => ({
    dataset: { settingsCategory: tab.category },
    focus() {
      this.focused = true;
    },
  }));
  const dom = { settingsCategoryButtons: categoryButtons };
  const runtime = { dom };
  vm.runInNewContext(
    functionSource('handleSettingsCategoryKeydown', 'settingsSearchMatches'),
    runtime,
  );

  for (const [key, expectedIndex] of [
    ['ArrowDown', 1],
    ['ArrowRight', 1],
    ['ArrowUp', tabs.length - 1],
    ['ArrowLeft', tabs.length - 1],
    ['Home', 0],
    ['End', tabs.length - 1],
  ]) {
    const event = { key, prevented: false, preventDefault() { this.prevented = true; } };
    runtime.handleSettingsCategoryKeydown(event, categoryButtons[0]);
    assert.equal(event.prevented, true, `${key} should prevent page scrolling`);
    assert.equal(categoryButtons[expectedIndex].focused, true, `${key} should focus its target tab`);
    categoryButtons.forEach((button) => { button.focused = false; });
  }
});

test('category selection and keyboard navigation update the active panel accessibly', () => {
  assert.match(app, /function activateSettingsCategory\(button\)/);
  assert.match(app, /categoryButton\.setAttribute\('aria-current', active \? 'page' : 'false'\)/);
  assert.match(app, /settingsPanel\.hidden = !panels\.includes\(settingsPanel\)/);
  assert.match(app, /function handleSettingsCategoryKeydown\(event, button\)/);
  for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']) {
    assert.ok(app.includes(`event.key === '${key}'`), `Missing ${key} category navigation`);
  }
  assert.match(app, /button\.addEventListener\('click', \(\) => navigateSettingsCategory\(button\)\)/);
  assert.match(app, /button\.addEventListener\('keydown', \(event\) => handleSettingsCategoryKeydown\(event, button\)\)/);
});

test('existing preference controls remain unique and connected to their existing state handlers', () => {
  for (const id of [
    'settings-language',
    'settings-theme',
    'settings-animation',
    'settings-reduced-motion',
    'settings-phone-toggle',
    'settings-provider',
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} should appear once`);
  }
  for (const control of [
    'settingsLanguage',
    'settingsTheme',
    'settingsAnimation',
    'settingsReducedMotion',
    'settingsPhoneToggle',
  ]) {
    assert.match(app, new RegExp(`dom\\.${control}\\.addEventListener\\('change'`));
  }
  assert.match(app, /dom\.settingsProvider\.textContent = settings\.provider/);
  assert.match(app, /settings-workspace-link\[data-section\]/);
});

test('incomplete capabilities are labelled honestly and the category layout adapts to mobile', () => {
  for (const status of ['UNAVAILABLE', 'BROWSER-DEPENDENT', 'SIMULATED ONLY', 'PARTIAL']) {
    assert.ok(html.includes(status), `Expected explicit ${status} status`);
  }
  for (const notice of ['not implemented', 'not connected', 'not configured']) {
    assert.ok(html.toLocaleLowerCase().includes(notice), `Expected an honest ${notice} notice`);
  }
  assert.match(styles, /\.settings-category:focus-visible|:focus-visible\s*\{/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.settings-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.settings-panel\[hidden\]\s*\{\s*display:\s*none;/);
});

test('existing appearance and language settings controls still call the original state and persistence handlers', () => {
  const bindEvents = app.slice(app.indexOf('function bindEvents() {'), app.indexOf('function initialize() {'));
  const controls = [
    ['settingsLanguage', 'language', 'hi'],
    ['settingsTheme', 'theme', 'aurora'],
    ['settingsAnimation', 'animationIntensity', 'reduced'],
  ];
  const dom = {};
  dom.languageSelect = {
    value: '',
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
  };
  for (const [name] of controls) {
    dom[name] = {
      value: '',
      listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
    };
  }
  dom.settingsReducedMotion = {
    checked: false,
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
  };
  dom.settingsEnterToSend = {
    checked: true,
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
  };
  dom.settingsPhoneToggle = {
    checked: false,
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
  };
  const state = { settings: { language: 'en', theme: 'midnight', animationIntensity: 'normal', reducedMotion: false, enterToSend: true } };
  let persisted = 0;
  const permissionUpdates = [];
  const runtime = {
    dom,
    state,
    persistSettings() { persisted += 1; },
    togglePhonePermission(enabled) { permissionUpdates.push(enabled); },
  };
  const settingBindings = [
    'languageSelect',
    'settingsLanguage',
    'settingsTheme',
    'settingsAnimation',
    'settingsReducedMotion',
    'settingsEnterToSend',
    'settingsPhoneToggle',
  ];
  for (const name of settingBindings) {
    const match = bindEvents.match(new RegExp(`if \\(dom\\.${name}\\) \\{[\\s\\S]*?\\n  \\}`));
    assert.ok(match, `Missing binding for ${name}`);
    vm.runInNewContext(match[0], runtime);
  }

  dom.languageSelect.value = 'hi';
  dom.languageSelect.listeners.change();
  assert.equal(state.settings.language, 'hi');
  assert.equal(dom.settingsLanguage.value, 'hi');
  dom.languageSelect.value = 'mix';
  dom.languageSelect.listeners.change();
  assert.equal(state.settings.language, 'mix');
  assert.equal(dom.settingsLanguage.value, 'mix');

  for (const [name, property, value] of controls) {
    dom[name].value = value;
    dom[name].listeners.change();
    assert.equal(state.settings[property], value);
  }
  dom.settingsReducedMotion.checked = true;
  dom.settingsReducedMotion.listeners.change();
  assert.equal(state.settings.reducedMotion, true);
  dom.settingsEnterToSend.checked = false;
  dom.settingsEnterToSend.listeners.change();
  assert.equal(state.settings.enterToSend, false);
  dom.settingsPhoneToggle.checked = true;
  dom.settingsPhoneToggle.listeners.change();
  assert.deepEqual(permissionUpdates, [true]);
  assert.equal(persisted, 7);
});

test('appearance preferences are applied to the workspace DOM on settings restore', () => {
  const dom = {
    parmarCore: null,
    languageSelect: { value: '' },
    settingsLanguage: { value: '' },
    settingsTheme: { value: '' },
    settingsAnimation: { value: '' },
    settingsReducedMotion: { checked: false },
    settingsEnterToSend: { checked: true },
    settingsPhoneToggle: { checked: false },
    phonePermissionToggle: { checked: false },
    memoryEnabledToggle: { checked: false },
    providerStatus: { textContent: '' },
    settingsProvider: { textContent: '' },
  };
  const body = {
    dataset: {},
    classes: {},
    classList: {
      toggle(name, enabled) { body.classes[name] = enabled; },
    },
  };
  const runtime = {
    dom,
    state: {
      settings: {
        language: 'hi',
        theme: 'aurora',
        animationIntensity: 'reduced',
        reducedMotion: true,
        enterToSend: false,
        phonePermission: false,
        memoryEnabled: true,
        provider: 'local-demo',
      },
    },
    document: { body },
    motionIsReduced: () => true,
  };
  vm.runInNewContext(functionSource('applySettings', 'motionIsReduced'), runtime);
  runtime.applySettings();

  assert.deepEqual({ ...body.dataset }, { theme: 'aurora', animation: 'reduced' });
  assert.equal(body.classes['reduced-motion'], true);
  assert.equal(dom.languageSelect.value, 'hi');
  assert.equal(dom.settingsLanguage.value, 'hi');
  assert.equal(dom.settingsTheme.value, 'aurora');
  assert.equal(dom.settingsAnimation.value, 'reduced');
  assert.equal(dom.settingsReducedMotion.checked, true);
  assert.equal(dom.settingsEnterToSend.checked, false);
  assert.equal(dom.settingsPhoneToggle.checked, false);
  assert.equal(dom.phonePermissionToggle.checked, false);
});

test('browser-local preference save failures restore the prior value and never announce success', () => {
  let storedValue = null;
  let shouldFail = true;
  const state = { settings: { theme: 'aurora', language: 'en' } };
  const status = { hidden: true, textContent: '', dataset: {} };
  let applied = 0;
  const runtime = {
    localStorage: {
      setItem(_key, value) {
        if (shouldFail) throw new Error('storage quota exceeded');
        storedValue = value;
      },
    },
    STORAGE_KEYS: { settings: 'parmar-settings-v1' },
    state,
    dom: { settingsSaveStatus: status },
    applySettings() { applied += 1; },
  };
  vm.runInNewContext(functionSource('persistSettings', 'setRequestPending'), runtime);

  state.settings.theme = 'midnight';
  assert.equal(runtime.persistSettings({ theme: 'aurora', language: 'en' }), false);
  assert.equal(state.settings.theme, 'aurora');
  assert.equal(status.dataset.status, 'error');
  assert.match(status.textContent, /previous value was restored/);
  assert.doesNotMatch(status.textContent, /Saved in this browser/);

  shouldFail = false;
  state.settings.theme = 'midnight';
  assert.equal(runtime.persistSettings({ theme: 'aurora', language: 'en' }), true);
  assert.equal(JSON.parse(storedValue).theme, 'midnight');
  assert.equal(status.dataset.status, 'saved');
  assert.match(status.textContent, /Saved in this browser/);
  assert.equal(applied, 2);
});

test('phone-awareness preference uses the existing server endpoint and reflects its result', async () => {
  const dom = {
    phoneBox: { innerHTML: '' },
    phoneStatusLabel: { textContent: '' },
    phonePolicyLabel: { textContent: '' },
  };
  const state = { settings: { phonePermission: true } };
  const requests = [];
  let persisted = 0;
  const status = {
    permission: 'REVOKED',
    current_event: 'NONE',
    policy_decision: 'BLOCKED',
    message: 'Simulated events are disabled.',
  };
  const runtime = {
    dom,
    state,
    persistSettings() { persisted += 1; },
    apiRequest: async (...args) => {
      requests.push(args);
      return { json: async () => ({ status }) };
    },
    console,
  };
  vm.runInNewContext(functionSource('togglePhonePermission', 'runPhoneSimulation'), runtime);
  await runtime.togglePhonePermission(false);

  assert.equal(state.settings.phonePermission, false);
  assert.equal(persisted, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/phone');
  assert.equal(requests[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0][1].body), { action: 'toggle_permission', enabled: false });
  assert.match(dom.phoneBox.innerHTML, /REVOKED/);
  assert.equal(dom.phoneStatusLabel.textContent, 'Permission-gated');
  assert.equal(dom.phonePolicyLabel.textContent, 'Blocked until permission is granted');
});
