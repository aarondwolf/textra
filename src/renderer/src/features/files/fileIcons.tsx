import manifest from 'material-icon-theme/dist/material-icons.json';

/**
 * File and folder icons for the Files tab, using the Material Icon Theme that VS Code ships.
 * The manifest maps exact file names, extensions and folder names to icon ids, and the SVGs are
 * bundled with the app so nothing is fetched at runtime.
 */

interface IconManifest {
  iconDefinitions: Record<string, { iconPath: string }>;
  file: string;
  folder: string;
  folderExpanded: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
}

const theme = manifest as IconManifest;

const svgUrls = import.meta.glob<string>(
  '../../../../../node_modules/material-icon-theme/icons/*.svg',
  { query: '?url', import: 'default', eager: true },
);

const urlByName = new Map<string, string>();
for (const [path, url] of Object.entries(svgUrls)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length);
  urlByName.set(name, url);
}

function urlFor(iconId: string | undefined, fallbackId: string): string {
  const definition = iconId ? theme.iconDefinitions[iconId] : undefined;
  const file = definition?.iconPath.slice(definition.iconPath.lastIndexOf('/') + 1, -4);
  return (
    (file ? urlByName.get(file) : undefined) ??
    urlByName.get(fallbackId) ??
    urlByName.values().next().value ??
    ''
  );
}

/** Matches VS Code: exact file name first, then the longest dotted extension ("d.ts" before "ts"). */
function fileIconId(name: string): string {
  const lower = name.toLowerCase();
  const byName = theme.fileNames[lower];
  if (byName) return byName;
  for (let dot = lower.indexOf('.'); dot !== -1; dot = lower.indexOf('.', dot + 1)) {
    const byExtension = theme.fileExtensions[lower.slice(dot + 1)];
    if (byExtension) return byExtension;
  }
  return theme.file;
}

function folderIconId(name: string, expanded: boolean): string {
  const lower = name.toLowerCase();
  const named = expanded ? theme.folderNamesExpanded[lower] : theme.folderNames[lower];
  return named ?? (expanded ? theme.folderExpanded : theme.folder);
}

interface Props {
  name: string;
  kind: 'file' | 'directory';
  expanded?: boolean;
  size?: number;
}

export function FileIcon({ name, kind, expanded = false, size = 16 }: Props) {
  const url =
    kind === 'directory'
      ? urlFor(folderIconId(name, expanded), expanded ? theme.folderExpanded : theme.folder)
      : urlFor(fileIconId(name), theme.file);
  return (
    <img
      className="file-icon"
      src={url}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
