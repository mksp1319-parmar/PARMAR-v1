const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'interface', 'static', 'app.js');
const stylesPath = path.join(__dirname, '..', 'interface', 'static', 'styles.css');
const appSource = fs.readFileSync(appPath, 'utf8');
const stylesSource = fs.readFileSync(stylesPath, 'utf8');

function functionSource(name) {
  const match = appSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

test('desktop discovery controls open and close the panel instead of focusing an unavailable drawer', () => {
  assert.match(appSource, /dom\.discoveryToggle\?\.addEventListener\('click', \(\) => \{\s*toggleWorkspacePanel\('right', dom\.discoveryToggle\);\s*\}\);/);
  assert.match(stylesSource, /body\[data-right-panel-state="closing"\]\s+\.discovery-panel\s*\{\s*display:\s*flex;[\s\S]*?pointer-events:\s*none;/);
});

const context = vm.createContext({});
vm.runInContext(`
  const PANEL_DIRECTION_LOCK = 10;
  ${functionSource('panelGestureAxis')}
  ${functionSource('panelOpenFraction')}
  ${functionSource('shouldOpenPanelAfterGesture')}
  globalThis.panelGestureAxis = panelGestureAxis;
  globalThis.panelOpenFraction = panelOpenFraction;
  globalThis.shouldOpenPanelAfterGesture = shouldOpenPanelAfterGesture;
`, context);

test('panel gesture direction locks horizontally and rejects vertical scrolling', () => {
  assert.equal(context.panelGestureAxis(4, 5), 'pending');
  assert.equal(context.panelGestureAxis(13, 3), 'horizontal');
  assert.equal(context.panelGestureAxis(3, 14), 'vertical');
});

test('left and right panel progress follow their physical swipe directions', () => {
  assert.equal(context.panelOpenFraction('left', false, 40, 100), 0.4);
  assert.equal(context.panelOpenFraction('right', false, -40, 100), 0.4);
  assert.equal(context.panelOpenFraction('left', true, -40, 100), 0.6);
  assert.equal(context.panelOpenFraction('right', true, 40, 100), 0.6);
});

test('panel release uses displacement and directional velocity without accidental flicks', () => {
  assert.equal(context.shouldOpenPanelAfterGesture(0.5, 0, 80), true);
  assert.equal(context.shouldOpenPanelAfterGesture(0.47, 0, 80), false);
  assert.equal(context.shouldOpenPanelAfterGesture(0.12, 0.7, 30), true);
  assert.equal(context.shouldOpenPanelAfterGesture(0.88, -0.7, -30), false);
  assert.equal(context.shouldOpenPanelAfterGesture(0.2, 0.8, 12), false);
});

test('closed desktop discovery is inert and its open state remains accessible', () => {
  class Panel {
    constructor() {
      this.attributes = {};
      this.inert = false;
    }

    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
  }

  const panels = {
    mainPanel: new Panel(),
    sidebar: new Panel(),
    discoveryPanel: new Panel(),
    sidebarToggle: new Panel(),
    discoveryToggle: new Panel(),
    discoveryTriggers: [],
  };
  const classes = new Set();
  const testContext = vm.createContext({
    dom: panels,
    document: { body: { classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    } } },
    window: { innerWidth: 1280 },
    workspacePanels: { left: 'open', right: 'closed' },
  });

  vm.runInContext(`
    const PANEL_DRAWER_BREAKPOINT = 1100;
    function isCompactPanelViewport() { return window.innerWidth <= PANEL_DRAWER_BREAKPOINT; }
    function panelElement(side) { return side === 'left' ? dom.sidebar : dom.discoveryPanel; }
    function panelTriggers(side) {
      return side === 'left'
        ? [dom.sidebarToggle]
        : [dom.discoveryToggle, ...dom.discoveryTriggers];
    }
    ${functionSource('syncWorkspaceAccessibility')}
    globalThis.syncWorkspaceAccessibility = syncWorkspaceAccessibility;
  `, testContext);

  testContext.syncWorkspaceAccessibility();
  assert.equal(panels.discoveryPanel.inert, true);
  assert.equal(panels.discoveryPanel.attributes['aria-hidden'], 'true');
  assert.equal(panels.discoveryToggle.attributes['aria-expanded'], 'false');

  testContext.workspacePanels.right = 'open';
  testContext.syncWorkspaceAccessibility();
  assert.equal(panels.discoveryPanel.inert, false);
  assert.equal(panels.discoveryPanel.attributes['aria-hidden'], 'false');
  assert.equal(panels.discoveryToggle.attributes['aria-expanded'], 'true');
});

test('desktop discovery is removed from layout when closed and presented as an overlay when open', () => {
  assert.match(stylesSource, /@media \(min-width: 1101px\)\s*\{[\s\S]*?\.app-shell\s*\{\s*grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\);[\s\S]*?\.discovery-panel\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?display:\s*none;/);
  assert.match(stylesSource, /body\[data-right-panel-state="opening"\]\s+\.discovery-panel,\s*body\[data-right-panel-state="open"\]\s+\.discovery-panel\s*\{\s*display:\s*flex;/);
});

test('mobile navigation remains above its dimming scrim and retains usable touch controls', () => {
  assert.match(stylesSource, /@media \(max-width: 1100px\)\s*\{\s*\.sidebar,\s*\.discovery-panel\s*\{\s*z-index:\s*var\(--layer-drawer\);/);
});