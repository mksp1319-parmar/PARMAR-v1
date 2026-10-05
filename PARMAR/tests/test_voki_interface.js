const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  VOKKIInterface,
  interpretContract,
  lifecyclePresence,
  futurePresentationStates,
} = require('../interface/static/voki-interface.js');
const {
  SPEECH_STATES,
  VOKKISpeechAdapter,
  isReleasedResponse,
} = require('../interface/static/voki-speech.js');
const {
  DEFAULT_VOKKI_IDENTITY,
  APPROVED_REFERENCE_IDENTITY,
  VOKKIAvatarPresentation,
  lifecycleExpressions,
} = require('../interface/static/voki-avatar.js');
const {
  ONBOARDING_STATES,
  VOKKIIdentityOnboarding,
} = require('../interface/static/voki-identity.js');
require('../interface/static/chat-presentation.js');

class Element {
  constructor() {
    this.textContent = '';
    this.dataset = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = {};
    this.buttons = [];
    this.attributes = {};
    this.focusCount = 0;
    this.children = [];
    this.checked = false;
  }

  addEventListener(eventName, callback) {
    this.listeners[eventName] = callback;
  }

  querySelector(selector) {
    return this.elements[selector] || null;
  }

  querySelectorAll(selector) {
    return selector === '[data-voki-decision]' ? this.buttons : [];
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    delete this[name];
  }

  focus() {
    this.focusCount += 1;
  }
}

function makeInterface(request, speechAdapterFactory) {
  const root = new Element();
  const presence = new Element();
  const avatar = new Element();
  avatar.elements = {};
  presence.elements = { '[data-voki-avatar]': avatar };
  root.elements = {
    '[data-voki-input]': new Element(),
    '[data-voki-submit]': new Element(),
    '[data-voki-lifecycle]': new Element(),
    '[data-voki-presence]': presence,
    '[data-voki-presence-label]': new Element(),
    '[data-voki-transport]': new Element(),
    '[data-voki-output]': new Element(),
    '[data-voki-history]': new Element(),
    '[data-voki-history-messages]': new Element(),
    '[data-voki-research-results]': new Element(),
    '[data-voki-research]': new Element(),
    '[data-voki-speech-toggle]': new Element(),
    '[data-voki-speech-status]': new Element(),
    '[data-voki-stop-speech]': new Element(),
    '[data-voki-approval]': new Element(),
    '[data-voki-approval-message]': new Element(),
    '[data-voki-form]': new Element(),
  };
  root.buttons = ['APPROVE', 'REJECT'].map((decision) => {
    const button = new Element();
    button.dataset.vokiDecision = decision;
    return button;
  });

  let nextRequestId = 0;
  const completed = [];
  const instance = new VOKKIInterface({
    root,
    request,
    getLanguage: () => 'en',
    beginRequest: () => ++nextRequestId,
    finishRequest: (requestId) => completed.push(requestId),
    speechAdapterFactory,
  });
  return { instance, root, completed };
}

function apiResponse(value, ok = true) {
  return { ok, json: async () => value };
}

function contract(overrides = {}) {
  return {
    lifecycle: { state: 'RELEASED' },
    request_review: { status: 'SAFE' },
    enforcement: { status: 'READY_FOR_ACTION' },
    approval: { status: 'NOT_REQUIRED', record_available: 'NOT_REQUIRED' },
    provider: { status: 'COMPLETED' },
    response_safety: { status: 'PASS' },
    response_disposition: 'RELEASED',
    message: 'Validated response.',
    ...overrides,
  };
}

function releasedResponse(overrides = {}) {
  return {
    message: 'Validated response.',
    voki_contract: contract(),
    ...overrides,
  };
}

function makeSpeechHarness(options = {}) {
  let utterance;
  const changes = [];
  const synthesis = {
    cancelCount: 0,
    spoken: [],
    cancel() {
      this.cancelCount += 1;
    },
    speak(value) {
      this.spoken.push(value);
      utterance = value;
    },
  };
  class FakeUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const adapter = new VOKKISpeechAdapter({
    synthesis: options.unavailable ? null : synthesis,
    Utterance: options.unavailable ? null : FakeUtterance,
    getLanguage: options.getLanguage || (() => 'en'),
    onStateChange: (change) => changes.push(change),
  });
  return {
    adapter,
    changes,
    synthesis,
    get utterance() { return utterance; },
  };
}

function makeIdentityHarness(options = {}) {
  const calls = {
    media: [],
    captures: 0,
    saved: null,
    saves: 0,
    deleted: 0,
    stopped: 0,
    revoked: [],
    timeout: null,
  };
  const track = { stop: () => { calls.stopped += 1; } };
  const stream = { getTracks: () => [track] };
  const video = {
    srcObject: null,
    muted: false,
    play: async () => {
      if (options.playPromise) return options.playPromise;
    },
    videoWidth: 640,
    videoHeight: 480,
  };
  const renderer = {
    identity: DEFAULT_VOKKI_IDENTITY,
    lifecycle: 'UNKNOWN',
    setIdentity(identity = DEFAULT_VOKKI_IDENTITY, assetUrl = null) {
      this.identity = identity;
      this.assetUrl = assetUrl;
    },
  };
  const store = {
    scope: 'a'.repeat(64),
    records: new Map(),
    setScope(scope) { this.scope = scope; },
    async get() { return this.records.has(this.scope) ? { blob: this.records.get(this.scope) } : null; },
    async save(blob) {
      calls.saves += 1;
      if (options.saveError) throw new Error('storage unavailable');
      if (options.savePromise) await options.savePromise;
      calls.saved = blob;
      this.records.set(this.scope, blob);
    },
    async delete() {
      calls.deleted += 1;
      this.records.delete(this.scope);
      calls.saved = null;
    },
  };
  const changes = [];
  let nextUrl = 0;
  const onboarding = new VOKKIIdentityOnboarding({
    mediaDevices: {
      async getUserMedia(constraints) {
        calls.media.push(constraints);
        if (options.cameraError) throw options.cameraError;
        if (options.mediaPromise) return options.mediaPromise;
        return stream;
      },
    },
    video,
    store,
    renderer,
    captureFrame: async () => {
      calls.captures += 1;
      if (options.captureError) throw new Error('capture failed');
      if (options.capturePromise) return options.capturePromise;
      return new Blob(['local-still'], { type: 'image/jpeg' });
    },
    createObjectURL: () => `blob:vokki-${++nextUrl}`,
    revokeObjectURL: (url) => calls.revoked.push(url),
    setTimeoutFn: (callback) => { calls.timeout = callback; return 1; },
    clearTimeoutFn: () => {},
    onStateChange: (change) => changes.push(change),
  });
  return { onboarding, calls, video, renderer, changes, stream };
}

test('unknown or absent contracts do not become a ready or successful lifecycle', () => {
  assert.deepEqual(interpretContract(null), {
    lifecycleState: 'UNKNOWN',
    lifecycleLabel: 'STATE UNAVAILABLE',
    presenceState: 'unknown',
    responseSafety: 'UNKNOWN',
    disposition: 'UNKNOWN',
    approvalStatus: 'UNKNOWN',
    approvalRecord: 'UNKNOWN',
    providerStatus: 'UNKNOWN',
    enforcementStatus: 'UNKNOWN',
    requestReviewStatus: 'UNKNOWN',
    message: '',
  });
  assert.equal(interpretContract({ lifecycle: { state: 'UNRECOGNIZED' } }).presenceState, 'unknown');
});

test('authoritative lifecycle maps to distinct VOKKI visual modes without adding backend states', () => {
  assert.deepEqual(lifecyclePresence, {
    UNKNOWN: 'unknown',
    IDLE: 'ready',
    LISTENING: 'listening',
    THINKING: 'processing',
    ANALYZING: 'checking',
    RISK_CHECK: 'checking',
    WAITING_FOR_HUMAN: 'approval-required',
    ENFORCEMENT_ALLOWED: 'checking',
    PROVIDER: 'responding',
    RESPONSE_SAFETY: 'checking',
    RELEASED: 'completed',
    WITHHELD: 'withheld',
    PROVIDER_FAILED: 'error',
    BLOCKED: 'withheld',
  });
  assert.deepEqual(futurePresentationStates, ['speaking']);
  assert.equal(Object.hasOwn(lifecyclePresence, 'SPEAKING'), false);
});

test('avatar initializes with the bundled local identity and neutral unavailable expression', () => {
  const root = new Element();
  root.elements = {};
  const avatar = new VOKKIAvatarPresentation({ root });

  assert.equal(root.dataset.avatarIdentity, 'vokki-local-default');
  assert.equal(root.dataset.avatarKind, 'local-default');
  assert.equal(root.dataset.lifecycleState, 'UNKNOWN');
  assert.equal(root.dataset.expression, 'unavailable');
  assert.equal(avatar.lifecycle, 'UNKNOWN');
  assert.equal(DEFAULT_VOKKI_IDENTITY.source, 'bundled-vector');
  assert.equal(DEFAULT_VOKKI_IDENTITY.asset, null);
});

test('appearance renderer has a separate plug-in seam from lifecycle interpretation', () => {
  const root = new Element();
  root.elements = {};
  let mountCall;
  const avatar = new VOKKIAvatarPresentation({
    root,
    appearanceAdapter: {
      mount: (options) => { mountCall = options; },
    },
  });

  assert.equal(mountCall.host, root);
  assert.equal(mountCall.identity, DEFAULT_VOKKI_IDENTITY);
  avatar.setLifecycle('WAITING_FOR_HUMAN');
  assert.equal(root.dataset.expression, 'approval-required');
  assert.equal(root.dataset.avatarIdentity, DEFAULT_VOKKI_IDENTITY.id);
});

test('avatar expression mapping covers authoritative lifecycle states only', () => {
  assert.deepEqual(lifecycleExpressions, {
    UNKNOWN: 'unavailable',
    IDLE: 'neutral',
    LISTENING: 'attentive',
    THINKING: 'focused',
    ANALYZING: 'verifying',
    RISK_CHECK: 'verifying',
    WAITING_FOR_HUMAN: 'approval-required',
    ENFORCEMENT_ALLOWED: 'verifying',
    PROVIDER: 'responding',
    RESPONSE_SAFETY: 'verifying',
    RELEASED: 'resolved',
    WITHHELD: 'cautious',
    PROVIDER_FAILED: 'recovery',
    BLOCKED: 'cautious',
  });
  assert.equal(Object.hasOwn(lifecycleExpressions, 'APPROVED'), false);
  assert.equal(Object.hasOwn(lifecycleExpressions, 'SAFE'), false);
});

test('identity onboarding initializes separately from backend lifecycle and does not request permission', () => {
  const { onboarding, calls, renderer } = makeIdentityHarness();
  assert.deepEqual(ONBOARDING_STATES, [
    'IDLE',
    'PERMISSION_REQUIRED',
    'CAPTURE_READY',
    'CAPTURED',
    'PREVIEW',
    'USER_APPROVAL_REQUIRED',
    'SAVED',
    'CANCELLED',
    'DENIED',
    'ERROR',
  ]);
  assert.equal(onboarding.state, 'IDLE');
  assert.deepEqual(calls.media, []);
  assert.equal(renderer.lifecycle, 'UNKNOWN');
  for (const state of ONBOARDING_STATES.filter((value) => value !== 'IDLE')) {
    assert.equal(Object.hasOwn(lifecycleExpressions, state), false);
    assert.equal(Object.hasOwn(lifecyclePresence, state), false);
  }
  onboarding.start();
  assert.equal(onboarding.state, 'PERMISSION_REQUIRED');
  assert.deepEqual(calls.media, []);
});

test('camera permission is requested only from the explicit enable action and never requests audio', async () => {
  const { onboarding, calls } = makeIdentityHarness();
  onboarding.start();
  assert.equal(await onboarding.requestCamera(), true);
  assert.deepEqual(calls.media, [{ video: true, audio: false }]);
  assert.equal(onboarding.state, 'CAPTURE_READY');
  assert.equal(onboarding.video.srcObject !== null, true);
});

test('local identity storage is namespaced by opaque authenticated-session scope', () => {
  const { LocalVOKKIIdentityStore } = require('../interface/static/voki-identity.js');
  const store = new LocalVOKKIIdentityStore(null);
  const firstScope = 'a'.repeat(64);
  const secondScope = 'b'.repeat(64);
  store.setScope(firstScope);
  assert.equal(store.scopedKey(), `approved-voki-reference:${firstScope}`);
  store.setScope(secondScope);
  assert.equal(store.scopedKey(), `approved-voki-reference:${secondScope}`);
  store.setScope(null);
  assert.throws(() => store.scopedKey(), /authenticated session/);
});

test('switching authenticated identity scope never displays another session local reference', async () => {
  const { onboarding, calls, renderer } = makeIdentityHarness();
  onboarding.start();
  await onboarding.requestCamera();
  await onboarding.capture();
  assert.equal(await onboarding.approve(), true);
  const firstScope = onboarding.store.scope;
  assert.equal(renderer.identity.kind, 'approved-reference');

  await onboarding.setStorageScope('b'.repeat(64));
  assert.equal(onboarding.store.scope, 'b'.repeat(64));
  assert.equal(renderer.identity, DEFAULT_VOKKI_IDENTITY);
  assert.equal(calls.saved instanceof Blob, true);
  await onboarding.setStorageScope(firstScope);
  assert.equal(renderer.identity.kind, 'approved-reference');
});

test('anonymous identity setup fails closed without requesting camera permission', async () => {
  const { onboarding, calls } = makeIdentityHarness();
  await onboarding.setStorageScope(null);
  assert.equal(onboarding.start(), false);
  assert.equal(onboarding.state, 'IDLE');
  assert.deepEqual(calls.media, []);
});

test('authenticated VOKKI history restores persisted messages and sources without speaking or fetching research', async () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    const history = {
      conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      messages: [
        { role: 'user', content: 'Research the subject.' },
        {
          role: 'assistant',
          content: 'A released response.',
          research: {
            contract_version: '1.0',
            status: 'RESULTS',
            reason_code: null,
            sources: [{
              title: 'Persisted source',
              url: 'https://example.org/research',
              domain: 'example.org',
              provider_id: 'http-json-search',
              source_id: 'source-1',
              snippet: 'Persisted excerpt.',
              metadata: {},
            }],
          },
        },
      ],
    };
    const calls = [];
    const harness = makeSpeechHarness();
    const { instance, root } = makeInterface(async (url) => {
      calls.push(url);
      return apiResponse(history);
    }, ({ getLanguage, onStateChange }) => new VOKKISpeechAdapter({
      synthesis: harness.synthesis,
      Utterance: class FakeUtterance { constructor(text) { this.text = text; } },
      getLanguage,
      onStateChange,
    }));
    instance.authenticated = true;
    instance.speech.setEnabled(true);

    assert.equal(await instance.loadConversation(history.conversation_id), true);
    const historyMessages = root.elements['[data-voki-history-messages]'];
    assert.equal(historyMessages.children.length, 2);
    assert.equal(historyMessages.children[1].children[1].textContent, 'A released response.');
    assert.equal(historyMessages.children[1].children[2].children[2].children[0].children[4].href, 'https://example.org/research');
    assert.deepEqual(calls, [`/api/conversations/${history.conversation_id}`]);
    assert.equal(harness.synthesis.spoken.length, 0);
    assert.equal(root.elements['[data-voki-lifecycle]'].dataset.lifecycle, 'UNKNOWN');
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test('home VOKKI presence opens the real interface and no longer runs an acknowledgment-only click path', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'app.js'), 'utf8');
  const homeButton = html.match(/<button class="parmar-core[^>]+id="parmar-core"[^>]*>/)?.[0] || '';
  assert.match(homeButton, /aria-label="Open VOKKI interaction"/);
  assert.match(app, /dom\.parmarCore\?\.addEventListener\('click', \(\) => \{\s*selectSection\('voki'\);\s*dom\.vokiInput\?\.focus/);
  assert.doesNotMatch(app, /classList\.add\('acknowledged'\)/);
});

test('repeated permission actions cannot open untracked concurrent camera streams', async () => {
  let grantPermission;
  const mediaPromise = new Promise((resolve) => { grantPermission = resolve; });
  const { onboarding, calls, stream } = makeIdentityHarness({ mediaPromise });
  onboarding.start();
  const firstRequest = onboarding.requestCamera();
  assert.equal(await onboarding.requestCamera(), false);
  assert.equal(calls.media.length, 1);
  grantPermission(stream);
  assert.equal(await firstRequest, true);
  assert.equal(onboarding.state, 'CAPTURE_READY');
});

test('camera setup remains single-flight while video playback is starting', async () => {
  let finishPlayback;
  const playPromise = new Promise((resolve) => { finishPlayback = resolve; });
  const { onboarding, calls } = makeIdentityHarness({ playPromise });
  onboarding.start();
  const firstRequest = onboarding.requestCamera();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(onboarding.cameraRequestPending, true);
  assert.equal(await onboarding.requestCamera(), false);
  assert.equal(calls.media.length, 1);
  finishPlayback();
  assert.equal(await firstRequest, true);
  assert.equal(onboarding.state, 'CAPTURE_READY');
});

test('cancelling a pending permission prompt stops a stream if permission is granted later', async () => {
  let grantPermission;
  const mediaPromise = new Promise((resolve) => { grantPermission = resolve; });
  const { onboarding, calls, stream } = makeIdentityHarness({ mediaPromise });
  onboarding.start();
  const permissionRequest = onboarding.requestCamera();
  assert.equal(onboarding.cameraRequestPending, true);
  onboarding.cancel();
  grantPermission(stream);
  assert.equal(await permissionRequest, false);
  assert.equal(onboarding.state, 'CANCELLED');
  assert.equal(calls.stopped, 1);
  assert.equal(onboarding.stream, null);
});

test('denied camera permission is non-blocking and retains bundled identity', async () => {
  const { onboarding, calls, renderer } = makeIdentityHarness({
    cameraError: Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
  });
  onboarding.start();
  assert.equal(await onboarding.requestCamera(), false);
  assert.equal(onboarding.state, 'DENIED');
  assert.equal(renderer.identity, DEFAULT_VOKKI_IDENTITY);
  assert.equal(calls.saved, null);
  assert.equal(calls.saves, 0);
});

test('capture stops the camera immediately and reaches preview and explicit approval states', async () => {
  const { onboarding, calls, video, changes, renderer } = makeIdentityHarness();
  onboarding.start();
  await onboarding.requestCamera();
  assert.equal(await onboarding.capture(), true);
  assert.equal(calls.captures, 1);
  assert.equal(calls.stopped, 1);
  assert.equal(video.srcObject, null);
  assert.deepEqual(changes.slice(-3).map(({ state }) => state), [
    'CAPTURED',
    'PREVIEW',
    'USER_APPROVAL_REQUIRED',
  ]);
  assert.equal(calls.saved, null);
  assert.equal(renderer.identity, DEFAULT_VOKKI_IDENTITY);
  assert.equal(await onboarding.approve(), true);
  assert.equal(onboarding.state, 'SAVED');
  assert.ok(calls.saved instanceof Blob);
  assert.equal(renderer.identity.kind, 'approved-reference');
  assert.equal(renderer.assetUrl, 'blob:vokki-1');
});

test('camera setup has a bounded lifetime and timeout releases the stream', async () => {
  const { onboarding, calls, video } = makeIdentityHarness();
  onboarding.start();
  await onboarding.requestCamera();
  calls.timeout();
  assert.equal(onboarding.state, 'ERROR');
  assert.equal(calls.stopped, 1);
  assert.equal(video.srcObject, null);
});

test('cancelling a pending still capture cannot restore a discarded preview', async () => {
  let finishCapture;
  const capturePromise = new Promise((resolve) => { finishCapture = resolve; });
  const { onboarding, calls } = makeIdentityHarness({ capturePromise });
  onboarding.start();
  await onboarding.requestCamera();
  const pendingCapture = onboarding.capture();
  onboarding.cancel();
  finishCapture(new Blob(['late-still'], { type: 'image/jpeg' }));
  assert.equal(await pendingCapture, false);
  assert.equal(onboarding.state, 'CANCELLED');
  assert.equal(onboarding.temporaryBlob, null);
  assert.equal(onboarding.temporaryUrl, null);
  assert.equal(calls.saved, null);
});

test('repeated capture actions cannot create competing stills', async () => {
  let finishCapture;
  const capturePromise = new Promise((resolve) => { finishCapture = resolve; });
  const { onboarding, calls } = makeIdentityHarness({ capturePromise });
  onboarding.start();
  await onboarding.requestCamera();
  const firstCapture = onboarding.capture();
  assert.equal(await onboarding.capture(), false);
  assert.equal(calls.captures, 1);
  finishCapture(new Blob(['still'], { type: 'image/jpeg' }));
  assert.equal(await firstCapture, true);
  assert.equal(onboarding.state, 'USER_APPROVAL_REQUIRED');
});

test('approval save is one-use while pending and cannot be cancelled midway', async () => {
  let finishSave;
  const savePromise = new Promise((resolve) => { finishSave = resolve; });
  const { onboarding, calls } = makeIdentityHarness({ savePromise });
  onboarding.start();
  await onboarding.requestCamera();
  await onboarding.capture();
  const approval = onboarding.approve();
  assert.equal(await onboarding.approve(), false);
  assert.equal(onboarding.cancel(), false);
  assert.equal(onboarding.retake(), false);
  assert.equal(calls.saves, 1);
  finishSave();
  assert.equal(await approval, true);
  assert.equal(onboarding.state, 'SAVED');
});

test('retake discards the temporary still and requires a new explicit permission action', async () => {
  const { onboarding, calls } = makeIdentityHarness();
  onboarding.start();
  await onboarding.requestCamera();
  await onboarding.capture();
  const previewUrl = onboarding.temporaryUrl;
  assert.equal(onboarding.retake(), true);
  assert.equal(onboarding.state, 'PERMISSION_REQUIRED');
  assert.equal(onboarding.temporaryBlob, null);
  assert.equal(onboarding.temporaryUrl, null);
  assert.deepEqual(calls.revoked, [previewUrl]);
  assert.equal(calls.media.length, 1);
  await onboarding.requestCamera();
  assert.equal(calls.media.length, 2);
});

test('cancel releases an active stream and discards an unapproved capture', async () => {
  const { onboarding, calls, video } = makeIdentityHarness();
  onboarding.start();
  await onboarding.requestCamera();
  assert.equal(onboarding.cancel(), true);
  assert.equal(onboarding.state, 'CANCELLED');
  assert.equal(calls.stopped, 1);
  assert.equal(video.srcObject, null);
  onboarding.start();
  await onboarding.requestCamera();
  await onboarding.capture();
  const previewUrl = onboarding.temporaryUrl;
  onboarding.cancel();
  assert.equal(onboarding.temporaryBlob, null);
  assert.deepEqual(calls.revoked, [previewUrl]);
  assert.equal(calls.saved, null);
});

test('capture and storage errors retain the bundled fallback and permit recovery', async () => {
  const captureFailure = makeIdentityHarness({ captureError: true });
  captureFailure.onboarding.start();
  await captureFailure.onboarding.requestCamera();
  assert.equal(await captureFailure.onboarding.capture(), false);
  assert.equal(captureFailure.onboarding.state, 'ERROR');
  assert.equal(captureFailure.calls.stopped, 1);
  captureFailure.onboarding.start();
  assert.equal(captureFailure.onboarding.state, 'PERMISSION_REQUIRED');

  const saveFailure = makeIdentityHarness({ saveError: true });
  saveFailure.onboarding.start();
  await saveFailure.onboarding.requestCamera();
  await saveFailure.onboarding.capture();
  assert.equal(await saveFailure.onboarding.approve(), false);
  assert.equal(saveFailure.onboarding.state, 'ERROR');
  assert.ok(saveFailure.onboarding.temporaryBlob);
  assert.equal(saveFailure.renderer.identity, DEFAULT_VOKKI_IDENTITY);
  assert.equal(saveFailure.onboarding.retake(), true);
  assert.equal(saveFailure.onboarding.state, 'PERMISSION_REQUIRED');
});

test('approved identity renderer changes appearance without changing lifecycle and restores bundled fallback', () => {
  const referenceImage = {
    hidden: true,
    removeAttribute(name) { if (name === 'src') delete this.src; },
  };
  const portrait = {
    hidden: false,
    toggleAttribute(name, enabled) { if (name === 'hidden') this.hidden = enabled; },
  };
  const root = new Element();
  root.elements = {
    '[data-voki-approved-image]': referenceImage,
    '.voki-avatar-portrait': portrait,
  };
  const avatar = new VOKKIAvatarPresentation({ root });
  avatar.setIdentity(APPROVED_REFERENCE_IDENTITY, 'blob:approved');
  assert.equal(root.dataset.avatarKind, 'approved-reference');
  assert.equal(referenceImage.src, 'blob:approved');
  assert.equal(referenceImage.hidden, false);
  assert.equal(portrait.hidden, true);
  assert.equal(avatar.lifecycle, 'UNKNOWN');
  avatar.setLifecycle('RELEASED');
  avatar.setIdentity();
  assert.equal(root.dataset.avatarKind, 'local-default');
  assert.equal(referenceImage.hidden, true);
  assert.equal(portrait.hidden, false);
  assert.equal(avatar.lifecycle, 'RELEASED');
});

test('approved local identity can be restored and explicitly removed', async () => {
  const first = makeIdentityHarness();
  first.onboarding.start();
  await first.onboarding.requestCamera();
  await first.onboarding.capture();
  await first.onboarding.approve();

  const restored = makeIdentityHarness();
  restored.calls.saved = first.calls.saved;
  assert.equal(await restored.onboarding.loadApprovedIdentity(), true);
  assert.equal(restored.onboarding.state, 'SAVED');
  assert.equal(restored.renderer.identity.kind, 'approved-reference');
  assert.equal(restored.renderer.assetUrl, 'blob:vokki-1');
  assert.equal(await restored.onboarding.removeApprovedIdentity(), true);
  assert.equal(restored.calls.deleted, 1);
  assert.equal(restored.renderer.identity, DEFAULT_VOKKI_IDENTITY);
  assert.deepEqual(restored.calls.revoked, ['blob:vokki-1']);
});

test('saved identity onboarding has no inert setup action and transitions retain a keyboard focus target', () => {
  const controller = Object.create(VOKKIInterface.prototype);
  controller.root = { dataset: {} };
  controller.identityOnboarding = { temporaryUrl: null, temporaryBlob: null };
  controller.avatar = { identity: APPROVED_REFERENCE_IDENTITY };
  controller.identityStatus = new Element();
  controller.identityStart = new Element();
  controller.identityEnable = new Element();
  controller.identityCapture = new Element();
  controller.identityApprove = new Element();
  controller.identityRetake = new Element();
  controller.identityCancel = new Element();
  controller.identityRemove = new Element();
  controller.identityVideo = new Element();
  controller.identityPreview = new Element();

  controller.renderIdentityOnboarding({ state: 'SAVED', message: 'Saved.' });
  assert.equal(controller.identityStart.hidden, true);
  assert.equal(controller.identityRemove.hidden, false);
  controller.focusIdentityControl(controller.identityEnable);
  assert.equal(controller.identityStatus.focusCount, 1);
});

test('identity onboarding is VOKKI-only and has no upload, microphone, or recording path', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'voki-identity.js'), 'utf8');
  const interfaceSource = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'voki-interface.js'), 'utf8');
  const voki = html.indexOf('id="section-voki"');
  const chat = html.indexOf('id="section-chat"');
  const identityControl = html.indexOf('data-voki-identity-start');
  assert.ok(voki < identityControl && identityControl < chat);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|MediaRecorder|SpeechRecognition/);
  assert.match(source, /getUserMedia\(\{ video: true, audio: false \}\)/);
  assert.match(html, /A camera is not needed to use VOKKI/);
  assert.match(html, /No image is uploaded/);
  assert.match(html, /<script src="\/static\/voki-identity\.js"><\/script>/);
  assert.match(interfaceSource, /visibilitychange/);
  assert.match(interfaceSource, /pagehide/);
});

test('speech adapter initializes disabled with an explicit client-only speech state', () => {
  const harness = makeSpeechHarness();
  assert.deepEqual(SPEECH_STATES, ['IDLE', 'QUEUED', 'SPEAKING', 'ENDED', 'ERROR', 'CANCELLED']);
  assert.equal(harness.adapter.available, true);
  assert.equal(harness.adapter.enabled, false);
  assert.equal(harness.adapter.state, 'IDLE');
  assert.deepEqual(harness.changes[0], { state: 'IDLE', boundary: null });

  const unavailable = makeSpeechHarness({ unavailable: true }).adapter;
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.setEnabled(true), false);
});

test('speech accepts only a contract-confirmed released response', () => {
  const harness = makeSpeechHarness();
  harness.adapter.setEnabled(true);

  assert.equal(isReleasedResponse(releasedResponse()), true);
  assert.equal(harness.adapter.speakReleasedResponse(releasedResponse()), true);
  assert.equal(harness.adapter.state, 'QUEUED');
  assert.equal(harness.synthesis.spoken.length, 1);
  assert.equal(harness.utterance.text, 'Validated response.');

  for (const invalid of [
    releasedResponse({ voki_contract: contract({ lifecycle: { state: 'WITHHELD' } }) }),
    releasedResponse({ voki_contract: contract({ response_safety: { status: 'BLOCK' } }) }),
    releasedResponse({ voki_contract: contract({ response_disposition: 'WITHHELD' }) }),
    releasedResponse({ voki_contract: contract({ provider: { status: 'FAILED' } }) }),
  ]) {
    assert.equal(isReleasedResponse(invalid), false);
    assert.equal(harness.adapter.speakReleasedResponse(invalid), false);
  }
  assert.equal(harness.synthesis.spoken.length, 1);
});

test('SPEAKING begins only on the real speech start event and ends at the contract lifecycle', () => {
  const harness = makeSpeechHarness();
  const { instance, root } = makeInterface(async () => apiResponse(releasedResponse()), ({ getLanguage, onStateChange }) => (
    new VOKKISpeechAdapter({
      synthesis: harness.synthesis,
      Utterance: harness.utterance?.constructor || class FakeUtterance { constructor(text) { this.text = text; } },
      getLanguage,
      onStateChange,
    })
  ));
  const toggle = root.elements['[data-voki-speech-toggle]'];
  toggle.checked = true;
  toggle.listeners.change();

  instance.renderResult(releasedResponse());
  const utterance = harness.synthesis.spoken[0];
  assert.equal(root.elements['[data-voki-lifecycle]'].dataset.lifecycle, 'RELEASED');
  assert.equal(root.dataset.speechState, 'QUEUED');
  assert.equal(root.elements['[data-voki-presence]'].dataset.speechState, 'QUEUED');
  assert.equal(utterance.lang, 'en-US');

  utterance.onstart();
  assert.equal(root.dataset.speechState, 'SPEAKING');
  assert.equal(root.elements['[data-voki-presence]'].dataset.speechState, 'SPEAKING');
  assert.equal(root.elements['[data-voki-lifecycle]'].dataset.lifecycle, 'RELEASED');
  assert.equal(root.elements['[data-voki-presence]'].elements['[data-voki-avatar]'].dataset.expression, 'resolved');
  utterance.onboundary({ charIndex: 5, name: 'word' });
  assert.equal(root.dataset.speechBoundary, '5');

  utterance.onend();
  assert.equal(root.dataset.speechState, 'ENDED');
  assert.equal(root.elements['[data-voki-presence]'].dataset.speechState, 'ENDED');
  assert.equal(root.elements['[data-voki-presence]'].dataset.lifecycleState, 'RELEASED');
  assert.equal(root.elements['[data-voki-presence]'].dataset.presenceState, 'completed');
  assert.equal(root.elements['[data-voki-stop-speech]'].hidden, true);

  instance.renderResult(releasedResponse());
  const secondUtterance = harness.synthesis.spoken[1];
  secondUtterance.onstart();
  assert.equal(root.elements['[data-voki-stop-speech]'].hidden, false);
  root.elements['[data-voki-stop-speech]'].listeners.click();
  assert.equal(root.dataset.speechState, 'CANCELLED');
  assert.equal(harness.synthesis.cancelCount, 1);
  assert.equal(root.elements['[data-voki-presence]'].dataset.lifecycleState, 'RELEASED');
});

test('speech cancellation and synthesis errors are distinct client presentation outcomes', () => {
  const harness = makeSpeechHarness();
  harness.adapter.setEnabled(true);
  harness.adapter.speakReleasedResponse(releasedResponse());
  harness.utterance.onstart();
  harness.adapter.cancel();
  assert.equal(harness.adapter.state, 'CANCELLED');
  assert.equal(harness.synthesis.cancelCount, 1);
  harness.utterance.onerror({ error: 'interrupted' });
  assert.equal(harness.adapter.state, 'CANCELLED');

  harness.adapter.speakReleasedResponse(releasedResponse());
  harness.utterance.onstart();
  harness.utterance.onerror({ error: 'synthesis-failed' });
  assert.equal(harness.adapter.state, 'ERROR');
});

test('VOKKI does not cancel or overlap speech already owned by another browser interface', () => {
  const harness = makeSpeechHarness();
  harness.synthesis.speaking = true;
  harness.adapter.setEnabled(true);

  assert.equal(harness.adapter.speakReleasedResponse(releasedResponse()), false);
  assert.equal(harness.adapter.state, 'ERROR');
  assert.equal(harness.synthesis.cancelCount, 0);
  assert.equal(harness.synthesis.spoken.length, 0);
});

test('speech adapter uses browser events without timer-based SPEAKING simulation or media input', () => {
  const speechSource = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'voki-speech.js'), 'utf8');
  assert.doesNotMatch(speechSource, /setTimeout|setInterval|requestAnimationFrame/);
  assert.match(speechSource, /utterance\.onstart = \(\) =>/);
  assert.match(speechSource, /this\.setState\('SPEAKING'\)/);
  assert.doesNotMatch(speechSource, /getUserMedia|mediaDevices|MediaRecorder|SpeechRecognition/);
});

test('VOKKI is an independent interface and Chat remains a separate section', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'app.js'), 'utf8');
  const voki = html.indexOf('id="section-voki"');
  const chat = html.indexOf('id="section-chat"');
  assert.ok(voki >= 0 && chat >= 0 && voki !== chat);
  assert.match(html, /data-section="voki"/);
  assert.match(html, /data-voki-interface/);
  assert.match(html, /<script src="\/static\/voki-interface\.js"><\/script>/);
  const vokiSection = html.match(/<section class="section-view" data-section="voki" id="section-voki"[\s\S]*?<\/section>/)?.[0];
  const chatSection = html.match(/<section class="section-view" data-section="chat" id="section-chat"[\s\S]*?<\/section>/)?.[0];
  assert.ok(vokiSection);
  assert.ok(chatSection);
  assert.match(vokiSection, /data-voki-presence/);
  assert.match(vokiSection, /data-voki-avatar-host/);
  assert.doesNotMatch(vokiSection, /chat-thread|chat-input|chat-voki/);
  assert.doesNotMatch(chatSection, /data-voki-interface/);
  assert.match(app, /request: apiRequest/);
  assert.match(app, /data-voki-submit], \[data-voki-decision/);
  assert.match(html, /<script src="\/static\/voki-avatar\.js"><\/script>/);
  assert.match(html, /<script src="\/static\/voki-speech\.js"><\/script>/);
  assert.match(app, /selectSection\(button\.dataset\.section, button\.dataset\.navKey \|\| button\.dataset\.section\)/);
  assert.match(chatSection, /class="composer-tool composer-voki"[^>]*data-section="voki"/);
  assert.doesNotMatch(chatSection, /chat-voki|voki-voice-toggle|voki-visibility-toggle/);
  assert.match(html, /data-voki-speech-toggle/);
  assert.doesNotMatch(chatSection, /data-voki-speech-toggle/);
});

test('presence has reduced-motion fallbacks and responsive layouts', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'styles.css'), 'utf8');
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.voki-presence[\s\S]*?animation: none !important/);
  assert.match(styles, /body\.reduced-motion[\s\S]*?\.voki-presence[\s\S]*?animation: none !important/);
  assert.match(styles, /@media \(max-width: 900px\) \{[\s\S]*?\.voki-presence-stage/);
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.voki-presence-stage/);
});

test('avatar implementation does not access cameras or microphones', () => {
  const avatarSource = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'voki-avatar.js'), 'utf8');
  const speechSource = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'voki-speech.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'interface', 'static', 'index.html'), 'utf8');
  assert.doesNotMatch(avatarSource, /getUserMedia|mediaDevices|MediaRecorder/);
  assert.doesNotMatch(speechSource, /getUserMedia|mediaDevices|MediaRecorder/);
  assert.doesNotMatch(html, /<input[^>]+type=["']file|capture=/i);
});

test('VOKKI sends through the chat API and releases only a passing response', async () => {
  const calls = [];
  const { instance, root } = makeInterface(async (url, options) => {
    calls.push({ url, options });
    return apiResponse({
      message: 'Validated response.',
      voki_contract: contract(),
    });
  });
  instance.input.value = 'Consider this request';

  await instance.submitRequest();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/chat');
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.message, 'Consider this request');
  assert.equal(Object.hasOwn(request.context || {}, 'memory'), false);
  assert.equal(root.elements['[data-voki-lifecycle]'].dataset.lifecycle, 'RELEASED');
  assert.equal(root.elements['[data-voki-presence]'].dataset.presenceState, 'completed');
  assert.equal(root.dataset.presenceState, 'completed');
  assert.equal(root.dataset.responseSafety, 'PASS');
  assert.equal(root.dataset.responseDisposition, 'RELEASED');
  assert.equal(root.elements['[data-voki-output]'].textContent, 'Validated response.');
});

test('VOKKI requests research explicitly and displays sources only for a released response', async () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    const calls = [];
    const { instance, root } = makeInterface(async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return apiResponse(releasedResponse({
        research: {
          contract_version: '1.0',
          status: 'RESULTS',
          sources: [{
            title: 'A real source',
            url: 'https://example.org/article',
            domain: 'example.org',
            provider_id: 'http-json-search',
            source_id: 'result-1',
            snippet: 'Provider-returned excerpt.',
            metadata: { author: 'Example Institute' },
          }],
          reason_code: null,
        },
      }));
    });
    root.elements['[data-voki-research]'].checked = true;
    instance.input.value = 'Research this question.';
    await instance.submitRequest();

    assert.equal(calls[0].research, true);
    const results = root.elements['[data-voki-research-results]'];
    assert.equal(results.hidden, false);
    assert.equal(results.children[0].className, 'message-research');
    assert.equal(results.children[0].children[2].children[0].children[4].href, 'https://example.org/article');

    instance.renderResult(releasedResponse({
      research: {
        contract_version: '1.0',
        status: 'RESULTS',
        sources: [{
          title: 'Withheld source',
          url: 'https://example.org/withheld',
          domain: 'example.org',
          provider_id: 'http-json-search',
          source_id: 'result-2',
          snippet: null,
          metadata: {},
        }],
        reason_code: null,
      },
      voki_contract: contract({
        lifecycle: { state: 'WITHHELD' },
        response_safety: { status: 'BLOCK' },
        response_disposition: 'WITHHELD',
      }),
    }));
    assert.equal(results.hidden, true);
    assert.deepEqual(results.children, []);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test('a non-PASS provider response is withheld even if the response includes candidate text', async () => {
  const { instance, root } = makeInterface(async () => apiResponse({
    message: 'Candidate content.',
    voki_contract: contract({
      lifecycle: { state: 'WITHHELD' },
      response_safety: { status: 'UNCERTAIN' },
      response_disposition: 'WITHHELD',
      message: 'Candidate content.',
    }),
  }));
  instance.input.value = 'Request';

  await instance.submitRequest();

  assert.equal(root.elements['[data-voki-output]'].textContent, 'PARMAR withheld the provider response.');
  assert.equal(root.elements['[data-voki-presence]'].dataset.presenceState, 'withheld');
});

test('a non-RELEASED lifecycle cannot display or speak a candidate response', () => {
  const harness = makeSpeechHarness();
  const { instance, root } = makeInterface(
    async () => apiResponse({}),
    ({ getLanguage, onStateChange }) => new VOKKISpeechAdapter({
      synthesis: harness.synthesis,
      Utterance: class FakeUtterance { constructor(text) { this.text = text; } },
      getLanguage,
      onStateChange,
    }),
  );
  instance.speech.setEnabled(true);
  const inconsistent = releasedResponse({
    voki_contract: contract({ lifecycle: { state: 'WITHHELD' } }),
  });

  instance.renderResult(inconsistent);

  assert.equal(root.elements['[data-voki-output]'].textContent, 'PARMAR withheld the provider response.');
  assert.equal(root.elements['[data-voki-lifecycle]'].dataset.lifecycle, 'WITHHELD');
  assert.equal(harness.synthesis.spoken.length, 0);
});

test('presence follows contract state changes without browser timers or inferred backend activity', () => {
  const { instance, root } = makeInterface(async () => apiResponse({}));
  const visual = root.elements['[data-voki-presence]'];
  const avatar = visual.elements['[data-voki-avatar]'];

  instance.renderResult({ voki_contract: contract({ lifecycle: { state: 'IDLE' } }) });
  assert.equal(visual.dataset.presenceState, 'ready');
  assert.equal(avatar.dataset.expression, 'neutral');
  instance.renderResult({ voki_contract: contract({ lifecycle: { state: 'RISK_CHECK' } }) });
  assert.equal(visual.dataset.presenceState, 'checking');
  assert.equal(visual.dataset.lifecycleState, 'RISK_CHECK');
  assert.equal(avatar.dataset.expression, 'verifying');
  instance.renderResult({ voki_contract: contract({
    lifecycle: { state: 'WAITING_FOR_HUMAN' },
    approval: { status: 'PENDING', record_available: 'AVAILABLE' },
  }) });
  assert.equal(visual.dataset.presenceState, 'approval-required');
  assert.equal(avatar.dataset.expression, 'approval-required');
  assert.match(visual.attributes['aria-label'], /APPROVAL REQUIRED/);
  instance.renderResult({ voki_contract: contract({ lifecycle: { state: 'PROVIDER_FAILED' }, provider: { status: 'FAILED' } }) });
  assert.equal(visual.dataset.presenceState, 'error');
  assert.equal(avatar.dataset.expression, 'recovery');
  assert.equal(root.dataset.presenceState, 'error');
});

test('browser transport waiting does not overwrite the authoritative lifecycle', async () => {
  let resolveRequest;
  const { instance, root } = makeInterface(() => new Promise((resolve) => {
    resolveRequest = resolve;
  }));
  instance.input.value = 'Request';
  root.elements['[data-voki-lifecycle]'].textContent = 'READY';
  root.elements['[data-voki-lifecycle]'].dataset.lifecycle = 'IDLE';

  const pending = instance.submitRequest();

  assert.equal(root.elements['[data-voki-lifecycle]'].dataset.lifecycle, 'IDLE');
  assert.equal(root.elements['[data-voki-transport]'].textContent, 'Waiting for PARMAR response.');
  resolveRequest(apiResponse({ voki_contract: contract(), message: 'Validated response.' }));
  await pending;
});

test('a canonical pending approval is submitted once and its result does not loop into another approval', async () => {
  const calls = [];
  const { instance, root } = makeInterface(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url === '/api/chat') {
      return apiResponse({
        approval_id: 'server-issued-review-token',
        message: 'A human decision is required.',
        voki_contract: contract({
          lifecycle: { state: 'WAITING_FOR_HUMAN' },
          request_review: { status: 'APPROVAL_REQUIRED' },
          enforcement: { status: 'HUMAN_APPROVAL_REQUIRED' },
          approval: { status: 'PENDING', record_available: 'AVAILABLE' },
          provider: { status: 'NOT_STARTED' },
          response_safety: { status: 'NOT_CHECKED' },
          response_disposition: 'NOT_APPLICABLE',
          message: 'A human decision is required.',
        }),
      });
    }
    return apiResponse({
      message: 'Released after approval.',
      voki_contract: contract({
        approval: { status: 'APPROVED', record_available: 'AVAILABLE' },
      }),
    });
  });
  instance.input.value = 'Request requiring approval';

  await instance.submitRequest();
  assert.equal(root.elements['[data-voki-approval]'].hidden, false);
  assert.equal(calls.length, 1);
  await instance.submitDecision('APPROVE');

  assert.deepEqual(calls.map((call) => call.url), ['/api/chat', '/api/approval']);
  assert.equal(calls[1].body.approval_id, 'server-issued-review-token');
  assert.equal(root.elements['[data-voki-approval]'].hidden, true);
  assert.equal(root.elements['[data-voki-output]'].textContent, 'Released after approval.');
});

test('authentication boundary clears VOKKI conversation and pending approval state', () => {
  const originalAddEventListener = globalThis.addEventListener;
  let authenticationChanged;
  globalThis.addEventListener = (eventName, callback) => {
    if (eventName === 'parmar-auth-state-changed') authenticationChanged = callback;
  };
  try {
    const { instance, root } = makeInterface(async () => apiResponse(releasedResponse()));
    instance.approvalId = 'opaque-pending-approval';
    instance.conversationId = 'server-conversation-selector';
    instance.recentMessages = [{ role: 'user', content: 'private prior turn' }];
    root.elements['[data-voki-approval]'].hidden = false;

    authenticationChanged();

    assert.equal(instance.approvalId, null);
    assert.equal(instance.conversationId, null);
    assert.deepEqual(instance.recentMessages, []);
    assert.equal(root.elements['[data-voki-approval]'].hidden, true);
    assert.equal(root.dataset.presenceState, 'unknown');
    assert.equal(root.elements['[data-voki-output]'].textContent, 'VOKKI has no active authenticated conversation.');
  } finally {
    if (originalAddEventListener) globalThis.addEventListener = originalAddEventListener;
    else delete globalThis.addEventListener;
  }
});

test('approval controls are hidden when no canonical server record is available', async () => {
  const { instance, root } = makeInterface(async () => apiResponse({
    approval_id: 'unavailable-record',
    message: 'A human decision is required.',
    voki_contract: contract({
      lifecycle: { state: 'WAITING_FOR_HUMAN' },
      request_review: { status: 'APPROVAL_REQUIRED' },
      enforcement: { status: 'HUMAN_APPROVAL_REQUIRED' },
      approval: { status: 'PENDING', record_available: 'UNAVAILABLE' },
      provider: { status: 'NOT_STARTED' },
      response_safety: { status: 'NOT_CHECKED' },
      response_disposition: 'NOT_APPLICABLE',
    }),
  }));
  instance.input.value = 'Request';

  await instance.submitRequest();

  assert.equal(root.elements['[data-voki-approval]'].hidden, true);
  assert.equal(instance.approvalId, null);
});
