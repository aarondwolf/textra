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

  it('reassembles a TeX error wrapped between physical log lines', () => {
    const [diagnostic] = parseDiagnostics(
      'st.tex:33: Undefined control sequ\nence.\nl.33     \\toprule\n',
      'st.tex',
    );
    expect(diagnostic).toMatchObject({
      file: 'st.tex',
      line: 33,
      message: 'Undefined control sequence.',
    });
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

  it('tracks active included files across parentheses for ! errors and warnings', () => {
    const root = join(process.cwd(), 'fixture');
    const log = [
      '(./chapters/intro.tex',
      '! Undefined control sequence.',
      'l.15 \\unknownCommand',
      'LaTeX Warning: Reference `missing` on page 1 undefined on input line 22.',
      'Overfull \\hbox (12.5pt too wide) in paragraph at lines 30--35',
      ')',
    ].join('\n');

    const diagnostics = parseDiagnostics(log, 'main.tex', root);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]).toEqual({
      severity: 'error',
      file: 'chapters/intro.tex',
      line: 15,
      message: 'Undefined control sequence. (l.15 \\unknownCommand)',
    });
    expect(diagnostics[1]).toEqual({
      severity: 'warning',
      file: 'chapters/intro.tex',
      line: 22,
      message: 'LaTeX Warning: Reference `missing` on page 1 undefined on input line 22.',
    });
    expect(diagnostics[2]).toEqual({
      severity: 'warning',
      file: 'chapters/intro.tex',
      line: 30,
      message: 'Overfull \\hbox (12.5pt too wide) in paragraph at lines 30--35',
    });
  });

  it('unwraps 79-column hard-wrapped paths and messages', () => {
    const root = join(process.cwd(), 'fixture');
    const prefix = '(./chapters/very_long_directory_name_that_spans_multiple_lines_to_test_79_col/';
    const line1 = prefix.padEnd(79, 'a');
    const line2 = 'section1.tex';
    const log = [line1, line2, '! Undefined control sequence.', 'l.10 \\badMacro', ')'].join('\n');

    const [diagnostic] = parseDiagnostics(log, 'main.tex', root);
    expect(diagnostic).toBeDefined();
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.line).toBe(10);
    expect(diagnostic.file).toContain('section1.tex');
  });

  it('pops closed files correctly and handles non-file parentheses', () => {
    const root = join(process.cwd(), 'fixture');
    const log = [
      '(./chapters/intro.tex',
      'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
      '(see the transcript file for additional information)',
      ')',
      '! Emergency stop.',
    ].join('\n');

    const diagnostics = parseDiagnostics(log, 'main.tex', root);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].severity).toBe('warning');
    // After ) is popped, the Emergency stop at top level without active file has no file
    expect(diagnostics[1].severity).toBe('error');
    expect(diagnostics[1].file).toBeUndefined();
  });

  it('handles quoted paths with spaces', () => {
    const root = join(process.cwd(), 'fixture');
    const log = [
      '("chapters/my notes.tex"',
      '! Undefined control sequence.',
      'l.5 \\wrong',
      ')',
    ].join('\n');

    const [diagnostic] = parseDiagnostics(log, 'main.tex', root);
    expect(diagnostic).toEqual({
      severity: 'error',
      file: 'chapters/my notes.tex',
      line: 5,
      message: 'Undefined control sequence. (l.5 \\wrong)',
    });
  });
});
