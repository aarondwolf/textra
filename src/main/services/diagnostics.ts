import { isAbsolute, relative } from 'node:path';
import type { Diagnostic } from '../../shared/api';

/** TeX logs are inconsistent; retain unlocated messages rather than invent locations. */
export function parseDiagnostics(
  log: string,
  rootFile: string,
  projectRoot?: string,
): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const lines = log.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const located = /^(.+?\.(?:tex|sty|cls)):(\d+):\s*(.+)$/.exec(line);
    if (located) {
      let file = located[1].replace(/\\/g, '/').replace(/^\.\//, '');
      if (projectRoot && isAbsolute(file)) file = relative(projectRoot, file).replace(/\\/g, '/');
      const safe = !isAbsolute(file) && !file.startsWith('../') && !file.includes(':');
      issues.push({
        severity: /warning/i.test(located[3]) ? 'warning' : 'error',
        message: located[3],
        ...(safe ? { file, line: Number(located[2]) } : {}),
      });
    } else if (line.startsWith('!')) {
      const nearby = lines.slice(index + 1, index + 6).find((entry) => /^l\.\d+/.test(entry));
      // The ! form does not identify which included file was active. Never guess root.
      issues.push({
        severity: 'error',
        message: `${line.slice(1).trim()}${nearby ? ` (${nearby.trim()})` : ''}`,
      });
    } else if (/^(?:LaTeX|Package .+|Class .+) Warning:/.test(line)) {
      issues.push({ severity: 'warning', message: line.trim() });
    } else if (/^(Overfull|Underfull) \\[hv]box/.test(line)) {
      issues.push({ severity: 'warning', message: line.trim() });
    }
  }
  // Root is used by callers for context, never as a guessed location.
  void rootFile;
  return issues
    .filter(
      (issue, index) =>
        issues.findIndex((other) => JSON.stringify(other) === JSON.stringify(issue)) === index,
    )
    .slice(0, 500);
}
