import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = 'http://localhost:5173';
const API = 'http://localhost:3001';
const SHOTS = 'shots';
const IMAGE = path.resolve('scripts/fixtures/test-image.png');
fs.mkdirSync(SHOTS, { recursive: true });

const suffix = Date.now().toString(36).slice(-6);
const userA = `e2ea${suffix}`;
const userB = `e2eb${suffix}`;
const roomName = `E2E ${suffix}`;
const PASSWORD = 'password123';

const pageErrors = [];
let step = 'setup';

function log(message) {
  console.log(`\n[${step}] ${message}`);
}

async function apiRequest(route, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + route, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route}: ${data.error || res.status}`);
  return data;
}

async function register(username) {
  return apiRequest('/api/register', {
    method: 'POST',
    body: { username, password: PASSWORD },
  });
}

async function makePage(browser, token, name, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(['microphone', 'camera'], { origin: WEB });
  await context.addInitScript((t) => {
    localStorage.setItem('aura.token', t);
    localStorage.setItem('aura.sound', 'off');
  }, token);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${name} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      pageErrors.push(`${name} console: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 400 && !url.includes('/socket.io/') && !/\/api\/rooms\/join$/.test(url)) {
      pageErrors.push(`${name} HTTP ${response.status()}: ${url}`);
    }
  });
  await page.goto(WEB);
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  return { page, context };
}

async function waitForToast(page, text) {
  const toast = page.locator('.toast', { hasText: text }).first();
  await toast.waitFor({ state: 'visible', timeout: 10000 });
}

async function waitForReaction(page, text, emoji, count) {
  await page.waitForFunction(
    ({ text, emoji, count }) => {
      const row = [...document.querySelectorAll('.message')].find((el) =>
        (el.querySelector('.message-text')?.textContent || '').includes(text),
      );
      if (!row) return false;
      const chip = [...row.querySelectorAll('.message-reactions .reaction-chip')].find(
        (el) => el.querySelector('.reaction-emoji')?.textContent === emoji,
      );
      return Boolean(chip) && Number(chip.querySelector('b')?.textContent || 0) === count;
    },
    { text, emoji, count },
    { timeout: 10000 },
  );
}

const created = await Promise.all([register(userA), register(userB)]);
const a = created[0];
const b = created[1];
log(`Created ${userA} and ${userB}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
  ],
});

try {
  step = 'auth validation';
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    await page.goto(WEB);
    await page.waitForSelector('.auth-card');
    await page.locator('input[aria-label="Username"]').fill('ab');
    await page.locator('input[aria-label="Password"]').fill('123');
    await page.locator('button[type="submit"]').click();
    await page.waitForSelector('.auth-error');
    assert.match(await page.locator('.auth-error').innerText(), /Username must be/);
    log('client-side auth validation works');
    await context.close();
  }

  step = 'friend request via UI';
  const { page: pageA, context: ctxA } = await makePage(browser, a.token, 'A');
  const { page: pageB, context: ctxB } = await makePage(browser, b.token, 'B');
  assert.ok(await pageA.locator('.dm-empty').isVisible());

  await pageA.locator('.friends-tab.add-tab').click();
  await pageA.locator('input[aria-label="Username to add"]').fill(userB);
  await pageA.locator('.add-friend-form button[type="submit"]').click();
  await pageA.locator('.add-friend-feedback.success').waitFor({ timeout: 10000 });
  assert.match(await pageA.locator('.add-friend-feedback.success').innerText(), /request sent/i);
  log('A sent a request by exact username');

  await pageB.locator('.friends-tab', { hasText: 'Pending' }).click();
  const incoming = pageB.locator('.pending-row', { hasText: userA });
  await incoming.waitFor({ timeout: 10000 });
  await incoming.locator('.pending-btn.accept').click();
  await pageB.locator('.friends-tab', { hasText: 'All' }).click();
  await pageB.locator('.friend-row', { hasText: userA }).waitFor({ timeout: 10000 });
  await pageA.locator('.dm-row', { hasText: userB }).waitFor({ timeout: 10000 });
  log('B accepted; both friend lists updated in real time');

  step = 'room creation via UI';
  await pageA.locator('.rail-action[aria-label="Create a room"]').click();
  await pageA.locator('input[placeholder="Late night crew"]').fill(roomName);
  await pageA.locator('.modal button[type="submit"]').click();
  await pageA.locator('.room-info-code').waitFor({ timeout: 10000 });
  const rawOtp = await pageA.locator('.room-info-digits').innerText();
  const otp = rawOtp.replace(/\D/g, '');
  assert.equal(otp.length, 6, `OTP should be six digits, got "${rawOtp}"`);
  await pageA.locator('.modal-close').click();
  await pageA.locator('.chat-header-name', { hasText: roomName }).waitFor();
  log(`Created "${roomName}" with code ${otp}`);

  step = 'room join via OTP';
  await pageB.locator('.rail-action[aria-label="Join a room with a code"]').click();
  const otpInputs = pageB.locator('.otp-input input');
  for (let i = 0; i < 6; i += 1) await otpInputs.nth(i).fill(otp[i]);
  await pageB.locator('.join-room-modal button[type="submit"]').click();
  await pageB.locator('.chat-header-name', { hasText: roomName }).waitFor({ timeout: 10000 });
  await pageA.locator('.system-message', { hasText: `${userB} joined the room` }).waitFor({ timeout: 10000 });
  log('B joined with the OTP; A saw the join system message');

  step = 'chat messages';
  const textA = `hello from ${userA}`;
  const textB = `hey ${userA}, got it`;
  await pageA.locator('textarea[aria-label^="Message #"]').fill(textA);
  await pageA.locator('textarea[aria-label^="Message #"]').press('Enter');
  await pageB.locator('.message-text', { hasText: textA }).waitFor({ timeout: 10000 });
  await pageB.locator('textarea[aria-label^="Message #"]').fill(textB);
  await pageB.locator('textarea[aria-label^="Message #"]').press('Enter');
  await pageA.locator('.message-text', { hasText: textB }).waitFor({ timeout: 10000 });
  log('two-way messaging works');

  step = 'message reactions';
  const reactionRow = pageA.locator('.message', { hasText: textB });
  await reactionRow.hover();
  await reactionRow
    .locator('.message-quick-reactions button[aria-label="React with ❤️"]')
    .click();
  await waitForReaction(pageB, textB, '❤️', 1);
  await waitForReaction(pageA, textB, '❤️', 1);
  await pageB
    .locator('.message', { hasText: textB })
    .locator('.message-reactions button[aria-label="React with ❤️"]')
    .click();
  await waitForReaction(pageA, textB, '❤️', 2);
  await waitForReaction(pageB, textB, '❤️', 2);
  await pageA
    .locator('.message', { hasText: textB })
    .locator('.message-reactions button[aria-label="React with ❤️"]')
    .click();
  await waitForReaction(pageA, textB, '❤️', 1);
  await waitForReaction(pageB, textB, '❤️', 1);
  assert.ok(
    await pageA
      .locator('.message', { hasText: textB })
      .locator('.message-reactions .reaction-chip')
      .evaluate((el) => !el.classList.contains('mine')),
  );
  assert.ok(
    await pageB
      .locator('.message', { hasText: textB })
      .locator('.message-reactions .reaction-chip')
      .evaluate((el) => el.classList.contains('mine')),
  );
  log('reactions sync, aggregate, and toggle for both users');

  step = 'message editing';
  const editOriginal = `edit me ${suffix}`;
  const editFinal = `${editOriginal} — polished`;
  await pageA.locator('textarea[aria-label^="Message #"]').fill(editOriginal);
  await pageA.locator('textarea[aria-label^="Message #"]').press('Enter');
  await pageB.locator('.message-text', { hasText: editOriginal }).waitFor({ timeout: 10000 });

  const editRow = pageA.locator('.message', { hasText: editOriginal });
  await editRow.hover();
  await editRow.locator('button[aria-label="Edit message"]').click();
  const editor = editRow.locator('.message-edit-input');
  await editor.waitFor();
  await editor.fill(editFinal);
  await editor.press('Enter');
  await pageB.locator('.message-text', { hasText: editFinal }).waitFor({ timeout: 10000 });
  await pageB.locator('.message', { hasText: editFinal }).locator('.edited-tag').waitFor();
  await pageA.locator('.message', { hasText: editFinal }).locator('.edited-tag').waitFor();
  log('editing updates both users and marks the message as edited');

  step = 'typing indicator';
  await pageB.locator('textarea[aria-label^="Message #"]').fill('typing right now');
  await pageA.locator('.typing-bar.visible').waitFor({ timeout: 10000 });
  assert.match(await pageA.locator('.typing-bar').innerText(), new RegExp(userB));
  log('typing indicator shows on the other side');

  step = 'image upload';
  await pageA.locator('input[type="file"]').setInputFiles(IMAGE);
  await pageA.locator('.composer-attachment img').waitFor({ timeout: 15000 });
  await pageA.locator('textarea[aria-label^="Message #"]').fill('an aura picture');
  await pageA.locator('textarea[aria-label^="Message #"]').press('Enter');
  const imageB = pageB.locator('.attachment-image').last();
  await imageB.waitFor({ timeout: 15000 });
  const imageSrc = await imageB.locator('img').getAttribute('src');
  assert.match(
    imageSrc,
    /(^\/uploads\/[a-f0-9]+\.png$)|(^https:\/\/[^/]+\/storage\/v1\/object\/public\/aura-uploads\/messages\/[^/]+\/[a-f0-9]+\.png$)/,
  );
  assert.ok(await imageB.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0));
  await imageB.click();
  await pageB.locator('.lightbox').waitFor();
  await pageB.waitForTimeout(450);
  await pageB.screenshot({ path: `${SHOTS}/e2e-lightbox.png` });
  await pageB.locator('.lightbox-close').click();
  log('image upload, render and lightbox work');

  step = 'message delete';
  const doomed = `delete me ${suffix}`;
  await pageA.locator('textarea[aria-label^="Message #"]').fill(doomed);
  await pageA.locator('textarea[aria-label^="Message #"]').press('Enter');
  await pageB.locator('.message-text', { hasText: doomed }).waitFor({ timeout: 10000 });
  const doomedRow = pageA.locator('.message', { hasText: doomed });
  await doomedRow.hover();
  await doomedRow.locator('button[aria-label="Delete message"]').click();
  await pageB.locator('.message-text', { hasText: doomed }).waitFor({ state: 'detached', timeout: 10000 });
  log('message deletion propagates to the other user');

  step = 'regenerate room code';
  await pageA.locator('.sidebar-room-header').click();
  await pageA.locator('.room-info-code').waitFor();
  const beforeOtp = (await pageA.locator('.room-info-digits').innerText()).replace(/\D/g, '');
  await pageA.locator('.room-info-code-actions button', { hasText: 'New code' }).click();
  await pageA.waitForFunction(
    (oldCode) => {
      const el = document.querySelector('.room-info-digits');
      return el && el.innerText.replace(/\D/g, '') !== oldCode;
    },
    beforeOtp,
    { timeout: 10000 },
  );
  const newOtp = (await pageA.locator('.room-info-digits').innerText()).replace(/\D/g, '');
  assert.notEqual(newOtp, beforeOtp);
  await pageB.waitForFunction(
    (code) => {
      const el = document.querySelector('.room-code-value');
      return el && el.innerText.replace(/\D/g, '') === code;
    },
    newOtp,
    { timeout: 10000 },
  );
  await pageA.locator('.modal-close').click();
  log(`owner rotated the code ${beforeOtp} → ${newOtp}; every member saw it`);

  step = 'invalid OTP';
  await pageB.locator('.rail-action[aria-label="Join a room with a code"]').click();
  const badInputs = pageB.locator('.otp-input input');
  for (let i = 0; i < 6; i += 1) await badInputs.nth(i).fill(beforeOtp[i]);
  await pageB.locator('.join-room-modal button[type="submit"]').click();
  await pageB.locator('.form-error').waitFor({ timeout: 10000 });
  assert.match(await pageB.locator('.form-error').innerText(), /Invalid room code/);
  await pageB.locator('.modal-close').click();
  log('the old code is rejected after rotation');

  step = 'leave room';
  await pageB.locator('.sidebar-room-header').click();
  await pageB.locator('.room-info-code').waitFor();
  const leaveBtn = pageB.locator('.modal-actions button', { hasText: 'Leave room' });
  await leaveBtn.click();
  await pageB.locator('.modal-actions button', { hasText: 'Click again to leave' }).click();
  await pageB.locator('.room-info-code').waitFor({ state: 'detached', timeout: 10000 });
  await pageB.locator(`button[aria-label="Room ${roomName}"]`).waitFor({
    state: 'detached',
    timeout: 10000,
  });
  await pageA
    .locator('.system-message', { hasText: `${userB} left the room` })
    .waitFor({ timeout: 10000 });
  log('leaving a room removes it and notifies the remaining members');

  step = 'message persistence';
  await pageA.reload();
  await pageA.waitForSelector('.app-shell');
  await pageA.locator(`button[aria-label="Room ${roomName}"]`).click();
  await pageA.locator('.message-text', { hasText: textB }).waitFor({ timeout: 15000 });
  await pageA.locator('.attachment-image').last().waitFor({ timeout: 10000 });
  await waitForReaction(pageA, textB, '❤️', 1);
  await pageA.locator('.message', { hasText: editFinal }).locator('.edited-tag').waitFor();
  log('messages, reactions, edits and uploads survive a reload');

  step = 'call decline';
  await pageA.locator('.rail-home').click();
  await pageA.locator('.dm-row', { hasText: userB }).click();
  await pageA.locator('.chat-header-name', { hasText: userB }).waitFor();
  await pageA.locator('button[aria-label="Start video call"]').click();
  await pageB.locator('.incoming-card').waitFor({ timeout: 20000 });
  assert.match(await pageB.locator('.incoming-kicker').innerText(), /Incoming video call/i);
  assert.match(await pageB.locator('.incoming-card h2').innerText(), new RegExp(userA));
  await pageB.locator('button[aria-label="Decline call"]').click();
  await pageA.locator('.call-dock').waitFor({ state: 'detached', timeout: 15000 });
  await waitForToast(pageA, 'declined');
  log('B declined; A call dock closed and toast shown');

  step = 'video call';
  await pageA.locator('button[aria-label="Start video call"]').click();
  await pageB.locator('.incoming-card').waitFor({ timeout: 20000 });
  await pageB.locator('button[aria-label="Accept call"]').click();
  await pageA.locator('.call-dock').waitFor({ timeout: 15000 });
  await pageB.locator('.call-dock').waitFor({ timeout: 15000 });
  await pageA.locator('.call-dock-head', { hasText: 'Voice Connected' }).waitFor({ timeout: 25000 });
  await pageB.locator('.call-dock-head', { hasText: 'Voice Connected' }).waitFor({ timeout: 25000 });
  await Promise.all([
    pageA.waitForFunction(
      () => {
        const videos = [...document.querySelectorAll('video.call-video')];
        return videos.length >= 2 && videos.every((v) => v.srcObject && v.videoWidth > 0);
      },
      { timeout: 25000 },
    ),
    pageB.waitForFunction(
      () => {
        const videos = [...document.querySelectorAll('video.call-video')];
        return videos.length >= 2 && videos.every((v) => v.srcObject && v.videoWidth > 0);
      },
      { timeout: 25000 },
    ),
  ]);
  await pageA.screenshot({ path: `${SHOTS}/e2e-video-call-a.png` });
  await pageB.screenshot({ path: `${SHOTS}/e2e-video-call-b.png` });
  log('WebRTC video connects both ways');

  step = 'call controls';
  await pageA.locator('.call-control', { hasText: 'Mute' }).click();
  await pageB.waitForFunction(
    () => document.querySelectorAll('.call-tile-name svg').length >= 1,
    { timeout: 10000 },
  );
  await pageA.locator('.call-control', { hasText: 'Camera on' }).click();
  await pageB.waitForFunction(
    () => document.querySelectorAll('video.call-video').length === 1,
    { timeout: 15000 },
  );
  await pageA.locator('.call-control', { hasText: 'Camera off' }).click();
  await pageB.waitForFunction(
    () => document.querySelectorAll('video.call-video').length === 2,
    { timeout: 15000 },
  );
  log('mute and camera toggle propagate to the remote peer');

  step = 'call hangup';
  await pageA.locator('.call-control', { hasText: 'Disconnect' }).click();
  await pageA.locator('.call-dock').waitFor({ state: 'detached', timeout: 10000 });
  await pageB.locator('.call-dock').waitFor({ state: 'detached', timeout: 15000 });
  log('hanging up closes the call on both sides');

  step = 'logout and login';
  await pageA.locator('.user-actions .icon-btn').last().click();
  await pageA.locator('.settings-profile').waitFor();
  assert.equal(await pageA.locator('.theme-swatch').count(), 3);
  await pageA.locator('.theme-swatch[aria-label="Ember theme"]').click();
  assert.equal(
    await pageA.evaluate(() => document.documentElement.dataset.theme),
    'ember',
  );
  assert.equal(await pageA.evaluate(() => localStorage.getItem('aura.theme')), 'ember');
  assert.equal(
    await pageA.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    ),
    '#fb7185',
  );
  await pageA.locator('.theme-swatch[aria-label="Aurora theme"]').click();
  assert.equal(
    await pageA.evaluate(() => document.documentElement.dataset.theme),
    'aurora',
  );
  const soundSwitch = pageA.locator('.settings-row .switch');
  await soundSwitch.click();
  assert.ok(await soundSwitch.evaluate((el) => el.classList.contains('on')));
  assert.equal(await pageA.evaluate(() => localStorage.getItem('aura.sound')), 'on');
  await pageA.locator('.settings-row button', { hasText: 'Log Out' }).click();
  await pageA.locator('.auth-card').waitFor({ timeout: 10000 });
  await pageA.locator('input[aria-label="Username"]').fill(userA);
  await pageA.locator('input[aria-label="Password"]').fill(PASSWORD);
  await pageA.locator('button[type="submit"]').click();
  await pageA.locator('.app-shell').waitFor({ timeout: 10000 });
  await pageA.locator(`button[aria-label="Room ${roomName}"]`).click();
  await pageA.locator('.message-text', { hasText: textA }).waitFor({ timeout: 15000 });
  log('theme + sound preferences, logout and username/password login work');

  step = 'delete room when last member leaves';
  await pageA.locator('.sidebar-room-header').click();
  await pageA.locator('.room-info-code').waitFor();
  await pageA.locator('.modal-actions button', { hasText: 'Leave room' }).click();
  await pageA.locator('.modal-actions button', { hasText: 'Click again to leave' }).click();
  await pageA.locator(`button[aria-label="Room ${roomName}"]`).waitFor({
    state: 'detached',
    timeout: 10000,
  });
  await pageA.locator('.friends-view').waitFor();
  log('the empty room and its history were deleted');

  await ctxA.close();
  await ctxB.close();

  if (pageErrors.length) {
    console.log('\nBrowser errors:');
    for (const error of pageErrors) console.log(' -', error);
    throw new Error(`${pageErrors.length} browser error(s) were logged`);
  }

  console.log('\nAll end-to-end checks passed.');
} catch (error) {
  for (const [name, page] of Object.entries(globalThis.__pages || {})) {
    if (!page.isClosed()) await page.screenshot({ path: `${SHOTS}/e2e-failure-${name}.png` }).catch(() => {});
  }
  console.error(`\nFAILED at step "${step}":`, error.message);
  throw error;
} finally {
  await browser.close();
}
