export interface CommonProblemHelp {
  title: string;
  explanation: string;
  url: string;
}

const TEX_FAQ = 'https://texfaq.org/FAQ-';

/**
 * Small, deliberately conservative matcher for the errors that leave new TeX
 * users stranded most often. Compiler diagnostics remain the authority; this
 * only attaches an approachable explanation when the wording is unmistakable.
 */
const patterns: readonly [RegExp, CommonProblemHelp][] = [
  [
    /undefined control sequence/i,
    {
      title: 'Unknown command',
      explanation:
        'TeX does not know this command. Check its spelling and add the package that defines it.',
      url: `${TEX_FAQ}usesevral`,
    },
  ],
  [
    /missing \$ inserted/i,
    {
      title: 'Math-mode marker is missing',
      explanation:
        'A math-only character or command was used outside math mode. Put the expression between $…$ or use a math environment.',
      url: `${TEX_FAQ}mathmode`,
    },
  ],
  [
    /overfull \\hbox/i,
    {
      title: 'Text is too wide for a line',
      explanation:
        'TeX could not break a line within the margins. This is a warning; revise a long word, URL, table, or line break if the PDF looks wrong.',
      url: `${TEX_FAQ}overfull`,
    },
  ],
  [
    /underfull \\hbox/i,
    {
      title: 'Loose line spacing',
      explanation:
        'TeX had too much empty horizontal space while justifying a line. It is often harmless, but inspect the affected paragraph in the PDF.',
      url: `${TEX_FAQ}underfull`,
    },
  ],
  [
    /runaway argument/i,
    {
      title: 'An argument was never closed',
      explanation:
        'A command likely has a missing closing brace, bracket, or environment end. Start near the line named by TeX and check matching delimiters.',
      url: `${TEX_FAQ}runaway`,
    },
  ],
  [
    /file [`']?(.+?)[`']? not found/i,
    {
      title: 'Referenced file was not found',
      explanation:
        'A required source, image, bibliography, class, or package file cannot be located. Check the path, filename, and installation.',
      url: `${TEX_FAQ}notfound`,
    },
  ],
  [
    /latex error:.*(missing \\begin\{document\}|can be used only in preamble)/i,
    {
      title: 'Document structure is misplaced',
      explanation:
        'A document command is in the wrong part of the file. Check the preamble, \\begin{document}, and \\end{document}.',
      url: `${TEX_FAQ}document`,
    },
  ],
  [
    /extra }, or forgotten \$/i,
    {
      title: 'Unexpected closing brace',
      explanation:
        'There is probably an unmatched } or a math-mode delimiter near this location. Check braces and $ markers around the reported line.',
      url: `${TEX_FAQ}brace`,
    },
  ],
  [
    /environment .+ undefined/i,
    {
      title: 'Unknown environment',
      explanation:
        'The environment name is misspelled or its defining package is missing. Check both the begin/end names and required package.',
      url: `${TEX_FAQ}usesevral`,
    },
  ],
  [
    /emergency stop/i,
    {
      title: 'TeX stopped before it could recover',
      explanation:
        'This usually follows an earlier error or an unfinished input. Read the first error above this message and check open braces/environments.',
      url: `${TEX_FAQ}error`,
    },
  ],
];

export function commonProblemHelp(message: string, detail = ''): CommonProblemHelp | null {
  const text = `${message}\n${detail}`;
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
