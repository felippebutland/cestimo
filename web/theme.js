/** Tema da página: automático (segue o sistema), claro ou escuro. */

export const THEME_KEY = 'cestimo:tema';
export const THEME_COLOR = { claro: '#f6f7f8', escuro: '#0d0f12' };
export const THEMES = [
  { id: 'auto', label: 'Auto' },
  { id: 'claro', label: 'Claro' },
  { id: 'escuro', label: 'Escuro' },
];

export const normalizeTheme = (raw) => (THEMES.some((t) => t.id === raw) ? raw : 'auto');

export const resolveTheme = (pref, systemDark) => (pref === 'auto' ? (systemDark ? 'escuro' : 'claro') : pref);

export const nextTheme = (pref) => THEMES[(THEMES.findIndex((t) => t.id === pref) + 1) % THEMES.length].id;
