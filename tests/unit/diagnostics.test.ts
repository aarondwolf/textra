import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagnostics } from '../../src/main/services/diagnostics';

describe('TeX diagnostics from actual compiler log forms', () => {
  it('reads file-line-error locations without confusing a Windows drive colon', () => {
    const root = join(process.cwd(), 'fixture');
    const source = join(root, 'chapters', 'results.tex');
    expect(parseDiagnostics(`${source}:12: Undefined control sequence.`, 'main.tex', root)).toEqual(
      [
        {
          severity: 'error',
          file: 'chapters/results.tex',
          line: 12,
          message: 'Undefined control sequence.',
        },
      ],
    );
  });

  it('keeps unlocated errors unlocated when the active included file is unknown', () => {
    const log = '! Undefined control sequence.\nl.4 \\notACommand\n';
    const result = parseDiagnostics(log, 'main.tex');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ severity: 'error' });
    expect(result[0].message).toContain('Undefined control sequence.');
    expect(result[0].message).toContain('l.4');
    expect(result[0].file).toBeUndefined();
    expect(result[0].line).toBeUndefined();
  });

  it('retains warnings, box warnings, and raw diagnostic text', () => {
    const log = [
      "LaTeX Warning: Reference `missing' on page 1 undefined on input line 8.",
      'Package hyperref Warning: Token not allowed in a PDF string.',
      'Overfull \\hbox (10.0pt too wide) in paragraph at lines 4--7',
    ].join('\r\n');
    const diagnostics = parseDiagnostics(log, 'main.tex');
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every((item) => item.severity === 'warning')).toBe(true);
    expect(diagnostics[0].message).toContain("Reference `missing'");
  });

  it('does not turn an external or traversal location into a clickable project file', () => {
    for (const source of ['../private.tex', join(process.cwd(), 'outside.tex')]) {
      const [diagnostic] = parseDiagnostics(
        `${source}:7: A compiler error.`,
        'main.tex',
        join(process.cwd(), 'fixture'),
      );
      expect(diagnostic.message).toBe('A compiler error.');
      expect(diagnostic.file).toBeUndefined();
      expect(diagnostic.line).toBeUndefined();
    }
  });

  it('deduplicates repeated diagnostics and bounds the rendered problem count', () => {
    expect(parseDiagnostics('! Same error.\n! Same error.\n', 'main.tex')).toHaveLength(1);
    const many = Array.from(
      { length: 600 },
      (_, index) => `main.tex:${index + 1}: Error ${index}`,
    ).join('\n');
    expect(parseDiagnostics(many, 'main.tex')).toHaveLength(500);
  });
});
