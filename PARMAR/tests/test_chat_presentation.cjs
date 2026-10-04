const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuthoritativelyReleased,
  startProgressiveReveal,
} = require('../interface/static/chat-presentation.js');

function releasedResult(overrides = {}) {
  return {
    voki_contract: {
      lifecycle: { state: 'RELEASED' },
      provider: { status: 'COMPLETED' },
      response_safety: { status: 'PASS' },
      response_disposition: 'RELEASED',
      ...overrides,
    },
  };
}

function animationHarness() {
  let nextId = 0;
  const callbacks = new Map();
  const requestFrame = (callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  };
  const cancelFrame = (id) => callbacks.delete(id);
  const tick = (timestamp) => {
    const scheduled = [...callbacks.values()];
    callbacks.clear();
    scheduled.forEach((callback) => callback(timestamp));
  };
  const createTextNode = (value) => ({
    data: value,
    appendData(chunk) {
      this.data += chunk;
    },
  });
  return { callbacks, requestFrame, cancelFrame, tick, createTextNode };
}

function element() {
  return {
    textContent: '',
    attributes: {},
    children: [],
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

test('released presentation requires every authoritative contract field to agree', () => {
  assert.equal(isAuthoritativelyReleased(releasedResult()), true);
  for (const overrides of [
    { lifecycle: { state: 'WITHHELD' } },
    { provider: { status: 'FAILED' } },
    { response_safety: { status: 'UNCERTAIN' } },
    { response_disposition: 'WITHHELD' },
  ]) {
    assert.equal(isAuthoritativelyReleased(releasedResult(overrides)), false);
  }
  assert.equal(isAuthoritativelyReleased({ message: 'candidate without a contract' }), false);
});

test('reveals only after a released response is accepted and keeps full accessible text available', () => {
  const harness = animationHarness();
  const visible = element();
  const accessible = element();
  const text = 'First line.\n\nCode: `a  b` — done.';
  let cancelReveal = () => {};

  const result = releasedResult();
  if (isAuthoritativelyReleased(result)) {
    cancelReveal = startProgressiveReveal({
      visibleElement: visible,
      accessibleElement: accessible,
      text,
      reducedMotion: false,
      ...harness,
    });
  }
  assert.equal(visible.children[0].data, '');
  assert.equal(accessible.textContent, text);
  harness.tick(0);
  harness.tick(100);
  assert.ok(visible.children[0].data.length > 0);
  assert.notEqual(visible.children[0].data, text);
  harness.tick(3000);
  assert.equal(visible.children[0].data, text);
  assert.equal(typeof cancelReveal, 'function');
});

test('reduced motion displays the complete response without scheduling animation', () => {
  const harness = animationHarness();
  const visible = element();
  const accessible = element();
  const text = 'Complete response immediately.';

  startProgressiveReveal({
    visibleElement: visible,
    accessibleElement: accessible,
    text,
    reducedMotion: true,
    ...harness,
  });

  assert.equal(visible.textContent, text);
  assert.equal(accessible.textContent, text);
  assert.equal(harness.callbacks.size, 0);
});

test('cancelling a reveal prevents stale conversation text from continuing to render', () => {
  const harness = animationHarness();
  const visible = element();
  const accessible = element();
  const cancel = startProgressiveReveal({
    visibleElement: visible,
    accessibleElement: accessible,
    text: 'This response belongs to the previous conversation.',
    reducedMotion: false,
    ...harness,
  });
  harness.tick(0);
  cancel();
  const before = visible.children[0].data;
  harness.tick(1000);
  assert.equal(visible.children[0].data, before);
  assert.equal(harness.callbacks.size, 0);
});
