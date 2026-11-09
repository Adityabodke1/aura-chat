import 'dotenv/config';
import { createJsonStore } from './jsonStore.js';
import { createSupabaseStore } from './supabaseStore.js';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export function supabaseConfig() {
  const url = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const key = clean(process.env.SUPABASE_SECRET_KEY);
  const bucket = clean(process.env.SUPABASE_STORAGE_BUCKET) || 'aura-uploads';
  const forcedJson = clean(process.env.AURA_STORE).toLowerCase() === 'json';

  return {
    url,
    key,
    bucket,
    forcedJson,
    enabled: Boolean(url && key && !forcedJson),
  };
}

/** True for sb_secret_… keys and legacy service_role JWTs. */
export function isSecretKey(key) {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString('utf8'),
      );
      return payload.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

/** Only accept attachments produced by this server or its Supabase bucket. */
export function isAllowedAttachmentUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('/uploads/')) return true;

  const { url: base, bucket } = supabaseConfig();
  if (!base) return false;
  return url.startsWith(`${base}/storage/v1/object/public/${bucket}/`);
}

export async function createStore() {
  const config = supabaseConfig();

  if (config.enabled) {
    if (!isSecretKey(config.key)) {
      console.warn(
        '[store] SUPABASE_SECRET_KEY is not a secret/service-role key. ' +
          'Falling back to local JSON so the app stays usable. ' +
          'Use the sb_secret_… key (or the legacy service_role JWT) from Project Settings → API Keys.',
      );
    } else {
      try {
        const store = createSupabaseStore(config);
        await store.init();
        console.log(`[store] Supabase database + storage bucket "${config.bucket}"`);
        return store;
      } catch (err) {
        console.error(`[store] Supabase is not ready — ${err.message}`);
        console.error('[store] Falling back to data/db.json. Apply supabase/schema.sql to fix this.');
      }
    }
  }

  if (config.forcedJson) {
    console.log('[store] AURA_STORE=json — using local data/db.json');
  } else if (!config.url || !config.key) {
    console.log('[store] Supabase is not configured — using local data/db.json');
  }

  const store = createJsonStore();
  await store.init();
  return store;
}
