import { isAbsolute, relative } from 'node:path';
import type { Diagnostic } from '../../shared/api';

/**
 * TeX wraps long `-file-line-error` messages across physical log lines. Keep the
 * continuation when it immediately follows a located error so search and copied
 * context use the actual diagnostic text instead of a clipped fragment.
 */
function locatedMessage(lines: string[], index: number, initial: string): string {
  let message = initial.trim();
  for (let next = index + 1; next < Math.min(lines.length, index + 4); next++) {
    const continuation = lines[next];
    const trimmed = continuation.trim();
    if (
      !trimmed ||
      /^l\.\d+\b/.test(trimmed) ||
      /^.+?\.(?:tex|sty|cls|bib|dtx|ins|ltx|bbl|toc|aux):\d+:\s*/.test(continuation) ||
      trimmed.startsWith('!') ||
      /^(?:LaTeX|Package .+|Class .+) Warning:/.test(trimmed)
    )
      break;
    // Wrapped TeX lines begin at column zero; an indented line is a separate
    // log detail and should not become part of the user-facing error message.
    if (/^\s/.test(continuation)) break;
    message += continuation;
  }
  return message;
}

/**
 * TeX engines wrap lines at max_print_line (typically 79-80 columns).
 * Unwrap hard-wrapped continuation lines so filenames and messages remain intact.
 */
function unwrapLogLines(lines: string[]): string[] {
  const unwrapped: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (
      (line.length === 79 || line.length === 80) &&
      i + 1 < lines.length &&
      !lines[i + 1].startsWith('!') &&
      !/^l\.\d+/.test(lines[i + 1]) &&
      !lines[i + 1].startsWith('*') &&
      !lines[i + 1].startsWith('Transcript written on') &&
      !/^(?:LaTeX|Package .+|Class .+) Warning:/.test(lines[i + 1]) &&
      !/^(?:Overfull|Underfull) \\[hv]box/.test(lines[i + 1])
    ) {
      i++;
      line += lines[i];
    }
    unwrapped.push(line);
  }
  return unwrapped;
}

function normalizeProjectFile(file: string, projectRoot?: string): string | undefined {
  let clean = file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1);
  }
  if (projectRoot && isAbsolute(clean)) {
    clean = relative(projectRoot, clean).replace(/\\/g, '/');
  }
  const safe = !isAbsolute(clean) && !clean.startsWith('../') && !clean.includes(':');
  return safe ? clean : undefined;
}

function isFilePathCandidate(candidate: string): boolean {
  if (!candidate || candidate.length < 2) return false;
  if (
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    candidate.startsWith('/') ||
    candidate.startsWith('\\') ||
    /^[a-zA-Z]:[/\\]/.test(candidate)
  ) {
    return true;
  }
  if (
    /\.(?:tex|sty|cls|aux|bbl|bib|dtx|ins|ltx|toc|lof|lot|out|def|ldf|fd|cfg|tikz|pgf|pdf|png|jpe?g|eps)\b/i.test(
      candidate,
    )
  ) {
    return true;
  }
  return false;
}

interface OpenFile {
  file: string;
  depth: number;
}

function scanFileTransitions(line: string, stack: OpenFile[], state: { depth: number }): void {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '(') {
      state.depth++;
      const currentDepth = state.depth;
      i++;
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      let filePath: string | null = null;
      if (i < line.length && line[i] === '"') {
        const closeQuote = line.indexOf('"', i + 1);
        if (closeQuote !== -1) {
          const candidate = line.substring(i + 1, closeQuote);
          if (isFilePathCandidate(candidate)) {
            filePath = candidate;
          }
          i = closeQuote + 1;
        }
      } else {
        const match = /^[^\s()]+/.exec(line.slice(i));
        if (match) {
          const candidate = match[0];
          if (isFilePathCandidate(candidate)) {
            filePath = candidate;
            i += candidate.length;
          }
        }
      }
      if (filePath) {
        stack.push({ file: filePath, depth: currentDepth });
      }
    } else if (ch === ')') {
      if (stack.length > 0 && stack[stack.length - 1].depth === state.depth) {
        stack.pop();
      }
      if (state.depth > 0) {
        state.depth--;
      }
      i++;
    } else {
      i++;
    }
  }
}

/** TeX logs are inconsistent; retain unlocated messages rather than invent locations. */
export function parseDiagnostics(
  log: string,
  rootFile: string,
  projectRoot?: string,
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const rawLines = log.split(/\r?\n/);
  const lines = unwrapLogLines(rawLines);
  const stack: OpenFile[] = [];
  const depthState = { depth: 0 };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const activeRaw = stack.length > 0 ? stack[stack.length - 1].file : undefined;
    const activeFile = activeRaw ? normalizeProjectFile(activeRaw, projectRoot) : undefined;

    const located = /^(.+?\.(?:tex|sty|cls|bib|dtx|ins|ltx|bbl|toc|aux)):(\d+):\s*(.+)$/.exec(line);
    if (located) {
      const safeFile = normalizeProjectFile(located[1], projectRoot);
      issues.push({
        severity: /warning/i.test(located[3]) ? 'warning' : 'error',
        message: locatedMessage(lines, index, located[3]),
        ...(safeFile ? { file: safeFile, line: Number(located[2]) } : {}),
      });
    } else if (line.startsWith('!')) {
      const nearby = lines.slice(index + 1, index + 6).find((entry) => /^l\.\d+/.test(entry));
      const lineMatch = nearby ? /^l\.(\d+)/.exec(nearby.trim()) : null;
      const lineNum = lineMatch ? Number(lineMatch[1]) : undefined;
      issues.push({
        severity: 'error',
        message: `${line.slice(1).trim()}${nearby ? ` (${nearby.trim()})` : ''}`,
        ...(activeFile && lineNum !== undefined ? { file: activeFile, line: lineNum } : {}),
      });
    } else if (/^(?:LaTeX|Package .+|Class .+) Warning:/.test(line)) {
      const lineMatch = /on input line (\d+)/i.exec(line);
      const lineNum = lineMatch ? Number(lineMatch[1]) : undefined;
      issues.push({
        severity: 'warning',
        message: line.trim(),
        ...(activeFile && lineNum !== undefined ? { file: activeFile, line: lineNum } : {}),
      });
    } else if (/^(Overfull|Underfull) \\[hv]box/.test(line)) {
      const lineMatch = /at lines? (\d+)/i.exec(line);
      const lineNum = lineMatch ? Number(lineMatch[1]) : undefined;
      issues.push({
        severity: 'warning',
        message: line.trim(),
        ...(activeFile && lineNum !== undefined ? { file: activeFile, line: lineNum } : {}),
      });
    }

    scanFileTransitions(line, stack, depthState);
  }

  // Root is used by callers for context, never as a guessed location.
  void rootFile;
  const seen = new Set<string>();
  const deduplicated: Diagnostic[] = [];
  for (const issue of issues) {
    const key = `${issue.severity}\u001f${issue.file ?? ''}\u001f${issue.line ?? ''}\u001f${issue.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(issue);
      if (deduplicated.length >= 500) break;
    }
  }
  return deduplicated;
}
