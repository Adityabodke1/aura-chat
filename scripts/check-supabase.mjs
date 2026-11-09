/**
 * Verify the Supabase project is ready for Aura Chat.
 * Requires SUPABASE_URL + SUPABASE_SECRET_KEY in .env.
 *
 *   npm run db:check
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { isSecretKey, supabaseConfig } from '../server/store/index.js';

const { url, key, bucket, enabled } = supabaseConfig();

if (!enabled || !isSecretKey(key)) {
  console.error(
    'Missing or invalid Supabase credentials.\n' +
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_… / service_role) in .env.',
  );
  process.exit(1);
}

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const TABLES = [
  'aura_users',
  'aura_sessions',
  'aura_rooms',
  'aura_room_members',
  'aura_friend_requests',
  'aura_messages',
];

async function main() {
  console.log(`\nSupabase project: ${url}\n`);

  let failed = false;

  for (const table of TABLES) {
    const { data, error, count } = await client
      .from(table)
      .select('*', { count: 'exact' })
      .limit(1);

    if (error) {
      failed = true;
      console.log(`  ✗ ${table.padEnd(24)} ${error.message}`);
    } else {
      console.log(`  ✓ ${table.padEnd(24)} ${count ?? data.length} row(s)`);
    }
  }

  const { error: extrasError } = await client
    .from('aura_messages')
    .select('reactions, edited_at')
    .limit(1);
  if (extrasError) {
    failed = true;
    console.log(`  ✗ ${'message extras'.padEnd(24)} ${extrasError.message}`);
    console.log(
      '    Run supabase/message-extras.sql (or rerun supabase/schema.sql) to add reactions + edited_at.',
    );
  } else {
    console.log(`  ✓ ${'message extras'.padEnd(24)} reactions + edited_at`);
  }

  const { error: bucketError } = await client.storage.getBucket(bucket);
  if (bucketError) {
    failed = true;
    console.log(`  ✗ bucket ${bucket.padEnd(17)} ${bucketError.message}`);
  } else {
    console.log(`  ✓ bucket ${bucket.padEnd(17)} available`);
  }

  if (!failed) {
    const probe = `diagnostics/probe-${Date.now()}.txt`;
    const { error: uploadError } = await client.storage
      .from(bucket)
      .upload(probe, Buffer.from('aura storage probe'), { contentType: 'text/plain' });

    if (uploadError) {
      failed = true;
      console.log(`  ✗ storage write          ${uploadError.message}`);
    } else {
      const { data } = client.storage.from(bucket).getPublicUrl(probe);
      const response = await fetch(data.publicUrl).catch(() => null);
      await client.storage.from(bucket).remove([probe]);
      if (!response?.ok) {
        failed = true;
        console.log('  ✗ storage public URL     not reachable (check the bucket is public)');
      } else {
        console.log('  ✓ storage write + public read');
      }
    }
  }

  if (failed) {
    console.log('\nApply supabase/schema.sql in the Supabase SQL Editor, then re-run npm run db:check.\n');
    process.exit(1);
  }

  console.log('\nSupabase is ready.\n');
}

main().catch((err) => {
  console.error(`\nCheck failed: ${err.message}\n`);
  process.exit(1);
});
