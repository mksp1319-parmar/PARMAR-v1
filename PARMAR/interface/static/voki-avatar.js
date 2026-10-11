(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PARMARVOKKIAvatar = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const DEFAULT_VOKKI_IDENTITY = Object.freeze({
    id: 'vokki-local-default',
    kind: 'local-default',
    source: 'reference-crop',
    reference: 'file_00000000bd50820b9c027852032b8da5.png',
    asset: '/static/assets/voki/default-avatar.png',
  });
  const lifecycleExpressions = Object.freeze({
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

  function resolveIdentity() {
    return DEFAULT_VOKKI_IDENTITY;
  }

  class VOKKIAvatarPresentation {
    constructor({
      root: element,
    } = {}) {
      if (!element) throw new TypeError('VOKKI avatar presentation requires a root element.');
      this.root = element;
      this.identity = resolveIdentity();
      this.lifecycle = 'UNKNOWN';
      this.initialize();
    }

    initialize() {
      this.root.dataset.avatarIdentity = this.identity.id;
      this.root.dataset.avatarKind = this.identity.kind;
      this.defaultImage = this.root.querySelector('[data-voki-default-image]');
      if (this.defaultImage) {
        this.defaultImage.src = this.identity.asset;
        this.defaultImage.hidden = false;
        this.root.dataset.avatarAppearance = 'reference-default';
      }
      this.setLifecycle('UNKNOWN');
    }

    setIdentity() {
      this.identity = resolveIdentity();
      this.root.dataset.avatarIdentity = this.identity.id;
      this.root.dataset.avatarKind = this.identity.kind;
      if (this.defaultImage) {
        this.defaultImage.src = this.identity.asset;
        this.defaultImage.hidden = false;
        this.root.dataset.avatarAppearance = 'reference-default';
      }
      return this.identity;
    }

    setLifecycle(lifecycleState) {
      const lifecycle = Object.hasOwn(lifecycleExpressions, lifecycleState)
        ? lifecycleState
        : 'UNKNOWN';
      const expression = lifecycleExpressions[lifecycle];
      this.lifecycle = lifecycle;
      this.root.dataset.lifecycleState = lifecycle;
      this.root.dataset.expression = expression;
      this.root.setAttribute('aria-label', `VOKKI visual identity, ${expression.replaceAll('-', ' ')}`);
      return expression;
    }
  }

  return {
    DEFAULT_VOKKI_IDENTITY,
    VOKKIAvatarPresentation,
    lifecycleExpressions,
  };
});
