export const PRODUCT_NAME = 'TeXtra';
export type Theme = 'dark' | 'light';
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
export interface Preferences {
  version: 1;
  theme: Theme;
  sidebarVisible: boolean;
  outputVisible: boolean;
  editorWidth: number;
}
export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  theme: 'dark',
  sidebarVisible: true,
  outputVisible: true,
  editorWidth: 55,
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface TextraAPI {
  getAppInfo(): Promise<Result<AppInfo>>;
  getPreferences(): Promise<Result<Preferences>>;
  setPreferences(value: Preferences): Promise<Result<Preferences>>;
}
declare global {
  interface Window {
    textra: TextraAPI;
  }
}
