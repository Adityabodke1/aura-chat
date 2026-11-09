import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaults = () => ({
  users: [],
  sessions: {},
  rooms: [],
  friendRequests: [],
  messages: {},
});

let db = defaults();
let saveTimer = null;

/** Strip a UTF-8 BOM (PowerShell/Notepad love adding one). */
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/** Load (or initialise) the JSON database. */
export function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = readJson(DB_FILE);
      db = { ...defaults(), ...parsed };
      db.users = Array.isArray(db.users) ? db.users : [];
      db.sessions = db.sessions || {};
      db.rooms = Array.isArray(db.rooms) ? db.rooms : [];
      db.friendRequests = Array.isArray(db.friendRequests) ? db.friendRequests : [];
      db.messages = db.messages || {};
    } catch (err) {
      console.error('[db] Could not read data/db.json — starting fresh.', err.message);
    }
  }
  return db;
}

/** The live in-memory database object. */
export function getDb() {
  return db;
}

/** Persist the database (debounced so bursts of messages are cheap). */
export function saveDb() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushDb();
  }, 120);
}

export function flushDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('[db] Failed to persist database:', err.message);
  }
}

process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    flushDb();
  }
});
