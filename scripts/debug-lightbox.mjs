import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = 'http://localhost:5173';
const API = 'http://localhost:3001';
const username = process.argv[2] || 'e2ea3pgw9q';
const res = await fetch(`${API}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password: 'password123' }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.error);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((t) => {
  localStorage.setItem('aura.token', t);
  localStorage.setItem('aura.sound', 'off');
}, data.token);
const page = await context.newPage();
await page.goto(WEB);
await page.waitForSelector('.app-shell');
const room = data.rooms.find((r) => r.name.startsWith('E2E'));
await page.locator(`button[aria-label="Room ${room.name}"]`).click();
await page.locator('.attachment-image').last().waitFor();
await page.locator('.attachment-image').last().click();
await page.locator('.lightbox').waitFor();
await page.waitForTimeout(700);
console.log(await page.locator('.lightbox').evaluate((el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bg: cs.backgroundColor, z: cs.zIndex, position: cs.position, opacity: cs.opacity, parent: el.parentElement.className };
}));
console.log(await page.locator('.lightbox img').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, opacity: getComputedStyle(el).opacity };
}));
await page.screenshot({ path: 'shots/debug-lightbox.png' });
await browser.close();
