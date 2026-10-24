/** A lightweight, dependency-free BibTeX entry used for editor suggestions. */
export interface BibliographyEntry {
  key: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
}

const NON_ENTRY_TYPES = new Set(['comment', 'preamble', 'string']);

function entryEnd(source: string, start: number, close: string): number {
  let depth = 1;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && !escaped) quoted = false;
      escaped = character === '\\' && !escaped;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length;
}

function fieldValue(entry: string, name: string): string | undefined {
  const fieldRegex = new RegExp(`(?:^|[,\\n\\r])\\s*${name}\\s*=\\s*`, 'i');
  const match = fieldRegex.exec(entry);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  if (start >= entry.length) return undefined;

  const firstChar = entry[start];
  let rawValue: string;

  if (firstChar === '{') {
    let depth = 1;
    let index = start + 1;
    while (index < entry.length && depth > 0) {
      const char = entry[index];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }
    rawValue = entry.slice(start + 1, index);
  } else if (firstChar === '"') {
    let index = start + 1;
    let escaped = false;
    while (index < entry.length) {
      const char = entry[index];
      if (char === '"' && !escaped) break;
      escaped = char === '\\' && !escaped;
      index += 1;
    }
    rawValue = entry.slice(start + 1, index);
  } else {
    // Unquoted value (e.g. year = 1984)
    const end = entry.slice(start).search(/[,}\n\r]/);
    rawValue = end === -1 ? entry.slice(start) : entry.slice(start, start + end);
  }

  const clean = rawValue
    .replace(/\\(LaTeX|TeX)\b/g, '$1')
    .replace(/\\[A-Za-z]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || undefined;
}

/** Reads ordinary BibTeX/BibLaTeX entries without evaluating macros. */
export function parseBibliography(source: string): BibliographyEntry[] {
  const entries: BibliographyEntry[] = [];
  const start = /@(\w+)\s*([{(])\s*([^,\s]+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(source))) {
    const type = match[1].toLowerCase();
    if (NON_ENTRY_TYPES.has(type)) continue;
    const key = match[3].trim();
    if (!key) continue;
    const end = entryEnd(source, start.lastIndex, match[2] === '{' ? '}' : ')');
    const body = source.slice(start.lastIndex, end);
    const title = fieldValue(body, 'title');
    const author = fieldValue(body, 'author');
    const year = fieldValue(body, 'year') ?? fieldValue(body, 'date')?.slice(0, 4);
    entries.push({
      key,
      type,
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(year ? { year } : {}),
    });
    start.lastIndex = end + 1;
  }
  return entries;
}

export function bibliographyDetail(entry: BibliographyEntry): string {
  const author = entry.author?.split(/\s+and\s+/i)[0];
  return [author, entry.year, entry.title].filter(Boolean).join(' · ') || entry.type;
}
