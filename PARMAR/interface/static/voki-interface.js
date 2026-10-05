(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PARMARVOKKIInterface = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const lifecycleLabels = {
    UNKNOWN: 'STATE UNAVAILABLE',
    IDLE: 'READY',
    LISTENING: 'LISTENING',
    THINKING: 'PROCESSING',
    ANALYZING: 'REVIEWING REQUEST',
    RISK_CHECK: 'CHECKING',
    WAITING_FOR_HUMAN: 'APPROVAL REQUIRED',
    ENFORCEMENT_ALLOWED: 'PERMISSION GRANTED',
    PROVIDER: 'RESPONDING',
    RESPONSE_SAFETY: 'CHECKING RESPONSE',
    RELEASED: 'COMPLETED',
    WITHHELD: 'WITHHELD',
    PROVIDER_FAILED: 'PROVIDER UNAVAILABLE',
    BLOCKED: 'BLOCKED',
  };

  const lifecyclePresence = {
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
  };

  function interpretContract(contract) {
    const lifecycleState = typeof contract?.lifecycle?.state === 'string'
      ? contract.lifecycle.state
      : 'UNKNOWN';
    const knownState = Object.hasOwn(lifecycleLabels, lifecycleState) ? lifecycleState : 'UNKNOWN';
    const responseSafety = typeof contract?.response_safety?.status === 'string'
      ? contract.response_safety.status
      : 'UNKNOWN';
    const disposition = typeof contract?.response_disposition === 'string'
      ? contract.response_disposition
      : 'UNKNOWN';
    const approvalStatus = typeof contract?.approval?.status === 'string'
      ? contract.approval.status
      : 'UNKNOWN';
    return {
      lifecycleState: knownState,
      lifecycleLabel: lifecycleLabels[knownState],
      presenceState: lifecyclePresence[knownState],
      responseSafety,
      disposition,
      approvalStatus,
      approvalRecord: typeof contract?.approval?.record_available === 'string'
        ? contract.approval.record_available
        : 'UNKNOWN',
      providerStatus: typeof contract?.provider?.status === 'string'
        ? contract.provider.status
        : 'UNKNOWN',
      enforcementStatus: typeof contract?.enforcement?.status === 'string'
        ? contract.enforcement.status
        : 'UNKNOWN',
      requestReviewStatus: typeof contract?.request_review?.status === 'string'
        ? contract.request_review.status
        : 'UNKNOWN',
      message: typeof contract?.message === 'string' ? contract.message : '',
    };
  }

  class VOKKIInterface {
    constructor({
      root: element,
      request,
      getLanguage,
      beginRequest,
      finishRequest,
      speechAdapterFactory,
    }) {
      if (!element || typeof request !== 'function') {
        throw new TypeError('VOKKI interface requires a root element and a request function.');
      }
      this.root = element;
      this.request = request;
      this.getLanguage = getLanguage || (() => 'en');
      this.beginRequest = beginRequest || (() => true);
      this.finishRequest = finishRequest || (() => {});
      this.input = element.querySelector('[data-voki-input]');
      this.submitButton = element.querySelector('[data-voki-submit]');
      this.lifecycle = element.querySelector('[data-voki-lifecycle]');
      this.presence = element.querySelector('[data-voki-presence]');
      this.presenceLabel = element.querySelector('[data-voki-presence-label]');
      const avatarRoot = this.presence?.querySelector('[data-voki-avatar]');
      this.avatar = avatarRoot && globalThis.PARMARVOKKIAvatar?.VOKKIAvatarPresentation
        ? new globalThis.PARMARVOKKIAvatar.VOKKIAvatarPresentation({ root: avatarRoot })
        : null;
      this.transport = element.querySelector('[data-voki-transport]');
      this.output = element.querySelector('[data-voki-output]');
      this.history = element.querySelector('[data-voki-history]');
      this.historyMessages = element.querySelector('[data-voki-history-messages]');
      this.researchResults = element.querySelector('[data-voki-research-results]');
      this.researchToggle = element.querySelector('[data-voki-research]');
      this.speechToggle = element.querySelector('[data-voki-speech-toggle]');
      this.speechStatus = element.querySelector('[data-voki-speech-status]');
      this.stopSpeechButton = element.querySelector('[data-voki-stop-speech]');
      this.identityStatus = element.querySelector('[data-voki-identity-status]');
      this.identityVideo = element.querySelector('[data-voki-identity-video]');
      this.identityPreview = element.querySelector('[data-voki-identity-preview]');
      this.identityStart = element.querySelector('[data-voki-identity-start]');
      this.identityEnable = element.querySelector('[data-voki-identity-enable]');
      this.identityCapture = element.querySelector('[data-voki-identity-capture]');
      this.identityApprove = element.querySelector('[data-voki-identity-approve]');
      this.identityRetake = element.querySelector('[data-voki-identity-retake]');
      this.identityCancel = element.querySelector('[data-voki-identity-cancel]');
      this.identityRemove = element.querySelector('[data-voki-identity-remove]');
      this.identityOnboarding = this.identityVideo
        && this.avatar
        && globalThis.PARMARVOKKIIdentity?.VOKKIIdentityOnboarding
        ? new globalThis.PARMARVOKKIIdentity.VOKKIIdentityOnboarding({
          video: this.identityVideo,
          renderer: this.avatar,
          onStateChange: (state) => this.renderIdentityOnboarding(state),
        })
        : null;
      this.approval = element.querySelector('[data-voki-approval]');
      this.approvalMessage = element.querySelector('[data-voki-approval-message]');
      this.approvalId = null;
      this.conversationId = null;
      this.recentMessages = [];
      this.authenticated = false;
      this.historyLoading = false;
      this.historyGeneration = 0;
      this.loadedConversationId = null;
      this.conversationGeneration = 0;
      this.authenticationGeneration = 0;
      const SpeechAdapter = globalThis.PARMARVOKKISpeech?.VOKKISpeechAdapter;
      this.speech = speechAdapterFactory
        ? speechAdapterFactory({
          getLanguage: this.getLanguage,
          onStateChange: (state) => this.handleSpeechState(state),
        })
        : SpeechAdapter
          ? new SpeechAdapter({
            getLanguage: this.getLanguage,
            onStateChange: (state) => this.handleSpeechState(state),
          })
          : null;
      this.bind();
      this.handleSpeechState({ state: this.speech?.state || 'IDLE', boundary: null });
      this.renderIdentityOnboarding({
        state: 'IDLE',
        message: 'The bundled avatar is active. Optional identity setup is local to this device.',
      });
      this.identityOnboarding?.setStorageScope(null);
      this.renderIdentityOnboarding({
        state: 'IDLE',
        message: 'Sign in to associate an approved local reference with this session.',
      });
    }

    bind() {
      globalThis.addEventListener?.('parmar-auth-state-changed', () => {
        this.authenticationGeneration += 1;
        this.historyGeneration += 1;
        this.conversationGeneration += 1;
        this.authenticated = false;
        this.speech?.cancel();
        this.identityOnboarding?.setStorageScope(null);
        this.approvalId = null;
        this.conversationId = null;
        this.recentMessages = [];
        this.loadedConversationId = null;
        this.renderHistory([]);
        if (this.researchToggle) this.researchToggle.checked = false;
        this.approval.hidden = true;
        this.lifecycle.textContent = lifecycleLabels.UNKNOWN;
        this.lifecycle.dataset.lifecycle = 'UNKNOWN';
        this.setPresence('UNKNOWN');
        this.output.textContent = 'VOKKI has no active authenticated conversation.';
        this.researchResults?.replaceChildren();
        if (this.researchResults) this.researchResults.hidden = true;
        this.transport.textContent = 'Session state changed. Start a new request.';
        this.root.dataset.requestReview = 'UNKNOWN';
        this.root.dataset.enforcement = 'UNKNOWN';
        this.root.dataset.provider = 'UNKNOWN';
        this.root.dataset.responseSafety = 'UNKNOWN';
        this.root.dataset.responseDisposition = 'UNKNOWN';
        this.root.querySelectorAll('[data-voki-decision]').forEach((button) => {
          button.disabled = false;
        });
      });
      globalThis.addEventListener?.('parmar-auth-session-ready', (event) => {
        const detail = event?.detail || {};
        this.authenticated = detail.authenticated === true;
        void this.identityOnboarding?.setStorageScope(detail.identityScope);
        if (this.authenticated && isConversationId(detail.conversationId)) {
          this.activateConversation(detail.conversationId, { refresh: detail.refresh === true });
        } else if (!this.authenticated) {
          this.activateConversation(null);
        }
      });
      globalThis.addEventListener?.('parmar-conversation-selection-changed', (event) => {
        const detail = event?.detail || {};
        if (detail.authenticated !== this.authenticated) return;
        if (this.authenticated && isConversationId(detail.conversationId)) {
          this.activateConversation(detail.conversationId);
        } else {
          this.activateConversation(null);
        }
      });
      this.root.querySelector('[data-voki-form]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submitRequest();
      });
      this.identityStart?.addEventListener('click', () => {
        this.identityOnboarding?.start();
        this.focusIdentityControl(this.identityEnable);
      });
      this.identityEnable?.addEventListener('click', async () => {
        const granted = await this.identityOnboarding?.requestCamera();
        this.focusIdentityControl(granted ? this.identityCapture : this.identityStart);
      });
      this.identityCapture?.addEventListener('click', async () => {
        const captured = await this.identityOnboarding?.capture();
        this.focusIdentityControl(captured ? this.identityApprove : this.identityStart);
      });
      this.identityApprove?.addEventListener('click', async () => {
        const saved = await this.identityOnboarding?.approve();
        this.focusIdentityControl(saved ? this.identityRemove : this.identityApprove);
      });
      this.identityRetake?.addEventListener('click', () => {
        this.identityOnboarding?.retake();
        this.focusIdentityControl(this.identityEnable);
      });
      this.identityCancel?.addEventListener('click', () => {
        this.identityOnboarding?.cancel();
        this.focusIdentityControl(this.identityStart);
      });
      this.identityRemove?.addEventListener('click', async () => {
        const removed = await this.identityOnboarding?.removeApprovedIdentity();
        this.focusIdentityControl(removed ? this.identityStart : this.identityRemove);
      });
      if (this.identityOnboarding) {
        const stopCameraWhenHidden = () => {
          if (globalThis.document?.hidden
            && (this.identityOnboarding.stream || this.identityOnboarding.cameraRequestPending)) {
            this.identityOnboarding.cancel();
          }
        };
        globalThis.document?.addEventListener('visibilitychange', stopCameraWhenHidden);
        globalThis.addEventListener?.('pagehide', () => this.identityOnboarding.cancel());
        const section = this.root.closest?.('.section-view');
        if (section && typeof globalThis.MutationObserver === 'function') {
          this.identitySectionObserver = new globalThis.MutationObserver(() => {
            if (!section.classList.contains('active')
              && (this.identityOnboarding.stream || this.identityOnboarding.cameraRequestPending)) {
              this.identityOnboarding.cancel();
            }
          });
          this.identitySectionObserver.observe(section, { attributes: true, attributeFilter: ['class'] });
        }
      }
      this.root.querySelectorAll('[data-voki-decision]').forEach((button) => {
        button.addEventListener('click', () => this.submitDecision(button.dataset.vokiDecision));
      });
      this.speechToggle?.addEventListener('change', () => {
        const enabled = this.speech?.setEnabled(this.speechToggle.checked) === true;
        this.speechToggle.checked = enabled;
        this.handleSpeechState({ state: this.speech?.state || 'IDLE', boundary: null });
      });
      this.stopSpeechButton?.addEventListener('click', () => this.speech?.cancel());
    }

    focusIdentityControl(preferred) {
      const target = preferred && !preferred.hidden ? preferred : this.identityStatus;
      target?.focus?.();
    }

    activateConversation(conversationId, { refresh = false } = {}) {
      if (conversationId === this.conversationId
        && !refresh
        && (this.historyLoading || this.loadedConversationId === conversationId)) return;
      this.conversationGeneration += 1;
      this.conversationId = isConversationId(conversationId) ? conversationId : null;
      this.recentMessages = [];
      this.approvalId = null;
      this.approval.hidden = true;
      if (this.researchToggle) this.researchToggle.checked = false;
      this.researchResults?.replaceChildren();
      if (this.researchResults) this.researchResults.hidden = true;
      this.root.dataset.historyError = 'false';
      if (!this.conversationId) {
        this.historyGeneration += 1;
        this.historyLoading = false;
        this.loadedConversationId = null;
        this.renderHistory([]);
        this.lifecycle.textContent = lifecycleLabels.UNKNOWN;
        this.lifecycle.dataset.lifecycle = 'UNKNOWN';
        this.setPresence('UNKNOWN');
        this.root.dataset.requestReview = 'UNKNOWN';
        this.root.dataset.enforcement = 'UNKNOWN';
        this.root.dataset.provider = 'UNKNOWN';
        this.root.dataset.responseSafety = 'UNKNOWN';
        this.root.dataset.responseDisposition = 'UNKNOWN';
        this.output.textContent = 'Start a request with PARMAR.';
        this.transport.textContent = 'No request in progress.';
        return;
      }
      this.renderHistory([]);
      this.output.textContent = 'Loading the selected PARMAR conversation.';
      if (this.authenticated && (refresh || this.loadedConversationId !== this.conversationId)) {
        void this.loadConversation(this.conversationId, { force: refresh });
      }
    }

    async loadConversation(conversationId, { force = false } = {}) {
      if (!this.authenticated || !isConversationId(conversationId)
        || (!force && this.loadedConversationId === conversationId)) return false;
      const generation = ++this.historyGeneration;
      const authenticationGeneration = this.authenticationGeneration;
      const conversationGeneration = this.conversationGeneration;
      this.historyLoading = true;
      this.transport.textContent = 'Loading conversation history.';
      this.submitButton.disabled = true;
      try {
        const response = await this.request(
          `/api/conversations/${encodeURIComponent(conversationId)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('Conversation history is unavailable.');
        const payload = await response.json();
        if (generation !== this.historyGeneration
          || authenticationGeneration !== this.authenticationGeneration
          || !this.authenticated) return false;
        if (payload?.conversation_id !== conversationId
          || !Array.isArray(payload.messages)
          || !payload.messages.every((message) => (
            message
            && ['user', 'assistant'].includes(message.role)
            && typeof message.content === 'string'
            && isValidPersistedResearch(message)
          ))) {
          throw new TypeError('Conversation history did not match the supported contract.');
        }
        this.renderHistory(payload.messages);
        this.loadedConversationId = conversationId;
        this.recentMessages = [];
        this.lifecycle.textContent = lifecycleLabels.UNKNOWN;
        this.lifecycle.dataset.lifecycle = 'UNKNOWN';
        this.setPresence('UNKNOWN');
        this.output.textContent = 'Historical messages are shown below. They were not replayed.';
        this.transport.textContent = 'Conversation history restored.';
        return true;
      } catch (_error) {
        if (generation !== this.historyGeneration
          || authenticationGeneration !== this.authenticationGeneration) return false;
        this.loadedConversationId = null;
        this.renderHistory([]);
        this.output.textContent = 'VOKKI could not restore this conversation.';
        this.transport.textContent = 'Conversation history unavailable. No history was substituted.';
        this.root.dataset.historyError = 'true';
        return false;
      } finally {
        if (generation === this.historyGeneration
          && authenticationGeneration === this.authenticationGeneration) {
          this.historyLoading = false;
          this.submitButton.disabled = false;
        }
      }
    }

    renderHistory(messages) {
      if (!this.historyMessages || !this.history) return;
      const rendered = [];
      for (const message of messages) {
        const item = globalThis.document?.createElement?.('article');
        if (!item) break;
        item.className = `voki-history-message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
        item.setAttribute('role', 'group');
        item.setAttribute('aria-label', message.role === 'assistant' ? 'PARMAR response' : 'Your message');
        const author = globalThis.document.createElement('strong');
        author.textContent = message.role === 'assistant' ? 'PARMAR' : 'You';
        const content = globalThis.document.createElement('p');
        content.textContent = message.content;
        item.append(author, content);
        if (message.role === 'assistant' && message.research) {
          globalThis.PARMARChatPresentation?.renderResearchResult(item, {
            research: message.research,
            persisted_release: true,
          });
        }
        rendered.push(item);
      }
      this.historyMessages.replaceChildren(...rendered);
      this.history.hidden = rendered.length === 0;
    }

    renderIdentityOnboarding({ state, message }) {
      if (!this.identityStatus) return;
      const identityControls = [
        this.identityStart,
        this.identityEnable,
        this.identityCapture,
        this.identityApprove,
        this.identityRetake,
        this.identityCancel,
        this.identityRemove,
      ];
      const focusedControl = globalThis.document?.activeElement;
      this.root.dataset.identityOnboarding = state;
      this.identityStatus.textContent = message;
      const permissionRequired = state === 'PERMISSION_REQUIRED';
      const captureReady = state === 'CAPTURE_READY';
      const previewAvailable = Boolean(this.identityOnboarding?.temporaryUrl);
      const approvalRequired = state === 'USER_APPROVAL_REQUIRED'
        || (state === 'ERROR' && Boolean(this.identityOnboarding?.temporaryBlob));

      if (this.identityVideo) this.identityVideo.hidden = !captureReady;
      if (this.identityPreview) {
        if (previewAvailable) this.identityPreview.src = this.identityOnboarding.temporaryUrl;
        else this.identityPreview.removeAttribute('src');
        this.identityPreview.hidden = !previewAvailable;
      }
      if (this.identityStart) {
        this.identityStart.hidden = ['PERMISSION_REQUIRED', 'CAPTURE_READY', 'CAPTURED', 'PREVIEW', 'USER_APPROVAL_REQUIRED'].includes(state);
        this.identityStart.hidden ||= approvalRequired || state === 'SAVED';
        this.identityStart.disabled = !this.identityOnboarding?.store?.scope;
        this.identityStart.textContent = state === 'DENIED' || state === 'ERROR'
          ? 'Try identity setup again'
          : 'Set up an optional visual reference';
      }
      if (this.identityEnable) {
        this.identityEnable.hidden = !permissionRequired;
        this.identityEnable.disabled = Boolean(this.identityOnboarding?.cameraRequestPending);
      }
      if (this.identityCapture) {
        this.identityCapture.hidden = !captureReady;
        this.identityCapture.disabled = Boolean(this.identityOnboarding?.capturePending);
      }
      if (this.identityApprove) {
        this.identityApprove.hidden = !approvalRequired;
        this.identityApprove.disabled = Boolean(this.identityOnboarding?.approvalPending);
      }
      if (this.identityRetake) {
        this.identityRetake.hidden = !approvalRequired;
        this.identityRetake.disabled = Boolean(this.identityOnboarding?.approvalPending);
      }
      if (this.identityCancel) {
        this.identityCancel.hidden = !['PERMISSION_REQUIRED', 'CAPTURE_READY', 'CAPTURED', 'PREVIEW', 'USER_APPROVAL_REQUIRED', 'ERROR'].includes(state);
        this.identityCancel.disabled = Boolean(this.identityOnboarding?.approvalPending);
      }
      if (this.identityRemove) {
        this.identityRemove.hidden = this.avatar?.identity?.kind !== 'approved-reference';
      }
      if (identityControls.includes(focusedControl) && (focusedControl.hidden || focusedControl.disabled)) {
        this.focusIdentityControl(this.identityStatus);
      }
    }

    renderResult(result) {
      this.researchResults?.replaceChildren();
      if (this.researchResults) this.researchResults.hidden = true;
      const contract = result?.voki_contract;
      const interpreted = interpretContract(contract);
      this.lifecycle.textContent = interpreted.lifecycleLabel;
      this.lifecycle.dataset.lifecycle = interpreted.lifecycleState;
      this.setPresence(interpreted.lifecycleState);
      dispatchWindowEvent('parmar-voki-lifecycle-updated', {
        lifecycleState: interpreted.lifecycleState,
      });
      this.root.dataset.requestReview = interpreted.requestReviewStatus;
      this.root.dataset.enforcement = interpreted.enforcementStatus;
      this.root.dataset.provider = interpreted.providerStatus;
      this.root.dataset.responseSafety = interpreted.responseSafety;
      this.root.dataset.responseDisposition = interpreted.disposition;
      if (interpreted.providerStatus === 'COMPLETED') {
        this.output.textContent = interpreted.lifecycleState === 'RELEASED'
          && interpreted.responseSafety === 'PASS'
          && interpreted.disposition === 'RELEASED'
          && typeof result?.message === 'string'
          ? result.message
          : 'PARMAR withheld the provider response.';
      } else if (interpreted.providerStatus === 'FAILED') {
        this.output.textContent = 'The configured provider is unavailable.';
      } else if (['WAITING_FOR_HUMAN', 'BLOCKED', 'WITHHELD'].includes(interpreted.lifecycleState)) {
        this.output.textContent = interpreted.message || 'PARMAR has not released a provider response.';
      } else {
        this.output.textContent = 'PARMAR returned no released response.';
      }
      if (
        this.researchResults
        && globalThis.PARMARChatPresentation?.isAuthoritativelyReleased(result)
      ) {
        const presentation = globalThis.PARMARChatPresentation.renderResearchResult(
          this.researchResults,
          result,
        );
        this.researchResults.hidden = !presentation;
      }
      this.speech?.speakReleasedResponse(result);
      this.approvalId = typeof result?.approval_id === 'string'
        && interpreted.approvalStatus === 'PENDING'
        && interpreted.approvalRecord === 'AVAILABLE'
        ? result.approval_id
        : null;
      this.conversationId = typeof result?.conversation_id === 'string'
        ? result.conversation_id
        : this.conversationId;
      const hasPendingRecord = Boolean(this.approvalId);
      this.approval.hidden = !hasPendingRecord;
      this.approvalMessage.textContent = hasPendingRecord
        ? 'PARMAR is waiting for your decision on this reviewed request.'
        : '';
      this.transport.textContent = 'No request in progress.';
      return interpreted;
    }

    setPresence(lifecycleState) {
      const state = Object.hasOwn(lifecyclePresence, lifecycleState) ? lifecycleState : 'UNKNOWN';
      const visualState = lifecyclePresence[state];
      this.root.dataset.presenceState = visualState;
      this.avatar?.setLifecycle(state);
      if (this.presence) {
        this.presence.dataset.presenceState = visualState;
        this.presence.dataset.lifecycleState = state;
        this.presence.setAttribute('aria-label', `VOKKI presence: ${lifecycleLabels[state]}`);
      }
      if (this.presenceLabel) this.presenceLabel.textContent = lifecycleLabels[state];
    }

    handleSpeechState({ state, boundary }) {
      const speechState = ['IDLE', 'QUEUED', 'SPEAKING', 'ENDED', 'ERROR', 'CANCELLED'].includes(state)
        ? state
        : 'ERROR';
      this.root.dataset.speechState = speechState;
      if (this.presence) this.presence.dataset.speechState = speechState;
      if (Number.isInteger(boundary) && boundary >= 0) {
        this.root.dataset.speechBoundary = String(boundary);
      } else {
        delete this.root.dataset.speechBoundary;
      }
      if (this.speechStatus) {
        this.speechStatus.textContent = {
          IDLE: this.speech?.available
            ? this.speech?.enabled
              ? 'Speech is enabled for released responses.'
              : 'Speech is off. Enable it to hear released responses.'
            : 'Browser speech synthesis is unavailable.',
          QUEUED: 'Released response queued for browser speech.',
          SPEAKING: 'VOKKI is speaking a released response.',
          ENDED: 'Speech finished.',
          ERROR: 'Browser speech could not complete this response.',
          CANCELLED: 'Speech cancelled.',
        }[speechState];
      }
      if (this.stopSpeechButton) {
        this.stopSpeechButton.hidden = !['QUEUED', 'SPEAKING'].includes(speechState);
      }
      this.syncSpeechControls();
    }

    syncSpeechControls() {
      if (!this.speechToggle) return;
      this.speechToggle.disabled = !this.speech?.available;
      this.speechToggle.checked = Boolean(this.speech?.enabled);
    }

    async submitRequest() {
      if (this.historyLoading) return;
      const message = this.input.value.trim();
      if (!message) {
        this.input.focus();
        return;
      }
      const requestId = this.beginRequest();
      if (requestId === null || requestId === false) return;

      const authenticationGeneration = this.authenticationGeneration;
      const conversationGeneration = this.conversationGeneration;
      this.speech?.cancel();
      this.transport.textContent = 'Waiting for PARMAR response.';
      this.submitButton.disabled = true;
      this.approval.hidden = true;
      this.approvalId = null;
      this.researchResults?.replaceChildren();
      if (this.researchResults) this.researchResults.hidden = true;
      try {
        const response = await this.request('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            language: this.getLanguage(),
            ...(this.conversationId ? { conversation_id: this.conversationId } : {}),
            ...(this.researchToggle?.checked === true ? { research: true } : {}),
            ...(!this.authenticated && this.recentMessages.length
              ? { context: { recent_messages: this.recentMessages.slice(-12) } }
              : {}),
          }),
        });
        if (!response.ok) throw new Error('VOKKI request failed.');
        const result = await response.json();
        if (authenticationGeneration !== this.authenticationGeneration
          || conversationGeneration !== this.conversationGeneration) return;
        this.renderResult(result);
        if (!this.authenticated) {
          this.recentMessages = [
            ...this.recentMessages,
            { role: 'user', content: message },
            { role: 'assistant', content: this.output.textContent },
          ].slice(-12);
        }
        await this.synchronizeConversation(result);
        this.input.value = '';
      } catch (_error) {
        if (authenticationGeneration !== this.authenticationGeneration
          || conversationGeneration !== this.conversationGeneration) return;
        this.lifecycle.textContent = lifecycleLabels.UNKNOWN;
        this.lifecycle.dataset.lifecycle = 'UNKNOWN';
        this.setPresence('UNKNOWN');
        this.output.textContent = 'VOKKI could not receive a PARMAR result.';
        this.transport.textContent = 'Request unavailable.';
        this.approval.hidden = true;
        this.approvalId = null;
      } finally {
        this.submitButton.disabled = false;
        this.finishRequest(requestId);
      }
    }

    async submitDecision(decision) {
      if (!this.approvalId || !['APPROVE', 'REJECT'].includes(decision)) return;
      const requestId = this.beginRequest();
      if (requestId === null || requestId === false) return;

      const authenticationGeneration = this.authenticationGeneration;
      const conversationGeneration = this.conversationGeneration;
      this.transport.textContent = 'Submitting your decision to PARMAR.';
      this.root.querySelectorAll('[data-voki-decision]').forEach((button) => {
        button.disabled = true;
      });
      try {
        const response = await this.request('/api/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approval_id: this.approvalId, decision }),
        });
        if (!response.ok) throw new Error('VOKKI decision request failed.');
        const result = await response.json();
        if (authenticationGeneration !== this.authenticationGeneration
          || conversationGeneration !== this.conversationGeneration) return;
        this.renderResult(result);
        await this.synchronizeConversation(result);
      } catch (_error) {
        if (authenticationGeneration !== this.authenticationGeneration
          || conversationGeneration !== this.conversationGeneration) return;
        this.lifecycle.textContent = lifecycleLabels.UNKNOWN;
        this.lifecycle.dataset.lifecycle = 'UNKNOWN';
        this.setPresence('UNKNOWN');
        this.output.textContent = 'VOKKI could not confirm the decision result.';
        this.transport.textContent = 'Decision result unavailable.';
        this.approval.hidden = true;
        this.approvalId = null;
      } finally {
        this.root.querySelectorAll('[data-voki-decision]').forEach((button) => {
          button.disabled = false;
        });
        this.finishRequest(requestId);
      }
    }

    async synchronizeConversation(result) {
      if (!this.authenticated || !isConversationId(result?.conversation_id)) return;
      this.conversationId = result.conversation_id;
      dispatchWindowEvent('parmar-voki-conversation-activated', {
        conversationId: result.conversation_id,
      });
      await this.loadConversation(result.conversation_id, { force: true });
    }
  }

  const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isConversationId(value) {
    return typeof value === 'string' && CONVERSATION_ID_PATTERN.test(value);
  }

  function isValidPersistedResearch(message) {
    if (message.research === undefined) return true;
    if (message.role !== 'assistant'
      || typeof globalThis.PARMARChatPresentation?.researchPresentation !== 'function') return false;
    const presentation = globalThis.PARMARChatPresentation.researchPresentation({
      research: message.research,
      persisted_release: true,
    });
    return Boolean(presentation && presentation.status !== 'INVALID_RESULTS');
  }

  function dispatchWindowEvent(name, detail) {
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new globalThis.CustomEvent(name, { detail }));
    }
  }

  return {
    VOKKIInterface,
    interpretContract,
    lifecycleLabels,
    lifecyclePresence,
    isConversationId,
    isValidPersistedResearch,
    futurePresentationStates: ['speaking'],
  };
});
