const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const staticDir = path.join(__dirname, '..', 'interface', 'static');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const designSystem = fs.readFileSync(path.join(staticDir, 'design-system.css'), 'utf8');
const referenceDir = path.join(staticDir, 'reference');

test('the shared design-system layer loads after existing application styles', () => {
  assert.match(html, /href="\/static\/premium\.css"/);
  assert.match(html, /href="\/static\/design-system\.css"/);
  assert.ok(html.indexOf('/static/design-system.css') > html.indexOf('/static/premium.css'));
});

test('the design system provides touch, focus, responsive and reduced-motion rules', () => {
  for (const token of ['--accent:', '--radius-surface:', '--space-4:', '--focus-ring:']) {
    assert.ok(designSystem.includes(token), `Missing design token ${token}`);
  }
  assert.match(designSystem, /:focus-visible/);
  assert.match(designSystem, /@media \(max-width: 760px\)/);
  assert.match(designSystem, /@media \(max-width: 420px\)/);
  assert.match(designSystem, /env\(safe-area-inset-bottom\)/);
  assert.match(designSystem, /@media \(prefers-reduced-motion: reduce\)/);
});

for (const [filename, title, sections] of [
  ['mobile-reference-board.svg', 'PARMAR mobile experience reference collection', 10],
  ['desktop-reference-board.svg', 'PARMAR desktop experience reference collection', 10],
]) {
  test(`${filename} documents ${sections} distinct screen references without fabricated assets`, () => {
    const svg = fs.readFileSync(path.join(referenceDir, filename), 'utf8');
    assert.match(svg, new RegExp(`<title[^>]*>${title}</title>`));
    for (let section = 1; section <= sections; section += 1) {
      const number = String(section).padStart(2, '0');
      assert.match(svg, new RegExp(`${number} \\/`), `Missing reference screen ${number}`);
    }
    assert.match(svg, /Logo\.jpg/i);
    assert.match(svg, /href="\.\.\/assets\/voki\/default-avatar\.png"/);
    assert.doesNotMatch(svg, /href=["']https?:\/\//);
  });
}
