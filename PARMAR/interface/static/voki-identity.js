(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PARMARVOKKIIdentity = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const ONBOARDING_STATES = Object.freeze([
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
  const IDENTITY_RECORD_KEY = 'approved-voki-reference';
  const CAMERA_TIMEOUT_MS = 60_000;
  const transitions = Object.freeze({
    IDLE: ['PERMISSION_REQUIRED', 'SAVED'],
    PERMISSION_REQUIRED: ['CAPTURE_READY', 'CANCELLED', 'DENIED', 'ERROR'],
    CAPTURE_READY: ['CAPTURED', 'CANCELLED', 'ERROR'],
    CAPTURED: ['PREVIEW', 'CANCELLED', 'ERROR'],
    PREVIEW: ['USER_APPROVAL_REQUIRED', 'PERMISSION_REQUIRED', 'CANCELLED', 'ERROR'],
    USER_APPROVAL_REQUIRED: ['SAVED', 'PERMISSION_REQUIRED', 'CANCELLED', 'ERROR'],
    SAVED: ['IDLE'],
    CANCELLED: ['IDLE', 'PERMISSION_REQUIRED'],
    DENIED: ['PERMISSION_REQUIRED', 'CANCELLED'],
    ERROR: ['PERMISSION_REQUIRED', 'USER_APPROVAL_REQUIRED', 'SAVED', 'CANCELLED'],
  });

  class LocalVOKKIIdentityStore {
    constructor(indexedDB = globalThis.indexedDB) {
      this.indexedDB = indexedDB;
      this.databasePromise = null;
    }

    open() {
      if (!this.indexedDB) return Promise.reject(new Error('Local identity storage is unavailable.'));
      if (!this.databasePromise) {
        this.databasePromise = new Promise((resolve, reject) => {
          const request = this.indexedDB.open('parmar-vokki-identity', 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('identities')) {
              request.result.createObjectStore('identities');
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('Could not open local identity storage.'));
          request.onblocked = () => reject(new Error('Local identity storage is blocked by another tab.'));
        });
      }
      return this.databasePromise;
    }

    async get() {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('identities', 'readonly');
        const request = transaction.objectStore('identities').get(IDENTITY_RECORD_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Could not read the approved local identity.'));
      });
    }

    async save(blob) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('identities', 'readwrite');
        transaction.objectStore('identities').put({ blob }, IDENTITY_RECORD_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not save the approved local identity.'));
        transaction.onabort = () => reject(transaction.error || new Error('Saving the approved local identity was aborted.'));
      });
    }

    async delete() {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('identities', 'readwrite');
        transaction.objectStore('identities').delete(IDENTITY_RECORD_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not remove the local identity.'));
        transaction.onabort = () => reject(transaction.error || new Error('Removing the local identity was aborted.'));
      });
    }
  }

  function captureVideoFrame(video, documentObject = globalThis.document) {
    if (!documentObject || !video?.videoWidth || !video?.videoHeight) {
      return Promise.reject(new Error('Camera image is not ready to capture.'));
    }
    const maxDimension = 1024;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = documentObject.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('Could not prepare the local image preview.'));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture a still image.'));
      }, 'image/jpeg', 0.82);
    });
  }

  class VOKKIIdentityOnboarding {
    constructor({
      mediaDevices = globalThis.navigator?.mediaDevices,
      video,
      store = new LocalVOKKIIdentityStore(),
      renderer,
      captureFrame: capture = captureVideoFrame,
      createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
      revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
      setTimeoutFn = globalThis.setTimeout,
      clearTimeoutFn = globalThis.clearTimeout,
      cameraTimeoutMs = CAMERA_TIMEOUT_MS,
      onStateChange = () => {},
    } = {}) {
      this.mediaDevices = mediaDevices;
      this.video = video;
      this.store = store;
      this.renderer = renderer;
      this.captureFrame = capture;
      this.createObjectURL = createObjectURL;
      this.revokeObjectURL = revokeObjectURL;
      this.setTimeoutFn = setTimeoutFn;
      this.clearTimeoutFn = clearTimeoutFn;
      this.cameraTimeoutMs = cameraTimeoutMs;
      this.onStateChange = onStateChange;
      this.state = 'IDLE';
      this.stream = null;
      this.temporaryBlob = null;
      this.temporaryUrl = null;
      this.approvedUrl = null;
      this.cameraTimer = null;
      this.cameraRequestPending = false;
      this.cameraAttempt = 0;
      this.capturePending = false;
      this.approvalPending = false;
      this.message = '';
      if (!this.video || !this.renderer || typeof this.renderer.setIdentity !== 'function') {
        throw new TypeError('VOKKI identity onboarding requires a video element and avatar renderer.');
      }
    }

    transition(state, message = '') {
      if (!ONBOARDING_STATES.includes(state)
        || (state !== this.state && !transitions[this.state].includes(state))) {
        throw new Error(`Invalid VOKKI identity onboarding transition: ${this.state} -> ${state}`);
      }
      this.state = state;
      this.message = message;
      this.onStateChange({ state, message });
    }

    start() {
      if (['IDLE', 'CANCELLED', 'DENIED', 'ERROR'].includes(this.state)) {
        this.transition('PERMISSION_REQUIRED', 'Camera access is optional. A single still is kept on this device only if you approve it.');
      }
    }

    async requestCamera() {
      if (this.state !== 'PERMISSION_REQUIRED' || this.cameraRequestPending) return false;
      if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') {
        this.transition('ERROR', 'Camera access is unavailable. VOKKI continues with its current identity.');
        return false;
      }
      const attempt = ++this.cameraAttempt;
      this.cameraRequestPending = true;
      this.transition('PERMISSION_REQUIRED', 'Waiting for browser permission. Cancel to continue without camera access.');
      let stream = null;
      try {
        stream = await this.mediaDevices.getUserMedia({ video: true, audio: false });
        if (attempt !== this.cameraAttempt || this.state !== 'PERMISSION_REQUIRED') {
          for (const track of stream.getTracks()) track.stop();
          return false;
        }
        this.stream = stream;
        this.video.srcObject = this.stream;
        this.video.muted = true;
        this.cameraTimer = this.setTimeoutFn(() => {
          if (attempt !== this.cameraAttempt || !['PERMISSION_REQUIRED', 'CAPTURE_READY'].includes(this.state)) return;
          this.cameraAttempt += 1;
          this.cameraRequestPending = false;
          this.stopStream();
          this.transition('ERROR', 'Camera setup timed out and the camera was stopped. You can try again.');
        }, this.cameraTimeoutMs);
        await this.video.play();
        if (attempt !== this.cameraAttempt || this.state !== 'PERMISSION_REQUIRED') {
          if (this.stream === stream) this.stopStream();
          else for (const track of stream.getTracks()) track.stop();
          return false;
        }
        this.cameraRequestPending = false;
        this.transition('CAPTURE_READY', 'Camera ready. Capture one still, or cancel; the camera will stop after capture.');
        return true;
      } catch (error) {
        const isCurrentAttempt = attempt === this.cameraAttempt;
        if (this.stream === stream) this.stopStream();
        else if (stream) for (const track of stream.getTracks()) track.stop();
        if (!isCurrentAttempt) return false;
        this.cameraRequestPending = false;
        if (this.state !== 'PERMISSION_REQUIRED') return false;
        if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
          this.transition('DENIED', 'Camera permission was not granted. VOKKI continues with its current identity.');
        } else {
          this.transition('ERROR', 'Camera could not be started. VOKKI continues with its current identity.');
        }
        return false;
      }
    }

    stopStream() {
      if (this.cameraTimer !== null) {
        this.clearTimeoutFn(this.cameraTimer);
        this.cameraTimer = null;
      }
      const stream = this.stream;
      this.stream = null;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      if (this.video.srcObject) this.video.srcObject = null;
    }

    async capture() {
      if (this.state !== 'CAPTURE_READY' || this.capturePending) return false;
      this.capturePending = true;
      this.transition('CAPTURE_READY', 'Capturing one temporary still. The camera will stop immediately afterward.');
      let blob;
      try {
        blob = await this.captureFrame(this.video);
      } catch (_error) {
        this.capturePending = false;
        this.stopStream();
        if (this.state !== 'CAPTURE_READY') return false;
        this.transition('ERROR', 'The still could not be captured. The camera was stopped; your current identity remains active.');
        return false;
      }
      this.capturePending = false;
      this.stopStream();
      if (this.state !== 'CAPTURE_READY') return false;
      if (!blob || typeof this.createObjectURL !== 'function') {
        this.transition('ERROR', 'A local preview could not be created. Your current identity remains active.');
        return false;
      }
      this.temporaryBlob = blob;
      try {
        this.temporaryUrl = this.createObjectURL(blob);
      } catch (_error) {
        this.discardTemporaryCapture();
        this.transition('ERROR', 'A local preview could not be created. Your current identity remains active.');
        return false;
      }
      this.transition('CAPTURED', 'Still captured. The camera is off.');
      this.transition('PREVIEW', 'Review the temporary preview. It is not saved yet.');
      this.transition('USER_APPROVAL_REQUIRED', 'Approve to save this still on this device, retake it, or cancel.');
      return true;
    }

    async approve() {
      if (this.state !== 'USER_APPROVAL_REQUIRED'
        && !(this.state === 'ERROR' && this.temporaryBlob)) return false;
      if (this.approvalPending) return false;
      this.approvalPending = true;
      this.onStateChange({ state: this.state, message: 'Saving the approved still on this device.' });
      try {
        await this.store.save(this.temporaryBlob);
      } catch (_error) {
        this.approvalPending = false;
        this.transition('ERROR', 'The still could not be saved locally. Nothing was approved; retry or cancel.');
        return false;
      }
      this.approvalPending = false;
      if (this.approvedUrl && typeof this.revokeObjectURL === 'function') {
        this.revokeObjectURL(this.approvedUrl);
      }
      this.approvedUrl = this.temporaryUrl;
      this.temporaryUrl = null;
      this.renderer.setIdentity(
        globalThis.PARMARVOKKIAvatar?.APPROVED_REFERENCE_IDENTITY || {
          id: 'vokki-approved-reference',
          kind: 'approved-reference',
          source: 'local-indexeddb',
          asset: IDENTITY_RECORD_KEY,
        },
        this.approvedUrl,
      );
      this.temporaryBlob = null;
      this.transition('SAVED', 'Approved reference saved on this device. The camera is off.');
      return true;
    }

    async loadApprovedIdentity() {
      try {
        const record = await this.store.get();
        if (!record?.blob || typeof this.createObjectURL !== 'function') return false;
        this.approvedUrl = this.createObjectURL(record.blob);
        this.renderer.setIdentity(
          globalThis.PARMARVOKKIAvatar?.APPROVED_REFERENCE_IDENTITY || {
            id: 'vokki-approved-reference',
            kind: 'approved-reference',
            source: 'local-indexeddb',
            asset: IDENTITY_RECORD_KEY,
          },
          this.approvedUrl,
        );
        const message = 'An approved local reference is active. The bundled avatar is available by removing it.';
        if (this.state === 'IDLE') this.transition('SAVED', message);
        else this.onStateChange({ state: this.state, message });
        return true;
      } catch (_error) {
        this.onStateChange({
          state: this.state,
          message: 'Local identity storage could not be read. The bundled avatar remains active.',
        });
        return false;
      }
    }

    discardTemporaryCapture() {
      this.temporaryBlob = null;
      if (this.temporaryUrl && typeof this.revokeObjectURL === 'function') {
        this.revokeObjectURL(this.temporaryUrl);
      }
      this.temporaryUrl = null;
    }

    retake() {
      if (this.approvalPending || !['USER_APPROVAL_REQUIRED', 'PREVIEW', 'ERROR'].includes(this.state)) return false;
      this.discardTemporaryCapture();
      this.transition('PERMISSION_REQUIRED', 'The temporary still was discarded. Enable camera to try again; your current identity remains active.');
      return true;
    }

    cancel() {
      if (this.approvalPending || this.state === 'SAVED' || this.state === 'IDLE') return false;
      this.cameraAttempt += 1;
      this.cameraRequestPending = false;
      this.capturePending = false;
      this.stopStream();
      this.discardTemporaryCapture();
      const identityMessage = this.renderer.identity?.kind === 'approved-reference'
        ? 'Your previously approved local identity remains active.'
        : 'The bundled avatar remains active.';
      this.transition('CANCELLED', `Setup cancelled. ${identityMessage}`);
      return true;
    }

    async removeApprovedIdentity() {
      try {
        await this.store.delete();
      } catch (_error) {
        this.onStateChange({
          state: this.state,
          message: 'The approved local reference could not be removed. It remains active.',
        });
        return false;
      }
      this.renderer.setIdentity();
      if (this.approvedUrl && typeof this.revokeObjectURL === 'function') {
        this.revokeObjectURL(this.approvedUrl);
      }
      this.approvedUrl = null;
      if (this.state === 'SAVED') this.transition('IDLE', 'Local reference removed. The bundled avatar is active.');
      else this.onStateChange({ state: this.state, message: 'Local reference removed. The bundled avatar is active.' });
      return true;
    }
  }

  return {
    ONBOARDING_STATES,
    IDENTITY_RECORD_KEY,
    CAMERA_TIMEOUT_MS,
    LocalVOKKIIdentityStore,
    VOKKIIdentityOnboarding,
    captureVideoFrame,
  };
});
