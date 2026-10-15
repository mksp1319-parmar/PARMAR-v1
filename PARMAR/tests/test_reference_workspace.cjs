const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticDir = path.join(__dirname, '..', 'interface', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(staticDir, 'styles.css'), 'utf8');
const premiumStyles = fs.readFileSync(path.join(staticDir, 'premium.css'), 'utf8');

function functionSource(name) {
  const match = app.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

test('primary workspace links use real Chat, Research, approval, and mobile navigation flows', () => {
  assert.match(html, /data-section="research" data-nav-key="research" aria-label="Research"/);
  assert.match(html, /data-section="approvals" data-nav-key="approvals" data-home-focus="approval"/);
  for (const section of ['home', 'chat', 'voki']) {
    assert.match(html, new RegExp(`class="nav-item mobile-bottom-item"[^>]*data-section="${section}"`));
  }
  assert.match(html, /class="nav-item mobile-bottom-item mobile-bottom-more"[^>]*aria-controls="sidebar"[^>]*>[\s\S]*?<span>More<\/span>/);
  assert.match(app, /dom\.mobileBottomMore\?\.addEventListener\('click', \(\) => dom\.sidebarToggle\?\.click\(\)\)/);
  assert.match(app, /if \(button\.dataset\.navKey\) selectSection\('chat', button\.dataset\.navKey\);\s*else selectSection\('chat'\)/);
  assert.match(app, /button\.dataset\.homeFocus === 'approval'/);
});

test('Approvals and System Status render their own real workspace state', () => {
  assert.match(html, /data-section="approvals" id="section-approvals"[\s\S]*?id="approval-box"/);
  assert.match(html, /id="section-system"[\s\S]*?id="system-lifecycle-value"[\s\S]*?id="system-aether-value"/);
  assert.match(app, /function renderSystemOverview\(\)[\s\S]*?dom\.aetherDesktopStatus\?\.textContent/);
});

test('Safety review explains missing evidence and never invents a low-risk result', () => {
  assert.match(app, /function renderReviewEmptyState\(container, message\)/);
  assert.match(app, /No risk assessment is available until a request is reviewed\./);
  assert.match(app, /Risk details were not reported for this result\./);
  assert.doesNotMatch(app, /risk\.risk_level \|\| 'LOW'/);
  assert.match(premiumStyles, /\.review-empty-state\s*\{/);
});

test('Safety review displays honest empty and partially reported result states', () => {
  const riskCenterEl = new TestElement('div');
  const explanationList = new TestElement('ul');
  const context = vm.createContext({
    document: { createElement: (tagName) => new TestElement(tagName) },
    dom: { riskCenterEl, explanationList },
  });
  vm.runInContext([
    functionSource('renderReviewEmptyState'),
    functionSource('renderRiskCenter'),
    functionSource('renderExplainability'),
  ].join('\n'), context);

  context.renderRiskCenter({ analysis: {} });
  context.renderExplainability({ analysis: {} });
  assert.equal(riskCenterEl.children[0].textContent, 'Risk details were not reported for this result.');
  assert.equal(explanationList.children[0].textContent, 'No decision context was reported for this result.');

  context.renderRiskCenter({ analysis: { risk: { risk_level: 'MEDIUM' } } });
  assert.deepEqual(
    riskCenterEl.children.map((card) => card.children[1].textContent),
    ['MEDIUM', 'Not reported', 'Not reported', 'Not reported'],
  );
});

test('VOKKI immersive layout is desktop-only so mobile navigation remains available', () => {
  assert.match(styles, /@media \(min-width: 761px\) \{\s*body\[data-active-section="voki"\]/);
});

test('Research shows only stored conversation results and launches the real Chat research flow', () => {
  assert.match(html, /id="section-research"[\s\S]*?id="research-history-filter"[\s\S]*?id="research-history-list"/);
  assert.match(html, /data-action="research-chat">Research in Chat/);
  assert.match(app, /function researchHistoryRecords\(\)[\s\S]*?message\.analysis\?\.research/);
  assert.match(app, /window\.PARMARChatPresentation\?\.renderResearchResult\(sources, record\.message\.analysis\)/);
  assert.match(app, /dom\.researchHistoryFilter\?\.addEventListener\('input', renderResearchWorkspace\)/);
  assert.match(app, /continueConversation\(record\.sessionId\)/);
  assert.match(html, /No search runs until you request it in Chat\./);
});

test('Chat presents persisted conversations in a searchable workspace pane', () => {
  assert.match(html, /<aside class="chat-history-panel" aria-label="Conversations">/);
  assert.match(html, /id="chat-history-filter"/);
  assert.match(html, /id="chat-history-list"/);
  assert.match(app, /chatHistoryList: document\.getElementById\('chat-history-list'\)/);
  assert.match(app, /chatHistoryFilter: document\.getElementById\('chat-history-filter'\)/);
  assert.match(app, /function syncChatHistoryList\(\)/);
  assert.match(app, /dom\.chatHistoryList\?\.addEventListener\('click'/);
  assert.match(app, /continueConversation\(button\.dataset\.sessionId\)/);
  assert.match(app, /state\.historyQuery = dom\.chatHistoryFilter\.value/);
  assert.match(app, /\.text-button\[data-action\]/);
});

test('reference surfaces retain VOKKI’s canonical local portrait in Home and VOKKI', () => {
  assert.equal((html.match(/data-voki-default-image src="\/static\/assets\/voki\/default-avatar\.png"/g) || []).length, 2);
  assert.match(html, /data-voki-home-avatar/);
  assert.match(html, /data-voki-avatar-host/);
  assert.match(styles, /\.home-voki-avatar-image/);
  assert.match(styles, /\.voki-presence-stage/);
});

test('shared styling covers Home, Chat, VOKKI, memory, browser, settings, and mobile', () => {
  for (const selector of [
    '.home-hero',
    '.conversation-surface',
    '.voki-interface-surface',
    '.memory-preferences',
    '.aether-workspace',
    '.settings-grid',
  ]) {
    assert.ok(styles.includes(selector), `Expected reference styles for ${selector}`);
  }
  assert.match(styles, /\.home-action-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.conversation-surface\s*\{[\s\S]*?grid-template-columns:\s*minmax\(190px,\s*0\.27fr\)\s+minmax\(0,\s*0\.73fr\)/);
  assert.match(styles, /\.memory-preferences strong,[\s\S]*?\.memory-composer > label\s*\{\s*color:\s*var\(--type-primary\);/);
  assert.match(styles, /\.memory-preferences p,[\s\S]*?\.memory-empty p\s*\{\s*color:\s*var\(--type-secondary\);/);
  assert.match(styles, /\.mobile-bottom-nav\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.mobile-bottom-nav\s*\{[\s\S]*?display:\s*grid/);
});
