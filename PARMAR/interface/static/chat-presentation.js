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

  return { isAuthoritativelyReleased, startProgressiveReveal };
});
