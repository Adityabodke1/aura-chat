# Aura Chat

A Discord-inspired chat app with OTP-protected rooms, direct messages, media sharing, emoji reactions, in-place message editing, runtime color themes, and WebRTC voice/video calls.

- **Frontend:** React 18 + Vite (glass panels, aurora backdrop, three themes)
- **Backend:** Express + Socket.IO
- **Auth:** username + password (scrypt hashes, server-side sessions)
- **Data:** Supabase Postgres (with a local JSON fallback)
- **Media:** Supabase Storage public bucket (with local disk fallback)
- **Calls:** WebRTC mesh with public STUN servers
- **Deploy:** static client on Netlify + persistent Node backend on Render/Railway/Fly/VPS

---

## Quick start (local JSON mode)

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Without Supabase credentials the server automatically stores everything in `data/db.json` and uploads in `uploads/`.

To force local mode even when Supabase is configured, set `AURA_STORE=json` in `.env`.

---

## Supabase setup

### 1. Create the database schema

1. Open your project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**.
3. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql).
4. Click **Run**.

This creates:

| Table | Purpose |
| --- | --- |
| `aura_users` | usernames, salts, scrypt password hashes |
| `aura_sessions` | bearer-token sessions |
| `aura_rooms` | room names, owners, 6-digit OTPs |
| `aura_room_members` | room membership |
| `aura_friend_requests` | pending + accepted friendships |
| `aura_messages` | DMs, room messages, attachments, reactions, edit timestamps |

It also creates the public **`aura-uploads`** Storage bucket and locks every table down with RLS. Only the server's secret key can read/write app data.

> **Updating an existing project?** Rerun the whole file, or paste just [`supabase/message-extras.sql`](supabase/message-extras.sql). It uses `alter table … add column if not exists`, so it adds the newer `reactions` and `edited_at` columns to `aura_messages` without touching existing rows. Until you apply it, the server keeps working but reactions and edit markers will not persist.

### 2. Add the server secret key

In Supabase: **Project Settings → API Keys → Secret keys → Create new secret key**, then copy the `sb_secret_…` value into `.env`:

```dotenv
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_…
SUPABASE_STORAGE_BUCKET=aura-uploads
```

> **Important:** the publishable/anon key is public and cannot write to these tables. The secret key is server-only — never put it in `client/`, commit it, or share it.

Verify everything:

```bash
npm run db:check
```

### 3. Move existing local data (optional)

If you already used the app in JSON mode:

```bash
npm run db:migrate
```

This upserts all users, sessions, rooms, friendships, and messages, uploads local files to the `aura-uploads` bucket, and rewrites attachment URLs. It is safe to re-run.

### 4. Start the app

```bash
npm run dev
```

The server log should say:

```
[store] Supabase database + storage bucket "aura-uploads"
```

If something is wrong it prints the reason and falls back to `data/db.json` instead of crashing.

---

## Environment variables

### Server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Express / Socket.IO port |
| `SUPABASE_URL` | — | Project URL |
| `SUPABASE_SECRET_KEY` | — | Server-only `sb_secret_…` or legacy `service_role` key |
| `SUPABASE_STORAGE_BUCKET` | `aura-uploads` | Public bucket for attachments |
| `AURA_STORE` | — | Set to `json` to force the local fallback |
| `CLIENT_ORIGIN` | — | Exact browser origin(s) allowed by CORS and Socket.IO; comma-separated. Required when Netlify hosts the client. |

### Client (build-time)

Vite reads the shared root `.env`; only variables prefixed with `VITE_` reach the browser. These are also set in Netlify's environment-variable UI. Leave both empty for local development or when Express serves `dist/` on the same origin.

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_URL` | empty | Backend origin for REST and `/uploads/...` media, e.g. `https://YOUR-SERVICE.onrender.com` |
| `VITE_SOCKET_URL` | empty | Backend origin for Socket.IO; falls back to `VITE_API_URL` |

Copy [`.env.example`](.env.example) to `.env` to get started. Never put `SUPABASE_SECRET_KEY` in a `VITE_` variable: everything prefixed with `VITE_` is public in the built client.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Express + Vite concurrently |
| `npm run client` | Start only the Vite client |
| `npm run server` | Start only the Express server |
| `npm run build` | Build the client into `dist/` |
| `npm start` | Serve the production build + API on port 3001 |
| `npm run db:check` | Verify Supabase tables, reaction/edit columns, bucket, write access, and public reads |
| `npm run db:migrate` | Import `data/db.json` + local uploads into Supabase |
| `node scripts/e2e.mjs` | Run the Playwright regression suite (dev server must be running) |
| `node scripts/preview.mjs` | Regenerate demo screenshots in `shots/` |

> The e2e suite covers reactions and editing. Apply `supabase/message-extras.sql` before running it against Supabase; the local JSON store needs no migration.

---

## Deploying: Netlify client + long-lived backend

Netlify can host the static Vite build, but it cannot keep the Express + Socket.IO server alive: serverless functions cannot hold persistent WebSocket connections. Run the backend on a long-lived Node host (Render, Railway, Fly.io, a VPS), then point the Netlify build at it.

### 1. Deploy the backend

The included [`render.yaml`](render.yaml) is a ready-to-use Render blueprint. On [Render](https://render.com), choose **New → Blueprint**, select the repository, and fill the secret values. Or create a Web Service manually:

- **Build command:** `npm ci`
- **Start command:** `npm start`
- **Health check path:** `/`

Set these environment variables:

```dotenv
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_…
SUPABASE_STORAGE_BUCKET=aura-uploads
CLIENT_ORIGIN=https://YOUR-SITE.netlify.app
```

`CLIENT_ORIGIN` accepts a comma-separated list, which is useful for a custom domain plus Netlify deploy previews. It also supports `*` wildcards, for example `https://*.netlify.app`. The server's own origin is always allowed; `localhost` origins are allowed automatically only outside production.

Copy the deployed backend URL — Render shows it at the top of the service page, for example `https://aura-chat-api-xxxx.onrender.com`.

> Render's free instances spin down after inactivity, which disconnects Socket.IO. Use an always-on instance (or another host) if calls and real-time chat must be reliable. In local JSON mode, uploads live on the host's disk and disappear after a redeploy; use Supabase Storage in production.

The same server also serves the built client from `dist/`, so `npm run build && npm start` on a single Node host is a valid all-in-one deployment when you do not need Netlify.

### 2. Deploy the client to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and select the repository.
2. [`netlify.toml`](netlify.toml) already configures the build:
   - build command: `npm run build`
   - publish directory: `dist`
   - SPA fallback: every route → `/index.html`
3. Add environment variables under **Site configuration → Environment variables**:

```dotenv
VITE_API_URL=https://YOUR-SERVICE.onrender.com
VITE_SOCKET_URL=https://YOUR-SERVICE.onrender.com
```

Use the backend origin exactly, without a trailing slash. Vite inlines these values at build time, so changing them requires a new Netlify deploy.

4. Make sure the backend's `CLIENT_ORIGIN` contains the exact Netlify origin, then deploy.
5. Open the site and verify: register/login, send a message, join a room by OTP, upload an image, and start a call.

Local development needs no extra configuration: the Vite proxy forwards `/api`, `/uploads` and `/socket.io` to `http://localhost:3001`. If you run the client locally against a remote backend, put the same `VITE_*` values in the root `.env` and add `http://localhost:5173` to the backend's `CLIENT_ORIGIN`.

### 3. Post-deploy checklist

```bash
npm run db:check
```

Run that against the same Supabase project, then confirm in the browser:

- The login request reaches the backend host, not Netlify.
- Socket.IO connects (presence dots update when another user logs in).
- Image attachments load from the backend origin or Supabase Storage.
- `CLIENT_ORIGIN` matches the exact URL in the address bar.

---

## How it works

### Auth

Registration and login stay username + password only. Passwords are hashed with Node's `scrypt` and a per-user salt. Login returns an opaque bearer token stored in `aura_sessions`; the browser keeps it in `localStorage` and sends it with REST requests and the Socket.IO handshake.

### Rooms

Rooms are joined with a 6-digit OTP. The owner can rotate the code in room settings; the old code stops working immediately and every member is notified. When the last member leaves, the room and its message history are deleted.

### Reactions

A hover action bar offers a curated emoji set. The server stores a `{ "❤️": ["userId", …] }` map in `aura_messages.reactions`, toggles the caller's ID, and broadcasts the updated message to every channel member. Chips aggregate counts across users and highlight the reactions you added.

### Editing

Authors can edit their own text messages in place. The server caps the text at 4000 characters, updates the row, sets `edited_at`, and broadcasts the result. The UI shows an `(edited)` marker. Attachments and room-owner moderation are unchanged.

### Themes

Settings offers **Aurora** (violet + cyan), **Ember** (rose + amber) and **Tide** (ocean + mint). The choice is saved in `localStorage` as `aura.theme` and applied through `data-theme` on `<html>`. [`client/src/styles/theme.css`](client/src/styles/theme.css) swaps the CSS variables for the aurora blobs, gradients, glows and highlights.

### Media

Uploads are limited to 50 MB and to image/video/audio MIME types. Files go to the `aura-uploads` bucket when Supabase is active, otherwise to `uploads/`. Attachment URLs are validated server-side so a client cannot submit arbitrary links.

### Calls

Calls use a WebRTC mesh over Socket.IO signaling:

1. `voice:join` registers the participant and rings the DM peer (`call:incoming`).
2. Peers exchange SDP offers/answers and ICE candidates via `call:signal`.
3. `voice:state` broadcasts mute/camera changes; `voice:leave` tears the call down for everyone.

STUN-only means calls work on most home networks, but **not** behind strict/symmetric NATs — add a TURN server for reliable remote calling.

---

## Security notes

- The Supabase secret key is read only by the Node server. The browser never receives it.
- Every `aura_*` table has RLS enabled with no client policies, so the public API key cannot read or write data.
- `CLIENT_ORIGIN` is an exact allowlist for browser API and Socket.IO origins. Do not use `*` in production.
- `VITE_*` variables are embedded in the public client bundle. Never place the Supabase secret key or other credentials in one.
- Attachment URLs must start with `/uploads/` or the configured public bucket URL.
- Usernames are case-insensitively unique; friend requests require the exact username.
- Render/proxy the app over HTTPS in production. Browsers only grant camera/microphone access on `localhost` or HTTPS.

---

## Troubleshooting

**`GET /rest/v1/aura_users` returns 404 / "relation does not exist"** — run `supabase/schema.sql` in the SQL Editor.

**Log says `aura_messages is missing "reactions"/"edited_at"`** — run `supabase/message-extras.sql` (or rerun the full schema) in the SQL Editor, then restart the backend. Messages keep working in the meantime, but reactions and edit markers will not persist.

**Browser console shows a CORS error / `origin not allowed`** — set `CLIENT_ORIGIN` on the backend to the exact origin in the address bar (including `https://`), then restart or redeploy the backend. Multiple origins are comma-separated.

**Netlify site loads but API calls go to the Netlify domain** — `VITE_API_URL` was missing during the build. Add it in Netlify's environment variables and trigger a new deploy; Vite inlines it at build time.

**Images or videos 404 on Netlify** — these are server-relative `/uploads/...` paths. Set `VITE_API_URL` so `mediaUrl()` resolves them against the backend origin, then redeploy.

**Socket.IO keeps reconnecting / calls fail on a free Render instance** — the instance may be asleep or restarting. Use an always-on plan or another host.

**Reactions disappear after a server restart** — the Supabase `reactions`/`edited_at` migration has not been applied. Rerun the schema SQL.

**Server logs "SUPABASE_SECRET_KEY is not a secret/service-role key"** — you pasted a publishable/anon key. Create a secret key in Project Settings → API Keys.

**No `aura-uploads` bucket** — rerun the schema SQL; it creates the bucket and public-read policy.

**Uploads fail with "row-level security" / permission errors** — the server is likely using the publishable key, or the secret key was revoked.

**Vite changes do not appear under OneDrive** — the file watcher can go stale; restart `npm run dev`.

**Camera/mic blocked on another device** — use HTTPS (for example a Caddy/NGINX reverse proxy) or test on `localhost`.

**`Unexpected token '﻿'` when reading `data/db.json`** — the loader strips UTF-8 BOMs; update to the latest `server/db.js` if you see this.

---

## Project layout

```
client/                 React app (App.jsx, components, styles)
client/src/theme.js     Theme ids, persistence and data-theme application
client/src/styles/theme.css  Glass/aurora redesign layer
server/index.js         REST + Socket.IO API
server/db.js            JSON fallback persistence
server/store/           Store adapter (json + supabase)
supabase/schema.sql     Tables, indexes, RLS, storage bucket
supabase/message-extras.sql  Focused migration for reactions + edit timestamps
scripts/                e2e, screenshots, migration, Supabase check
netlify.toml            Netlify build, SPA redirect and security headers
render.yaml             Optional Render backend blueprint
Procfile                Generic Node host process definition
data/db.json            Local fallback data (git-ignored)
uploads/                Local fallback media (git-ignored)
```
