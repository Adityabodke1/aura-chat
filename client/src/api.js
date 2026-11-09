const TOKEN_KEY = 'aura.token';

/**
 * When the client is hosted separately from the API (for example Netlify +
 * Render), set VITE_API_URL at build time to the backend origin. When it is
 * empty the app uses relative URLs, which keeps the local Vite proxy and the
 * Express-served production build working unchanged.
 */
export const API_BASE = String(import.meta.env.VITE_API_URL || '')
  .trim()
  .replace(/\/+$/, '');

/** Resolve server-relative media paths through the API origin. */
export function mediaUrl(url) {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (!API_BASE) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request(path, { method = 'GET', body, formData, token } = {}) {
  const headers = {};
  const authToken = token ?? getToken();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error('Cannot reach the server. Is it running?');
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(
      'The API returned an HTML page. If the client is hosted on Netlify, set VITE_API_URL to your backend origin and redeploy.',
    );
  }

  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  register: (username, password) =>
    request('/api/register', { method: 'POST', body: { username, password } }),
  login: (username, password) =>
    request('/api/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  addFriend: (username) =>
    request('/api/friends/request', { method: 'POST', body: { username } }),
  respondFriend: (requestId, action) =>
    request('/api/friends/respond', { method: 'POST', body: { requestId, action } }),
  removeFriend: (userId) =>
    request('/api/friends/remove', { method: 'POST', body: { userId } }),
  messages: (channelId) => request(`/api/messages?channel=${encodeURIComponent(channelId)}`),
  createRoom: (name) => request('/api/rooms', { method: 'POST', body: { name } }),
  joinRoom: (otp) => request('/api/rooms/join', { method: 'POST', body: { otp } }),
  regenerateOtp: (roomId) => request(`/api/rooms/${roomId}/otp`, { method: 'POST' }),
  leaveRoom: (roomId) => request(`/api/rooms/${roomId}/leave`, { method: 'POST' }),
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/api/upload', { method: 'POST', formData });
  },
};
