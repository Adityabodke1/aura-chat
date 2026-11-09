import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { io } from 'socket.io-client';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = 'http://localhost:5173';
const API = 'http://localhost:3001';
const SHOTS = 'shots';
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}

async function ensureUser(username) {
  let res = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  });
  if (res.status === 409) {
    res = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'password123' }),
    });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'auth failed');
  return data;
}

const a = await ensureUser('auratest');
const b = await ensureUser('novatest');

// make friends
const meA = await api('/api/me', { token: a.token });
if (!meA.friends.some((f) => f.username === 'novatest')) {
  const meB = await api('/api/me', { token: b.token });
  if (meB.incoming.length) {
    for (const req of meB.incoming) {
      await api('/api/friends/respond', {
        token: b.token,
        method: 'POST',
        body: { requestId: req.id, action: 'accept' },
      });
    }
  } else {
    await api('/api/friends/request', {
      token: a.token,
      method: 'POST',
      body: { username: 'novatest' },
    });
    const refreshedB = await api('/api/me', { token: b.token });
    for (const req of refreshedB.incoming) {
      await api('/api/friends/respond', {
        token: b.token,
        method: 'POST',
        body: { requestId: req.id, action: 'accept' },
      });
    }
  }
}

// create room + join with OTP
const existingRooms = (await api('/api/me', { token: a.token })).rooms;
let room = existingRooms.find((r) => r.name === 'Midnight Crew');
if (!room) {
  const created = await api('/api/rooms', {
    token: a.token,
    method: 'POST',
    body: { name: 'Midnight Crew' },
  });
  room = created.room;
}
const joined = await api('/api/me', { token: b.token });
if (!joined.rooms.some((r) => r.id === room.id)) {
  await api('/api/rooms/join', {
    token: b.token,
    method: 'POST',
    body: { otp: room.otp },
  });
}
room = (await api('/api/me', { token: a.token })).rooms.find((r) => r.id === room.id);

// sockets so both users look online
const sa = io(API, { auth: { token: a.token }, transports: ['websocket'] });
const sb = io(API, { auth: { token: b.token }, transports: ['websocket'] });
await Promise.all([
  new Promise((r) => sa.on('connect', r)),
  new Promise((r) => sb.on('connect', r)),
]);

const roomChannel = `room:${room.id}`;
const dmChannel = `dm:${[a.user.id, b.user.id].sort().join(':')}`;

const seedMessages = [
  [sa, roomChannel, 'this room is ours now 🌙'],
  [sb, roomChannel, 'the code worked! love the aura'],
  [sa, roomChannel, '**midnight crew** assemble — voice later?'],
  [sb, roomChannel, 'absolutely. bringing snacks 🍕'],
];
const dmMessages = [
  [sa, dmChannel, 'yo! welcome to aura 👋'],
  [sb, dmChannel, 'this UI is *so* discord, i love it'],
  [sa, dmChannel, 'try the room code — 6 digits, invite only'],
];

async function ensureSeed(seed, channel) {
  const existing = await api(`/api/messages?channel=${encodeURIComponent(channel)}`, {
    token: a.token,
  });
  if (existing.messages.some((message) => message.type === 'user')) return;
  for (const [sock, target, text] of seed) {
    sock.emit('message:send', { channelId: target, text });
  }
}

await ensureSeed(seedMessages, roomChannel);
await ensureSeed(dmMessages, dmChannel);

await sleep(1200);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

async function makePage(token) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((t) => {
    localStorage.setItem('aura.token', t);
    localStorage.setItem('aura.sound', 'off');
  }, token);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.goto(WEB);
  await page.waitForSelector('.app-shell', { timeout: 10000 });
  return { page, context };
}

// fresh auth screenshots
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(WEB);
  await page.waitForSelector('.auth-card');
  await shot(page, '01-auth-login');
  await page.locator('.auth-switch button').click();
  await shot(page, '02-auth-register');
  await context.close();
}

const { page: pageA, context: ctxA } = await makePage(a.token);
await shot(pageA, '03-friends');

// add-friend tab
await pageA.locator('.friends-tab.add-tab').click();
await shot(pageA, '04-add-friend');
await pageA.locator('.friends-tab', { hasText: 'Online' }).click();

// room
await pageA.locator(`button[aria-label="Room ${room.name}"]`).click();
await pageA.waitForSelector('.chat-view');
await pageA.locator('.message').first().waitFor({ timeout: 15000 });
await shot(pageA, '05-room');

// room info
await pageA.locator('.sidebar-room-header').click();
await pageA.waitForSelector('.room-info-code');
await shot(pageA, '06-room-info');
await pageA.locator('.modal-close').click();

// join modal
await pageA.locator('.rail-action[aria-label="Join a room with a code"]').click();
await pageA.waitForSelector('.otp-input');
await shot(pageA, '07-join-room');
await pageA.locator('.modal-close').click();

// create room modal
await pageA.locator('.rail-action[aria-label="Create a room"]').click();
await pageA.waitForSelector('.create-room-preview');
await shot(pageA, '08-create-room');
await pageA.locator('.modal-close').click();

// dm
await pageA.locator('.rail-home').click();
await pageA.waitForSelector('.dm-row');
await pageA.locator('.dm-row', { hasText: 'novatest' }).click();
await pageA.locator('.message').first().waitFor({ timeout: 15000 });
await shot(pageA, '09-dm');

// settings
await pageA.locator('.user-actions .icon-btn').last().click();
await pageA.waitForSelector('.settings-profile');
await shot(pageA, '10-settings');
await pageA.locator('.modal-close').click();

// mobile
await ctxA.close();
const mobileCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
await mobileCtx.addInitScript((t) => {
  localStorage.setItem('aura.token', t);
  localStorage.setItem('aura.sound', 'off');
}, a.token);
const mobile = await mobileCtx.newPage();
await mobile.goto(WEB);
await mobile.waitForSelector('.app-shell');
await shot(mobile, '11-mobile-friends');
await mobile.locator('.mobile-menu').click();
await shot(mobile, '12-mobile-sidebar');
await mobile.locator(`button[aria-label="Room ${room.name}"]`).click();
await mobile.locator('.chat-view').waitFor();
await mobile.locator('.message').first().waitFor({ timeout: 15000 });
await shot(mobile, '13-mobile-room');

sa.close();
sb.close();
await browser.close();
console.log('Screenshots written to', SHOTS);
