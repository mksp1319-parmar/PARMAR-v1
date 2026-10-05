(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PARMARChatPresentation = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function isAuthoritativelyReleased(result) {
    const contract = result?.voki_contract || result?.analysis?.voki_contract;
    return contract?.lifecycle?.state === 'RELEASED'
      && contract?.provider?.status === 'COMPLETED'
      && contract?.response_safety?.status === 'PASS'
      && contract?.response_disposition === 'RELEASED';
  }

  function researchRequestOption(enabled) {
    return enabled === true ? { research: true } : {};
  }

  function startProgressiveReveal({
    visibleElement,
    accessibleElement,
    text,
    reducedMotion,
    requestFrame,
    cancelFrame,
    createTextNode,
    isCurrent = () => true,
    onComplete = () => {},
  }) {
    if (!visibleElement || !accessibleElement || typeof text !== 'string') {
      throw new TypeError('A visual element, accessible element, and response text are required.');
    }

    accessibleElement.textContent = text;
    visibleElement.setAttribute('aria-hidden', 'true');
    if (reducedMotion || !text) {
      visibleElement.textContent = text;
      onComplete();
      return () => {};
    }

    const scheduleFrame = requestFrame || ((callback) => root.requestAnimationFrame(callback));
    const stopFrame = cancelFrame || ((frameId) => root.cancelAnimationFrame(frameId));
    const makeTextNode = createTextNode || ((value) => root.document.createTextNode(value));
    if (typeof scheduleFrame !== 'function' || typeof stopFrame !== 'function' || typeof makeTextNode !== 'function') {
      throw new TypeError('Progressive reveal requires browser animation and text-node APIs.');
    }

    const characters = Array.from(text);
    const durationMs = Math.min(2200, Math.max(420, characters.length * 0.75));
    const textNode = makeTextNode('');
    visibleElement.replaceChildren(textNode);
    let frameId = null;
    let startedAt = null;
    let revealedCharacters = 0;
    let cancelled = false;

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (frameId !== null) stopFrame(frameId);
      frameId = null;
    };

    const revealFrame = (timestamp) => {
      frameId = null;
      if (cancelled || !isCurrent()) {
        cancel();
        return;
      }
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / durationMs));
      const nextCharacter = Math.min(characters.length, Math.floor(characters.length * progress));
      if (nextCharacter > revealedCharacters) {
        textNode.appendData(characters.slice(revealedCharacters, nextCharacter).join(''));
        revealedCharacters = nextCharacter;
      }
      if (progress >= 1) {
        textNode.data = text;
        onComplete();
        return;
      }
      frameId = scheduleFrame(revealFrame);
    };

    frameId = scheduleFrame(revealFrame);
    return cancel;
  }

  const researchStatuses = new Set([
    'NOT_REQUESTED',
    'SEARCHING',
    'RESULTS',
    'NO_RESULTS',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_FAILED',
    'INVALID_RESULTS',
    'BLOCKED',
  ]);
  const sensitiveQueryKeys = new Set([
    'apikey',
    'accesstoken',
    'auth',
    'authtoken',
    'authorization',
    'clientsecret',
    'credential',
    'password',
    'privatekey',
    'secret',
    'signature',
    'token',
  ]);
  const sourceFields = new Set([
    'title',
    'url',
    'domain',
    'provider_id',
    'source_id',
    'snippet',
    'metadata',
  ]);
  const sourceMetadataFields = new Set([
    'author',
    'attribution',
    'content_type',
    'published_at',
  ]);

  function hasSensitiveParameters(parameters) {
    for (const key of parameters.keys()) {
      if (sensitiveQueryKeys.has(key.replace(/[-_]/g, '').toLowerCase())) return true;
    }
    return false;
  }

  function codePointLength(value) {
    return Array.from(value).length;
  }

  function validResearchSource(source) {
    if (!source || typeof source !== 'object'
      || Object.keys(source).some((key) => !sourceFields.has(key))
      || ['title', 'url', 'domain', 'provider_id', 'source_id', 'snippet', 'metadata']
        .some((key) => !Object.hasOwn(source, key))
      || typeof source.title !== 'string' || !source.title.trim() || codePointLength(source.title) > 500
      || typeof source.url !== 'string' || source.url.length > 2048
      || typeof source.domain !== 'string'
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(source.domain)
      || typeof source.provider_id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(source.provider_id)
      || typeof source.source_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(source.source_id)
      || (source.snippet !== null
        && (typeof source.snippet !== 'string' || !source.snippet.trim() || codePointLength(source.snippet) > 2000))
      || !source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata)
      || Object.keys(source.metadata).some((key) => !sourceMetadataFields.has(key))
      || Object.values(source.metadata).some((value) => (
        typeof value !== 'string' || !value.trim() || codePointLength(value) > 300
      ))) {
      return false;
    }

    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || !url.hostname
        || url.username || url.password
        || url.hostname.toLowerCase() !== source.domain.toLowerCase()) return false;
      if (hasSensitiveParameters(url.searchParams)
        || hasSensitiveParameters(new URLSearchParams(url.hash.slice(1)))) return false;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function researchPresentation(response) {
    const research = response?.research || response?.analysis?.research;
    if (response?.research_client_error === true) {
      return {
        status: 'CLIENT_REQUEST_FAILED',
        message: 'The research request did not produce a usable PARMAR research result.',
        sources: [],
      };
    }
    if (!research || typeof research !== 'object') return null;

    const contractStatus = String(response?.status || response?.analysis?.status || '').toUpperCase();
    const vokiContract = response?.voki_contract || response?.analysis?.voki_contract;
    if (contractStatus === 'APPROVAL_REQUIRED'
      || vokiContract?.request_review?.status === 'APPROVAL_REQUIRED') {
      return {
        status: 'APPROVAL_REQUIRED',
        message: 'Approval is required before PARMAR can continue this research request.',
        sources: [],
      };
    }
    if (Object.keys(research).some((key) => !['contract_version', 'status', 'sources', 'reason_code'].includes(key))
      || ['contract_version', 'status', 'sources', 'reason_code'].some((key) => !Object.hasOwn(research, key))
      || research.contract_version !== '1.0' || !researchStatuses.has(research.status)
      || !Array.isArray(research.sources) || research.sources.length > 20) {
      return {
        status: 'INVALID_RESULTS',
        message: 'The research result did not match the supported contract. Sources were withheld.',
        sources: [],
      };
    }
    if ((research.reason_code !== null
      && (typeof research.reason_code !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(research.reason_code)))
      || (research.status === 'NO_RESULTS' && research.reason_code !== null)) {
      return {
        status: 'INVALID_RESULTS',
        message: 'The research result did not match the supported contract. Sources were withheld.',
        sources: [],
      };
    }
    if (research.status === 'NOT_REQUESTED') return null;
    if (research.status === 'RESULTS') {
      const sourceUrls = new Set();
      const hasInvalidOrDuplicateSource = research.sources.some((source) => {
        if (!validResearchSource(source)) return true;
        if (sourceUrls.has(source.url)) return true;
        sourceUrls.add(source.url);
        return false;
      });
      if (!research.sources.length || hasInvalidOrDuplicateSource) {
        return {
          status: 'INVALID_RESULTS',
          message: 'The research result contained invalid source data. Sources were withheld.',
          sources: [],
        };
      }
      if (!isAuthoritativelyReleased(response) && response?.persisted_release !== true) {
        if (vokiContract?.provider?.status === 'FAILED' || response?.provider_error === true) {
          return {
            status: 'CHAT_PROVIDER_FAILED',
            message: 'Search returned sources, but PARMAR’s response provider failed. The answer and sources were not released.',
            sources: [],
          };
        }
        return {
          status: 'RESPONSE_WITHHELD',
          message: 'PARMAR’s response-safety checks did not release an answer. Sources are withheld with an unreleased response.',
          sources: [],
        };
      }
      return { status: 'RESULTS', message: 'Sources returned by the configured research provider.', sources: research.sources };
    }
    if (research.sources.length) {
      return {
        status: 'INVALID_RESULTS',
        message: 'The research result contained sources in an invalid state. Sources were withheld.',
        sources: [],
      };
    }
    if (research.status === 'BLOCKED') {
      const reason = String(research.reason_code || '');
      if (reason === 'REQUEST_REVIEW_UNAVAILABLE') {
        return {
          status: 'REQUEST_REVIEW_UNAVAILABLE',
          message: 'PARMAR could not establish its safety review. Research was not run.',
          sources: [],
        };
      }
      const requestBlocked = contractStatus === 'BLOCKED'
        || vokiContract?.lifecycle?.state === 'BLOCKED'
        || vokiContract?.lifecycle?.state === 'WITHHELD'
        || reason.startsWith('REQUEST_');
      return {
        status: requestBlocked ? 'BLOCKED' : 'RESEARCH_BLOCKED',
        message: requestBlocked
          ? 'PARMAR safety controls blocked this request. Research was not run.'
          : 'PARMAR did not authorize external research for this request.',
        sources: [],
      };
    }
    const messages = {
      SEARCHING: 'PARMAR reports that the research provider is searching.',
      NO_RESULTS: 'The configured research provider returned no validated sources.',
      PROVIDER_UNAVAILABLE: 'Research is unavailable because no valid search provider is configured.',
      PROVIDER_FAILED: 'The configured search provider failed. No research answer was generated.',
      INVALID_RESULTS: 'The configured search provider returned invalid results. Sources were withheld.',
    };
    return {
      status: research.status,
      message: messages[research.status] || 'The research result is unavailable.',
      sources: [],
    };
  }

  function renderResearchResult(container, response, doc = globalThis.document) {
    const presentation = researchPresentation(response);
    if (!container || !doc) return presentation;
    if (!presentation) return null;

    const section = doc.createElement('section');
    section.className = 'message-research';
    section.setAttribute('aria-label', 'Research result');
    const heading = doc.createElement('h3');
    heading.className = 'message-research-heading';
    heading.textContent = presentation.sources.length ? 'Sources' : 'Research status';
    const status = doc.createElement('p');
    status.className = 'message-research-status';
    status.dataset.status = presentation.status;
    status.setAttribute('role', 'status');
    status.textContent = presentation.message;
    section.append(heading, status);

    if (presentation.sources.length) {
      const list = doc.createElement('ol');
      list.className = 'message-research-sources';
      list.setAttribute('aria-label', 'Sources returned by the research provider');
      presentation.sources.forEach((source) => {
        const item = doc.createElement('li');
        item.className = 'message-research-source';
        const title = doc.createElement('h4');
        title.textContent = source.title;
        const domain = doc.createElement('p');
        domain.className = 'message-research-domain';
        domain.textContent = source.domain;
        const attribution = doc.createElement('p');
        attribution.className = 'message-research-attribution';
        const details = [`Provider: ${source.provider_id}`, `Source ID: ${source.source_id}`];
        const metadata = source.metadata;
        for (const key of ['author', 'attribution', 'content_type', 'published_at']) {
          if (typeof metadata[key] === 'string' && metadata[key].trim()) {
            details.push(metadata[key]);
          }
        }
        attribution.textContent = details.join(' · ');
        item.append(title, domain, attribution);
        if (typeof source.snippet === 'string' && source.snippet) {
          const snippet = doc.createElement('p');
          snippet.className = 'message-research-snippet';
          snippet.textContent = source.snippet;
          item.appendChild(snippet);
        }
        const link = doc.createElement('a');
        link.className = 'message-research-link';
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `Open ${source.title} at ${source.domain} in a new tab`);
        link.textContent = 'Open source';
        item.appendChild(link);
        list.appendChild(item);
      });
      section.appendChild(list);
    }
    container.appendChild(section);
    return presentation;
  }

  return {
    isAuthoritativelyReleased,
    researchRequestOption,
    renderResearchResult,
    researchPresentation,
    startProgressiveReveal,
    validResearchSource,
  };
});
