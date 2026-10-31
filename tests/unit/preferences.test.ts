import { describe, expect, it } from 'vitest';
import { validatePreferences } from '../../src/main/services/preferences';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';

describe('preference boundary validation', () => {
  it('migrates existing settings and validates the default recipe', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.defaultRecipe;
    delete legacy.previewVisible;
    delete legacy.miktexAutoInstall;
    delete legacy.texEditorMode;
    expect(validatePreferences(legacy)).toEqual(DEFAULT_PREFERENCES);
    expect(validatePreferences({ ...legacy, defaultRecipe: 'xelatex' }).defaultRecipe).toBe(
      'xelatex',
    );
    expect(() => validatePreferences({ ...legacy, defaultRecipe: 'shell' })).toThrow();
  });
  it('migrates and validates the preferred TeX editor mode', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.texEditorMode;
    expect(validatePreferences(legacy).texEditorMode).toBe('code');
    expect(validatePreferences({ ...legacy, texEditorMode: 'visual' }).texEditorMode).toBe(
      'visual',
    );
    expect(() => validatePreferences({ ...legacy, texEditorMode: 'other' })).toThrow();
  });
  it('migrates and validates editable Visual ignore lists', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.visualIgnoredCommands;
    delete legacy.visualIgnoredEnvironments;
    const migrated = validatePreferences(legacy);
    expect(migrated.visualIgnoredCommands).toEqual(DEFAULT_PREFERENCES.visualIgnoredCommands);
    expect(migrated.visualIgnoredEnvironments).toEqual(
      DEFAULT_PREFERENCES.visualIgnoredEnvironments,
    );
    const updated = validatePreferences({
      ...legacy,
      visualIgnoredCommands: ['newpage', 'newpage', 'MyCommand'],
      visualIgnoredEnvironments: [],
    });
    expect(updated.visualIgnoredCommands).toEqual(['newpage', 'MyCommand']);
    expect(updated.visualIgnoredEnvironments).toEqual([]);
    for (const bad of [
      ['\\clearpage'],
      ['clearpage{unsafe}'],
      ['x'.repeat(81)],
      Array(101).fill('x'),
    ])
      expect(() => validatePreferences({ ...legacy, visualIgnoredCommands: bad })).toThrow();
  });
  it('allows automatic MiKTeX packages to be disabled and rejects non-boolean values', () => {
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, miktexAutoInstall: false }).miktexAutoInstall,
    ).toBe(false);
    expect(() =>
      validatePreferences({ ...DEFAULT_PREFERENCES, miktexAutoInstall: 'yes' }),
    ).toThrow();
  });
  it('accepts both supported themes and boundary split widths', () => {
    for (const theme of ['light', 'dark']) {
      for (const editorWidth of [25, 55.5, 75]) {
        const value = { ...DEFAULT_PREFERENCES, theme, editorWidth };
        expect(validatePreferences(value)).toEqual(value);
      }
    }
  });

  it.each([
    null,
    [],
    'dark',
    {},
    { ...DEFAULT_PREFERENCES, version: 2 },
    { ...DEFAULT_PREFERENCES, theme: 'system' },
    { ...DEFAULT_PREFERENCES, sidebarVisible: 'true' },
    { ...DEFAULT_PREFERENCES, outputVisible: 1 },
    { ...DEFAULT_PREFERENCES, previewVisible: 'yes' },
    { ...DEFAULT_PREFERENCES, editorWidth: '55' },
    { ...DEFAULT_PREFERENCES, editorWidth: NaN },
    { ...DEFAULT_PREFERENCES, editorWidth: Infinity },
    { ...DEFAULT_PREFERENCES, editorWidth: 24.99 },
    { ...DEFAULT_PREFERENCES, editorWidth: 75.01 },
    { ...DEFAULT_PREFERENCES, apiKey: 'must-not-be-stored' },
  ])('rejects unsupported or malformed values: %j', (value) => {
    expect(() => validatePreferences(value)).toThrow();
  });

  it('returns an independent object so callers cannot mutate validated state', () => {
    const input = { ...DEFAULT_PREFERENCES };
    const validated = validatePreferences(input);
    input.theme = 'light';
    expect(validated.theme).toBe('dark');
  });

  it('migrates files saved before editor and tool settings existed', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.fontSize;
    delete legacy.wrap;
    delete legacy.sidebarWidth;
    delete legacy.toolPaths;
    delete legacy.externalChangeDetection;
    delete legacy.externalChangeQuietPeriodMs;
    delete legacy.externalChangePollingOnly;
    delete legacy.openDiffAfterConflictCopy;
    delete legacy.commonProblemHelp;
    expect(validatePreferences(legacy)).toEqual(DEFAULT_PREFERENCES);
  });

  it('persists external-change safety preferences within their supported bounds', () => {
    const saved = validatePreferences({
      ...DEFAULT_PREFERENCES,
      externalChangeDetection: false,
      externalChangeQuietPeriodMs: 5_000,
      externalChangePollingOnly: true,
      openDiffAfterConflictCopy: false,
    });
    expect(saved).toMatchObject({
      externalChangeDetection: false,
      externalChangeQuietPeriodMs: 5_000,
      externalChangePollingOnly: true,
      openDiffAfterConflictCopy: false,
    });
    for (const externalChangeQuietPeriodMs of [1_999, 5_001, 2_500.5, '3000', NaN])
      expect(() =>
        validatePreferences({ ...DEFAULT_PREFERENCES, externalChangeQuietPeriodMs }),
      ).toThrow();
    for (const externalChangeDetection of ['yes', 1, null])
      expect(() =>
        validatePreferences({ ...DEFAULT_PREFERENCES, externalChangeDetection }),
      ).toThrow();
  });

  it('persists font size and word wrap within supported bounds', () => {
    const saved = validatePreferences({ ...DEFAULT_PREFERENCES, fontSize: 18, wrap: true });
    expect(saved.fontSize).toBe(18);
    expect(saved.wrap).toBe(true);
    for (const fontSize of [9, 29, 14.5, '14', NaN])
      expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, fontSize })).toThrow();
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, wrap: 'yes' })).toThrow();
  });

  it('stores user-level recipes only when their tools are allowlisted and referenced', () => {
    const globalBuildRecipes = {
      recipes: [{ name: 'User pdflatex', tools: ['pdflatex'] }],
      tools: [
        {
          name: 'pdflatex',
          command: 'pdflatex',
          args: ['-interaction=nonstopmode', '%DOC_EXT%'],
          cwd: '%DIR%',
        },
      ],
    };
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, globalBuildRecipes }).globalBuildRecipes,
    ).toEqual(globalBuildRecipes);
    expect(() =>
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        globalBuildRecipes: {
          ...globalBuildRecipes,
          tools: [{ ...globalBuildRecipes.tools[0], command: 'powershell' }],
        },
      }),
    ).toThrow();
    expect(() =>
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        globalBuildRecipes: {
          ...globalBuildRecipes,
          recipes: [{ name: 'Broken', tools: ['missing-tool'] }],
        },
      }),
    ).toThrow();
  });

  it('defaults common problem help on and only accepts a boolean preference', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.commonProblemHelp;
    expect(validatePreferences(legacy).commonProblemHelp).toBe(true);
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, commonProblemHelp: false }).commonProblemHelp,
    ).toBe(false);
    expect(() =>
      validatePreferences({ ...DEFAULT_PREFERENCES, commonProblemHelp: 'yes' }),
    ).toThrow();
  });

  it('bounds the persisted sidebar width', () => {
    expect(validatePreferences({ ...DEFAULT_PREFERENCES, sidebarWidth: 300 }).sidebarWidth).toBe(
      300,
    );
    for (const sidebarWidth of [159, 481, NaN, Infinity, '226'])
      expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, sidebarWidth })).toThrow();
  });

  it('accepts only absolute paths to the matching TeX executable', () => {
    const good = process.platform === 'win32' ? 'C:\\tex\\bin\\pdflatex.exe' : '/opt/tex/pdflatex';
    expect(
      validatePreferences({ ...DEFAULT_PREFERENCES, toolPaths: { pdflatex: good } }).toolPaths,
    ).toEqual({ pdflatex: good });
    for (const toolPaths of [
      { pdflatex: 'pdflatex' },
      { pdflatex: '/opt/tex/xelatex' },
      { pdflatex: '/opt/tex/pdflatex.sh' },
      { pdflatex: '/opt/tex/powershell' },
      { pdflatex: 42 },
      { powershell: '/usr/bin/powershell' },
      [],
    ])
      expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, toolPaths })).toThrow();
  });
});
