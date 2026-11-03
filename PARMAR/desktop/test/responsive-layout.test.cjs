'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const desktopDirectory = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(desktopDirectory, 'browser.css'), 'utf8');

function matchingBrace(source, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('Unclosed CSS block.');
}

function parseRules(source, conditions = [], rules = []) {
  let cursor = 0;
  while (cursor < source.length) {
    const openingIndex = source.indexOf('{', cursor);
    if (openingIndex === -1) break;
    const closingIndex = matchingBrace(source, openingIndex);
    const prelude = source.slice(cursor, openingIndex).trim();
    const body = source.slice(openingIndex + 1, closingIndex);
    if (prelude.startsWith('@media')) {
      parseRules(body, [...conditions, prelude.slice('@media'.length).trim()], rules);
    } else if (!prelude.startsWith('@')) {
      const declarations = Object.fromEntries(
        body.split(';')
          .map((declaration) => declaration.trim())
          .filter(Boolean)
          .map((declaration) => {
            const separator = declaration.indexOf(':');
            return [
              declaration.slice(0, separator).trim(),
              declaration.slice(separator + 1).trim(),
            ];
          }),
      );
      for (const selector of prelude.split(',')) {
        rules.push({ selector: selector.trim(), conditions, declarations });
      }
    }
    cursor = closingIndex + 1;
  }
  return rules;
}

const rules = parseRules(css);

function conditionMatches(condition, width, coarsePointer) {
  const maxWidth = condition.match(/^\(max-width:\s*(\d+)px\)$/);
  if (maxWidth) return width <= Number(maxWidth[1]);
  if (condition === '(pointer: coarse)') return coarsePointer;
  return false;
}

function styleFor(selector, width, coarsePointer) {
  return rules
    .filter((rule) => rule.selector === selector
      && rule.conditions.every((condition) => conditionMatches(condition, width, coarsePointer)))
    .reduce((style, rule) => ({ ...style, ...rule.declarations }), {});
}

function pixels(value, description) {
  assert.match(value || '', /^\d+(?:\.\d+)?px$/, `${description} must use a fixed pixel size.`);
  return Number.parseFloat(value);
}

function rectangle(x, y, width, height, label) {
  return { x, y, width, height, label };
}

function assertWithinViewport(box, width, height) {
  assert.ok(box.width > 0 && box.height > 0, `${box.label} must have a visible size.`);
  assert.ok(box.x >= 0 && box.y >= 0, `${box.label} starts outside the viewport.`);
  assert.ok(
    box.x + box.width <= width + 0.01 && box.y + box.height <= height + 0.01,
    `${box.label} exceeds the ${width}x${height} viewport: ${JSON.stringify(box)}`,
  );
}

function assertNoOverlap(boxes, context) {
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first];
      const b = boxes[second];
      const overlaps = a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y;
      assert.equal(overlaps, false, `${context}: ${a.label} overlaps ${b.label}.`);
    }
  }
}

function layoutAtViewport(width, height, coarsePointer) {
  const mobile = width <= 640;
  const narrowMobile = width <= 400;
  const topbarStyle = styleFor('.topbar', width, coarsePointer);
  const toolbarStyle = styleFor('.toolbar', width, coarsePointer);
  const addressStyle = styleFor('.address-box', width, coarsePointer);
  const addressGoStyle = styleFor('.address-go', width, coarsePointer);
  const topbarHeight = pixels(topbarStyle.height, '.topbar height');
  const topbarPadding = Number.parseFloat(topbarStyle.padding.split(/\s+/).at(-1));
  const topbarGap = pixels(topbarStyle.gap, '.topbar gap');
  const iconWidth = pixels(
    styleFor('.icon-button', width, coarsePointer).width,
    '.icon-button width',
  );
  const tabAddWidth = pixels(
    styleFor('.tab-add', width, coarsePointer).width,
    '.tab-add width',
  );

  const brandWidth = mobile ? (narrowMobile ? 84 : 130) : 140;
  const securityWidth = mobile ? 7 : 200;
  const tabStripWidth = width - 2 * topbarPadding
    - 3 * topbarGap
    - brandWidth
    - securityWidth
    - iconWidth;
  const tabGap = 5;
  const tabsWidth = tabStripWidth - tabAddWidth - tabGap;
  assert.ok(tabsWidth > 0, `The tabs scroller has no room at ${width}px.`);

  const brandX = topbarPadding;
  const tabStripX = brandX + brandWidth + topbarGap;
  const securityX = tabStripX + tabStripWidth + topbarGap;
  const settingsX = securityX + securityWidth + topbarGap;
  const topbarBoxes = [
    rectangle(brandX, 0, brandWidth, topbarHeight, 'AETHER brand'),
    rectangle(tabStripX, 0, tabStripWidth, topbarHeight, 'tab strip'),
    rectangle(securityX, 0, securityWidth, topbarHeight, 'security status'),
    rectangle(settingsX, 0, iconWidth, topbarHeight, 'settings button'),
    rectangle(tabStripX + tabsWidth + tabGap, 0, tabAddWidth, topbarHeight, 'new-tab button'),
  ];

  const toolbarTop = topbarHeight;
  const toolbarPaddingValues = toolbarStyle.padding.split(/\s+/);
  const toolbarPaddingVertical = Number.parseFloat(toolbarPaddingValues[0]);
  const toolbarPaddingHorizontal = Number.parseFloat(toolbarPaddingValues.at(-1));
  const controls = [];
  let toolbarHeight;
  let addressBox;
  if (mobile) {
    const gap = pixels(toolbarStyle.gap, 'mobile toolbar gap');
    const columnCount = 5;
    const gridColumns = toolbarStyle['grid-template-columns'];
    assert.match(gridColumns, /repeat\(5,\s*minmax\(32px,\s*1fr\)\)/);
    const trackWidth = (width - 2 * toolbarPaddingHorizontal - (columnCount - 1) * gap) / columnCount;
    const addressHeight = pixels(addressStyle.height, 'mobile address box height');
    const addressWidth = width - 2 * toolbarPaddingHorizontal;
    addressBox = rectangle(
      toolbarPaddingHorizontal,
      toolbarTop + toolbarPaddingVertical,
      addressWidth,
      addressHeight,
      'address bar',
    );
    const buttonTop = addressBox.y + addressBox.height + gap;
    const iconHeight = pixels(
      styleFor('.icon-button', width, coarsePointer).height,
      'toolbar button height',
    );
    for (const [index, label] of ['back', 'forward', 'reload', 'stop', 'bookmark'].entries()) {
      controls.push(rectangle(
        toolbarPaddingHorizontal + index * (trackWidth + gap),
        buttonTop,
        iconWidth,
        iconHeight,
        `${label} button`,
      ));
    }
    toolbarHeight = 2 * toolbarPaddingVertical + addressHeight + gap + iconHeight + 1;
  } else {
    const padding = toolbarPaddingHorizontal;
    const gap = pixels(toolbarStyle.gap, 'toolbar gap');
    const addressMargin = Number.parseFloat(addressStyle.margin.split(/\s+/).at(-1));
    const fixedAddressWidth = 100;
    const addressWidth = width - 2 * padding
      - 5 * gap
      - 5 * iconWidth
      - 2 * addressMargin
      - fixedAddressWidth;
    assert.ok(addressWidth >= fixedAddressWidth, `The address bar is cramped at ${width}px.`);
    toolbarHeight = pixels(toolbarStyle.height, 'toolbar height');
    let cursor = padding;
    for (const label of ['back', 'forward', 'reload', 'stop']) {
      controls.push(rectangle(cursor, toolbarTop, iconWidth, toolbarHeight, `${label} button`));
      cursor += iconWidth + gap;
    }
    addressBox = rectangle(cursor + addressMargin, toolbarTop, addressWidth, toolbarHeight, 'address bar');
    cursor += addressMargin + addressWidth + addressMargin + gap;
    controls.push(rectangle(cursor, toolbarTop, iconWidth, toolbarHeight, 'bookmark button'));
  }

  const addressGoWidth = coarsePointer
    ? pixels(addressGoStyle['min-width'], 'touch Go button minimum width')
    : 36;
  const addressGoHeight = coarsePointer
    ? pixels(addressGoStyle['min-height'], 'touch Go button minimum height')
    : 25;
  const addressGo = rectangle(
    addressBox.x + addressBox.width - addressGoWidth - 8,
    addressBox.y + (addressBox.height - addressGoHeight) / 2,
    addressGoWidth,
    addressGoHeight,
    'Go button',
  );
  const addressInput = rectangle(
    addressBox.x + 34,
    addressBox.y,
    addressBox.width - addressGoWidth - 54,
    addressBox.height,
    'address input',
  );

  const noticeTop = toolbarTop + toolbarHeight;
  const noticeHeight = narrowMobile ? 60 : (mobile ? 48 : 36);
  const workspaceTop = noticeTop + noticeHeight;
  const sidebarStyle = styleFor('.sidebar', width, coarsePointer);
  const sidebarWidth = mobile ? width : Number.parseFloat(sidebarStyle.width);
  const sidebarHeight = mobile ? (coarsePointer ? 55 : 51) : height - workspaceTop - 26;
  const sidebar = rectangle(0, workspaceTop, sidebarWidth, sidebarHeight, 'sidebar');
  const statusbar = rectangle(0, height - 26, width, 26, 'status bar');

  const topbarBottom = rectangle(0, 0, width, topbarHeight, 'topbar');
  const toolbarBounds = rectangle(0, toolbarTop, width, toolbarHeight, 'toolbar');
  const noticeBounds = rectangle(0, noticeTop, width, noticeHeight, 'restricted-mode notice');
  for (const box of [...topbarBoxes, topbarBottom, toolbarBounds, noticeBounds, sidebar, statusbar]) {
    assertWithinViewport(box, width, height);
  }
  for (const box of [...controls, addressBox, addressGo, addressInput]) {
    assertWithinViewport(box, width, height);
  }
  assertWithinViewport(sidebar, width, height);
  assertWithinViewport(statusbar, width, height);
  assertNoOverlap(topbarBoxes.slice(0, 4), `${width}px top bar`);
  assertNoOverlap(controls, `${width}px toolbar`);
  assertNoOverlap([addressInput, addressGo], `${width}px address field`);
  assert.ok(
    sidebar.y + sidebar.height <= statusbar.y,
    `The sidebar overlaps the status bar at ${width}px.`,
  );
  assert.ok(tabsWidth + tabAddWidth + tabGap <= tabStripWidth + 0.01);
  assert.ok(
    topbarBoxes[4].x >= topbarBoxes[1].x
      && topbarBoxes[4].x + topbarBoxes[4].width
        <= topbarBoxes[1].x + topbarBoxes[1].width,
    `The new-tab action is outside the tab strip at ${width}px.`,
  );
  assert.ok(addressInput.width > 0, `The address input has no usable width at ${width}px.`);
}

test('AETHER controls fit target viewports without unintended document overflow or overlap', () => {
  for (const [width, height] of [
    [360, 720],
    [640, 720],
    [768, 1024],
    [1480, 920],
  ]) {
    for (const coarsePointer of [false, true]) {
      assert.match(styleFor('body', width, coarsePointer).overflow, /hidden/);
      assert.equal(styleFor('.browser-shell', width, coarsePointer)['min-width'], '0');
      assert.equal(styleFor('.workspace', width, coarsePointer).overflow, 'hidden');
      assert.equal(styleFor('.tabs', width, coarsePointer)['overflow-x'], 'auto');
      if (width <= 640) {
        assert.equal(styleFor('.sidebar', width, coarsePointer)['overflow-x'], 'auto');
      }
      layoutAtViewport(width, height, coarsePointer);
    }
  }
});

test('coarse-pointer navigation controls have 44px touch targets', () => {
  for (const selector of [
    '.icon-button',
    '.tab-add',
    '.tab-close',
    '.tab-select',
    '.sidebar-action',
    '.panel-action',
    '.address-box',
    '.address-go',
  ]) {
    const style = styleFor(selector, 360, true);
    const width = Math.max(
      Number.parseFloat(style.width) || 0,
      Number.parseFloat(style['min-width']) || 0,
      selector === '.address-box' ? 44 : 0,
    );
    const height = Math.max(
      Number.parseFloat(style.height) || 0,
      Number.parseFloat(style['min-height']) || 0,
    );
    assert.ok(width >= 44, `${selector} is only ${width}px wide in coarse-pointer mode.`);
    assert.ok(height >= 44, `${selector} is only ${height}px high in coarse-pointer mode.`);
  }
});
