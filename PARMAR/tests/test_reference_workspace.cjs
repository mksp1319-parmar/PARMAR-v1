const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staticDir = path.join(__dirname, '..', 'interface', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(staticDir, 'styles.css'), 'utf8');

test('primary workspace links use real Chat, Research, approval, and mobile navigation flows', () => {
  assert.match(html, /data-section="research" data-nav-key="research" aria-label="Research"/);
  assert.match(html, /data-section="core" data-nav-key="approvals" data-home-focus="approval"/);
  for (const section of ['home', 'chat', 'voki']) {
    assert.match(html, new RegExp(`class="nav-item mobile-bottom-item"[^>]*data-section="${section}"`));
  }
  assert.match(html, /class="nav-item mobile-bottom-item mobile-bottom-more"[^>]*aria-controls="sidebar"[^>]*>[\s\S]*?<span>More<\/span>/);
  assert.match(app, /dom\.mobileBottomMore\?\.addEventListener\('click', \(\) => dom\.sidebarToggle\?\.click\(\)\)/);
  assert.match(app, /if \(button\.dataset\.navKey\) selectSection\('chat', button\.dataset\.navKey\);\s*else selectSection\('chat'\)/);
  assert.match(app, /button\.dataset\.homeFocus === 'approval'/);
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
