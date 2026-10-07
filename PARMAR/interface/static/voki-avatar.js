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
  const APPROVED_REFERENCE_IDENTITY = Object.freeze({
    id: 'vokki-approved-reference',
    kind: 'approved-reference',
    source: 'local-indexeddb',
    asset: 'approved-voki-reference',
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

  function isCatalogIdentity(identity) {
    return identity?.kind === 'catalog'
      && typeof identity.id === 'string'
      && typeof identity.asset === 'string'
      && identity.asset.startsWith('/static/assets/voki/')
      && !identity.asset.split('/').includes('..');
  }

  function resolveIdentity(identity) {
    if (identity?.id === DEFAULT_VOKKI_IDENTITY.id) return DEFAULT_VOKKI_IDENTITY;
    return isCatalogIdentity(identity) ? identity : DEFAULT_VOKKI_IDENTITY;
  }

  class VOKKIAvatarPresentation {
    constructor({
      root: element,
      identity = DEFAULT_VOKKI_IDENTITY,
      appearanceAdapter = null,
    } = {}) {
      if (!element) throw new TypeError('VOKKI avatar presentation requires a root element.');
      this.root = element;
      this.identity = resolveIdentity(identity);
      this.appearanceAdapter = appearanceAdapter;
      this.lifecycle = 'UNKNOWN';
      this.initialize();
    }

    initialize() {
      this.root.dataset.avatarIdentity = this.identity.id;
      this.root.dataset.avatarKind = this.identity.kind;
      this.defaultImage = this.root.querySelector('[data-voki-default-image]');
      this.referenceImage = this.root.querySelector('[data-voki-approved-image]');
      if (this.defaultImage) {
        this.defaultImage.src = this.identity.asset;
        this.defaultImage.hidden = false;
        this.root.dataset.avatarAppearance = this.identity.kind === 'catalog'
          ? 'catalog'
          : 'reference-default';
      }
      if (this.appearanceAdapter) {
        if (typeof this.appearanceAdapter.mount !== 'function') {
          throw new TypeError('VOKKI appearance adapter must provide mount().');
        }
        this.appearanceAdapter.mount({
          host: this.root,
          identity: this.identity,
        });
      }
      this.setLifecycle('UNKNOWN');
    }

    setIdentity(identity = DEFAULT_VOKKI_IDENTITY, assetUrl = null) {
      const hasApprovedReference = identity?.kind === 'approved-reference'
        && typeof assetUrl === 'string'
        && assetUrl.startsWith('blob:');
      this.identity = hasApprovedReference
        ? identity
        : isCatalogIdentity(identity)
          ? identity
          : DEFAULT_VOKKI_IDENTITY;
      this.root.dataset.avatarIdentity = this.identity.id;
      this.root.dataset.avatarKind = this.identity.kind;

      if (this.referenceImage) {
        if (hasApprovedReference) {
          this.referenceImage.src = assetUrl;
          this.referenceImage.hidden = false;
          this.root.dataset.avatarAppearance = 'approved-reference';
        } else {
          this.referenceImage.removeAttribute('src');
          this.referenceImage.hidden = true;
          this.root.dataset.avatarAppearance = this.identity.kind === 'catalog'
            ? 'catalog'
            : 'reference-default';
        }
      }
      if (this.defaultImage) {
        this.defaultImage.src = this.identity.asset;
        this.defaultImage.hidden = hasApprovedReference;
        if (!hasApprovedReference) {
          this.root.dataset.avatarAppearance = this.identity.kind === 'catalog'
            ? 'catalog'
            : 'reference-default';
        }
      }
      this.appearanceAdapter?.setIdentity?.({
        host: this.root,
        identity: this.identity,
        assetUrl: hasApprovedReference ? assetUrl : null,
      });
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
    APPROVED_REFERENCE_IDENTITY,
    VOKKIAvatarPresentation,
    lifecycleExpressions,
  };
});
