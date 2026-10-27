import type { CustomTheme, Preferences, Theme, ThemeCustomizations } from '../../../shared/api';

export const THEME_DEFAULTS: Record<string, Required<ThemeCustomizations>> = {
  dark: {
    accent: '#9bc9bb',
    accentStrong: '#b0ddcf',
    accentBackground: '#293e37',
    background: '#1c1e20',
    surface: '#222426',
    text: '#e4e5e2',
  },
  light: {
    accent: '#326958',
    accentStrong: '#245442',
    accentBackground: '#e1eee6',
    background: '#faf9f6',
    surface: '#f4f3ef',
    text: '#292f2c',
  },
  midnight: {
    accent: '#b2c8ff',
    accentStrong: '#d2ddff',
    accentBackground: '#29385e',
    background: '#141725',
    surface: '#1b2032',
    text: '#e8ebf5',
  },
  forest: {
    accent: '#a8d7a9',
    accentStrong: '#c8ecc9',
    accentBackground: '#2d4833',
    background: '#18221e',
    surface: '#202d26',
    text: '#e3ece4',
  },
  ocean: {
    accent: '#8ed3db',
    accentStrong: '#b9edf1',
    accentBackground: '#28505a',
    background: '#142329',
    surface: '#1b3038',
    text: '#e1eff1',
  },
  rose: {
    accent: '#efacc8',
    accentStrong: '#ffd0e1',
    accentBackground: '#60384f',
    background: '#261a23',
    surface: '#33212e',
    text: '#f1e4eb',
  },
  sand: {
    accent: '#9a6443',
    accentStrong: '#76482f',
    accentBackground: '#f0dcca',
    background: '#f5f0e4',
    surface: '#ede5d4',
    text: '#3b342a',
  },
};

/** Theme selection replaces stale color overrides through the same path in every UI. */
export function themeSelection(
  theme: Theme,
  customThemes: readonly CustomTheme[] = [],
): Pick<Preferences, 'theme' | 'themeCustomizations'> {
  const custom = customThemes.find((candidate) => candidate.id === theme);
  const colors = { ...(THEME_DEFAULTS[custom?.baseTheme ?? theme] ?? THEME_DEFAULTS.dark) };
  for (const key of Object.keys(colors) as (keyof ThemeCustomizations)[]) {
    const value = custom?.[key];
    if (value) colors[key] = value;
  }
  return { theme, themeCustomizations: colors };
}
