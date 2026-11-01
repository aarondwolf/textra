export const COMMON_LATEX_ENVIRONMENTS = [
  'abstract',
  'align',
  'align*',
  'array',
  'center',
  'description',
  'document',
  'enumerate',
  'equation',
  'equation*',
  'figure',
  'figure*',
  'flushleft',
  'flushright',
  'gather',
  'gather*',
  'itemize',
  'matrix',
  'minipage',
  'multline',
  'multline*',
  'pmatrix',
  'proof',
  'quotation',
  'quote',
  'split',
  'table',
  'table*',
  'tabular',
  'tabular*',
  'thebibliography',
  'theorem',
  'tikzpicture',
  'verbatim',
] as const;

export function stripLatexComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '%') continue;
    let escapes = 0;
    for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1)
      escapes += 1;
    if (escapes % 2 === 0) return line.slice(0, index);
  }
  return line;
}

export function unmatchedEnvironments(source: string): string[] {
  const stack: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const commands = stripLatexComment(line);
    for (const match of commands.matchAll(/\\(begin|end)\s*\{([^}\s]+)\}/g)) {
      const command = match[1];
      const environment = match[2];
      if (command === 'begin') {
        stack.push(environment);
        continue;
      }
      const index = stack.lastIndexOf(environment);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack;
}
