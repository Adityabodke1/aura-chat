import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { Server } from 'socket.io';
import { createStore, isAllowedAttachmentUrl, supabaseConfig } from './store/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DIST_DIR = path.join(ROOT, 'dist');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PORT = Number(process.env.PORT) || 3001;

/**
 * Comma-separated browser origins allowed to call the API/socket directly.
 * Supports a `*` wildcard, for example:
 *   CLIENT_ORIGIN=https://aura-chat.netlify.app,https://*.netlify.app
 * The app's own origin and local dev origins are always allowed.
 */
const CLIENT_ORIGIN_PATTERNS = String(
  process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGINS || '',
)
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function originMatchesPattern(origin, pattern) {
  if (!pattern.includes('*')) return pattern === origin;
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${source}$`).test(origin);
}

function originAllowed(origin, hostHeader) {
  if (!origin) return true; // curl, server-to-server, same-origin navigations
  if (CLIENT_ORIGIN_PATTERNS.some((pattern) => originMatchesPattern(origin, pattern))) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    if (hostHeader && parsed.host === hostHeader) return true; // own origin
  } catch {
    return false;
  }

  if (process.env.NODE_ENV !== 'production') {
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return false;
}


/** Assigned in main() before the server accepts requests. */
let store;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const AVATAR_COLORS = [
  '#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245',
  '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB', '#F47FFF',
];

const newId = () => crypto.randomBytes(8).toString('hex');

/** Wrap async route handlers so rejected promises reach the error handler. */
const route = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function avatarColorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, user) {
  try {
    const candidate = Buffer.from(hashPassword(password, user.salt), 'hex');
    const expected = Buffer.from(user.passwordHash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  };
}

const userById = (id) => store.getUserById(id);

const friendshipRequest = (a, b) => store.getFriendship(a, b);

const areFriends = async (a, b) => Boolean(await friendshipRequest(a, b));

async function friendIds(userId) {
  return store.getFriendIds(userId);
}

async function friendsOf(userId) {
  const ids = await friendIds(userId);
  const users = await store.getUsersByIds(ids);
  return users.sort((a, b) => a.username.localeCompare(b.username));
}

async function serializeRoom(room) {
  const users = await store.getUsersByIds(room.members);
  const byId = new Map(users.map((user) => [user.id, user]));
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    otp: room.otp,
    createdAt: room.createdAt,
    members: room.members.map((id) => byId.get(id)).filter(Boolean).map(publicUser),
  };
}

async function snapshot(user) {
  const [pending, friends, rooms] = await Promise.all([
    store.getPendingRequests(user.id),
    friendsOf(user.id),
    store.getRoomsForUser(user.id),
  ]);
  const serializedRooms = await Promise.all(rooms.map(serializeRoom));

  return {
    user: publicUser(user),
    friends: friends.map(publicUser),
    incoming: pending.incoming,
    outgoing: pending.outgoing,
    rooms: serializedRooms.sort((a, b) => a.createdAt - b.createdAt),
  };
}

async function channelMemberIds(channelId) {
  if (typeof channelId !== 'string') return [];
  if (channelId.startsWith('dm:')) {
    return channelId.slice(3).split(':').filter(Boolean);
  }
  if (channelId.startsWith('room:')) {
    const room = await store.getRoom(channelId.slice(5));
    return room ? [...room.members] : [];
  }
  return [];
}

async function canAccessChannel(userId, channelId) {
  const ids = await channelMemberIds(channelId);
  if (!ids.includes(userId)) return false;
  if (channelId.startsWith('dm:')) {
    return ids.length === 2 && areFriends(ids[0], ids[1]);
  }
  return Boolean(await store.getRoom(channelId.slice(5)));
}

function cleanAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!isAllowedAttachmentUrl(url)) return null;
  const type = ['image', 'video', 'audio', 'file'].includes(raw.type) ? raw.type : 'file';
  return {
    url,
    type,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 180) : 'attachment',
    size: Number(raw.size) || 0,
  };
}

/* ------------------------------------------------------------------ */
/*  App / server / socket.io                                          */
/* ------------------------------------------------------------------ */

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  cors: { origin: true, methods: ['GET', 'POST'] },
  allowRequest: (req, callback) => {
    const allowed = originAllowed(req.headers.origin, req.headers.host);
    callback(allowed ? null : 'origin not allowed', allowed);
  },
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin, req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));

const online = new Map(); // userId -> Set<socketId>
const voiceStates = new Map(); // channelId -> Map<userId, participant>
const voiceChannelByUser = new Map(); // userId -> channelId

const toUser = (userId, event, payload) => io.to(`user:${userId}`).emit(event, payload);

async function emitToChannelMembers(channelId, event, payload, excludeUserId = null) {
  const ids = await channelMemberIds(channelId);
  for (const uid of ids) {
    if (uid === excludeUserId) continue;
    toUser(uid, event, payload);
  }
}

function broadcastPresence() {
  io.emit('presence:update', { online: [...online.keys()] });
}

async function addSystemMessage(channelId, text) {
  const message = {
    id: newId(),
    channelId,
    type: 'system',
    text,
    createdAt: Date.now(),
  };
  await pushMessage(message);
  return message;
}

async function pushMessage(message) {
  await store.addMessage(message);
  await emitToChannelMembers(message.channelId, 'message:new', message);
  return message;
}

/** Small curated set keeps reaction payloads predictable and safe. */
const REACTION_EMOJIS = new Set(['❤️', '😂', '🔥', '👍', '✨', '🎉', '😮', '😢']);

/* --------------------------- auth ---------------------------------- */

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.query.token || null;
}

async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    const session = token ? await store.getSession(token) : null;
    const user = session ? await userById(session.userId) : null;
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

/* --------------------------- auth routes --------------------------- */

app.post('/api/register', route(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–20 characters using letters, numbers, dots or underscores.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Password is too long.' });
  }
  if (await store.getUserByUsernameLower(username.toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: newId(),
    username,
    usernameLower: username.toLowerCase(),
    salt,
    passwordHash: hashPassword(password, salt),
    avatarColor: avatarColorFor(username),
    createdAt: Date.now(),
  };
  await store.createUser(user);

  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, { userId: user.id, createdAt: Date.now() });

  res.json({ token, ...(await snapshot(user)) });
}));

app.post('/api/login', route(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await store.getUserByUsernameLower(username);
  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, { userId: user.id, createdAt: Date.now() });
  res.json({ token, ...(await snapshot(user)) });
}));

app.post('/api/logout', requireAuth, route(async (req, res) => {
  await store.deleteSession(req.token);
  res.json({ ok: true });
}));

app.get('/api/me', requireAuth, route(async (req, res) => {
  res.json(await snapshot(req.user));
}));

/* --------------------------- friends ------------------------------- */

app.post('/api/friends/request', requireAuth, route(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Enter a username.' });

  const target = await store.getUserByUsernameLower(username.toLowerCase());
  if (!target) return res.status(404).json({ error: `No user found with the exact username "${username}".` });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot add yourself.' });
  if (await areFriends(req.user.id, target.id)) {
    return res.status(409).json({ error: `You are already friends with ${target.username}.` });
  }

  const sameDirection = await store.getPendingRequest(req.user.id, target.id);
  if (sameDirection) {
    return res.status(409).json({ error: `You already sent a request to ${target.username}.` });
  }

  const reverse = await store.getPendingRequest(target.id, req.user.id);
  if (reverse) {
    await store.updateFriendRequest(reverse.id, { status: 'accepted', acceptedAt: Date.now() });
    toUser(target.id, 'friends:changed', {});
    toUser(req.user.id, 'friends:changed', {});
    toUser(req.user.id, 'friend:accepted', { user: publicUser(target) });
    toUser(target.id, 'friend:accepted', { user: publicUser(req.user) });
    return res.json({ status: 'accepted', user: publicUser(target) });
  }

  const request = {
    id: newId(),
    fromUserId: req.user.id,
    toUserId: target.id,
    status: 'pending',
    createdAt: Date.now(),
  };
  await store.createFriendRequest(request);

  toUser(target.id, 'friend:request', { id: request.id, user: publicUser(req.user) });
  toUser(target.id, 'friends:changed', {});
  toUser(req.user.id, 'friends:changed', {});
  res.json({ status: 'pending' });
}));

app.post('/api/friends/respond', requireAuth, route(async (req, res) => {
  const requestId = String(req.body?.requestId || '');
  const action = req.body?.action === 'accept' ? 'accept' : 'decline';
  const request = await store.getFriendRequest(requestId);
  if (!request || request.status !== 'pending' || request.toUserId !== req.user.id) {
    return res.status(404).json({ error: 'That friend request no longer exists.' });
  }

  const other = await userById(request.fromUserId);
  if (action === 'accept') {
    await store.updateFriendRequest(request.id, { status: 'accepted', acceptedAt: Date.now() });
    if (other) {
      toUser(other.id, 'friends:changed', {});
      toUser(other.id, 'friend:accepted', { user: publicUser(req.user) });
    }
    toUser(req.user.id, 'friend:accepted', { user: publicUser(other) });
  } else {
    await store.deleteFriendRequest(request.id);
    if (other) toUser(other.id, 'friends:changed', {});
  }
  toUser(req.user.id, 'friends:changed', {});
  res.json({ ok: true });
}));

app.post('/api/friends/remove', requireAuth, route(async (req, res) => {
  const otherId = String(req.body?.userId || '');
  const friendship = await friendshipRequest(req.user.id, otherId);
  if (!friendship) return res.status(404).json({ error: 'You are not friends with that user.' });
  await store.deleteFriendRequest(friendship.id);
  toUser(req.user.id, 'friends:changed', {});
  toUser(otherId, 'friends:changed', {});
  res.json({ ok: true });
}));

/* --------------------------- messages ------------------------------ */

app.get('/api/messages', requireAuth, route(async (req, res) => {
  const channelId = String(req.query.channel || '');
  if (!(await canAccessChannel(req.user.id, channelId))) {
    return res.status(403).json({ error: 'You do not have access to this conversation.' });
  }
  const messages = await store.getMessages(channelId, 150);
  res.json({ messages });
}));

/* --------------------------- rooms --------------------------------- */

async function makeOtp() {
  let otp;
  do {
    otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  } while (await store.otpExists(otp));
  return otp;
}

app.post('/api/rooms', requireAuth, route(async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 30) {
    return res.status(400).json({ error: 'Room name must be 2–30 characters.' });
  }
  const room = {
    id: newId(),
    name,
    ownerId: req.user.id,
    otp: await makeOtp(),
    members: [req.user.id],
    createdAt: Date.now(),
  };
  await store.createRoom(room);
  await addSystemMessage(`room:${room.id}`, `${req.user.username} created the room. Share the room code to invite people.`);
  res.json({ room: await serializeRoom(room) });
}));

app.post('/api/rooms/join', requireAuth, route(async (req, res) => {
  const otp = String(req.body?.otp || '').trim();
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter the 6-digit room code.' });
  const room = await store.getRoomByOtp(otp);
  if (!room) return res.status(404).json({ error: 'Invalid room code. Check the code and try again.' });

  if (!room.members.includes(req.user.id)) {
    await store.addRoomMember(room.id, req.user.id);
    room.members.push(req.user.id);
    await addSystemMessage(`room:${room.id}`, `${req.user.username} joined the room.`);
    toUser(req.user.id, 'rooms:changed', {});
    for (const memberId of room.members) {
      if (memberId === req.user.id) continue;
      toUser(memberId, 'room:member_joined', {
        roomId: room.id,
        roomName: room.name,
        user: publicUser(req.user),
      });
    }
  }
  res.json({ room: await serializeRoom(room) });
}));

app.get('/api/rooms/:roomId/otp', requireAuth, route(async (req, res) => {
  const room = await store.getRoom(req.params.roomId);
  if (!room || !room.members.includes(req.user.id)) {
    return res.status(404).json({ error: 'Room not found.' });
  }
  res.json({ otp: room.otp });
}));

app.post('/api/rooms/:roomId/otp', requireAuth, route(async (req, res) => {
  const room = await store.getRoom(req.params.roomId);
  if (!room || !room.members.includes(req.user.id)) {
    return res.status(404).json({ error: 'Room not found.' });
  }
  if (room.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only the room owner can change the code.' });
  }
  const otp = await makeOtp();
  await store.updateRoom(room.id, { otp });
  const payload = { roomId: room.id, otp };
  for (const memberId of room.members) toUser(memberId, 'room:otp', payload);
  res.json({ otp });
}));

app.post('/api/rooms/:roomId/leave', requireAuth, route(async (req, res) => {
  const room = await store.getRoom(req.params.roomId);
  if (!room || !room.members.includes(req.user.id)) {
    return res.status(404).json({ error: 'Room not found.' });
  }
  const channelId = `room:${room.id}`;
  await leaveVoice(req.user.id);

  const remaining = room.members.filter((id) => id !== req.user.id);
  if (remaining.length === 0) {
    await store.deleteRoom(room.id);
  } else {
    await store.removeRoomMember(room.id, req.user.id);
    if (room.ownerId === req.user.id) {
      await store.updateRoom(room.id, { ownerId: remaining[0] });
    }
    await addSystemMessage(channelId, `${req.user.username} left the room.`);
    for (const memberId of remaining) {
      toUser(memberId, 'rooms:changed', {});
    }
  }
  toUser(req.user.id, 'rooms:changed', {});
  res.json({ ok: true });
}));

/* --------------------------- uploads ------------------------------- */

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.weba',
};

function extensionFor(file) {
  const fallback = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  return MIME_EXT[file.mimetype] || fallback || '';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video|audio)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only images, videos and audio files are allowed.'));
  },
});

app.post('/api/upload', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (50 MB max).' : err.message;
        return res.status(400).json({ error: message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });

      const type = req.file.mimetype.startsWith('image/')
        ? 'image'
        : req.file.mimetype.startsWith('video/')
          ? 'video'
          : req.file.mimetype.startsWith('audio/')
            ? 'audio'
            : 'file';

      const filename = `${crypto.randomBytes(16).toString('hex')}${extensionFor(req.file)}`;
      let url;

      if (store.kind === 'supabase') {
        const month = new Date().toISOString().slice(0, 7);
        url = await store.uploadFile({
          buffer: req.file.buffer,
          path: `messages/${month}/${filename}`,
          contentType: req.file.mimetype,
        });
      } else {
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
        url = `/uploads/${filename}`;
      }

      res.json({
        url,
        type,
        name: req.file.originalname,
        size: req.file.size,
      });
    } catch (uploadError) {
      next(uploadError);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Voice / call helpers                                              */
/* ------------------------------------------------------------------ */

function voiceParticipants(channelId) {
  const map = voiceStates.get(channelId);
  if (!map) return [];
  return [...map.values()].map((p) => ({ ...p }));
}

async function broadcastVoice(channelId) {
  const participants = voiceParticipants(channelId);
  await emitToChannelMembers(channelId, 'voice:update', { channelId, participants });
  return participants;
}

async function leaveVoice(userId) {
  const channelId = voiceChannelByUser.get(userId);
  if (!channelId) return;

  const map = voiceStates.get(channelId);
  if (map) {
    map.delete(userId);
    if (map.size === 0) voiceStates.delete(channelId);
  }
  voiceChannelByUser.delete(userId);

  await emitToChannelMembers(channelId, 'voice:peer_left', { channelId, userId });
  const remaining = await broadcastVoice(channelId);

  if (channelId.startsWith('dm:') && remaining.length === 0) {
    await emitToChannelMembers(channelId, 'call:cancelled', { channelId });
  }
}

/* ------------------------------------------------------------------ */
/*  Socket.io                                                        */
/* ------------------------------------------------------------------ */

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const session = token ? await store.getSession(token) : null;
    const user = session ? await userById(session.userId) : null;
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  } catch (err) {
    console.error('[socket] auth failed:', err.message);
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  socket.join(`user:${user.id}`);

  const sockets = online.get(user.id) || new Set();
  sockets.add(socket.id);
  online.set(user.id, sockets);
  broadcastPresence();

  /** Keep async socket handlers from producing unhandled rejections. */
  const guard = (handler) => (...args) => {
    Promise.resolve(handler(...args)).catch((err) => {
      console.error(`[socket] ${user.username}:`, err.message);
      socket.emit('app:error', { error: 'Something went wrong. Please try again.' });
    });
  };

  /* ---- direct messages / channel presence ---- */
  socket.on('channel:open', guard(async ({ channelId } = {}) => {
    if (await canAccessChannel(user.id, channelId)) socket.join(`channel:${channelId}`);
  }));

  socket.on('typing:start', guard(async ({ channelId } = {}) => {
    if (!(await canAccessChannel(user.id, channelId))) return;
    await emitToChannelMembers(
      channelId,
      'typing',
      { channelId, user: { id: user.id, username: user.username } },
      user.id,
    );
  }));

  socket.on('message:send', guard(async ({ channelId, text, attachment } = {}) => {
    if (!(await canAccessChannel(user.id, channelId))) return;
    const body = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
    const file = cleanAttachment(attachment);
    if (!body && !file) return;

    const message = {
      id: newId(),
      channelId,
      type: 'user',
      userId: user.id,
      username: user.username,
      avatarColor: user.avatarColor,
      text: body,
      attachment: file,
      createdAt: Date.now(),
    };
    await pushMessage(message);
  }));

  socket.on('message:delete', guard(async ({ channelId, messageId } = {}) => {
    if (!(await canAccessChannel(user.id, channelId))) return;
    const message = await store.getMessage(messageId);
    if (!message || message.channelId !== channelId) return;

    let allowed = message.userId === user.id;
    if (!allowed && channelId.startsWith('room:')) {
      const room = await store.getRoom(channelId.slice(5));
      allowed = room?.ownerId === user.id;
    }
    if (!allowed) return;

    await store.deleteMessage(messageId);
    await emitToChannelMembers(channelId, 'message:deleted', { channelId, messageId });
  }));

  socket.on('message:react', guard(async ({ channelId, messageId, emoji } = {}) => {
    if (!(await canAccessChannel(user.id, channelId))) return;
    if (!REACTION_EMOJIS.has(emoji)) return;

    const message = await store.getMessage(messageId);
    if (!message || message.channelId !== channelId) return;

    const reactions = { ...(message.reactions || {}) };
    const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji] : []);
    if (users.has(user.id)) users.delete(user.id);
    else users.add(user.id);
    if (users.size) reactions[emoji] = [...users];
    else delete reactions[emoji];

    const updated =
      (await store.updateMessage(messageId, { reactions })) || { ...message, reactions };
    await emitToChannelMembers(channelId, 'message:updated', updated);
  }));

  socket.on('message:edit', guard(async ({ channelId, messageId, text } = {}) => {
    if (!(await canAccessChannel(user.id, channelId))) return;

    const message = await store.getMessage(messageId);
    if (!message || message.channelId !== channelId) return;
    if (message.userId !== user.id || message.type !== 'user') return;

    const body = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
    if (!body || body === message.text) return;

    const editedAt = Date.now();
    const updated =
      (await store.updateMessage(messageId, { text: body, editedAt })) || {
        ...message,
        text: body,
        editedAt,
      };
    await emitToChannelMembers(channelId, 'message:updated', updated);
  }));

  /* ---- rooms ---- */
  socket.on('room:request-voice', guard(async ({ channelId } = {}) => {
    if (!(await canAccessChannel(user.id, channelId))) return;
    socket.emit('voice:update', { channelId, participants: voiceParticipants(channelId) });
  }));

  /* ---- voice / calls ---- */
  socket.on('voice:join', guard(async ({ channelId, camera } = {}) => {
    if (!channelId || !(await canAccessChannel(user.id, channelId))) return;

    const previous = voiceChannelByUser.get(user.id);
    if (previous && previous !== channelId) await leaveVoice(user.id);

    let map = voiceStates.get(channelId);
    if (!map) {
      map = new Map();
      voiceStates.set(channelId, map);
    }
    const already = map.has(user.id);
    const existing = [...map.values()]
      .filter((p) => p.userId !== user.id)
      .map((p) => ({ ...p }));

    if (!already) {
      map.set(user.id, {
        userId: user.id,
        username: user.username,
        avatarColor: user.avatarColor,
        muted: false,
        camera: Boolean(camera),
        joinedAt: Date.now(),
      });
    } else if (typeof camera === 'boolean') {
      map.get(user.id).camera = camera;
    }
    voiceChannelByUser.set(user.id, channelId);

    socket.emit('voice:joined', {
      channelId,
      peers: existing,
      self: { ...map.get(user.id) },
    });

    if (!already) {
      for (const peer of existing) {
        toUser(peer.userId, 'voice:peer_joined', {
          channelId,
          peer: { ...map.get(user.id) },
        });
      }
    }

    if (channelId.startsWith('dm:')) {
      const otherId = (await channelMemberIds(channelId)).find((id) => id !== user.id);
      if (otherId) {
        const otherInCall = voiceChannelByUser.get(otherId) === channelId;
        if (!otherInCall) {
          toUser(otherId, 'call:incoming', {
            channelId,
            video: Boolean(camera),
            from: publicUser(user),
          });
        } else {
          toUser(otherId, 'call:accepted', { channelId });
        }
      }
    }

    await broadcastVoice(channelId);
  }));

  socket.on('voice:state', ({ muted, camera } = {}) => {
    const channelId = voiceChannelByUser.get(user.id);
    if (!channelId) return;
    const participant = voiceStates.get(channelId)?.get(user.id);
    if (!participant) return;
    if (typeof muted === 'boolean') participant.muted = muted;
    if (typeof camera === 'boolean') participant.camera = camera;
    broadcastVoice(channelId).catch((err) => console.error('[voice]', err.message));
  });

  socket.on('voice:leave', guard(async () => {
    await leaveVoice(user.id);
  }));

  socket.on('call:signal', ({ toUserId, channelId, data } = {}) => {
    if (!toUserId || !channelId || !data) return;
    if (voiceChannelByUser.get(user.id) !== channelId) return;
    if (voiceChannelByUser.get(toUserId) !== channelId) return;
    toUser(toUserId, 'call:signal', { fromUserId: user.id, channelId, data });
  });

  socket.on('call:decline', guard(async ({ channelId, toUserId } = {}) => {
    if (!channelId?.startsWith('dm:') || !toUserId) return;
    const ids = await channelMemberIds(channelId);
    if (!ids.includes(user.id) || !ids.includes(toUserId)) return;
    toUser(toUserId, 'call:declined', { channelId, by: publicUser(user) });
  }));

  socket.on('disconnect', () => {
    const set = online.get(user.id);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        online.delete(user.id);
        leaveVoice(user.id).catch((err) => console.error('[voice]', err.message));
      }
    }
    broadcastPresence();
  });
});

/* ------------------------------------------------------------------ */
/*  Static client                                                     */
/* ------------------------------------------------------------------ */

if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('Aura Chat API is running. Start the Vite client with: npm run dev');
  });
}

// Basic error handler (JSON for API calls).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  store = await createStore();

  server.listen(PORT, () => {
    const cfg = supabaseConfig();
    console.log(`\n  Aura Chat server  →  http://localhost:${PORT}`);
    console.log(`  Data store        →  ${store.kind === 'supabase' ? 'Supabase' : 'data/db.json'}`);
    if (store.kind === 'supabase') {
      console.log(`  Storage bucket    →  ${cfg.bucket} (${cfg.url})`);
    } else {
      console.log(`  Uploads           →  ${UPLOAD_DIR}`);
    }
    console.log('');
  });

  const shutdown = async () => {
    try {
      await store.close?.();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
