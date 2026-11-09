import { io } from 'socket.io-client';

/**
 * The Socket.IO server must run on a long-lived Node host (Render, Railway,
 * Fly.io, a VPS…). Netlify can only serve the static Vite build. Set
 * VITE_SOCKET_URL (or VITE_API_URL as a fallback) to that backend origin.
 */
const SOCKET_URL = String(
  import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || '',
)
  .trim()
  .replace(/\/+$/, '');

export function createSocket(token) {
  const options = {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  };
  return SOCKET_URL ? io(SOCKET_URL, options) : io(options);
}
