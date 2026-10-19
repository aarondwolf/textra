import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_CONFIG,
  exportSettings,
  importSettings,
  validateProjectConfig,
} from '../../src/main/services/settings';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';

describe('portable settings validation', () => {
  it('round-trips supported preferences in a versioned bundle', () => {
    const preferences = { ...DEFAULT_PREFERENCES, theme: 'light' as const, editorWidth: 33.5 };
    const exported = exportSettings(preferences);
    expect(JSON.parse(exported)).toEqual({ schemaVersion: 1, preferences });
    expect(importSettings(exported)).toEqual(preferences);
  });

  it.each([
    null,
    [],
    'invalid JSON',
    JSON.stringify(DEFAULT_PREFERENCES),
    JSON.stringify({ schemaVersion: 2, preferences: DEFAULT_PREFERENCES }),
    JSON.stringify({ schemaVersion: 1, preferences: DEFAULT_PREFERENCES, apiKey: 'secret' }),
    JSON.stringify({ schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES, token: 'secret' } }),
    JSON.stringify({ schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES, theme: 'system' } }),
    ' '.repeat(1024 * 1024 + 1),
    'é'.repeat(600000),
  ])('rejects malformed, secret-bearing, unsupported, or oversized imports', (text) => {
    expect(() => importSettings(text)).toThrow();
  });

  it('refuses to export extra fields instead of leaking them', () => {
    expect(() => exportSettings({ ...DEFAULT_PREFERENCES, apiKey: 'secret' })).toThrow();
  });
});

describe('project config validation', () => {
  it('explains unsupported imported commands while retaining the preservation notice', () => {
    expect(() =>
      validateProjectConfig({
        'latex-workshop.latex.tools': [{ name: 'custom', command: 'sh', args: [] }],
      }),
    ).toThrow(/Supported commands: .* Existing settings were preserved\./);
  });

  it('normalizes Workshop settings and accepts custom per-document recipes', () => {
    const config = validateProjectConfig({
      'latex-workshop.latex.recipes': [{ name: 'My draft', tools: ['pdflatex'] }],
      recipes: { 'main.tex': 'My draft' },
    });
    expect(config.recipes).toEqual({ 'main.tex': 'My draft' });
    expect(config['latex-workshop.latex.outDir']).toBe(
      DEFAULT_PROJECT_CONFIG['latex-workshop.latex.outDir'],
    );
    expect(validateProjectConfig({})).toEqual(DEFAULT_PROJECT_CONFIG);
  });

  it('does not share mutable defaults between project reads', () => {
    const config = validateProjectConfig({});
    config['latex-workshop.latex.tools']![0]!.args.push('changed');
    expect(validateProjectConfig({})).toEqual(DEFAULT_PROJECT_CONFIG);
  });
  it('round-trips per-document recipes and rejects unsafe paths or commands', () => {
    const config = { ...DEFAULT_PROJECT_CONFIG, recipes: { 'chapters/one.tex': 'xelatex' } };
    expect(validateProjectConfig(config)).toEqual(config);
    for (const recipes of [{ '../outside.tex': 'pdflatex' }, { 'main.tex': 'sh' }, null, []]) {
      expect(() => validateProjectConfig({ ...DEFAULT_PROJECT_CONFIG, recipes })).toThrow();
    }
  });
  it('accepts nested root files and only allowlisted engines', () => {
    for (const engine of ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'bibtex-pipeline']) {
      const config = { ...DEFAULT_PROJECT_CONFIG, rootFile: 'chapters/résumé.tex', engine };
      expect(validateProjectConfig(config)).toEqual(config);
    }
    expect(validateProjectConfig(DEFAULT_PROJECT_CONFIG)).toEqual(DEFAULT_PROJECT_CONFIG);
  });

  it.each([
    null,
    [],
    { ...DEFAULT_PROJECT_CONFIG, schemaVersion: 2 },
    { ...DEFAULT_PROJECT_CONFIG, apiKey: 'secret' },
    { ...DEFAULT_PROJECT_CONFIG, engine: 'sh' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: '../outside.tex' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: 'C:/outside.tex' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: '/outside.tex' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: '.textra/project.tex' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: 'notes.txt' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: '' },
    { ...DEFAULT_PROJECT_CONFIG, rootFile: 42 },
  ])('rejects unsafe root files and unsupported config values', (config) => {
    expect(() => validateProjectConfig(config)).toThrow();
  });
});
