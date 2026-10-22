export interface CommonProblemHelp {
  title: string;
  explanation: string;
  url: string;
  sourceLabel?: string;
}

const TEX_FAQ = 'https://texfaq.org/FAQ-';
const OVERLEAF = 'https://www.overleaf.com/learn/';

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
      url: `${OVERLEAF}latex/Errors/Undefined_control_sequence`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /missing \$ inserted/i,
    {
      title: 'Math-mode marker is missing',
      explanation:
        'A math-only character or command was used outside math mode. Put the expression between $…$ or use a math environment.',
      url: `${OVERLEAF}latex/Errors/Missing_%24_inserted`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /overfull \\hbox/i,
    {
      title: 'Text is too wide for a line',
      explanation:
        'TeX could not break a line within the margins. This is a warning; revise a long word, URL, table, or line break if the PDF looks wrong.',
      url: `${TEX_FAQ}overfull`,
      sourceLabel: 'TeX FAQ',
    },
  ],
  [
    /underfull \\hbox/i,
    {
      title: 'Loose line spacing',
      explanation:
        'TeX had too much empty horizontal space while justifying a line. It is often harmless, but inspect the affected paragraph in the PDF.',
      url: `${OVERLEAF}how-to/Understanding_underfull_and_overfull_box_warnings`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /runaway argument/i,
    {
      title: 'An argument was never closed',
      explanation:
        'A command likely has a missing closing brace, bracket, or environment end. Start near the line named by TeX and check matching delimiters.',
      url: `${TEX_FAQ}matchbrak`,
      sourceLabel: 'TeX FAQ',
    },
  ],
  [
    /file [`']?(.+?)[`']? not found/i,
    {
      title: 'Referenced file was not found',
      explanation:
        'A required source, image, bibliography, class, or package file cannot be located. Check the path, filename, and installation.',
      url: `${OVERLEAF}latex/Errors/File_XXX_not_found_on_input_line_XXX`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /latex error:.*missing \\begin\{document\}/i,
    {
      title: 'Missing \\begin{document}',
      explanation:
        'TeX encountered text or body commands before the document environment was started. Check your preamble and ensure \\begin{document} is present.',
      url: `${OVERLEAF}latex/Errors/LaTeX_Error%3A_Missing_%5Cbegin_document`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /latex error:.*can be used only in preamble/i,
    {
      title: 'Preamble command in document body',
      explanation:
        'A command such as \\usepackage can only be placed before \\begin{document}. Move it into the preamble at the top of your file.',
      url: `${OVERLEAF}latex/Errors/LaTeX_Error%3A_Can_be_used_only_in_preamble`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /extra }, or forgotten \$/i,
    {
      title: 'Unexpected closing brace',
      explanation:
        'There is probably an unmatched } or a math-mode delimiter near this location. Check braces and $ markers around the reported line.',
      url: `${TEX_FAQ}matchbrak`,
      sourceLabel: 'TeX FAQ',
    },
  ],
  [
    /environment .+ undefined/i,
    {
      title: 'Unknown environment',
      explanation:
        'The environment name is misspelled or its defining package is missing. Check both the begin/end names and required package.',
      url: `${OVERLEAF}latex/Errors/LaTeX_Error%3A_Environment_XXX_undefined`,
      sourceLabel: 'Overleaf',
    },
  ],
  [
    /emergency stop/i,
    {
      title: 'TeX stopped before it could recover',
      explanation:
        'This usually follows an earlier error or an unfinished input. Read the first error above this message and check open braces/environments.',
      url: `${TEX_FAQ}erroradvice`,
      sourceLabel: 'TeX FAQ',
    },
  ],
];

export function commonProblemHelp(message: string, detail = ''): CommonProblemHelp | null {
  const text = `${message}\n${detail}`;
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
