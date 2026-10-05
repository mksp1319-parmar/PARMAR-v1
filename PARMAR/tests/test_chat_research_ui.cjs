const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuthoritativelyReleased,
  renderResearchResult,
  researchPresentation,
  researchRequestOption,
} = require('../interface/static/chat-presentation.js');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

const document = { createElement: (tagName) => new Element(tagName) };

function source(overrides = {}) {
  return {
    title: 'A sourced title',
    url: 'https://example.com/research?id=42',
    domain: 'example.com',
    provider_id: 'configured-search',
    source_id: 'result-42',
    snippet: 'A real provider-returned excerpt.',
    metadata: { author: 'Researcher', published_at: '2025-01-02' },
    ...overrides,
  };
}

function releasedResponse(sources = [source()]) {
  return {
    status: 'RELEASED',
    message: 'A PARMAR response supported by retrieved sources.',
    voki_contract: {
      lifecycle: { state: 'RELEASED' },
      provider: { status: 'COMPLETED' },
      response_safety: { status: 'PASS' },
      response_disposition: 'RELEASED',
    },
    research: {
      contract_version: '1.0',
      status: 'RESULTS',
      sources,
      reason_code: null,
    },
  };
}

test('research mode defaults to ordinary Chat and adds only the explicit true opt-in', () => {
  assert.deepEqual(researchRequestOption(false), {});
  assert.deepEqual(researchRequestOption(undefined), {});
  assert.deepEqual(researchRequestOption(true), { research: true });
});

test('released research sources render actual validated metadata and HTTPS destinations', () => {
  const container = new Element('div');
  const response = releasedResponse();
  assert.equal(isAuthoritativelyReleased(response), true);

  const presentation = renderResearchResult(container, response, document);
  assert.equal(presentation.status, 'RESULTS');
  const section = container.children[0];
  assert.equal(section.className, 'message-research');
  const list = section.children[2];
  const item = list.children[0];
  assert.equal(item.children[0].textContent, 'A sourced title');
  assert.equal(item.children[1].textContent, 'example.com');
  assert.match(item.children[2].textContent, /configured-search/);
  assert.match(item.children[2].textContent, /Researcher/);
  assert.equal(item.children[3].textContent, 'A real provider-returned excerpt.');
  const link = item.children[4];
  assert.equal(link.href, 'https://example.com/research?id=42');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.match(link.attributes['aria-label'], /A sourced title/);
});

test('persisted released history can restore validated sources without rerunning research', () => {
  const container = new Element('div');
  const historical = {
    research: releasedResponse().research,
    persisted_release: true,
  };
  const presentation = renderResearchResult(container, historical, document);
  assert.equal(presentation.status, 'RESULTS');
  assert.equal(container.children[0].children[2].children[0].children[4].href, source().url);
});

test('source content is inserted as text and optional snippet is nullable', () => {
  const maliciousTitle = '<img src=x onerror=alert(1)>';
  const response = releasedResponse([source({
    title: maliciousTitle,
    snippet: null,
    metadata: {},
  })]);
  const container = new Element('div');

  renderResearchResult(container, response, document);

  const item = container.children[0].children[2].children[0];
  assert.equal(item.children[0].textContent, maliciousTitle);
  assert.equal(item.children.length, 4);
  assert.equal(Object.hasOwn(item.children[0], 'innerHTML'), false);
});

test('invalid URLs, hosts, required fields, and duplicate sources are withheld', () => {
  for (const invalid of [
    source({ url: 'javascript:alert(1)' }),
    source({ url: 'https://other.example/path' }),
    source({ url: 'https://user:pass@example.com/path' }),
    source({ url: 'https://example.com/path?access_token=secret' }),
    source({ url: 'https://example.com/path#access_token=secret' }),
    source({ title: '  ' }),
    source({ title: undefined }),
    source({ url: undefined }),
    source({ domain: undefined }),
    source({ domain: 'not a host' }),
    source({ provider_id: 'invalid provider' }),
    source({ source_id: 'invalid source id' }),
    source({ title: 'x'.repeat(501) }),
    source({ snippet: 'x'.repeat(2001) }),
    source({ untrusted_authority: true }),
    source({ metadata: { injected: 'unexpected' } }),
  ]) {
    const result = researchPresentation(releasedResponse([invalid]));
    assert.equal(result.status, 'INVALID_RESULTS');
    assert.deepEqual(result.sources, []);
  }

  const duplicateUrl = source({ source_id: 'result-43' });
  assert.equal(researchPresentation(releasedResponse([source(), duplicateUrl])).status, 'INVALID_RESULTS');
  const repeatedSourceId = source({
    source_id: 'result-42',
    url: 'https://example.net/other',
    domain: 'example.net',
  });
  assert.equal(researchPresentation(releasedResponse([source(), repeatedSourceId])).status, 'RESULTS');
  const tooMany = Array.from({ length: 21 }, (_value, index) => source({
    url: `https://example${index}.com/page`,
    domain: `example${index}.com`,
    source_id: `result-${index}`,
  }));
  assert.equal(researchPresentation(releasedResponse(tooMany)).status, 'INVALID_RESULTS');
});

test('zero-source and failure states remain distinct', () => {
  const cases = [
    ['NO_RESULTS', 'The configured research provider returned no validated sources.'],
    ['PROVIDER_UNAVAILABLE', 'Research is unavailable because no valid search provider is configured.'],
    ['PROVIDER_FAILED', 'The configured search provider failed. No research answer was generated.'],
    ['INVALID_RESULTS', 'The configured search provider returned invalid results. Sources were withheld.'],
  ];
  for (const [status, message] of cases) {
    const presentation = researchPresentation({
      research: { contract_version: '1.0', status, sources: [], reason_code: null },
    });
    assert.equal(presentation.status, status);
    assert.equal(presentation.message, message);
    assert.deepEqual(presentation.sources, []);
  }
  assert.equal(researchPresentation({
    research: { contract_version: '1.0', status: 'NO_RESULTS', sources: [], reason_code: null },
  }).sources.length, 0);
  assert.equal(researchPresentation({
    research: {
      contract_version: '1.0',
      status: 'NO_RESULTS',
      sources: [],
      reason_code: 'SEARCH_FAILED',
    },
  }).status, 'INVALID_RESULTS');
  assert.equal(researchPresentation({
    research: {
      contract_version: '1.0',
      status: 'NO_RESULTS',
      sources: [],
      reason_code: null,
      unexpected: 'field',
    },
  }).status, 'INVALID_RESULTS');
});

test('blocked and approval-required outcomes never expose sources or authority controls', () => {
  const approval = researchPresentation({
    status: 'APPROVAL_REQUIRED',
    research: { contract_version: '1.0', status: 'BLOCKED', sources: [], reason_code: 'REQUEST_REQUIRES_REVIEW' },
  });
  assert.equal(approval.status, 'APPROVAL_REQUIRED');
  assert.match(approval.message, /Approval is required/);

  const blocked = researchPresentation({
    status: 'BLOCKED',
    research: { contract_version: '1.0', status: 'BLOCKED', sources: [], reason_code: 'REQUEST_NOT_AUTHORIZED_FOR_RESEARCH' },
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.deepEqual(blocked.sources, []);

  const unavailableReview = researchPresentation({
    research: { contract_version: '1.0', status: 'BLOCKED', sources: [], reason_code: 'REQUEST_REVIEW_UNAVAILABLE' },
  });
  assert.equal(unavailableReview.status, 'REQUEST_REVIEW_UNAVAILABLE');
  assert.match(unavailableReview.message, /could not establish its safety review/);

  const unavailableAuthorization = researchPresentation({
    research: { contract_version: '1.0', status: 'BLOCKED', sources: [], reason_code: 'EXTERNAL_SEARCH_NOT_AUTHORIZED' },
  });
  assert.equal(unavailableAuthorization.status, 'RESEARCH_BLOCKED');
});

test('client request failure is distinct from no results and unreleased sources stay hidden', () => {
  assert.equal(researchPresentation({ research_client_error: true }).status, 'CLIENT_REQUEST_FAILED');

  const unreleased = releasedResponse();
  unreleased.voki_contract.response_safety.status = 'FAIL';
  const presentation = researchPresentation(unreleased);
  assert.equal(presentation.status, 'RESPONSE_WITHHELD');
  assert.deepEqual(presentation.sources, []);

  const chatProviderFailure = releasedResponse();
  chatProviderFailure.voki_contract.provider.status = 'FAILED';
  assert.equal(researchPresentation(chatProviderFailure).status, 'CHAT_PROVIDER_FAILED');
});
