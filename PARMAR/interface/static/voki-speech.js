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

  function isReleasedResponse(result) {
    const contract = result?.voki_contract;
    return Boolean(
      contract?.lifecycle?.state === 'RELEASED'
      && contract?.provider?.status === 'COMPLETED'
      && contract?.response_safety?.status === 'PASS'
      && contract?.response_disposition === 'RELEASED'
      && typeof result.message === 'string'
      && result.message.trim(),
    );
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
      if (this.state === 'QUEUED' || this.state === 'SPEAKING') {
        if (!this.cancel()) return false;
      }

      const text = result.message.trim();
      const token = ++this.token;
      const utterance = new this.Utterance(text);
      const language = this.getLanguage();
      utterance.lang = language === 'hi' ? 'hi-IN' : language === 'mix' ? 'en-IN' : 'en-US';
      this.boundary = null;
      this.setState('QUEUED');

      utterance.onstart = () => {
        if (token !== this.token || !this.enabled) return;
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

  return { SPEECH_STATES, VOKKISpeechAdapter, isReleasedResponse };
});
