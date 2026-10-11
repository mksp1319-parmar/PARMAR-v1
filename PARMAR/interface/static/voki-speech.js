(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PARMARVOKKISpeech = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const SPEECH_STATES = Object.freeze([
    'IDLE',
    'QUEUED',
    'SPEAKING',
    'ENDED',
    'ERROR',
    'CANCELLED',
  ]);
  const VOICE_INPUT_STATES = Object.freeze([
    'IDLE',
    'ERROR',
    'REQUESTING_PERMISSION',
    'LISTENING',
    'CANCELLING',
    'TRANSCRIBING',
    'SUBMITTING',
    'SPEAKING',
  ]);

  function recognitionLanguage(language) {
    if (language === 'en') return 'en-US';
    if (language === 'hi') return 'hi-IN';
    return null;
  }

  function isReleasedResponse(result) {
    const contract = result?.voki_contract || result?.analysis?.voki_contract;
    return Boolean(
      contract?.lifecycle?.state === 'RELEASED'
      && contract?.provider?.status === 'COMPLETED'
      && contract?.response_safety?.status === 'PASS'
      && contract?.response_disposition === 'RELEASED'
      && typeof result.message === 'string'
      && result.message.trim(),
    );
  }

  function requestId(value) {
    return typeof value === 'string'
      && value !== 'UNKNOWN'
      && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
      ? value
      : null;
  }

  function createProactiveEvent(result) {
    const contract = result?.voki_contract || result?.analysis?.voki_contract;
    const id = requestId(contract?.request_id);
    if (!id) return null;
    if (isReleasedResponse(result)) {
      return {
        type: 'RELEASED_RESULT',
        requestId: id,
        response: {
          message: result.message.trim(),
          voki_contract: {
            lifecycle: { state: 'RELEASED' },
            provider: { status: 'COMPLETED' },
            response_safety: { status: 'PASS' },
            response_disposition: 'RELEASED',
          },
        },
      };
    }

    if (
      contract?.lifecycle?.state === 'WAITING_FOR_HUMAN'
      && contract?.request_review?.status === 'APPROVAL_REQUIRED'
      && contract?.enforcement?.status === 'HUMAN_APPROVAL_REQUIRED'
      && contract?.approval?.status === 'PENDING'
      && contract?.approval?.record_available === 'AVAILABLE'
    ) {
      return {
        type: 'APPROVAL_REQUIRED',
        requestId: id,
        lifecycleState: 'WAITING_FOR_HUMAN',
        enforcementStatus: 'HUMAN_APPROVAL_REQUIRED',
        approvalStatus: 'PENDING',
        approvalRecordAvailable: 'AVAILABLE',
      };
    }
    return null;
  }

  function normalizeProactiveEvent(event) {
    const id = requestId(event?.requestId);
    if (!id) return null;
    if (event.type === 'RELEASED_RESULT' && isReleasedResponse(event.response)) {
      return {
        type: event.type,
        requestId: id,
        response: {
          message: event.response.message.trim(),
          voki_contract: {
            lifecycle: { state: 'RELEASED' },
            provider: { status: 'COMPLETED' },
            response_safety: { status: 'PASS' },
            response_disposition: 'RELEASED',
          },
        },
      };
    }
    if (
      event.type === 'APPROVAL_REQUIRED'
      && event.lifecycleState === 'WAITING_FOR_HUMAN'
      && event.enforcementStatus === 'HUMAN_APPROVAL_REQUIRED'
      && event.approvalStatus === 'PENDING'
      && event.approvalRecordAvailable === 'AVAILABLE'
    ) {
      return {
        type: event.type,
        requestId: id,
        lifecycleState: event.lifecycleState,
        enforcementStatus: event.enforcementStatus,
        approvalStatus: event.approvalStatus,
        approvalRecordAvailable: event.approvalRecordAvailable,
      };
    }
    return null;
  }

  function approvalNotice(language) {
    if (language === 'hi') return 'PARMAR में एक अनुरोध आपकी समीक्षा की प्रतीक्षा कर रहा है।';
    if (language === 'mix') return 'PARMAR mein ek request aapke review ka intezar kar rahi hai.';
    return 'A PARMAR request is waiting for your review.';
  }

  class VOKKISpeechAdapter {
    constructor({
      synthesis = globalThis.speechSynthesis,
      Utterance = globalThis.SpeechSynthesisUtterance,
      getLanguage = () => 'en',
      onStateChange = () => {},
    } = {}) {
      this.synthesis = synthesis;
      this.Utterance = Utterance;
      this.getLanguage = getLanguage;
      this.onStateChange = onStateChange;
      this.enabled = false;
      this.state = 'IDLE';
      this.token = 0;
      this.boundary = null;
      this.available = Boolean(
        synthesis
        && typeof synthesis.speak === 'function'
        && typeof synthesis.cancel === 'function'
        && typeof Utterance === 'function',
      );
      this.onStateChange({ state: this.state, boundary: null });
    }

    setEnabled(enabled) {
      this.enabled = this.available && Boolean(enabled);
      if (!this.enabled) this.cancel();
      return this.enabled;
    }

    speakReleasedResponse(result) {
      if (!this.enabled || !this.available || !isReleasedResponse(result)) return false;
      return this.speakText(result.message, true);
    }

    speakProactiveEvent(event) {
      if (!this.available) return false;
      const accepted = normalizeProactiveEvent(event);
      if (!accepted) return false;
      if (accepted.type === 'APPROVAL_REQUIRED') {
        return this.speakText(approvalNotice(this.getLanguage()), false);
      }
      return this.speakText(accepted.response.message, false);
    }

    speakText(value, requiresEnabled) {
      if (!this.available || (requiresEnabled && !this.enabled)) return false;
      if (this.state === 'QUEUED' || this.state === 'SPEAKING') {
        if (!this.cancel()) return false;
      }

      const text = value.trim();
      const token = ++this.token;
      const utterance = new this.Utterance(text);
      const language = this.getLanguage();
      utterance.lang = language === 'hi' ? 'hi-IN' : language === 'mix' ? 'en-IN' : 'en-US';
      this.boundary = null;
      this.setState('QUEUED');

      utterance.onstart = () => {
        if (token !== this.token || (requiresEnabled && !this.enabled)) return;
        this.setState('SPEAKING');
      };
      utterance.onboundary = (event) => {
        if (token !== this.token || this.state !== 'SPEAKING') return;
        if (
          Number.isInteger(event?.charIndex)
          && event.charIndex >= 0
          && (event?.name === undefined || event.name === 'word')
        ) {
          this.boundary = event.charIndex;
          this.onStateChange({ state: this.state, boundary: this.boundary });
        }
      };
      utterance.onend = () => {
        if (token !== this.token) return;
        this.setState('ENDED');
      };
      utterance.onerror = (event) => {
        if (token !== this.token) return;
        this.setState(event?.error === 'canceled' || event?.error === 'interrupted' ? 'CANCELLED' : 'ERROR');
      };

      try {
        if (this.synthesis.speaking === true || this.synthesis.pending === true) {
          this.setState('ERROR');
          return false;
        }
        this.synthesis.speak(utterance);
      } catch (_error) {
        if (token === this.token) this.setState('ERROR');
        return false;
      }
      return true;
    }

    cancel() {
      const wasActive = this.state === 'QUEUED' || this.state === 'SPEAKING';
      this.token += 1;
      if (this.available && wasActive) {
        try {
          this.synthesis.cancel();
        } catch (_error) {
          this.boundary = null;
          this.setState('ERROR');
          return false;
        }
      }
      this.boundary = null;
      this.setState(wasActive ? 'CANCELLED' : 'IDLE');
      return true;
    }

    setState(state) {
      this.state = SPEECH_STATES.includes(state) ? state : 'ERROR';
      this.onStateChange({ state: this.state, boundary: this.boundary });
    }
  }

  class VOKKIProactiveSpeech {
    constructor({
      speech,
      isDocumentVisible = () => globalThis.document?.hidden !== true,
      isInterfaceActive = () => true,
      isBusy = () => false,
      now = () => Date.now(),
      eventTtlMs = 15_000,
      minimumIntervalMs = 60_000,
      onStateChange = () => {},
    } = {}) {
      this.speech = speech;
      this.isDocumentVisible = isDocumentVisible;
      this.isInterfaceActive = isInterfaceActive;
      this.isBusy = isBusy;
      this.now = now;
      this.eventTtlMs = eventTtlMs;
      this.minimumIntervalMs = minimumIntervalMs;
      this.onStateChange = onStateChange;
      this.enabled = false;
      this.muted = false;
      this.pending = [];
      this.seen = new Map();
      this.lastAnnouncementAt = null;
      this.ownedSpeechToken = null;
      this.onStateChange({ enabled: this.enabled, muted: this.muted });
    }

    setEnabled(enabled) {
      this.enabled = this.speech?.available === true && enabled === true;
      if (!this.enabled) {
        this.pending = [];
        this.cancelOwnedSpeech();
      }
      this.notifyState();
      return this.enabled;
    }

    setMuted(muted) {
      this.muted = muted === true;
      if (this.muted) {
        this.pending = [];
        this.ownedSpeechToken = null;
        this.speech?.cancel();
      }
      this.notifyState();
      return this.muted;
    }

    enqueueEvent(event) {
      const accepted = normalizeProactiveEvent(event);
      if (
        !accepted
        || !this.enabled
        || this.muted
        || this.speech?.available !== true
        || !this.isDocumentVisible()
        || !this.isInterfaceActive()
      ) return false;

      const now = this.now();
      this.pruneSeen(now);
      const key = `${accepted.type}:${accepted.requestId}`;
      if (this.seen.has(key)) return false;
      this.seen.set(key, now + 10 * 60_000);
      this.pending.push({ key, event: accepted, enqueuedAt: now });
      if (this.pending.length > 4) this.pending.shift();
      return this.flush();
    }

    flush() {
      if (!this.enabled || this.muted || this.speech?.available !== true) {
        this.pending = [];
        return false;
      }
      if (!this.isDocumentVisible() || !this.isInterfaceActive()) {
        this.suspend();
        return false;
      }

      const now = this.now();
      while (this.pending.length > 0) {
        const next = this.pending[0];
        if (now - next.enqueuedAt > this.eventTtlMs) {
          this.pending.shift();
          continue;
        }
        if (this.isBusy()) return false;
        if (
          this.lastAnnouncementAt !== null
          && now - this.lastAnnouncementAt < this.minimumIntervalMs
        ) {
          this.pending.shift();
          continue;
        }
        this.pending.shift();
        if (this.speech.speakProactiveEvent(next.event)) {
          this.lastAnnouncementAt = now;
          this.ownedSpeechToken = this.speech.token;
          return true;
        }
        return false;
      }
      return false;
    }

    suspend() {
      this.pending = [];
      this.cancelOwnedSpeech();
    }

    stopSpeaking() {
      this.pending = [];
      this.ownedSpeechToken = null;
      return this.speech?.cancel() === true;
    }

    cancelOwnedSpeech() {
      if (
        this.ownedSpeechToken !== null
        && this.speech?.token === this.ownedSpeechToken
        && ['QUEUED', 'SPEAKING'].includes(this.speech?.state)
      ) {
        this.speech.cancel();
      }
      this.ownedSpeechToken = null;
    }

    pruneSeen(now) {
      for (const [key, expiresAt] of this.seen) {
        if (expiresAt <= now) this.seen.delete(key);
      }
      while (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value);
    }

    notifyState() {
      this.onStateChange({ enabled: this.enabled, muted: this.muted });
    }
  }

  class VOKKIRecognitionAdapter {
    constructor({
      Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
      getLanguage = () => 'en',
      onStateChange = () => {},
    } = {}) {
      this.Recognition = Recognition;
      this.getLanguage = getLanguage;
      this.onStateChange = onStateChange;
      this.state = 'IDLE';
      this.available = false;
      this.message = 'Checking on-device speech recognition support.';
      this.recognition = null;
      this.generation = 0;
      this.availabilityGeneration = 0;
      this.availableLanguage = null;
      this.onStateChange({ state: this.state, message: this.message, available: false });
      void this.refreshAvailability();
    }

    async refreshAvailability() {
      const generation = ++this.availabilityGeneration;
      const language = recognitionLanguage(this.getLanguage());
      this.available = false;
      this.availableLanguage = null;

      if (!this.Recognition || typeof this.Recognition.available !== 'function') {
        this.setState('ERROR', 'On-device speech recognition is unsupported in this browser.');
        return false;
      }
      if (!language) {
        this.setState('ERROR', 'Voice input supports English or Hindi. Select one of those languages.');
        return false;
      }

      let probe;
      try {
        probe = new this.Recognition();
      } catch (_error) {
        this.setState('ERROR', 'On-device speech recognition is unavailable in this browser.');
        return false;
      }
      if (!('processLocally' in probe)) {
        this.setState('ERROR', 'This browser cannot guarantee on-device speech recognition.');
        return false;
      }

      let availability;
      try {
        availability = await this.Recognition.available({
          langs: [language],
          processLocally: true,
        });
      } catch (_error) {
        if (generation !== this.availabilityGeneration) return false;
        this.setState('ERROR', 'On-device speech availability could not be confirmed.');
        return false;
      }
      if (generation !== this.availabilityGeneration) return false;

      if (availability === 'available') {
        this.available = true;
        this.availableLanguage = language;
        this.setState('IDLE', 'On-device speech is ready. Press Talk to request microphone access.');
        return true;
      }
      const availabilityMessages = {
        downloadable: 'The on-device speech language pack is not installed. This build does not download language packs.',
        downloading: 'The on-device speech language pack is downloading. Try Talk again when it is ready.',
        unavailable: 'On-device speech recognition is unavailable for the selected language.',
      };
      this.setState(
        'ERROR',
        availabilityMessages[availability] || 'On-device speech recognition is unavailable.',
      );
      return false;
    }

    start(onTranscript) {
      if (typeof onTranscript !== 'function') {
        throw new TypeError('Voice input requires a transcript handler.');
      }
      if (!this.available || this.availableLanguage !== recognitionLanguage(this.getLanguage())) {
        if (this.state !== 'ERROR') {
          this.setState('ERROR', 'On-device speech is not ready for the selected language.');
        }
        return false;
      }
      if (this.recognition) return false;

      let recognition;
      try {
        recognition = new this.Recognition();
        recognition.processLocally = true;
        if (recognition.processLocally !== true) {
          this.setState('ERROR', 'This browser cannot guarantee on-device speech recognition.');
          return false;
        }
        recognition.lang = this.availableLanguage;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
      } catch (_error) {
        this.setState('ERROR', 'On-device speech recognition could not be initialized.');
        return false;
      }

      const generation = ++this.generation;
      let failed = false;
      let transcript = '';
      this.recognition = recognition;
      recognition.onstart = () => {
        if (generation !== this.generation) return;
        this.setState('LISTENING', 'VOKKI is listening. Speak once, then it will stop automatically.');
      };
      recognition.onresult = (event) => {
        if (generation !== this.generation) return;
        const results = event?.results;
        if (!results || typeof results.length !== 'number') return;
        const finalParts = [];
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index];
          if (!result?.isFinal) continue;
          const text = result[0]?.transcript;
          if (typeof text === 'string') finalParts.push(text);
        }
        transcript = finalParts.join(' ').trim();
      };
      recognition.onerror = (event) => {
        if (generation !== this.generation) return;
        failed = true;
        const errors = {
          'not-allowed': 'Microphone permission was denied. Allow access in your browser, then try again.',
          'service-not-allowed': 'The browser blocked on-device speech recognition. No cloud fallback was used.',
          'audio-capture': 'No usable microphone is available.',
          'language-not-supported': 'The local speech language pack is unavailable. No cloud fallback was used.',
          'no-speech': 'No speech was detected. Try again when ready.',
          network: 'On-device speech recognition failed. No cloud fallback was used.',
          aborted: 'Voice input was cancelled.',
        };
        this.setState('ERROR', errors[event?.error] || 'On-device speech recognition failed.');
      };
      recognition.onend = () => {
        if (generation !== this.generation) return;
        this.recognition = null;
        if (failed) {
          this.setState('ERROR', this.message);
          return;
        }
        if (!transcript) {
          this.setState('ERROR', 'No transcript was produced. Try again when ready.');
          return;
        }
        this.setState('TRANSCRIBING', 'Transcript received.');
        this.setState('SUBMITTING', 'Submitting the transcript through PARMAR’s existing chat flow.');
        let submission;
        try {
          submission = onTranscript(transcript);
        } catch (_error) {
          this.setState('ERROR', 'The transcript could not be submitted through PARMAR.');
          return;
        }
        Promise.resolve(submission).then(
          () => {
            if (generation === this.generation && this.state === 'SUBMITTING') {
              this.setState('IDLE', 'Voice input complete. Press Talk when you are ready to speak again.');
            }
          },
          () => {
            if (generation === this.generation && this.state === 'SUBMITTING') {
              this.setState('ERROR', 'The transcript could not be submitted through PARMAR.');
            }
          },
        );
      };

      this.setState(
        'REQUESTING_PERMISSION',
        'Requesting microphone permission. Audio recognition is restricted to this device.',
      );
      try {
        recognition.start();
      } catch (_error) {
        if (generation === this.generation) {
          this.recognition = null;
          this.setState('ERROR', 'Microphone access or on-device recognition could not be started.');
        }
        return false;
      }
      return true;
    }

    cancel() {
      const recognition = this.recognition;
      if (!recognition) {
        this.setState('IDLE', 'Voice input is idle.');
        return true;
      }

      const generation = ++this.generation;
      this.setState('CANCELLING', 'Stopping microphone capture.');
      recognition.onend = () => {
        if (generation !== this.generation || this.recognition !== recognition) return;
        this.recognition = null;
        this.setState('IDLE', 'Voice input cancelled. Microphone capture has stopped.');
      };
      try {
        recognition.abort();
      } catch (_error) {
        this.recognition = null;
        this.setState('ERROR', 'The browser could not confirm microphone release.');
        return false;
      }
      return true;
    }

    setState(state, message) {
      this.state = VOICE_INPUT_STATES.includes(state) ? state : 'ERROR';
      this.message = message;
      this.onStateChange({
        state: this.state,
        message: this.message,
        available: this.available,
      });
    }
  }

  return {
    SPEECH_STATES,
    VOICE_INPUT_STATES,
    VOKKISpeechAdapter,
    VOKKIProactiveSpeech,
    VOKKIRecognitionAdapter,
    createProactiveEvent,
    isReleasedResponse,
    normalizeProactiveEvent,
    recognitionLanguage,
  };
});
