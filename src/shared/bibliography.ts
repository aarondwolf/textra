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
  const match = new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*(?:\\{([^{}]*)\\}|"([^"]*)")`, 'i').exec(
    entry,
  );
  const value = match?.[1] ?? match?.[2];
  return (
    value
      ?.replace(/\\[A-Za-z]+\s*/g, '')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || undefined
  );
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
    const year = fieldValue(body, 'year');
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
