const { test, expect } = require('@playwright/test');

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'desktop-1280', width: 1280, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile-430', width: 430, height: 844 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
];

function localConversations() {
  const now = Date.now();
  return [
    {
      id: 'session-chat-a',
      title: 'Planning a careful release',
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      messages: [
        { role: 'user', text: 'How should I plan a careful release?' },
        { role: 'assistant', text: 'Local Demo is not a conversational model.' },
      ],
    },
    {
      id: 'session-chat-b',
      title: 'Comparing two approaches',
      createdAt: now,
      updatedAt: now,
      messages: [
        { role: 'user', text: 'Compare two approaches.' },
        { role: 'assistant', text: 'Local Demo is not a conversational model.' },
      ],
    },
  ];
}

async function openChat(page) {
  const navigationToggle = page.locator('#sidebar-toggle');
  if (await navigationToggle.getAttribute('aria-expanded') === 'false') {
    await navigationToggle.click();
  }
  await page.locator('#sidebar [data-section="chat"]').click();
  if (await page.evaluate(() => window.innerWidth <= 920)) {
    await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed', { timeout: 10_000 });
  }
}

for (const viewport of viewports) {
  test(`Chat history and composer fit ${viewport.name} viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await openChat(page);
    await expect(page.locator('.nav-item.active')).toHaveText('Chats');

    const historyPanel = page.locator('#chat-history-panel');
    const historyToggle = page.locator('#chat-history-toggle');
    const compact = viewport.width <= 900;
    await expect(historyToggle).toHaveAttribute('aria-expanded', compact ? 'false' : 'true');
    if (compact) await expect(historyPanel).toBeHidden();
    else await expect(historyPanel).toBeVisible();
    await expect(page.locator('#chat-mode-badge')).toContainText('Local Demo');
    await expect(page.locator('#chat-availability-note')).toContainText('not conversational AI');
    await expect(page.locator('#section-chat .composer-tool')).toHaveCount(0);
    await expect(page.locator('#section-chat .composer-voki')).toHaveCount(0);
    await expect(page.locator('.global-search')).toBeHidden();
    await expect(page.locator('.header-controls')).toBeHidden();
    await expect(page.locator('#section-chat > .view-heading')).toHaveCount(0);

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      appShell: document.querySelector('.app-shell').getBoundingClientRect().toJSON(),
      mainPanel: document.querySelector('.main-panel').getBoundingClientRect().toJSON(),
      topbar: (() => {
        const element = document.querySelector('.topbar');
        const style = getComputedStyle(element);
        return {
          bounds: element.getBoundingClientRect().toJSON(),
          display: style.display,
          gridTemplateColumns: style.gridTemplateColumns,
          flexDirection: style.flexDirection,
        };
      })(),
      topbarLeft: document.querySelector('.topbar-left').getBoundingClientRect().toJSON(),
      headerControls: document.querySelector('.header-controls').getBoundingClientRect().toJSON(),
      workspace: document.querySelector('.workspace').getBoundingClientRect().toJSON(),
      activeSection: document.querySelector('.section-view.active').getBoundingClientRect().toJSON(),
      globalSearch: document.querySelector('.global-search').getBoundingClientRect().toJSON(),
      globalSearchInput: document.querySelector('#global-search-input').getBoundingClientRect().toJSON(),
      conversationSurface: document.querySelector('.conversation-surface').getBoundingClientRect().toJSON(),
      composer: document.querySelector('.chat-composer').getBoundingClientRect().toJSON(),
      composerNote: document.querySelector('.composer-note').getBoundingClientRect().toJSON(),
      workspaceFooterDisplay: getComputedStyle(document.querySelector('.workspace-footer')).display,
      input: document.querySelector('#chat-input').getBoundingClientRect().toJSON(),
      send: document.querySelector('#chat-submit').getBoundingClientRect().toJSON(),
      sendHitTarget: (() => {
        const send = document.querySelector('#chat-submit');
        const bounds = send.getBoundingClientRect();
        const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return {
          id: target?.closest('#chat-submit')?.id || null,
          tag: target?.tagName || null,
          targetId: target?.id || null,
          targetClass: target?.className?.toString() || null,
          bodyClass: document.body.className,
        };
      })(),
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.mainPanel.height, JSON.stringify(layout)).toBe(viewport.height);
    expect(layout.activeSection.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.activeSection.bottom, JSON.stringify(layout)).toBeGreaterThanOrEqual(viewport.height - 1);
    expect(layout.conversationSurface.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.conversationSurface.bottom, JSON.stringify(layout)).toBeGreaterThanOrEqual(viewport.height - 1);
    expect(layout.workspaceFooterDisplay).toBe('none');
    expect(layout.composer.width, JSON.stringify(layout)).toBeGreaterThan(0);
    expect(layout.input.width, JSON.stringify(layout)).toBeGreaterThan(140);
    expect(layout.composer.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.composerNote.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.height - 8);
    expect(layout.send.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.sendHitTarget.id, JSON.stringify(layout)).toBe('chat-submit');
    if (viewport.width > 900) {
      const geometry = await page.evaluate(() => ({
        historyWidth: document.querySelector('#chat-history-panel').getBoundingClientRect().width,
        composerWidth: document.querySelector('.chat-composer').getBoundingClientRect().width,
        headingHeight: document.querySelector('#section-chat .conversation-topline').getBoundingClientRect().height,
      }));
      expect(geometry.historyWidth).toBeGreaterThanOrEqual(268);
      expect(geometry.composerWidth).toBeLessThanOrEqual(760);
      expect(geometry.headingHeight).toBeLessThanOrEqual(58);
    }
    if (viewport.width <= 900) {
      expect(layout.globalSearch.width, JSON.stringify(layout)).toBe(0);
      const hitTargets = await page.evaluate(() => [
        document.querySelector('#sidebar-toggle'),
        document.querySelector('#chat-history-toggle'),
        document.querySelector('#section-chat .composer-research'),
        document.querySelector('#chat-submit'),
      ].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }));
      expect(hitTargets.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify(hitTargets)).toBe(true);
    }
    const screenshotPath = testInfo.outputPath(`chat-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach(`chat-${viewport.name}`, {
      path: screenshotPath,
      contentType: 'image/png',
    });

    if (compact) {
      await historyToggle.click();
      await expect(historyPanel).toBeVisible();
      await expect(historyPanel).toHaveAttribute('role', 'dialog');
      await expect(historyPanel).toHaveAttribute('aria-modal', 'true');
      await expect(historyToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#chat-history-filter')).toBeFocused();
      await expect.poll(() => page.locator('#chat-history-filter').evaluate(
        (element) => element.getBoundingClientRect().height,
      )).toBeGreaterThanOrEqual(44);
      await page.locator('#chat-history-filter').press('Shift+Tab');
      await expect(page.locator('#new-session-btn')).toBeFocused();
      await page.locator('#new-session-btn').press('Shift+Tab');
      await expect(page.locator('#chat-history-close')).toBeFocused();
      await page.locator('#chat-history-close').press('Tab');
      await expect(page.locator('#new-session-btn')).toBeFocused();
      await historyPanel.press('Escape');
      await expect(historyPanel).toBeHidden();
      await expect(historyPanel).not.toHaveAttribute('aria-modal');
      await expect(historyToggle).toBeFocused();
      await page.setViewportSize({ width: 390, height: 460 });
      await page.locator('#chat-input').focus();
      const shortLayout = await page.locator('#chat-input').evaluate((input) => {
        const bounds = input.getBoundingClientRect();
        const send = document.querySelector('#chat-submit');
        const sendBounds = send.getBoundingClientRect();
        const sendTarget = document.elementFromPoint(
          sendBounds.x + sendBounds.width / 2,
          sendBounds.y + sendBounds.height / 2,
        );
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          viewportHeight: window.innerHeight,
          sendBottom: sendBounds.bottom,
          sendHitTarget: sendTarget?.closest('#chat-submit')?.id || null,
        };
      });
      expect(shortLayout.top).toBeGreaterThanOrEqual(0);
      expect(shortLayout.bottom).toBeLessThanOrEqual(shortLayout.viewportHeight);
      expect(shortLayout.sendBottom, JSON.stringify(shortLayout)).toBeLessThanOrEqual(shortLayout.viewportHeight);
      expect(shortLayout.sendHitTarget, JSON.stringify(shortLayout)).toBe('chat-submit');
    } else {
      await historyToggle.click();
      await expect(historyPanel).toBeHidden();
      await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
      const collapsedSurfaceBottom = await page.locator('.conversation-surface').evaluate(
        (element) => element.getBoundingClientRect().bottom,
      );
      expect(collapsedSurfaceBottom).toBeGreaterThanOrEqual(viewport.height - 1);
    }
  });
}

test('Chat keeps only conversation essentials and leaves global navigation intact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await openChat(page);

  await expect(page.locator('#section-chat h1')).toHaveCount(1);
  await expect(page.locator('#section-chat h1')).toHaveText('Chat');
  await expect(page.locator('#section-chat .chat-history-toggle')).toBeVisible();
  await expect(page.locator('#new-session-btn')).toBeVisible();
  await expect(page.locator('#chat-history-filter')).toBeVisible();
  await expect(page.locator('#chat-input')).toBeVisible();
  await expect(page.locator('#chat-submit')).toBeVisible();
  await expect(page.locator('#research-mode')).toBeVisible();
  await expect(page.locator('#sidebar [data-section="research"]')).toBeAttached();
  await expect(page.locator('#section-chat [data-section="research"]')).toHaveCount(0);
  await expect(page.locator('#section-chat .chat-brand-logo, #section-chat .human-note')).toHaveCount(0);
  await expect(page.locator('#section-chat .chat-empty-emblem, #section-chat .chat-empty-eyebrow')).toHaveCount(0);
});

test('switching local conversations preserves each unsent draft and the new-chat action clears it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((sessions) => {
    localStorage.setItem('parmar-sessions-v1', JSON.stringify(sessions));
  }, localConversations());
  await page.goto('/');
  await openChat(page);

  const toggle = page.getByRole('button', { name: /conversation history/ });
  const input = page.locator('#chat-input');
  await toggle.click();
  await page.locator('#chat-history-filter').fill('careful release');
  await expect(page.locator('#chat-history-list [data-session-id]')).toHaveCount(1);
  await expect(page.locator('#chat-history-list [data-session-id]')).toContainText('Planning a careful release');
  await page.locator('#chat-history-filter').clear();
  await expect(page.locator('#chat-history-list [data-session-id]')).toHaveCount(2);
  await page.locator('#chat-history-filter').fill('not in loaded history');
  await expect(page.locator('#chat-history-list .history-empty')).toHaveText('No loaded conversations match this filter.');
  await page.locator('#chat-history-filter').clear();
  await page.locator('#chat-history-list [data-session-id="session-chat-a"]').click();
  await input.fill('Draft for conversation A');
  await toggle.click();
  await page.locator('#chat-history-list [data-session-id="session-chat-b"]').click();
  await expect(input).toHaveValue('');
  await input.fill('Draft for conversation B');
  await toggle.click();
  await page.locator('#chat-history-list [data-session-id="session-chat-a"]').click();
  await expect(input).toHaveValue('Draft for conversation A');

  await toggle.click();
  await page.locator('#new-session-btn').click();
  await expect(input).toHaveValue('');
  await expect(page.locator('#chat-history-panel')).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('mobile history close control restores focus and global navigation stays independent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openChat(page);

  const historyToggle = page.locator('#chat-history-toggle');
  const historyPanel = page.locator('#chat-history-panel');
  await historyToggle.click();
  await expect(page.locator('#chat-history-filter')).toBeFocused();
  await page.locator('#chat-history-close').click();
  await expect(historyPanel).toBeHidden();
  await expect(historyToggle).toBeFocused();

  const chatExpanded = await historyToggle.getAttribute('aria-expanded');
  const navigationToggle = page.locator('#sidebar-toggle');
  await navigationToggle.click();
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'open');
  await expect(historyToggle).toHaveAttribute('aria-expanded', chatExpanded);
  await navigationToggle.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-left-panel-state', 'closed', { timeout: 10_000 });
  await expect(navigationToggle).toBeFocused();
});

test('composer keyboard submits once and concurrent send actions do not duplicate requests', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await openChat(page);

  let requests = 0;
  let releaseRequest;
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  await page.route('**/api/chat', async (route) => {
    requests += 1;
    await requestGate;
    await route.abort('failed');
  });

  const input = page.locator('#chat-input');
  await input.fill('Keyboard submission test');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('Keyboard submission test\n');
  await input.press('Enter');
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('#chat-submit')).toBeDisabled();
  await page.locator('#chat-submit').click({ force: true });
  await input.fill('Keep this second draft');
  await input.press('Enter');
  await expect.poll(() => requests).toBe(1);
  await expect(input).toHaveValue('Keep this second draft');
  releaseRequest();
  await expect(page.locator('#chat-availability-note')).toHaveAttribute('data-state', 'error');
  await expect(input).toHaveValue('Keep this second draft');
});

test('mobile short-height Chat keeps the composer and send target visible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 460 });
  await page.goto('/');
  await openChat(page);

  const layout = await page.evaluate(() => {
    const input = document.querySelector('#chat-input').getBoundingClientRect();
    const send = document.querySelector('#chat-submit').getBoundingClientRect();
    const composerNote = document.querySelector('.composer-note').getBoundingClientRect();
    const target = document.elementFromPoint(send.x + send.width / 2, send.y + send.height / 2);
    return {
      width: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      inputTop: input.top,
      inputBottom: input.bottom,
      sendBottom: send.bottom,
      composerNoteBottom: composerNote.bottom,
      sendTarget: target?.closest('#chat-submit')?.id || null,
    };
  });
  expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.inputTop).toBeGreaterThanOrEqual(0);
  expect(layout.inputBottom).toBeLessThanOrEqual(460);
  expect(layout.sendBottom).toBeLessThanOrEqual(460);
  expect(layout.composerNoteBottom).toBeLessThanOrEqual(452);
  expect(layout.sendTarget).toBe('chat-submit');

  const screenshotPath = testInfo.outputPath('chat-mobile-short.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('chat-mobile-short', { path: screenshotPath, contentType: 'image/png' });
});

test('long Chat history scrolls inside the conversation canvas without moving the composer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const messages = Array.from({ length: 60 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: index % 2 === 0
      ? `Historical question ${index / 2 + 1}: review a long decision record.`
      : 'Local Demo is deterministic safety review, not conversational AI.',
  }));
  await page.addInitScript((historyMessages) => {
    localStorage.setItem('parmar-sessions-v1', JSON.stringify([{
      id: 'long-chat-history',
      title: 'Long decision record',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: historyMessages,
    }]));
  }, messages);
  await page.goto('/');
  await openChat(page);

  await page.locator('#chat-history-toggle').click();
  await page.locator('#chat-history-list [data-session-id="long-chat-history"]').click();
  const transcript = page.locator('#chat-thread');
  await expect(transcript.locator('.message')).toHaveCount(60);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const initialScroll = await transcript.evaluate((thread) => ({
    bottom: thread.scrollTop + thread.clientHeight,
    height: thread.scrollHeight,
  }));
  expect(initialScroll.bottom).toBeGreaterThanOrEqual(initialScroll.height - 1);
  const screenshotPath = testInfo.outputPath('chat-long-transcript-mobile.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('chat-long-transcript-mobile', {
    path: screenshotPath,
    contentType: 'image/png',
  });
  const layout = await page.evaluate(() => {
    const thread = document.querySelector('#chat-thread');
    const composer = document.querySelector('.chat-composer').getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    return {
      threadScrollHeight: thread.scrollHeight,
      threadClientHeight: thread.clientHeight,
      composerBottom: composer.bottom,
      viewportHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  expect(layout.threadScrollHeight).toBeGreaterThan(layout.threadClientHeight);
  expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
});

test('Chat copy action copies the exact message and exposes no unsupported message actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedChatText = text; } },
    });
  });
  const conversations = localConversations();
  conversations[0].messages = [
    { role: 'user', text: 'Keep exact whitespace.\nSecond line.' },
    { role: 'assistant', text: 'PARMAR Local Demo is deterministic.' },
  ];
  await page.addInitScript((sessions) => {
    localStorage.setItem('parmar-sessions-v1', JSON.stringify(sessions));
  }, conversations);
  await page.goto('/');
  await openChat(page);
  await page.locator('#chat-history-list [data-session-id="session-chat-a"]').click();

  const assistantMessage = page.getByRole('group', { name: 'PARMAR message' });
  await expect(assistantMessage.getByRole('button')).toHaveCount(1);
  await expect(assistantMessage.getByRole('button', { name: 'Copy message' })).toBeVisible();
  const screenshotPath = testInfo.outputPath('chat-fixture-transcript-desktop.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('chat-fixture-transcript-desktop', {
    path: screenshotPath,
    contentType: 'image/png',
  });
  await assistantMessage.getByRole('button', { name: 'Copy message' }).click();
  await expect(assistantMessage.getByRole('button', { name: 'Message copied' })).toHaveText('Copied');
  expect(await page.evaluate(() => window.__copiedChatText)).toBe('PARMAR Local Demo is deterministic.');
});

test('Chat research opt-in reaches the existing request and failures restore the draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await openChat(page);
  let requestBody;
  await page.route('**/api/chat', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.abort('failed');
  });

  await page.locator('#research-mode').check();
  await page.locator('#chat-input').fill('Check one source for this decision.');
  await page.locator('#chat-submit').click();
  await expect.poll(() => requestBody?.research).toBe(true);
  await expect(page.locator('#chat-input')).toHaveValue('Check one source for this decision.');
  await expect(page.locator('#chat-availability-note')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#chat-availability-note')).toContainText('retry is manual');
  await expect(page.locator('#research-mode')).toBeChecked();
});

test('offline state disables sending without dropping the current draft', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openChat(page);
  await page.locator('#chat-input').fill('Draft while offline');
  await context.setOffline(true);
  await expect(page.locator('#chat-availability-note')).toHaveAttribute('data-state', 'offline');
  await expect(page.locator('#chat-submit')).toBeDisabled();
  await expect(page.locator('#chat-input')).toHaveValue('Draft while offline');
  await context.setOffline(false);
  await expect(page.locator('#chat-submit')).toBeEnabled();
});

test('authenticated Chat stays denied and never dispatches a provider request', async ({ page }) => {
  let sessionChecks = 0;
  let chatRequests = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') {
      sessionChecks += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          authentication_state: 'AUTHENTICATED',
          csrf_token: 'test-only-session-token',
          active_profile_id: null,
        }),
      });
    } else if (url.pathname === '/api/chat') {
      chatRequests += 1;
      await route.abort('failed');
    } else {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await openChat(page);

  await expect.poll(() => sessionChecks).toBeGreaterThan(0);
  await expect(page.locator('#chat-availability-note')).toHaveAttribute('data-state', 'denied');
  await expect(page.locator('#chat-submit')).toBeDisabled();
  await page.locator('#chat-input').fill('This request must stay blocked.');
  await page.locator('#chat-input').press('Enter');
  await expect(page.locator('#chat-input')).toHaveValue('This request must stay blocked.');
  expect(chatRequests).toBe(0);
});

test('composer enforces the supported 4,000-character limit and reports the count', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await openChat(page);
  const input = page.locator('#chat-input');
  await input.fill('🙂'.repeat(4001));
  await expect(input).toHaveValue('🙂'.repeat(4000));
  await expect(page.locator('#chat-character-count')).toHaveText('4,000 / 4,000');
  await expect(page.locator('#chat-character-count')).toHaveAttribute('data-state', 'near-limit');
});
