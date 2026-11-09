import { createClient } from '@supabase/supabase-js';

const mapUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    usernameLower: row.username_lower,
    salt: row.salt,
    passwordHash: row.password_hash,
    avatarColor: row.avatar_color,
    createdAt: Number(row.created_at),
  };

const userRow = (user) => ({
  id: user.id,
  username: user.username,
  username_lower: user.usernameLower ?? user.username.toLowerCase(),
  salt: user.salt,
  password_hash: user.passwordHash,
  avatar_color: user.avatarColor,
  created_at: user.createdAt,
});

const mapSession = (row) =>
  row && { userId: row.user_id, createdAt: Number(row.created_at) };

const mapRoom = (row, memberIds) => ({
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  otp: row.otp,
  members: memberIds,
  createdAt: Number(row.created_at),
});

const mapFriendRequest = (row) =>
  row && {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status,
    createdAt: Number(row.created_at),
    acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
  };

const mapMessage = (row) => ({
  id: row.id,
  channelId: row.channel_id,
  type: row.type,
  userId: row.user_id ?? undefined,
  username: row.username ?? undefined,
  avatarColor: row.avatar_color ?? undefined,
  text: row.text ?? '',
  attachment: row.attachment ?? null,
  reactions: row.reactions && typeof row.reactions === 'object' ? row.reactions : {},
  editedAt: row.edited_at == null ? null : Number(row.edited_at),
  createdAt: Number(row.created_at),
});

const messageRow = (message, includeExtras = true) => ({
  id: message.id,
  channel_id: message.channelId,
  type: message.type || 'user',
  user_id: message.userId || null,
  username: message.username ?? null,
  avatar_color: message.avatarColor ?? null,
  text: message.text ?? '',
  attachment: message.attachment ?? null,
  ...(includeExtras
    ? {
        reactions: message.reactions || {},
        edited_at: message.editedAt ?? null,
      }
    : {}),
  created_at: message.createdAt,
});

function checked(error, label) {
  if (error) {
    const hint = error.code === '42P01' ? ' (is supabase/schema.sql applied?)' : '';
    throw new Error(`${label}: ${error.message}${hint}`);
  }
}

/**
 * Supabase-backed store. All access goes through the server's secret key, so
 * the browser never sees a credential that can write to the database.
 */
export function createSupabaseStore({ url, key, bucket }) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /**
   * `reactions` + `edited_at` were added after the first release. Keep the app
   * usable for people who have not rerun supabase/schema.sql yet; reactions and
   * edit markers simply will not persist until the migration is applied.
   */
  let messageExtras = true;

  async function detectMessageExtras() {
    const { error } = await client
      .from('aura_messages')
      .select('reactions, edited_at')
      .limit(1);
    if (!error) return true;

    if (error.code === '42703' || /column .* does not exist/i.test(error.message)) {
      console.warn(
        '[supabase] aura_messages is missing "reactions"/"edited_at". ' +
          'Messages still work, but reactions and edit markers will not persist. ' +
          'Run supabase/message-extras.sql (or rerun supabase/schema.sql) to enable them.',
      );
      return false;
    }

    checked(error, 'Inspect message columns');
    return true;
  }

  async function membersForRooms(roomIds) {
    if (!roomIds.length) return new Map();
    const { data, error } = await client
      .from('aura_room_members')
      .select('room_id, user_id')
      .in('room_id', roomIds);
    checked(error, 'Load room members');

    const map = new Map(roomIds.map((id) => [id, []]));
    for (const row of data || []) {
      const list = map.get(row.room_id);
      if (list) list.push(row.user_id);
    }
    return map;
  }

  async function fetchRooms(roomIds) {
    if (!roomIds.length) return [];
    const [{ data: rooms, error }, members] = await Promise.all([
      client
        .from('aura_rooms')
        .select('*')
        .in('id', roomIds)
        .order('created_at', { ascending: true }),
      membersForRooms(roomIds),
    ]);
    checked(error, 'Load rooms');
    return (rooms || []).map((row) => mapRoom(row, members.get(row.id) || []));
  }

  async function usersByIds(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return [];
    const { data, error } = await client.from('aura_users').select('*').in('id', unique);
    checked(error, 'Load users');
    return (data || []).map(mapUser);
  }

  async function friendRequestById(id) {
    const { data, error } = await client
      .from('aura_friend_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    checked(error, 'Load friend request');
    return mapFriendRequest(data);
  }

  async function roomById(id) {
    const { data, error } = await client
      .from('aura_rooms')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    checked(error, 'Load room');
    if (!data) return null;
    const members = await membersForRooms([id]);
    return mapRoom(data, members.get(id) || []);
  }

  async function messageById(id) {
    const { data, error } = await client
      .from('aura_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    checked(error, 'Load message');
    return data ? mapMessage(data) : null;
  }

  return {
    kind: 'supabase',
    bucket,

    async init() {
      const { error } = await client.from('aura_users').select('id').limit(1);
      checked(error, 'Connect to Supabase');

      messageExtras = await detectMessageExtras();

      const { error: bucketError } = await client.storage.getBucket(bucket);
      if (bucketError) {
        console.warn(
          `[supabase] Storage bucket "${bucket}" is unavailable: ${bucketError.message}. ` +
            'Run supabase/schema.sql to create it.',
        );
      }
    },

    async close() {},

    /* ------------------------------ users ------------------------------ */
    async getUserById(id) {
      const { data, error } = await client
        .from('aura_users')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      checked(error, 'Load user');
      return mapUser(data);
    },

    async getUserByUsernameLower(usernameLower) {
      const { data, error } = await client
        .from('aura_users')
        .select('*')
        .eq('username_lower', usernameLower)
        .maybeSingle();
      checked(error, 'Load user');
      return mapUser(data);
    },

    async createUser(user) {
      const { error } = await client.from('aura_users').insert(userRow(user));
      checked(error, 'Create user');
      return user;
    },

    /* ---------------------------- sessions ----------------------------- */
    async createSession(token, session) {
      const { error } = await client.from('aura_sessions').insert({
        token,
        user_id: session.userId,
        created_at: session.createdAt,
      });
      checked(error, 'Create session');
    },

    async getSession(token) {
      const { data, error } = await client
        .from('aura_sessions')
        .select('*')
        .eq('token', token)
        .maybeSingle();
      checked(error, 'Load session');
      return mapSession(data);
    },

    async deleteSession(token) {
      const { error } = await client.from('aura_sessions').delete().eq('token', token);
      checked(error, 'Delete session');
    },

    /* ----------------------------- friends ----------------------------- */
    async getFriendship(a, b) {
      const { data, error } = await client
        .from('aura_friend_requests')
        .select('*')
        .eq('status', 'accepted')
        .or(
          `and(from_user_id.eq.${a},to_user_id.eq.${b}),` +
            `and(from_user_id.eq.${b},to_user_id.eq.${a})`,
        )
        .maybeSingle();
      checked(error, 'Load friendship');
      return mapFriendRequest(data);
    },

    async getFriendIds(userId) {
      const { data, error } = await client
        .from('aura_friend_requests')
        .select('from_user_id,to_user_id')
        .eq('status', 'accepted')
        .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);
      checked(error, 'Load friends');
      return (data || []).map((row) =>
        row.from_user_id === userId ? row.to_user_id : row.from_user_id,
      );
    },

    async getUsersByIds(ids) {
      return usersByIds(ids);
    },

    async getPendingRequests(userId) {
      const { data, error } = await client
        .from('aura_friend_requests')
        .select('*')
        .eq('status', 'pending')
        .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
        .order('created_at', { ascending: true });
      checked(error, 'Load friend requests');

      const rows = data || [];
      const otherIds = rows.map((row) =>
        row.from_user_id === userId ? row.to_user_id : row.from_user_id,
      );
      const users = await usersByIds(otherIds);
      const byId = new Map(users.map((user) => [user.id, user]));

      const incoming = [];
      const outgoing = [];
      for (const row of rows) {
        const other = byId.get(
          row.from_user_id === userId ? row.to_user_id : row.from_user_id,
        );
        if (!other) continue;
        const entry = {
          id: row.id,
          createdAt: Number(row.created_at),
          user: {
            id: other.id,
            username: other.username,
            avatarColor: other.avatarColor,
            createdAt: other.createdAt,
          },
        };
        if (row.to_user_id === userId) incoming.push(entry);
        else outgoing.push(entry);
      }
      return { incoming, outgoing };
    },

    async getPendingRequest(fromUserId, toUserId) {
      const { data, error } = await client
        .from('aura_friend_requests')
        .select('*')
        .eq('from_user_id', fromUserId)
        .eq('to_user_id', toUserId)
        .eq('status', 'pending')
        .maybeSingle();
      checked(error, 'Load friend request');
      return mapFriendRequest(data);
    },

    async getFriendRequest(id) {
      return friendRequestById(id);
    },

    async createFriendRequest(request) {
      const { error } = await client.from('aura_friend_requests').insert({
        id: request.id,
        from_user_id: request.fromUserId,
        to_user_id: request.toUserId,
        status: request.status,
        created_at: request.createdAt,
        accepted_at: request.acceptedAt ?? null,
      });
      checked(error, 'Create friend request');
      return request;
    },

    async updateFriendRequest(id, patch) {
      const row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.acceptedAt !== undefined) row.accepted_at = patch.acceptedAt;
      if (!Object.keys(row).length) return friendRequestById(id);

      const { data, error } = await client
        .from('aura_friend_requests')
        .update(row)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      checked(error, 'Update friend request');
      return mapFriendRequest(data);
    },

    async deleteFriendRequest(id) {
      const { error } = await client
        .from('aura_friend_requests')
        .delete()
        .eq('id', id);
      checked(error, 'Delete friend request');
    },

    /* ------------------------------ rooms ------------------------------ */
    async getRoomsForUser(userId) {
      const { data, error } = await client
        .from('aura_room_members')
        .select('room_id')
        .eq('user_id', userId);
      checked(error, 'Load room memberships');
      const ids = [...new Set((data || []).map((row) => row.room_id))];
      return fetchRooms(ids);
    },

    async getRoom(id) {
      return roomById(id);
    },

    async getRoomByOtp(otp) {
      const { data, error } = await client
        .from('aura_rooms')
        .select('*')
        .eq('otp', otp)
        .maybeSingle();
      checked(error, 'Load room');
      if (!data) return null;
      const members = await membersForRooms([data.id]);
      return mapRoom(data, members.get(data.id) || []);
    },

    async createRoom(room) {
      const { error } = await client.from('aura_rooms').insert({
        id: room.id,
        name: room.name,
        owner_id: room.ownerId,
        otp: room.otp,
        created_at: room.createdAt,
      });
      checked(error, 'Create room');

      const members = [...new Set(room.members || [])];
      if (members.length) {
        const { error: memberError } = await client.from('aura_room_members').insert(
          members.map((userId) => ({
            room_id: room.id,
            user_id: userId,
            joined_at: room.createdAt,
          })),
        );
        if (memberError) {
          await client.from('aura_rooms').delete().eq('id', room.id);
          checked(memberError, 'Add room members');
        }
      }
      return room;
    },

    async addRoomMember(roomId, userId) {
      const { error } = await client.from('aura_room_members').upsert(
        { room_id: roomId, user_id: userId, joined_at: Date.now() },
        { onConflict: 'room_id,user_id', ignoreDuplicates: true },
      );
      checked(error, 'Add room member');
    },

    async removeRoomMember(roomId, userId) {
      const { error } = await client
        .from('aura_room_members')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', userId);
      checked(error, 'Remove room member');
    },

    async updateRoom(id, patch) {
      const row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.ownerId !== undefined) row.owner_id = patch.ownerId;
      if (patch.otp !== undefined) row.otp = patch.otp;
      if (!Object.keys(row).length) return roomById(id);

      const { data, error } = await client
        .from('aura_rooms')
        .update(row)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      checked(error, 'Update room');
      if (!data) return null;
      const members = await membersForRooms([id]);
      return mapRoom(data, members.get(id) || []);
    },

    async deleteRoom(id) {
      const { error } = await client.from('aura_rooms').delete().eq('id', id);
      checked(error, 'Delete room');
      const { error: messageError } = await client
        .from('aura_messages')
        .delete()
        .eq('channel_id', `room:${id}`);
      checked(messageError, 'Delete room messages');
    },

    async otpExists(otp) {
      const { data, error } = await client
        .from('aura_rooms')
        .select('id')
        .eq('otp', otp)
        .maybeSingle();
      checked(error, 'Check room code');
      return Boolean(data);
    },

    /* ---------------------------- messages ----------------------------- */
    async getMessages(channelId, limit = 150) {
      const { data, error } = await client
        .from('aura_messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(limit);
      checked(error, 'Load messages');
      return (data || []).map(mapMessage).reverse();
    },

    async addMessage(message) {
      const { error } = await client
        .from('aura_messages')
        .insert(messageRow(message, messageExtras));
      checked(error, 'Save message');
      return message;
    },

    async getMessage(id) {
      return messageById(id);
    },

    async updateMessage(id, patch) {
      const row = {};
      if (patch.text !== undefined) row.text = patch.text;
      if (messageExtras && patch.editedAt !== undefined) row.edited_at = patch.editedAt;
      if (messageExtras && patch.reactions !== undefined) row.reactions = patch.reactions;
      if (!Object.keys(row).length) return messageById(id);

      const { data, error } = await client
        .from('aura_messages')
        .update(row)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      checked(error, 'Update message');
      return data ? mapMessage(data) : null;
    },

    async deleteMessage(id) {
      const { error } = await client.from('aura_messages').delete().eq('id', id);
      checked(error, 'Delete message');
    },

    async deleteChannelMessages(channelId) {
      const { error } = await client
        .from('aura_messages')
        .delete()
        .eq('channel_id', channelId);
      checked(error, 'Delete channel messages');
    },

    /* ---------------------------- uploads ------------------------------ */
    async uploadFile({ buffer, path: objectPath, contentType }) {
      const { error } = await client.storage.from(bucket).upload(objectPath, buffer, {
        contentType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw new Error(`Upload to Supabase Storage: ${error.message}`);
      const { data } = client.storage.from(bucket).getPublicUrl(objectPath);
      return data.publicUrl;
    },
  };
}
