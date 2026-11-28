const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const viewports = [
  { name: 'desktop-1440x1000', width: 1440, height: 1000 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

function cssTimeInSeconds(value) {
  const parsed = Number.parseFloat(value);
  return value.trim().endsWith('ms') ? parsed / 1000 : parsed;
}

function expectedComposition(width, height) {
  if (width <= 420) return 'mobile';
  return width <= 820 || width / height <= 4 / 3 ? 'tablet' : 'desktop';
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#section-voki');
    const surface = root?.querySelector('[data-voki-interface]');
    const selectors = [
      '.voki-presence-stage',
      '.voki-speech-controls',
      '.voki-interface-form',
      '.voki-identity-onboarding',
      '.voki-interface-approval',
    ];
    const elements = selectors.flatMap((selector) => {
      const element = surface?.querySelector(selector);
      if (!element || element.hidden || getComputedStyle(element).display === 'none') return [];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [{
        selector,
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        horizontalContentOverflow: element.scrollWidth > element.clientWidth + 1,
        clipped: selector !== '.voki-presence-stage' && (
          (['hidden', 'clip'].includes(style.overflowX)
            && element.scrollWidth > element.clientWidth + 1)
          || (['hidden', 'clip'].includes(style.overflowY)
            && element.scrollHeight > element.clientHeight + 1)
        ),
      }];
    });
    const overlaps = [];
    for (let first = 0; first < elements.length; first += 1) {
      for (let second = first + 1; second < elements.length; second += 1) {
        const a = elements[first];
        const b = elements[second];
        if (a.selector === '.voki-presence-stage' || b.selector === '.voki-presence-stage') continue;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          overlaps.push(`${a.selector} overlaps ${b.selector}`);
        }
      }
    }
    const portrait = surface?.querySelector('.voki-avatar-default-image');
    const stage = surface?.querySelector('.voki-presence-stage');
    const lifecycle = surface?.querySelector('[data-voki-lifecycle]');
    const text = surface?.innerText || '';
    const visibleText = [];
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) {
      const node = textWalker.currentNode;
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || parent.closest('.sr-only, [aria-hidden="true"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) visibleText.push(node.textContent.trim());
    }
    const portraitRect = portrait?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const portraitStyle = portrait ? getComputedStyle(portrait) : null;
    const portraitLayers = [];
    for (let element = portrait; element && element !== root; element = element.parentElement) {
      const style = getComputedStyle(element);
      portraitLayers.push({
        element: element.id ? `#${element.id}` : element.className || element.tagName.toLowerCase(),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
      });
      if (element === stage) break;
    }
    const stageCenter = stageRect
      ? document.elementsFromPoint(
        stageRect.left + stageRect.width / 2,
        stageRect.top + stageRect.height / 2,
      ).slice(0, 6).map((element) => ({
        element: element.id ? `#${element.id}` : element.className || element.tagName.toLowerCase(),
        opacity: getComputedStyle(element).opacity,
        zIndex: getComputedStyle(element).zIndex,
      }))
      : [];

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      sectionWidth: root?.scrollWidth ?? 0,
      sectionClientWidth: root?.clientWidth ?? 0,
      horizontalOverflow: (
        document.documentElement.scrollWidth > window.innerWidth
        || (root?.scrollWidth ?? 0) > (root?.clientWidth ?? 0) + 1
      ),
      elements,
      clippedElements: elements.filter((element) => element.clipped).map((element) => element.selector),
      overlaps,
      portrait: {
        source: portrait?.getAttribute('src') ?? '',
        loaded: Boolean(portrait?.complete && portrait.naturalWidth > 0),
        width: portrait?.naturalWidth ?? 0,
        height: portrait?.naturalHeight ?? 0,
        bounds: portraitRect ? {
          left: portraitRect.left,
          top: portraitRect.top,
          width: portraitRect.width,
          height: portraitRect.height,
        } : null,
        objectFit: portraitStyle?.objectFit ?? '',
        display: portraitStyle?.display ?? '',
        visibility: portraitStyle?.visibility ?? '',
        opacity: portraitStyle?.opacity ?? '',
        layers: portraitLayers,
        stageCenter,
        coversStage: Boolean(
          portraitRect
          && stageRect
          && portraitRect.left <= stageRect.left + 1
          && portraitRect.top <= stageRect.top + 1
          && portraitRect.right >= stageRect.right - 1
          && portraitRect.bottom >= stageRect.bottom - 1,
        ),
        proportional: Boolean(
          portraitRect
          && Math.abs(
            (portraitRect.width / portraitRect.height)
            - (portrait?.naturalWidth / portrait?.naturalHeight),
          ) < 0.01,
        ),
      },
      stage: {
        width: Math.round(stageRect?.width ?? 0),
        height: Math.round(stageRect?.height ?? 0),
        bounds: stageRect ? {
          left: stageRect.left,
          top: stageRect.top,
          width: stageRect.width,
          height: stageRect.height,
        } : null,
        clipsPortrait: Boolean(
          stageStyle
          && ['hidden', 'clip'].includes(stageStyle.overflowX)
          && ['hidden', 'clip'].includes(stageStyle.overflowY),
        ),
      },
      referenceComposition: getComputedStyle(stage).getPropertyValue('--voki-reference-composition').trim(),
      visibleText,
      lifecycle: lifecycle?.textContent?.trim() ?? '',
      misleadingPresenceClaim: /\b(?:VOKKI\s+(?:is\s+)?(?:online|connected|processing)|connected\s+to\s+(?:PARMAR|core))\b/i.test(text),
      visible: {
        presence: Boolean(surface?.querySelector('.voki-presence-stage')?.getClientRects().length),
        conversation: Boolean(surface?.querySelector('.voki-interface-output')?.getClientRects().length),
        composer: Boolean(surface?.querySelector('.voki-interface-form')?.getClientRects().length),
      },
    };
  });
}

async function inspectScreenshotPortrait(page, screenshot, layout) {
  return page.evaluate(async ({ screenshotBase64, portraitBounds, stageBounds }) => {
    const screenshotImage = new Image();
    screenshotImage.src = `data:image/png;base64,${screenshotBase64}`;
    await screenshotImage.decode();

    const screenshotCanvas = document.createElement('canvas');
    screenshotCanvas.width = screenshotImage.naturalWidth;
    screenshotCanvas.height = screenshotImage.naturalHeight;
    const screenshotContext = screenshotCanvas.getContext('2d', { willReadFrequently: true });
    screenshotContext.drawImage(screenshotImage, 0, 0);

    const portrait = document.querySelector('#section-voki .voki-avatar-default-image');
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = portrait.naturalWidth;
    sourceCanvas.height = portrait.naturalHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(portrait, 0, 0);

    const luminance = (pixel) => (
      pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722
    );
    const samples = [0.35, 0.5, 0.65].flatMap((xFraction) => (
      [0.35, 0.5, 0.65].map((yFraction) => {
        const x = stageBounds.left + stageBounds.width * xFraction;
        const y = stageBounds.top + stageBounds.height * yFraction;
        const containScale = Math.min(
          portraitBounds.width / portrait.naturalWidth,
          portraitBounds.height / portrait.naturalHeight,
        );
        const renderedWidth = portrait.naturalWidth * containScale;
        const renderedHeight = portrait.naturalHeight * containScale;
        const offsetX = (portraitBounds.width - renderedWidth) / 2;
        const offsetY = (portraitBounds.height - renderedHeight) / 2;
        const sourceX = (x - portraitBounds.left - offsetX) / containScale;
        const sourceY = (y - portraitBounds.top - offsetY) / containScale;
        const sourcePixel = (
          sourceX >= 0 && sourceX < portrait.naturalWidth
          && sourceY >= 0 && sourceY < portrait.naturalHeight
        )
          ? sourceContext.getImageData(Math.floor(sourceX), Math.floor(sourceY), 1, 1).data
          : [0, 0, 0, 0];
        const capturedPixel = screenshotContext.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        return {
          xFraction,
          yFraction,
          sourceLuminance: Math.round(luminance(sourcePixel)),
          capturedLuminance: Math.round(luminance(capturedPixel)),
        };
      })
    ));
    return {
      samples,
      sourceCandidates: samples.filter((sample) => sample.sourceLuminance > 45).length,
      visiblePortraitSamples: samples.filter(
        (sample) => sample.sourceLuminance > 45 && sample.capturedLuminance > 24,
      ).length,
    };
  }, {
    screenshotBase64: screenshot.toString('base64'),
    portraitBounds: layout.portrait.bounds,
    stageBounds: layout.stage.bounds,
  });
}

async function installDeterministicSpeechMocks(page) {
  await page.addInitScript(() => {
    const state = {
      availabilityChecks: 0,
      availabilityOptions: null,
      recognitionStarts: 0,
      speechCalls: 0,
      speechCancellations: 0,
    };
    globalThis.__vokiVisualAcceptance = state;

    class MockSpeechRecognition {
      constructor() {
        this.processLocally = false;
      }

      static async available(options) {
        state.availabilityChecks += 1;
        state.availabilityOptions = {
          langs: Array.isArray(options?.langs) ? [...options.langs] : [],
          processLocally: options?.processLocally === true,
        };
        return 'unavailable';
      }

      start() {
        state.recognitionStarts += 1;
        throw new Error('Visual acceptance must not start microphone capture.');
      }

      abort() {}
    }

    class MockSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
      }
    }

    const synthesis = {
      speaking: false,
      pending: false,
      paused: false,
      speak() {
        state.speechCalls += 1;
        this.speaking = true;
      },
      cancel() {
        state.speechCancellations += 1;
        this.speaking = false;
        this.pending = false;
      },
    };

    Object.defineProperty(globalThis, 'SpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(globalThis, 'speechSynthesis', {
      configurable: true,
      value: synthesis,
    });
  });
}

async function waitForStableLayout(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const selectors = ['.voki-presence-stage', '.voki-interface-form'];
    const measure = () => selectors.map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10)
        : null;
    });
    const before = measure();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = measure();
    return JSON.stringify(before) === JSON.stringify(after);
  }), { message: 'VOKKI layout settles after navigation and viewport changes' }).toBe(true);
}

for (const viewport of viewports) {
  test(`VOKKI responsive interaction and evidence: ${viewport.name}`, async ({ page }, testInfo) => {
    const evidence = {
      viewport: { width: viewport.width, height: viewport.height },
      status: 'FAIL',
      findings: [],
      browserErrors: [],
      externalRequests: [],
      failedRequests: [],
      assetResponses: [],
      screenshots: [],
      checks: {},
    };
    const origin = new URL(testInfo.project.use.baseURL).origin;
    page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.browserErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      evidence.failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? 'Request failed',
      });
    });
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/static/assets/voki/Vokki-screen.png') {
        evidence.assetResponses.push({ status: response.status(), ok: response.ok() });
      }
    });
    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin !== origin) {
        evidence.externalRequests.push(requestUrl.href);
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      await installDeterministicSpeechMocks(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(page.locator('#section-home')).toHaveClass(/active/);
      const homeQuickActions = page.locator('.home-quick-actions');
      await expect(homeQuickActions).toBeVisible();
      await expect(homeQuickActions.locator('[data-action="research-chat"]')).toHaveCount(1);
      await expect(homeQuickActions.getByRole('button', { name: /Talk to VOKKI/ })).toBeVisible();
      await expect(homeQuickActions.getByRole('button', { name: /Open Approvals/ })).toBeVisible();
      const homeOverflow = await page.evaluate(() => (
        document.documentElement.scrollWidth > window.innerWidth
      ));
      expect(homeOverflow, `${viewport.name} Home has no horizontal overflow`).toBe(false);
      await expect(page.locator('.mobile-bottom-nav, .mobile-bottom-item, .mobile-bottom-more')).toHaveCount(0);
      const homeScreenshot = testInfo.outputPath(`${viewport.name}-home-quick-actions.png`);
      await homeQuickActions.screenshot({ path: homeScreenshot });
      await testInfo.attach(`${viewport.name}-home-quick-actions`, {
        path: homeScreenshot,
        contentType: 'image/png',
      });
      const homePageScreenshot = testInfo.outputPath(`${viewport.name}-home.png`);
      await page.screenshot({ path: homePageScreenshot });
      await testInfo.attach(`${viewport.name}-home`, {
        path: homePageScreenshot,
        contentType: 'image/png',
      });
      evidence.screenshots.push({
        path: path.relative(__dirname, homePageScreenshot).split(path.sep).join('/'),
        state: 'PARMAR Home with the complete canonical VOKKI source image',
        dimensions: `${viewport.width}x${viewport.height}`,
        findings: [],
      });

      const homeNavigation = page.getByRole('button', { name: 'Talk with VOKKI' });
      if (viewport.width <= 760) {
        await page.locator('#sidebar-toggle').click();
        await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
        await page.locator('#sidebar [data-section="voki"]').click();
      } else {
        await expect(homeNavigation).toBeVisible();
        await homeNavigation.click();
      }

      const workspace = page.locator('#section-voki');
      await expect(workspace).toHaveClass(/active/);
      await expect(workspace.getByRole('heading', { name: 'VOKKI', exact: true })).toBeVisible();
      const responsiveTransitions = [420, 421, 760, 761, 820, 821, 1024, 1025, 1280];
      evidence.checks.responsiveTransitions = [];
      for (const width of responsiveTransitions) {
        await page.setViewportSize({ width, height: viewport.height });
        await expect(workspace).toHaveClass(/active/);
        await waitForStableLayout(page);
        const transitionLayout = await inspectLayout(page);
        const transitionEvidence = {
          width,
          composition: transitionLayout.referenceComposition,
          horizontalOverflow: transitionLayout.horizontalOverflow,
          portraitCoversStage: transitionLayout.portrait.coversStage,
          portraitBounds: transitionLayout.portrait.bounds,
          portraitObjectFit: transitionLayout.portrait.objectFit,
          stageBounds: transitionLayout.stage.bounds,
        };
        evidence.checks.responsiveTransitions.push(transitionEvidence);
        expect(transitionLayout.horizontalOverflow, `no overflow at ${width}px`).toBe(false);
        expect(transitionLayout.referenceComposition, `composition at ${width}px`)
          .toBe(expectedComposition(width, viewport.height));
        expect(transitionLayout.portrait.loaded, `portrait remains loaded at ${width}px`).toBe(true);
        expect(transitionLayout.portrait.coversStage, `portrait covers stage at ${width}px`).toBe(true);
      }

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(workspace).toHaveClass(/active/);
      await waitForStableLayout(page);
      if (viewport.width <= 760) {
        await expect(workspace.locator('nav:visible')).toHaveCount(0);
        await expect(workspace.getByRole('button', { name: 'Return to PARMAR workspace' })).toBeVisible();
      }
      await expect(workspace.locator('.voki-presence-stage')).toBeVisible();
      await expect(workspace.locator('.voki-interface-output')).toBeVisible();
      await expect(workspace.locator('.voki-interface-form')).toBeVisible();
      await expect(workspace.locator('[data-voki-lifecycle]')).toHaveText('STATE UNAVAILABLE');
      await expect(workspace.getByRole('textbox', {
        name: 'Send a request to PARMAR through VOKKI',
      })).toBeVisible();
      await expect(workspace.getByRole('group', { name: 'VOKKI voice input' })).toBeAttached();
      await expect(workspace.locator('[data-voki-input-status]')).toHaveAttribute('aria-live', 'polite');

      const portrait = workspace.locator('.voki-avatar-default-image');
      await expect(portrait).toHaveAttribute('src', '/static/assets/voki/Vokki-screen.png');
      await expect.poll(() => portrait.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      await portrait.evaluate((image) => image.decode());
      const allPixelsOpaque = await portrait.evaluate((image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 255) return false;
        }
        return true;
      });
      expect(allPixelsOpaque, 'the extracted photograph remains fully opaque').toBe(true);
      await waitForStableLayout(page);

      const initialLayout = await inspectLayout(page);
      evidence.checks.layout = initialLayout;
      expect(initialLayout.viewport).toEqual({ width: viewport.width, height: viewport.height });
      expect(initialLayout.horizontalOverflow, 'horizontal overflow at the requested viewport').toBe(false);
      expect(initialLayout.clippedElements, 'primary content clipping').toEqual([]);
      expect(initialLayout.overlaps, 'primary content overlap').toEqual([]);
      expect(initialLayout.elements.every((element) => (
        element.left >= -1 && element.right <= viewport.width + 1
      )), 'primary content remains within the viewport width').toBe(true);
      expect(initialLayout.portrait.loaded, 'canonical VOKKI portrait loads').toBe(true);
      expect(initialLayout.portrait.width).toBe(1097);
      expect(initialLayout.portrait.height).toBe(615);
      expect(initialLayout.portrait.objectFit, 'the complete screen photograph is shown without cropping').toBe('contain');
      expect(initialLayout.portrait.coversStage, 'the image presentation fills the visual stage').toBe(true);
      expect(initialLayout.stage.clipsPortrait, 'portrait cropping is confined to the presentation stage').toBe(true);
      expect(initialLayout.referenceComposition).toBe(
        expectedComposition(viewport.width, viewport.height),
      );
      expect(
        initialLayout.referenceComposition !== 'desktop'
          ? initialLayout.stage.height >= viewport.height * 0.7
          : initialLayout.stage.width >= viewport.width * 0.9,
        'the responsive canonical portrait remains prominent',
      ).toBe(true);
      expect(initialLayout.visibleText, 'the VOKKI section has no visible text').toEqual([]);
      expect(initialLayout.misleadingPresenceClaim, 'no fabricated online/connected/processing status').toBe(false);
      expect(initialLayout.visible.presence && initialLayout.visible.conversation, 'presence and conversation areas are visible').toBe(true);

      const interfaceRoot = workspace.locator('[data-voki-interface]');
      const talkButton = interfaceRoot.getByRole('button', { name: 'Talk' });
      await expect(interfaceRoot).toHaveAttribute('data-voice-input-state', 'IDLE');
      await expect(interfaceRoot).toHaveAttribute('data-voice-input-available', 'false');
      await expect(talkButton).toBeEnabled();
      await expect(interfaceRoot.locator('[data-voki-input-status]')).toContainText(/press Talk to check/i);
      await expect(workspace.locator('[data-voki-cancel-voice]')).toBeHidden();
      await expect(workspace.locator('[data-voki-stop-speech]')).toBeHidden();
      const pauseToggle = workspace.locator('[data-voki-pause-toggle]');
      await pauseToggle.check();
      await expect(interfaceRoot).toHaveAttribute('data-sense-state', 'PAUSED');
      await expect(talkButton).toBeDisabled();
      await expect(workspace.locator('[data-voki-submit]')).toBeDisabled();
      await pauseToggle.uncheck();
      await expect(interfaceRoot).toHaveAttribute('data-sense-state', 'ACTIVE');
      await expect(talkButton).toBeEnabled();

      const reducedMotion = await page.locator('.voki-presence-stage').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
          animationDuration: style.animationDuration.split(',').map((value) => value.trim()),
          transitionDuration: style.transitionDuration.split(',').map((value) => value.trim()),
        };
      });
      expect(reducedMotion.requested).toBe(true);
      expect([...reducedMotion.animationDuration, ...reducedMotion.transitionDuration]
        .every((value) => cssTimeInSeconds(value) <= 0.00001)).toBe(true);
      evidence.checks.reducedMotion = reducedMotion;

      const topScreenshot = testInfo.outputPath(`${viewport.name}-presence.png`);
      const topScreenshotBuffer = await page.screenshot({ path: topScreenshot });
      const screenshotPortrait = await inspectScreenshotPortrait(page, topScreenshotBuffer, initialLayout);
      evidence.checks.screenshotPortrait = screenshotPortrait;
      await testInfo.attach(`${viewport.name}-presence`, { path: topScreenshot, contentType: 'image/png' });
      evidence.screenshots.push({
        path: path.relative(__dirname, topScreenshot).split(path.sep).join('/'),
        state: 'VOKKI initial, lifecycle unavailable, voice idle',
        dimensions: `${viewport.width}x${viewport.height}`,
        findings: initialLayout.clippedElements.concat(initialLayout.overlaps),
      });

      await page.waitForTimeout(1000);
      await waitForStableLayout(page);
      const delayedLayout = await inspectLayout(page);
      expect(delayedLayout.stage.bounds, 'presentation stage remains stable after waiting').toEqual(initialLayout.stage.bounds);
      expect(delayedLayout.portrait.bounds, 'portrait position remains stable after waiting').toEqual(initialLayout.portrait.bounds);
      const delayedScreenshot = testInfo.outputPath(`${viewport.name}-delayed.png`);
      const delayedScreenshotBuffer = await page.screenshot({ path: delayedScreenshot });
      const delayedPortrait = await inspectScreenshotPortrait(page, delayedScreenshotBuffer, delayedLayout);
      expect(
        delayedPortrait.visiblePortraitSamples,
        'the canonical portrait remains visible after waiting',
      ).toBeGreaterThan(0);
      await testInfo.attach(`${viewport.name}-delayed`, { path: delayedScreenshot, contentType: 'image/png' });
      evidence.checks.delayedRender = { layout: delayedLayout, screenshotPortrait: delayedPortrait };
      evidence.screenshots.push({
        path: path.relative(__dirname, delayedScreenshot).split(path.sep).join('/'),
        state: 'VOKKI remained rendered after a one-second wait',
        dimensions: `${viewport.width}x${viewport.height}`,
        findings: delayedLayout.clippedElements.concat(delayedLayout.overlaps),
      });

      await talkButton.click();
      await expect(interfaceRoot).toHaveAttribute('data-voice-input-state', 'ERROR');
      await expect(interfaceRoot).toHaveAttribute('data-voice-input-available', 'false');
      await expect(interfaceRoot.locator('[data-voki-input-status]')).toContainText(/unavailable/i);
      await expect(workspace.locator('[data-voki-cancel-voice]')).toBeHidden();
      await expect(workspace.locator('[data-voki-stop-speech]')).toBeHidden();

      const composer = workspace.locator('[data-voki-form]');
      await composer.scrollIntoViewIfNeeded();
      const input = workspace.locator('[data-voki-input]');
      const send = workspace.locator('[data-voki-submit]');
      await expect(input).toBeEnabled();
      await expect(send).toBeEnabled();
      await input.fill('Visual acceptance draft; not submitted.');
      await expect(input).toHaveValue('Visual acceptance draft; not submitted.');

      const researchLabel = workspace.locator('.composer-research');
      const researchToggle = workspace.locator('[data-voki-research]');
      await researchLabel.click();
      await expect(researchToggle).toBeChecked();
      await researchLabel.click();
      await expect(researchToggle).not.toBeChecked();

      const speechToggle = workspace.locator('[data-voki-speech-toggle]');
      const speechStatus = await workspace.locator('[data-voki-speech-status]').innerText();
      if (await speechToggle.isEnabled()) {
        await speechToggle.check();
        await expect(speechToggle).toBeChecked();
        await speechToggle.uncheck();
        await expect(speechToggle).not.toBeChecked();
      } else {
        expect(speechStatus).toMatch(/unavailable/i);
      }

      await input.click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        const style = element ? getComputedStyle(element) : null;
        return {
          visible: Boolean(element?.matches(':focus-visible')),
          outlineStyle: style?.outlineStyle ?? 'none',
          outlineWidth: style?.outlineWidth ?? '0px',
          label: element?.getAttribute('aria-label') || element?.getAttribute('type') || element?.tagName || '',
        };
      });
      expect(focus.visible, 'keyboard navigation exposes a focus-visible control').toBe(true);
      expect(focus.outlineStyle).not.toBe('none');
      expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThan(0);
      evidence.checks.keyboardFocus = focus;

      const voiceCleanup = await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        globalThis.speechSynthesis.cancel();
        const state = globalThis.__vokiVisualAcceptance;
        return {
          availabilityChecks: state.availabilityChecks,
          availabilityOptions: state.availabilityOptions,
          recognitionStarts: state.recognitionStarts,
          speechCalls: state.speechCalls,
          speechCancellations: state.speechCancellations,
          speaking: globalThis.speechSynthesis.speaking,
          pending: globalThis.speechSynthesis.pending,
        };
      });
      evidence.checks.voiceState = voiceCleanup;
      expect(voiceCleanup.availabilityChecks).toBe(1);
      expect(voiceCleanup.availabilityOptions).toEqual({
        langs: ['en-US'],
        processLocally: true,
      });
      expect(voiceCleanup.recognitionStarts, 'the test never starts microphone capture').toBe(0);
      expect(voiceCleanup.speechCalls, 'the test never starts speech playback').toBe(0);
      expect(voiceCleanup.speechCancellations).toBeGreaterThan(0);
      expect(voiceCleanup.speaking).toBe(false);
      expect(voiceCleanup.pending).toBe(false);

      expect(screenshotPortrait.sourceCandidates, 'the sampled canonical portrait area has visible source pixels')
        .toBeGreaterThan(0);
      expect(
        screenshotPortrait.visiblePortraitSamples,
        'the captured VOKKI screenshot visibly renders the canonical portrait',
      ).toBeGreaterThan(0);

      const composerLayout = await inspectLayout(page);
      evidence.checks.composerLayout = composerLayout;
      expect(composerLayout.horizontalOverflow).toBe(false);
      expect(composerLayout.clippedElements).toEqual([]);
      expect(composerLayout.overlaps).toEqual([]);
      expect(composerLayout.visible.composer).toBe(true);
      const composerScreenshot = testInfo.outputPath(`${viewport.name}-composer.png`);
      await page.screenshot({ path: composerScreenshot });
      await testInfo.attach(`${viewport.name}-composer`, { path: composerScreenshot, contentType: 'image/png' });
      evidence.screenshots.push({
        path: path.relative(__dirname, composerScreenshot).split(path.sep).join('/'),
        state: 'VOKKI composer draft, research toggle reset, keyboard focus visible',
        dimensions: `${viewport.width}x${viewport.height}`,
        findings: composerLayout.clippedElements.concat(composerLayout.overlaps),
      });

      expect(evidence.assetResponses.some((response) => response.ok && response.status === 200),
        'canonical image request returns HTTP 200').toBe(true);
      expect(evidence.failedRequests, 'no browser requests fail').toEqual([]);
      expect(evidence.externalRequests, 'the browser must not request remote providers or assets').toEqual([]);
      expect(evidence.browserErrors, 'no uncaught browser or console errors').toEqual([]);
      evidence.status = 'PASS';
    } catch (error) {
      evidence.findings.push(error.message);
      throw error;
    } finally {
      const evidencePath = testInfo.outputPath(`${viewport.name}-evidence.json`);
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      fs.writeFileSync(
        evidencePath,
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
    }
  });
}
