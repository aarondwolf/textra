import { parse } from '@retorquere/bibtex-parser';

/** A lightweight BibTeX entry used for editor suggestions and outline analysis. */
export interface BibliographyEntry {
  key: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
}

const NON_ENTRY_TYPES = new Set(['comment', 'preamble', 'string']);

function formatAuthor(author: unknown): string {
  if (typeof author === 'string') return author.trim();
  if (!author || typeof author !== 'object') return '';
  const a = author as {
    name?: string;
    firstName?: string;
    prefix?: string;
    lastName?: string;
    suffix?: string;
  };
  if (a.name) return a.name.trim();
  const given = [a.firstName, a.prefix].filter(Boolean).join(' ');
  const family = [a.lastName, a.suffix].filter(Boolean).join(' ');
  return [given, family].filter(Boolean).join(' ');
}

function formatAuthors(authors: unknown): string | undefined {
  if (Array.isArray(authors)) {
    const list = authors.map(formatAuthor).filter(Boolean);
    return list.length ? list.join(' and ') : undefined;
  }
  if (typeof authors === 'string' && authors.trim()) return authors.trim();
  return undefined;
}

function cleanTitle(raw: unknown): string | undefined {
  if (Array.isArray(raw)) raw = raw.join(' ');
  if (typeof raw !== 'string') return undefined;
  const clean = raw
    .replace(/L[ᴬª]T<sub>E<\/sub>X/gi, 'LaTeX')
    .replace(/T<sub>E<\/sub>X/gi, 'TeX')
    .replace(/<[^>]+>/g, '')
    .replace(/\\(LaTeX|TeX)\b/g, '$1')
    .replace(/\\[A-Za-z]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || undefined;
}

function extractYear(fields: Record<string, unknown>): string | undefined {
  const year = fields.year;
  if (typeof year === 'string' && year.trim()) return year.trim();
  if (typeof year === 'number') return String(year);
  const date = fields.date;
  if (typeof date === 'string' && date.trim()) return date.trim().slice(0, 4);
  if (Array.isArray(date) && typeof date[0] === 'string' && date[0].trim()) {
    return date[0].trim().slice(0, 4);
  }
  return undefined;
}

/** Reads ordinary BibTeX/BibLaTeX entries using @retorquere/bibtex-parser. */
export function parseBibliography(source: string): BibliographyEntry[] {
  if (!source || !source.trim()) return [];
  try {
    const parsed = parse(source, { sentenceCase: false });
    const entries: BibliographyEntry[] = [];
    for (const item of parsed.entries) {
      const type = (item.type || '').toLowerCase();
      if (NON_ENTRY_TYPES.has(type)) continue;
      const key = (item.key || '').trim();
      if (!key) continue;

      const fields = (item.fields || {}) as Record<string, unknown>;
      const title = cleanTitle(fields.title);
      const author = formatAuthors(fields.author);
      const year = extractYear(fields);

      entries.push({
        key,
        type,
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),
        ...(year ? { year } : {}),
      });
    }
    return entries;
  } catch {
    return [];
  }
}

export function bibliographyDetail(entry: BibliographyEntry): string {
  const author = entry.author?.split(/\s+and\s+/i)[0];
  return [author, entry.year, entry.title].filter(Boolean).join(' · ') || entry.type;
}
