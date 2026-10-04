const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'interface', 'static', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

function functionSource(name) {
  const match = appSource.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist in app.js`);
  return match[0];
}

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