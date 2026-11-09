import { getDb, loadDb, saveDb, flushDb } from '../db.js';

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

/**
 * Local JSON store. Keeps the in-memory dataset in `data/db.json` and mirrors
 * the async Supabase store API so the server can run without credentials.
 */
export function createJsonStore() {
  const db = loadDb();

  const findUser = (id) => db.users.find((u) => u.id === id) || null;

  return {
    kind: 'json',

    async init() {},

    async close() {
      flushDb();
    },

    /* ------------------------------ users ------------------------------ */
    async getUserById(id) {
      return clone(findUser(id));
    },

    async getUserByUsernameLower(usernameLower) {
      return clone(db.users.find((u) => u.usernameLower === usernameLower) || null);
    },

    async createUser(user) {
      db.users.push(clone(user));
      saveDb();
      return clone(user);
    },

    /* ---------------------------- sessions ----------------------------- */
    async createSession(token, session) {
      db.sessions[token] = clone(session);
      saveDb();
    },

    async getSession(token) {
      return clone(db.sessions[token] || null);
    },

    async deleteSession(token) {
      delete db.sessions[token];
      saveDb();
    },

    /* ----------------------------- friends ----------------------------- */
    async getFriendship(a, b) {
      const row = db.friendRequests.find(
        (r) =>
          r.status === 'accepted' &&
          ((r.fromUserId === a && r.toUserId === b) || (r.fromUserId === b && r.toUserId === a)),
      );
      return clone(row || null);
    },

    async getFriendIds(userId) {
      return db.friendRequests
        .filter((r) => r.status === 'accepted' && (r.fromUserId === userId || r.toUserId === userId))
        .map((r) => (r.fromUserId === userId ? r.toUserId : r.fromUserId));
    },

    async getUsersByIds(ids) {
      const wanted = new Set(ids);
      return clone(db.users.filter((u) => wanted.has(u.id)));
    },

    async getPendingRequests(userId) {
      const incoming = db.friendRequests
        .filter((r) => r.status === 'pending' && r.toUserId === userId)
        .map((r) => ({ id: r.id, createdAt: r.createdAt, user: findUser(r.fromUserId) }))
        .filter((r) => r.user);
      const outgoing = db.friendRequests
        .filter((r) => r.status === 'pending' && r.fromUserId === userId)
        .map((r) => ({ id: r.id, createdAt: r.createdAt, user: findUser(r.toUserId) }))
        .filter((r) => r.user);

      return {
        incoming: clone(incoming.map((r) => ({ ...r, user: publicUser(r.user) }))),
        outgoing: clone(outgoing.map((r) => ({ ...r, user: publicUser(r.user) }))),
      };
    },

    async getPendingRequest(fromUserId, toUserId) {
      const row = db.friendRequests.find(
        (r) =>
          r.status === 'pending' &&
          r.fromUserId === fromUserId &&
          r.toUserId === toUserId,
      );
      return clone(row || null);
    },

    async getFriendRequest(id) {
      return clone(db.friendRequests.find((r) => r.id === id) || null);
    },

    async createFriendRequest(request) {
      db.friendRequests.push(clone(request));
      saveDb();
      return clone(request);
    },

    async updateFriendRequest(id, patch) {
      const row = db.friendRequests.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, clone(patch));
      saveDb();
      return clone(row);
    },

    async deleteFriendRequest(id) {
      db.friendRequests = db.friendRequests.filter((r) => r.id !== id);
      saveDb();
    },

    /* ------------------------------ rooms ------------------------------ */
    async getRoomsForUser(userId) {
      return clone(db.rooms.filter((r) => r.members.includes(userId)));
    },

    async getRoom(id) {
      return clone(db.rooms.find((r) => r.id === id) || null);
    },

    async getRoomByOtp(otp) {
      return clone(db.rooms.find((r) => r.otp === otp) || null);
    },

    async createRoom(room) {
      db.rooms.push(clone(room));
      saveDb();
      return clone(room);
    },

    async addRoomMember(roomId, userId) {
      const room = db.rooms.find((r) => r.id === roomId);
      if (!room) return;
      if (!room.members.includes(userId)) {
        room.members.push(userId);
        saveDb();
      }
    },

    async removeRoomMember(roomId, userId) {
      const room = db.rooms.find((r) => r.id === roomId);
      if (!room) return;
      room.members = room.members.filter((id) => id !== userId);
      saveDb();
    },

    async updateRoom(id, patch) {
      const room = db.rooms.find((r) => r.id === id);
      if (!room) return null;
      Object.assign(room, clone(patch));
      saveDb();
      return clone(room);
    },

    async deleteRoom(id) {
      db.rooms = db.rooms.filter((r) => r.id !== id);
      delete db.messages[`room:${id}`];
      saveDb();
    },

    async otpExists(otp) {
      return db.rooms.some((r) => r.otp === otp);
    },

    /* ---------------------------- messages ----------------------------- */
    async getMessages(channelId, limit = 150) {
      const list = db.messages[channelId] || [];
      return clone(list.slice(-limit));
    },

    async addMessage(message) {
      const list = db.messages[message.channelId] || (db.messages[message.channelId] = []);
      list.push(clone(message));
      if (list.length > 3000) list.splice(0, list.length - 3000);
      saveDb();
      return clone(message);
    },

    async getMessage(id) {
      for (const list of Object.values(db.messages)) {
        const found = list.find((m) => m.id === id);
        if (found) return clone(found);
      }
      return null;
    },

    async updateMessage(id, patch) {
      for (const list of Object.values(db.messages)) {
        const found = list.find((m) => m.id === id);
        if (found) {
          Object.assign(found, clone(patch));
          saveDb();
          return clone(found);
        }
      }
      return null;
    },

    async deleteMessage(id) {
      for (const list of Object.values(db.messages)) {
        const index = list.findIndex((m) => m.id === id);
        if (index !== -1) {
          list.splice(index, 1);
          saveDb();
          return;
        }
      }
    },

    async deleteChannelMessages(channelId) {
      delete db.messages[channelId];
      saveDb();
    },

    /* ---------------------------- uploads ------------------------------ */
    async uploadFile() {
      throw new Error('The JSON store cannot upload files; use local disk storage.');
    },
  };
}

/** Kept here to avoid importing server/index.js (circular). */
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  };
}
