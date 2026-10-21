import type { AICompletionRole } from './ai';

const EMBEDDED_LANGUAGES = new Set([
  'python',
  'py',
  'javascript',
  'js',
  'typescript',
  'ts',
  'java',
  'c',
  'c++',
  'cpp',
  'c#',
  'csharp',
  'rust',
  'go',
  'ruby',
  'r',
  'julia',
  'matlab',
  'octave',
  'bash',
  'sh',
  'shell',
  'powershell',
  'sql',
  'html',
  'css',
  'json',
  'yaml',
  'xml',
  'lua',
  'perl',
  'php',
  'haskell',
  'scala',
  'kotlin',
  'swift',
  'fortran',
  'latex',
  'tex',
]);

export interface LatexCursorContext {
  environments: string[];
  math: string | null;
  excluded: boolean;
  literal: boolean;
  language: string;
  eligible: boolean;
}

/** Scan only up to the cursor. Literal blocks deliberately bypass TeX tokenization. */
export function scanLatexCursor(source: string, offset: number): LatexCursorContext {
  const end = Math.max(0, Math.min(offset, source.length));
  const stack: string[] = [];
  let math: string | null = null;
  let excluded = false;
  let literal: { name: string; language: string } | null = null;
  for (let i = 0; i < end;) {
    if (literal) {
      const close = `\\end{${literal.name}}`;
      if (source.startsWith(close, i) && i + close.length <= end) {
        stack.pop();
        literal = null;
        i += close.length;
      } else i++;
      continue;
    }
    if (source[i] === '%') {
      const newline = source.indexOf('\n', i);
      if (newline < 0 || newline >= end) {
        excluded = true;
        break;
      }
      i = newline + 1;
      continue;
    }
    if (source[i] === '\\') {
      const rest = source.slice(i, end);
      const verb = /^\\verb\*?([^\w\s])/.exec(rest);
      if (verb) {
        const close = source.indexOf(verb[1], i + verb[0].length);
        const newline = source.indexOf('\n', i + verb[0].length);
        if (newline >= 0 && newline < end && (close < 0 || newline < close)) {
          i = newline + 1;
          continue;
        }
        if (close < 0 || close >= end) {
          excluded = true;
          break;
        }
        i = close + 1;
        continue;
      }
      const env = /^\\(begin|end)\s*\{([^}\s]+)\}/.exec(rest);
      if (env) {
        i += env[0].length;
        const name = env[2];
        if (env[1] === 'end') {
          const index = stack.lastIndexOf(name);
          if (index >= 0) stack.splice(index);
        } else {
          stack.push(name);
          if (/^(minted|lstlisting|verbatim\*?|comment)$/.test(name)) {
            let language = 'text';
            const tail = source.slice(i, end);
            const declaration =
              name === 'minted'
                ? /^(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/.exec(tail)
                : name === 'lstlisting'
                  ? /^\s*\[([^\]]*)\]/.exec(tail)
                  : null;
            if (declaration) {
              language =
                name === 'minted'
                  ? declaration[1].trim()
                  : (/\blanguage\s*=\s*\{?([\w+#.-]+)/i.exec(declaration[1])?.[1] ?? 'text');
              i += declaration[0].length;
            }
            if (!EMBEDDED_LANGUAGES.has(language.toLowerCase())) language = 'text';
            literal = { name, language };
          }
        }
        continue;
      }
      const delimiter = source.slice(i, Math.min(end, i + 2));
      if (delimiter === '\\(' || delimiter === '\\[') math ??= delimiter;
      else if ((delimiter === '\\)' && math === '\\(') || (delimiter === '\\]' && math === '\\['))
        math = null;
      i += 2; // Escaped percent, dollar and backslash cannot start another token.
      continue;
    }
    if (source[i] === '$') {
      const delimiter = source[i + 1] === '$' && i + 1 < end ? '$$' : '$';
      if (math === delimiter) math = null;
      else if (!math) math = delimiter;
      i += delimiter.length;
    } else i++;
  }
  excluded ||= literal?.name === 'comment';
  return {
    environments: stack,
    math,
    excluded,
    literal: Boolean(literal),
    language: literal?.language ?? 'latex',
    eligible: !excluded && (Boolean(math) || stack.some((name) => name !== 'document')),
  };
}

export function buildCompletionContext(source: string, offset: number, role: AICompletionRole) {
  const cursor = scanLatexCursor(source, offset);
  const manual = role === 'inlineCompletion';
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const metadata = JSON.stringify({
    environments: cursor.environments,
    math: cursor.math,
    language: cursor.language,
    literal: cursor.literal,
    indentation: /^\s*/.exec(source.slice(lineStart, offset))?.[0] ?? '',
    packages: Array.from(
      source.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g),
      (match) => match[1],
    ).slice(0, 50),
  }).slice(0, manual ? 4_000 : 2_000);
  return {
    prefix: source.slice(Math.max(0, offset - (manual ? 16_000 : 8_000)), offset),
    suffix: source.slice(offset, offset + (manual ? 4_000 : 2_000)),
    metadata,
    cursor,
  };
}
