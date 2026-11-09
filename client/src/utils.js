export const dmChannelId = (a, b) => `dm:${[a, b].sort().join(':')}`;
export const roomChannelId = (roomId) => `room:${roomId}`;

export function initials(name = '?') {
  const clean = name.replace(/[^\w]/g, '');
  return (clean.slice(0, 2) || '?').toUpperCase();
}

export function displayName(user) {
  return user ? user.username : 'Unknown';
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDayLabel(ts) {
  const day = startOfDay(ts);
  const today = startOfDay(Date.now());
  const yesterday = today - 86400000;
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function platformMod() {
  return /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
}

export function safeText(value) {
  return typeof value === 'string' ? value : '';
}

export function statusLabel(online) {
  return online ? 'Online' : 'Offline';
}

const ACCENTS = [
  'linear-gradient(135deg, #5865F2, #7b85ff)',
  'linear-gradient(135deg, #EB459E, #ff7cc3)',
  'linear-gradient(135deg, #23A559, #57F287)',
  'linear-gradient(135deg, #F0B232, #FEE75C)',
  'linear-gradient(135deg, #ED4245, #ff7a7c)',
  'linear-gradient(135deg, #9B59B6, #c98fe0)',
  'linear-gradient(135deg, #1ABC9C, #5fe3cb)',
  'linear-gradient(135deg, #E67E22, #f6b26b)',
  'linear-gradient(135deg, #3498DB, #74c0f5)',
];

export function roomAccent(name = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
