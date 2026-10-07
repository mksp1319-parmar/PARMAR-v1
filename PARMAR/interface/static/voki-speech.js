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
    VOKKIRecognitionAdapter,
    isReleasedResponse,
    recognitionLanguage,
  };
});
