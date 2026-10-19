const sectionLevels: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

function stripComment(line: string): string {
  const match = /(^|[^\\])%/.exec(line);
  return match ? line.slice(0, match.index + match[1].length) : line;
}

/** Folding for environments, sectioning commands and comment blocks. */
export interface FoldingRange {
  /** 1-based first line, which stays visible. */
  start: number;
  /** 1-based last hidden line. */
  end: number;
  comment?: true;
}

export function latexFoldingRanges(lines: string[]): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  const environments: { name: string; line: number }[] = [];
  const sections: { level: number; line: number }[] = [];
  const closeSections = (level: number, lastLine: number) => {
    while (sections.length && sections[sections.length - 1].level >= level) {
      const section = sections.pop()!;
      let end = lastLine;
      while (end > section.line && !lines[end - 1].trim()) end--;
      if (end > section.line) ranges.push({ start: section.line, end });
    }
  };
  let commentStart = 0;
  const flushComments = (endLine: number) => {
    if (commentStart && endLine - commentStart >= 1)
      ranges.push({
        start: commentStart,
        end: endLine,
        comment: true,
      });
    commentStart = 0;
  };
  for (let index = 0; index < lines.length; index++) {
    const number = index + 1;
    const raw = lines[index];
    if (/^\s*%/.test(raw)) {
      if (!commentStart) commentStart = number;
      continue;
    }
    flushComments(number - 1);
    const text = stripComment(raw);
    const section =
      /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/.exec(
        text,
      );
    if (section) {
      const level = sectionLevels[section[1]];
      closeSections(level, number - 1);
      sections.push({ level, line: number });
    }
    for (const token of text.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
      const name = token[2];
      if (token[1] === 'begin') {
        environments.push({ name, line: number });
        continue;
      }
      if (name === 'document') closeSections(0, number - 1);
      const open = environments.map((item) => item.name).lastIndexOf(name);
      if (open === -1) continue;
      const [begin] = environments.splice(open);
      if (number - 1 > begin.line) ranges.push({ start: begin.line, end: number - 1 });
    }
  }
  flushComments(lines.length);
  closeSections(0, lines.length);
  return ranges;
}
