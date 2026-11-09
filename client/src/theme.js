const THEME_KEY = 'aura.theme';

export const THEMES = [
  {
    id: 'aurora',
    name: 'Aurora',
    accent: '#8b5cf6',
    accent2: '#22d3ee',
    note: 'violet + cyan',
  },
  {
    id: 'ember',
    name: 'Ember',
    accent: '#fb7185',
    accent2: '#f59e0b',
    note: 'rose + amber',
  },
  {
    id: 'tide',
    name: 'Tide',
    accent: '#38bdf8',
    accent2: '#34d399',
    note: 'ocean + mint',
  },
];

export function getTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (THEMES.some((theme) => theme.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'aurora';
}

export function applyTheme(id) {
  const theme = THEMES.find((entry) => entry.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    /* ignore */
  }
  return theme.id;
}
