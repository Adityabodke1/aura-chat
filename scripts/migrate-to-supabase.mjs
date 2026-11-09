/**
 * Import the local JSON database and uploads into Supabase.
 *
 *   1. Apply supabase/schema.sql in the Supabase SQL Editor.
 *   2. Put SUPABASE_URL + SUPABASE_SECRET_KEY in .env.
 *   3. Run: npm run db:migrate
 *
 * Safe to re-run: every row is upserted by primary key.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { isSecretKey, supabaseConfig } from '../server/store/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

const { url, key, bucket, enabled } = supabaseConfig();

if (!enabled || !isSecretKey(key)) {
  console.error(
    'Missing or invalid Supabase credentials.\n' +
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_… / service_role) in .env first.',
  );
  process.exit(1);
}

if (!fs.existsSync(DB_FILE)) {
  console.error(`No local database found at ${DB_FILE}. Nothing to migrate.`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8').replace(/^\uFEFF/, ''));
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.weba': 'audio/webm',
};

async function upsertAll(table, rows, onConflict = 'id') {
  if (!rows.length) {
    console.log(`  ${table}: 0 rows`);
    return;
  }
  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length} rows`);
}

async function uploadLocalAttachments() {
  const files = new Set();
  for (const list of Object.values(db.messages || {})) {
    for (const message of list || []) {
      const attachmentUrl = message?.attachment?.url;
      if (typeof attachmentUrl === 'string' && attachmentUrl.startsWith('/uploads/')) {
        files.add(attachmentUrl.slice('/uploads/'.length));
      }
    }
  }

  const replacements = new Map();
  let uploaded = 0;
  for (const filename of files) {
    const safeName = path.basename(filename);
    const localPath = path.join(UPLOAD_DIR, safeName);
    const oldUrl = `/uploads/${safeName}`;

    if (!fs.existsSync(localPath)) {
      console.warn(`  ! missing upload, leaving URL untouched: ${oldUrl}`);
      continue;
    }

    const objectPath = `legacy/${safeName}`;
    const contentType = MIME[path.extname(safeName).toLowerCase()] || 'application/octet-stream';
    const { error } = await client.storage
      .from(bucket)
      .upload(objectPath, fs.readFileSync(localPath), { contentType, upsert: true });
    if (error) throw new Error(`Upload ${safeName}: ${error.message}`);

    const { data } = client.storage.from(bucket).getPublicUrl(objectPath);
    replacements.set(oldUrl, data.publicUrl);
    uploaded += 1;
  }

  console.log(`  uploads: ${uploaded} file(s)`);
  return replacements;
}

function flagged(text) {
  console.log(`\n${text}`);
}

async function main() {
  console.log(`\nMigrating local data → ${url}`);
  console.log(`Storage bucket: ${bucket}`);

  // Fail early with a clear message if the schema has not been applied.
  const { error: probeError } = await client.from('aura_users').select('id').limit(1);
  if (probeError) {
    throw new Error(
      `${probeError.message}\nApply supabase/schema.sql in the Supabase SQL Editor first.`,
    );
  }

  const urlMap = await uploadLocalAttachments();

  // Users first (everything references them), then the rest.
  await upsertAll(
    'aura_users',
    (db.users || []).map((user) => ({
      id: user.id,
      username: user.username,
      username_lower: user.usernameLower || user.username.toLowerCase(),
      salt: user.salt,
      password_hash: user.passwordHash,
      avatar_color: user.avatarColor || '#5865F2',
      created_at: user.createdAt,
    })),
  );

  await upsertAll(
    'aura_sessions',
    Object.entries(db.sessions || {}).map(([token, session]) => ({
      token,
      user_id: session.userId,
      created_at: session.createdAt,
    })),
    'token',
  );

  await upsertAll(
    'aura_rooms',
    (db.rooms || []).map((room) => ({
      id: room.id,
      name: room.name,
      owner_id: room.ownerId,
      otp: room.otp,
      created_at: room.createdAt,
    })),
  );

  const memberships = [];
  for (const room of db.rooms || []) {
    for (const userId of room.members || []) {
      memberships.push({
        room_id: room.id,
        user_id: userId,
        joined_at: room.createdAt || 0,
      });
    }
  }
  await upsertAll('aura_room_members', memberships, 'room_id,user_id');

  await upsertAll(
    'aura_friend_requests',
    (db.friendRequests || []).map((request) => ({
      id: request.id,
      from_user_id: request.fromUserId,
      to_user_id: request.toUserId,
      status: request.status,
      created_at: request.createdAt,
      accepted_at: request.acceptedAt ?? null,
    })),
  );

  const messages = [];
  for (const [channelId, list] of Object.entries(db.messages || {})) {
    for (const message of list || []) {
      let attachment = message.attachment || null;
      if (attachment?.url && urlMap.has(attachment.url)) {
        attachment = { ...attachment, url: urlMap.get(attachment.url) };
      }
      messages.push({
        id: message.id,
        channel_id: channelId,
        type: message.type || 'user',
        user_id: message.userId || null,
        username: message.username || null,
        avatar_color: message.avatarColor || null,
        text: message.text || '',
        attachment,
        created_at: message.createdAt,
      });
    }
  }
  await upsertAll('aura_messages', messages);

  flagged('Migration complete.');
  flagged('Start the server with: npm run dev');
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}\n`);
  process.exit(1);
});
