const { test, expect } = require('@playwright/test');

const viewports = [
  { name: 'desktop-1440x1000', width: 1440, height: 1000 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

async function openNavigation(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation' });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(page.locator('#sidebar-close')).toBeFocused();
  }
}

async function openMoreWorkspaces(page) {
  const workspaces = page.locator('#sidebar-workspaces');
  if (!await workspaces.evaluate((element) => element.open)) {
    await workspaces.locator(':scope > summary').click();
  }
  await expect(workspaces).toHaveJSProperty('open', true);
}

async function touchSwipe(page, startX, startY, endX, endY) {
  await page.evaluate(({ startX: x1, startY: y1, endX: x2, endY: y2 }) => {
    const target = document.elementFromPoint(x1, y1);
    if (!target) throw new Error('Touch gesture must start on a rendered element.');
    const dispatch = (element, type, x, y) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    }));
    dispatch(target, 'pointerdown', x1, y1);
    for (let step = 1; step <= 8; step += 1) {
      dispatch(document, 'pointermove', x1 + ((x2 - x1) * step) / 8, y1 + ((y2 - y1) * step) / 8);
    }
    dispatch(document, 'pointerup', x2, y2);
  }, { startX, startY, endX, endY });
}

async function expectNoBottomNavigation(page) {
  await expect(page.locator(
    '.mobile-bottom-nav, .mobile-bottom-item, .voki-ecosystem-launcher, [data-bottom-navigation], [data-navigation-dock], [class*="bottom-dock"], [class*="destination-tabs"]',
  )).toHaveCount(0);

  const bottomAnchors = await page.evaluate(() => {
    const destinationSelector = 'button[data-section], a[data-section], [role="link"][data-section], a[href^="#section-"]';
    const navigationSelector = 'nav, [role="navigation"], [role="toolbar"]';
    const candidates = document.querySelectorAll('*');
    return Array.from(candidates).filter((element) => {
      const style = window.getComputedStyle(element);
      if (!['fixed', 'sticky', 'absolute'].includes(style.position)) return false;
      const rect = element.getBoundingClientRect();
      const anchoredAtBottom = window.innerHeight - rect.bottom <= 40;
      const occupiesBottomArea = rect.top >= window.innerHeight * 0.55;
      const containsDestination = element.matches(`${destinationSelector}, ${navigationSelector}`)
        || Boolean(element.querySelector(`${destinationSelector}, ${navigationSelector}`));
      return anchoredAtBottom
        && occupiesBottomArea
        && containsDestination
        && rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    }).map((element) => ({
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className : '',
      label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 80),
    }));
  });
  expect(bottomAnchors, 'No fixed, sticky, or bottom-positioned destination controls').toEqual([]);
}

test('mobile edge gestures open navigation and reach the restricted AETHER workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.locator('#sidebar-toggle');
  const bars = toggle.locator('span');
  await expect(bars).toHaveCount(2);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await bars.evaluateAll((items) => items.map((item) => getComputedStyle(item).transform)))
    .toEqual(['none', 'none']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');

  const toggleBox = await toggle.boundingBox();
  await touchSwipe(page, toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2,
    toggleBox.x + toggleBox.width / 2 + 200, toggleBox.y + toggleBox.height / 2);
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed');

  await page.locator('#sidebar-toggle').click();
  await page.locator('#sidebar [data-section="chat"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed', { timeout: 10_000 });
  const composer = await page.locator('#chat-input').boundingBox();
  const composerStartX = Math.max(1, composer.x + 1);
  await touchSwipe(page, composerStartX, composer.y + composer.height / 2,
    composerStartX + 200, composer.y + composer.height / 2);
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed');
  await page.locator('#sidebar-toggle').click();
  await page.locator('#sidebar button[data-section="home"]').click();

  await touchSwipe(page, 1, 420, 1, 700);
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed');
  await touchSwipe(page, 1, 420, 340, 420);
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'open');
  await expect(page.locator('#discovery-panel')).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed');

  await touchSwipe(page, 389, 420, 45, 420);
  await expect(page.locator('#section-aether')).toHaveClass(/\bactive\b/);
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed');
  await expect(page.locator('#aether-desktop-status')).toContainText('not connected');
  await expect(page.locator('#aether-desktop-open')).toBeHidden();
});

test('primary destinations, Settings, Customize, and Integrations retain their approved locations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const primary = await page.locator('#sidebar .nav [data-primary-navigation]')
    .evaluateAll((items) => items.map((item) => item.dataset.primaryNavigation));
  expect(primary).toEqual(['home', 'chats', 'voki', 'aether', 'marketplace', 'learning']);
  await expect(page.locator('#logout-btn')).toBeHidden();
  await expect(page.locator('#sidebar [data-section="marketplace"]')).toBeVisible();
  await page.locator('#sidebar-workspaces > summary').click();

  await page.locator('#sidebar [data-section="settings"]').click();
  const settings = page.locator('#settings-category-nav [data-settings-category]');
  await expect(settings).toHaveCount(14);
  const settingIds = await settings.evaluateAll((items) => items.map((item) => item.dataset.settingsCategory));
  for (const category of settingIds) {
    const button = page.locator(`#settings-category-nav [data-settings-category="${category}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(`#settings-detail-view [data-settings-group="${category}"], #settings-detail-view [data-settings-panel="${category}"]`).first()).toBeVisible();
    await page.locator('#settings-back-button').click();
    await expect(page.locator('#settings-home-view')).toBeVisible();
  }

  await page.locator('#sidebar [data-section="customize"]').click();
  const customize = page.locator('#customize-category-nav [data-customize-category]');
  await expect(customize).toHaveCount(9);
  for (const button of await customize.all()) {
    const category = await button.getAttribute('data-customize-category');
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'location');
    await expect(page.locator(`#customize-${category}`)).toBeVisible();
  }
  await expect(page.locator('#sidebar [data-primary-navigation="integrations"]')).toHaveCount(0);
  await expect(page.locator('#customize-category-nav [data-customize-category="integrations"]')).toBeVisible();
  await expect(page.locator('#sidebar [data-primary-navigation="marketplace"]')).toBeVisible();
});

for (const viewport of viewports) {
  test(`all PARMAR destinations use non-bottom navigation at ${viewport.name}`, async ({ page }) => {
    const browserErrors = [];
    const failedRequests = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    const destinations = await page.locator('#sidebar .nav-item[data-section]:not([data-action])')
      .evaluateAll((links) => [...new Set(links.map((link) => link.dataset.section))]);
    expect(destinations.length, 'The workspace must expose destination navigation').toBeGreaterThan(0);

    for (const destination of destinations) {
      await openNavigation(page);
      const link = page.locator(`#sidebar .nav-item[data-section="${destination}"]:not([data-action])`);
      if (!await link.isVisible()) {
        await page.locator('#sidebar-workspaces > summary').click();
      }
      await expect(link, `${destination} must remain reachable through the sidebar`).toHaveCount(1);
      await expect(link).toHaveAttribute('aria-label', /\S/);
      await link.click();
      await expect(page.locator(`#section-${destination}`)).toHaveClass(/\bactive\b/);
      await expectNoBottomNavigation(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${destination} must not create horizontal overflow at ${viewport.name}`).toBe(false);

      if (destination === 'voki') {
        await page.getByRole('button', { name: 'Return to PARMAR workspace' }).click();
        await expect(page.locator('#section-home')).toHaveClass(/\bactive\b/);
      }
    }

    if (viewport.width <= 920) {
      await openNavigation(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#sidebar-toggle')).toBeFocused();
      await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');
    } else {
      const home = page.locator('#sidebar .nav-item[data-section="home"]');
      await home.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#section-home')).toHaveClass(/\bactive\b/);
    }

    await openNavigation(page);
    await page.locator('#sidebar [data-section="settings"]').click();
    await page.locator('[data-settings-category="data-controls"]').click();
    await expect(page.locator('#settings-panel-privacy')).toBeVisible();
    await expectNoBottomNavigation(page);
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
}

test('Knowledge Hub edits, searches, and reopens browser-local documents', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sidebar-workspaces > summary').click();
  await page.locator('#sidebar [data-section="knowledge"]').click();

  await page.locator('#knowledge-title-input').fill('   ');
  await page.locator('#knowledge-category-input').fill('Study');
  await page.locator('#knowledge-body-input').fill('A private body phrase for searching.');
  await page.locator('#knowledge-form button[type="submit"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('Enter a document title.');
  await expect(page.locator('#knowledge-title-input')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#knowledge-title-input').fill('Document without content');
  await page.locator('#knowledge-body-input').fill('   ');
  await page.locator('#knowledge-form button[type="submit"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('Enter document content before saving.');
  await expect(page.locator('#knowledge-body-input')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#knowledge-title-input').fill('Browser-local note');
  await page.locator('#knowledge-body-input').fill('A private body phrase for searching.');
  await page.locator('#knowledge-form button[type="submit"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('Document saved locally.');
  await expect(page.locator('#knowledge-list')).toContainText('Browser-local note');

  await page.locator('#knowledge-search').fill('body phrase');
  await expect(page.locator('#knowledge-list')).toContainText('Browser-local note');
  await page.locator('#knowledge-search').fill('Browser-local');
  await expect(page.locator('#knowledge-list')).toContainText('A private body phrase for searching.');
  await page.locator('#knowledge-search').fill('no matching title or content');
  await expect(page.locator('#knowledge-empty')).toBeVisible();
  await expect(page.locator('#knowledge-empty')).toContainText('No saved items match this search.');

  await page.locator('#knowledge-search').fill('');
  await page.getByRole('button', { name: 'Edit Browser-local note' }).click();
  await expect(page.locator('#knowledge-title-input')).toHaveValue('Browser-local note');
  await page.locator('#knowledge-title-input').fill('Edited note');
  await page.locator('#knowledge-category-input').fill('Reference');
  await page.locator('#knowledge-body-input').fill('Saved edits survive a reload.');
  await page.locator('#knowledge-form button[type="submit"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('Document saved locally.');
  await expect(page.locator('#knowledge-list')).toContainText('Reference');

  await page.reload();
  await page.locator('#sidebar-workspaces > summary').click();
  await page.locator('#sidebar [data-section="knowledge"]').click();
  await page.getByRole('button', { name: 'Edit Edited note' }).click();
  await expect(page.locator('#knowledge-body-input')).toHaveValue('Saved edits survive a reload.');
  await expect(page.locator('#knowledge-category-input')).toHaveValue('Reference');
});

test('Knowledge Hub reports storage failures without showing success', async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'parmar-knowledge-v1') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.locator('#sidebar-workspaces > summary').click();
  await page.locator('#sidebar [data-section="knowledge"]').click();
  await page.locator('#knowledge-title-input').fill('Unsaved note');
  await page.locator('#knowledge-body-input').fill('This must not appear as saved.');
  await page.locator('#knowledge-form button[type="submit"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('Could not save');
  await expect(page.locator('#knowledge-status')).not.toContainText('Document saved');
  await expect(page.locator('#knowledge-title-input')).toHaveValue('Unsaved note');
  await expect(page.locator('#knowledge-list')).not.toContainText('Unsaved note');
});

test('Knowledge Hub reports unreadable saved data without replacing it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('parmar-knowledge-v1', '{invalid'));
  await page.goto('/');
  await page.locator('#sidebar-workspaces > summary').click();
  await page.locator('#sidebar [data-section="knowledge"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('Could not read saved knowledge data');
  await expect(page.locator('#knowledge-empty')).toContainText('could not be read');
  await page.locator('#knowledge-title-input').fill('Do not replace saved data');
  await page.locator('#knowledge-body-input').fill('The malformed saved content remains untouched.');
  await page.locator('#knowledge-form button[type="submit"]').click();
  await expect(page.locator('#knowledge-status')).toContainText('No changes were saved');
  expect(await page.evaluate(() => localStorage.getItem('parmar-knowledge-v1'))).toBe('{invalid');
});

test('Chat keeps a failed draft available for deliberate retry', async ({ page }) => {
  await page.route('**/api/chat', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await page.locator('#sidebar [data-section="chat"]').click();
  await page.locator('#chat-input').fill('Keep this draft when the service is unavailable.');
  await page.locator('#chat-submit').click();
  await expect(page.locator('#chat-input')).toHaveValue('Keep this draft when the service is unavailable.');
  await expect(page.locator('#chat-thread')).toContainText('The chat service could not respond. Please try again.');
});

test('Learning sessions are editable and totals derive from saved session minutes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sidebar [data-section="learning"]').click();
  await page.locator('#learning-subject-input').fill('Physics');
  await page.locator('#learning-topic-input').fill('Kinematics');
  await page.locator('#learning-notes-input').fill('Review motion equations.');
  await page.locator('#learning-minutes-input').fill('0');
  expect(await page.locator('#learning-minutes-input').evaluate((input) => input.checkValidity())).toBe(false);
  await expect(page.locator('#learning-list')).not.toContainText('Physics · Kinematics');
  await page.locator('#learning-minutes-input').fill('40');
  await page.locator('#learning-form button[type="submit"]').click();
  await expect(page.locator('#learning-total')).toHaveText('40');
  await page.reload();
  await page.locator('#sidebar [data-section="learning"]').click();
  await page.getByRole('button', { name: 'Edit Physics · Kinematics' }).click();
  await page.locator('#learning-subject-input').fill('Mathematics');
  await page.locator('#learning-topic-input').fill('Limits');
  await page.locator('#learning-minutes-input').fill('65');
  await page.locator('#learning-form button[type="submit"]').click();
  await expect(page.locator('#learning-total')).toHaveText('65');
  await page.reload();
  await page.locator('#sidebar [data-section="learning"]').click();
  await expect(page.locator('#learning-total')).toHaveText('65');
  await expect(page.locator('#learning-list')).toContainText('Mathematics · Limits');
});

test('workflow drafts reject missing configuration and invalid connections', async ({ page }) => {
  await page.goto('/');
  await openMoreWorkspaces(page);
  await page.locator('#sidebar [data-section="workflow"]').click();
  await page.locator('#workflow-name-input').fill('Review flow');
  await page.locator('#workflow-nodes-input').fill('Review input\nCheck policy');
  await page.locator('#workflow-connections-input').fill('Review input -> Check policy');
  await page.locator('#workflow-form button[type="submit"]').click();
  await expect(page.locator('#workflow-status')).toContainText('Configure each node');

  await page.locator('#workflow-nodes-input').fill('input: Request | User request\npolicy-review: Review | Apply policy');
  await page.locator('#workflow-connections-input').fill('Request -> Missing');
  await page.locator('#workflow-form button[type="submit"]').click();
  await expect(page.locator('#workflow-status')).toContainText('refers to a node that does not exist');

  await page.locator('#workflow-connections-input').fill('Request -> Review');
  await page.locator('#workflow-form button[type="submit"]').click();
  await expect(page.locator('#workflow-list')).toContainText('VALIDATED LOCAL DRAFT');
  await expect(page.locator('#workflow-list')).toContainText('NOT EXECUTABLE');
  await page.reload();
  await openMoreWorkspaces(page);
  await page.locator('#sidebar [data-section="workflow"]').click();
  await page.getByRole('button', { name: 'Edit Review flow' }).click();
  await expect(page.locator('#workflow-nodes-input')).toHaveValue('input: Request | User request\npolicy-review: Review | Apply policy');
});

test('Agent Studio and integration drafts remain unexecutable and disconnected', async ({ page }) => {
  await page.goto('/');
  await openMoreWorkspaces(page);
  await page.locator('#sidebar [data-section="agents"]').click();
  await page.locator('#agent-name-input').fill('Local reviewer draft');
  await page.locator('#agent-role-input').fill('Summarize locally stored notes only.');
  await page.locator('#agent-form button[type="submit"]').click();
  await expect(page.locator('#agent-status')).toContainText('not an executable agent');
  await page.getByRole('button', { name: 'Edit Local reviewer draft' }).click();
  await expect(page.locator('#agent-role-input')).toHaveValue('Summarize locally stored notes only.');
  await expect(page.locator('#agent-list')).toContainText('CONFIGURATION DRAFT · NOT EXECUTABLE');

  await openMoreWorkspaces(page);
  await page.locator('#sidebar [data-section="customize"]').click();
  await page.locator('#customize-category-nav [data-customize-category="integrations"]').click();
  await page.locator('#integration-name-input').fill('Repository request');
  await page.locator('#integration-permissions-input').fill('Read repository metadata\nRead repository metadata');
  await page.locator('#integration-form button[type="submit"]').click();
  await expect(page.locator('#integration-status')).toContainText('must be unique');
  await expect(page.locator('#integration-empty')).toContainText('No connection drafts saved');
  await page.locator('#integration-permissions-input').fill('Read repository metadata\nCreate draft issue');
  await page.locator('#integration-form button[type="submit"]').click();
  await expect(page.locator('#integration-status')).toContainText('No provider is connected');
  await page.getByRole('button', { name: 'Edit Repository request' }).click();
  await expect(page.locator('#integration-permissions-input')).toHaveValue('Read repository metadata\nCreate draft issue');
  await expect(page.locator('#integration-list')).toContainText('CONNECTION DRAFT · NOT CONNECTED');
});

test('Marketplace metadata is validated but never represented as verified or installable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sidebar-workspaces > summary').click();
  await page.locator('#sidebar [data-section="customize"]').click();
  await page.locator('#customize-category-nav [data-customize-category="tools-capabilities"]').click();
  await page.locator('#marketplace-name-input').fill('Example extension');
  await page.locator('#marketplace-source-input').fill('javascript:alert(1)');
  await page.locator('#marketplace-form button[type="submit"]').click();
  await expect(page.locator('#marketplace-status')).toContainText('No source is contacted');

  await page.locator('#marketplace-source-input').fill('example/extension');
  await page.locator('#marketplace-permissions-input').fill('read.workspace\nread.workspace');
  await page.locator('#marketplace-form button[type="submit"]').click();
  await expect(page.locator('#marketplace-status')).toContainText('must be unique');
  await expect(page.locator('#marketplace-empty')).toContainText('No verified plugin listings are available');
  await page.locator('#marketplace-permissions-input').fill('read.workspace\nwrite.draft');
  await page.locator('#marketplace-form button[type="submit"]').click();
  await expect(page.locator('#marketplace-status')).toContainText('remains unverified and non-installable');
  await expect(page.locator('#marketplace-list')).toContainText('UNVERIFIED');
  await expect(page.locator('#marketplace-list')).toContainText('INSTALLATION DISABLED');
  await expect(page.locator('#marketplace-list button')).toHaveCount(1);
});

test('Customize search, response preferences, and the New Chat action use their separate destinations', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sidebar-workspaces > summary').click();
  await page.locator('#sidebar [data-section="customize"]').click();
  await expect(page.locator('#customize-category-nav [data-customize-category]')).toHaveCount(9);

  await page.locator('#customize-search').fill('response length');
  await page.locator('#customize-search-results [data-customize-search-result]').click();
  await expect(page.locator('#customize-ai-behavior')).toBeInViewport();
  await page.locator('#settings-response-length').selectOption('detailed');
  await expect(page.locator('#customize-save-status')).toContainText('Saved in this browser');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('parmar-settings-v1')).responseLength))
    .toBe('detailed');

  await page.locator('#sidebar [data-section="chat"]').click();
  await expect(page.getByRole('button', { name: 'New Chat' })).toBeVisible();
  await page.locator('#chat-input').fill('Discard this draft for a new conversation.');
  await page.getByRole('button', { name: 'New Chat' }).click();
  await expect(page.locator('#chat-input')).toHaveValue('');
});

test('PARMAR Core copies only the current displayed review summary on explicit request', async ({ page }) => {
  await page.goto('/');
  await openMoreWorkspaces(page);
  await page.locator('#sidebar [data-section="safety"]').click();
  await expect(page.locator('#copy-decision-summary')).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => { window.copiedReviewSummary = text; },
      },
    });
    window.updateState({
      analysis: {
        status: 'SAFE',
        lifecycle: { current_state: 'IDLE' },
        enforcement: { status: 'ALLOWED', execution_allowed: false },
        request: 'Test review request',
        message: 'Test review returned by the local fixture.',
        risk: { risk_level: 'LOW' },
        explanation: {
          what_requested: 'Test review request',
          what_detected: 'No external action requested',
          what_risks_found: 'No risk was reported by the fixture',
        },
      },
    }, false, false);
  });
  await expect(page.locator('#copy-decision-summary')).toBeEnabled();
  await page.locator('#copy-decision-summary').click();
  await expect(page.locator('#copy-decision-status')).toContainText('copied');
  const copied = await page.evaluate(() => window.copiedReviewSummary);
  expect(copied).toContain('PARMAR review summary (as displayed)');
  expect(copied).toContain('Status: READY');
  expect(copied).toContain('Risk: LOW');
  expect(copied).toContain('Request: Test review request');
  expect(copied).toContain('Authority: Informational only; this summary does not approve or execute a proposal.');
  expect(copied).not.toContain('APPROVED');
});
