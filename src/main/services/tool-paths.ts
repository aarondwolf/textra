import { isAbsolute, basename, extname } from 'node:path';
import { CONFIGURABLE_TOOLS, type ConfigurableTool } from '../../shared/api';

/**
 * A custom path must be an absolute path to an executable whose file name is exactly the
 * tool it replaces (pdflatex or pdflatex.exe). This keeps the override from turning a
 * TeX setting into a way to run arbitrary programs.
 */
export function validateToolPath(name: ConfigurableTool, value: unknown): string {
  if (!(CONFIGURABLE_TOOLS as readonly string[]).includes(name))
    throw new Error('Unsupported or invalid preferences.');
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    !isAbsolute(value)
  )
    throw new Error('Unsupported or invalid preferences.');
  const file = basename(value);
  const extension = extname(file).toLowerCase();
  const stem = extension === '.exe' ? file.slice(0, -4) : file;
  if (extension && extension !== '.exe') throw new Error('Unsupported or invalid preferences.');
  if (stem.toLowerCase() !== name) throw new Error('Unsupported or invalid preferences.');
  return value;
}

let overrides: Partial<Record<ConfigurableTool, string>> = {};

export function setToolPaths(paths: Partial<Record<ConfigurableTool, string>>): void {
  overrides = { ...paths };
}

export function getToolPath(name: string): string | undefined {
  return (overrides as Record<string, string | undefined>)[name];
}
