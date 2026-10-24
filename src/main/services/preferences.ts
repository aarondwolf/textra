import { AsyncMutex } from './mutex';
import { writeAtomic } from './atomic-write';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BUILD_RECIPES,
  CONFIGURABLE_TOOLS,
  DEFAULT_PREFERENCES,
  FONT_SIZE_RANGE,
  SIDEBAR_WIDTH_RANGE,
  type ConfigurableTool,
  type Preferences,
} from '../../shared/api';
import { validateToolPath } from './tool-paths';

const themeNames = new Set(['dark', 'light', 'midnight', 'forest', 'ocean', 'rose', 'sand']);
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const hexColorSchema = z.string().regex(colorPattern);

export const customThemeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  baseTheme: z.enum(['dark', 'light', 'midnight', 'forest', 'ocean', 'rose', 'sand']),
  accent: hexColorSchema.optional(),
  accentStrong: hexColorSchema.optional(),
  accentBackground: hexColorSchema.optional(),
  background: hexColorSchema.optional(),
  surface: hexColorSchema.optional(),
  text: hexColorSchema.optional(),
  uiFont: z
    .string()
    .transform((s) => s.slice(0, 128))
    .optional(),
  editorFont: z
    .string()
    .transform((s) => s.slice(0, 128))
    .optional(),
});

export const themeCustomizationsSchema = z.object({
  accent: hexColorSchema,
  accentStrong: hexColorSchema,
  accentBackground: hexColorSchema,
  background: hexColorSchema.optional(),
  surface: hexColorSchema.optional(),
  text: hexColorSchema.optional(),
});

const keyboardShortcutsSchema = z.record(z.string(), z.unknown()).transform((record) => {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(record)) {
    if (typeof key === 'string' && typeof val === 'string' && key.length < 64 && val.length < 64) {
      result[key] = val;
    }
  }
  return result;
});

const chktexRuleSeveritiesSchema = z
  .record(z.string(), z.enum(['error', 'warning', 'info']))
  .superRefine((rec, ctx) => {
    const entries = Object.entries(rec);
    if (entries.length > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many rule severities' });
      return;
    }
    for (const [rule] of entries) {
      const num = Number(rule);
      if (!Number.isInteger(num) || num < 1 || num > 10_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid rule number' });
        return;
      }
    }
  })
  .transform((rec) => {
    const result: Preferences['chktexRuleSeverities'] = {};
    for (const [rule, severity] of Object.entries(rec)) {
      result[String(Number(rule))] = severity;
    }
    return result;
  });

const toolPathsSchema = z.record(z.string(), z.unknown()).transform((obj) => {
  const result: Preferences['toolPaths'] = {};
  for (const [name, path] of Object.entries(obj)) {
    if (!(CONFIGURABLE_TOOLS as readonly string[]).includes(name)) {
      throw new Error('Unsupported or invalid preferences.');
    }
    result[name as ConfigurableTool] = validateToolPath(name as ConfigurableTool, path);
  }
  return result;
});

const buildRecipeValues = BUILD_RECIPES.map((r) => r.value) as [string, ...string[]];

export const preferencesSchema = z
  .object({
    version: z.literal(1),
    theme: z.string(),
    themeCustomizations: themeCustomizationsSchema
      .optional()
      .default(DEFAULT_PREFERENCES.themeCustomizations),
    sidebarVisible: z.boolean(),
    previewVisible: z.boolean().optional().default(DEFAULT_PREFERENCES.previewVisible),
    outputVisible: z.boolean(),
    editorWidth: z.number().refine((n) => Number.isFinite(n) && n >= 25 && n <= 75),
    defaultRecipe: z.enum(buildRecipeValues).optional().default(DEFAULT_PREFERENCES.defaultRecipe),
    fontSize: z
      .number()
      .int()
      .min(FONT_SIZE_RANGE.min)
      .max(FONT_SIZE_RANGE.max)
      .optional()
      .default(DEFAULT_PREFERENCES.fontSize),
    wrap: z.boolean().optional().default(DEFAULT_PREFERENCES.wrap),
    autoSave: z.boolean().optional().default(DEFAULT_PREFERENCES.autoSave),
    autoSaveDelayMs: z
      .number()
      .int()
      .min(1000)
      .max(120_000)
      .optional()
      .default(DEFAULT_PREFERENCES.autoSaveDelayMs),
    editorMinimap: z.boolean().optional().default(DEFAULT_PREFERENCES.editorMinimap),
    commonProblemHelp: z.boolean().optional().default(DEFAULT_PREFERENCES.commonProblemHelp),
    formatToolbarVisible: z.boolean().optional().default(DEFAULT_PREFERENCES.formatToolbarVisible),
    sidebarWidth: z
      .number()
      .refine(
        (n) => Number.isFinite(n) && n >= SIDEBAR_WIDTH_RANGE.min && n <= SIDEBAR_WIDTH_RANGE.max,
      )
      .optional()
      .default(DEFAULT_PREFERENCES.sidebarWidth),
    texlabEnabled: z.boolean().optional().default(DEFAULT_PREFERENCES.texlabEnabled),
    chktexEnabled: z.boolean().optional().default(DEFAULT_PREFERENCES.chktexEnabled),
    chktexRunMode: z.enum(['save', 'live']).optional().default(DEFAULT_PREFERENCES.chktexRunMode),
    chktexIgnoredRules: z
      .array(z.number().int().min(1).max(10_000))
      .max(100)
      .transform((rules) => [...new Set(rules)].sort((a, b) => a - b))
      .optional()
      .default([]),
    chktexRuleSeverities: chktexRuleSeveritiesSchema.optional().default({}),
    toolPaths: toolPathsSchema.optional().default({}),
    restoreSession: z.boolean().optional().default(DEFAULT_PREFERENCES.restoreSession),
    tabCloseButtons: z
      .enum(['always', 'hover'])
      .optional()
      .default(DEFAULT_PREFERENCES.tabCloseButtons),
    previewTabs: z.boolean().optional().default(DEFAULT_PREFERENCES.previewTabs),
    externalChangeDetection: z
      .boolean()
      .optional()
      .default(DEFAULT_PREFERENCES.externalChangeDetection),
    externalChangeQuietPeriodMs: z
      .number()
      .int()
      .min(2_000)
      .max(5_000)
      .optional()
      .default(DEFAULT_PREFERENCES.externalChangeQuietPeriodMs),
    externalChangePollingOnly: z
      .boolean()
      .optional()
      .default(DEFAULT_PREFERENCES.externalChangePollingOnly),
    openDiffAfterConflictCopy: z
      .boolean()
      .optional()
      .default(DEFAULT_PREFERENCES.openDiffAfterConflictCopy),
    recentCommands: z
      .array(z.string().min(1).max(100))
      .max(12)
      .transform((commands) => [...new Set(commands)])
      .optional()
      .default([]),
    uiFont: z.string().optional().default(''),
    editorFont: z.string().optional().default(''),
    customThemes: z.array(customThemeSchema).optional().default([]),
    keyboardShortcuts: keyboardShortcutsSchema.optional().default({}),
    snippetsSymbolsOpenDefault: z.boolean().optional().default(false),
    snippetsTemplatesOpenDefault: z.boolean().optional().default(false),
    historyEnabled: z.boolean().optional().default(DEFAULT_PREFERENCES.historyEnabled),
    historyIntervalMinutes: z
      .number()
      .int()
      .min(1)
      .max(120)
      .optional()
      .default(DEFAULT_PREFERENCES.historyIntervalMinutes),
  })
  .strict()
  .superRefine((data, ctx) => {
    const customIds = new Set(data.customThemes.map((t) => t.id));
    if (!themeNames.has(data.theme) && !customIds.has(data.theme)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unsupported or invalid preferences.',
        path: ['theme'],
      });
    }
  });

export function validatePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Preferences must be an object.');
  }
  const result = preferencesSchema.safeParse(value);
  if (!result.success) {
    throw new Error('Unsupported or invalid preferences.');
  }
  return structuredClone(result.data) as Preferences;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** User preferences only. Document contents and credentials never belong here. */
export class PreferencesStore {
  private readonly filename: string;
  private readonly mutex = new AsyncMutex();

  constructor(private readonly directory: string) {
    this.filename = join(directory, 'preferences.json');
  }

  private async read(): Promise<Preferences> {
    try {
      return validatePreferences(JSON.parse(await readFile(this.filename, 'utf8')) as unknown);
    } catch (error) {
      if (isMissing(error)) return { ...DEFAULT_PREFERENCES };
      throw error;
    }
  }

  async get(): Promise<Preferences> {
    await this.mutex.flush();
    return this.read();
  }

  async flush(): Promise<void> {
    await this.mutex.flush();
  }

  async set(value: unknown): Promise<Preferences> {
    const preferences = validatePreferences(value);
    await this.mutex.run(async () => {
      // Do not silently replace corrupt settings or an unknown future version.
      await this.read();
      await writeAtomic(this.filename, `${JSON.stringify(preferences, null, 2)}\n`, {
        prefix: 'preferences',
        tempDirectory: this.directory,
        ensureDir: true,
      });
    });
    return { ...preferences };
  }
}
