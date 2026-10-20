import { useEffect, useRef } from 'react';
import { latexFoldingRanges } from './folding';
import FormattingToolbar from './FormattingToolbar';
// editor.api.js does not load the icon font that Monaco's widgets (find, suggest) use, and the
// package exports map cannot address a .css file, so import it by path.
import '../../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
// editor.api.js ships no optional features; each one must be imported to exist.
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHints.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import type { Theme, SourceLocation } from '../../../../shared/api';
import { bibliographyDetail, type BibliographyEntry } from '../../../../shared/bibliography';
import { analyzeLatexDocument } from '../../../../shared/writing-analysis';
import { editDocument, saveDocument, useWorkspace, type OpenDocument } from '../../state/workspace';
import { useUI } from '../../state/ui';

(self as typeof self & { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
monaco.languages.register({ id: 'latex', extensions: ['.tex', '.sty', '.cls', '.bib'] });
monaco.languages.setMonarchTokensProvider('latex', {
  tokenizer: {
    root: [
      [/%.*$/, 'comment'],
      [/\$\$/, { token: 'delimiter.math', next: '@displayDollar' }],
      [/\$/, { token: 'delimiter.math', next: '@inlineDollar' }],
      [/\\\(/, { token: 'delimiter.math', next: '@inlineParen' }],
      [/\\\[/, { token: 'delimiter.math', next: '@displayBracket' }],
      [/\\[a-zA-Z@]+|\\./, 'keyword'],
      [/[{}]/, 'delimiter.bracket'],
      [/\b\d+\b/, 'number'],
    ],
    inlineDollar: [[/\$/, { token: 'delimiter.math', next: '@pop' }], { include: '@mathCommon' }],
    displayDollar: [
      [/\$\$/, { token: 'delimiter.math', next: '@pop' }],
      { include: '@mathCommon' },
    ],
    inlineParen: [[/\\\)/, { token: 'delimiter.math', next: '@pop' }], { include: '@mathCommon' }],
    displayBracket: [
      [/\\\]/, { token: 'delimiter.math', next: '@pop' }],
      { include: '@mathCommon' },
    ],
    mathCommon: [
      [/%.*$/, 'comment'],
      [/\\[a-zA-Z@]+|\\./, 'keyword'],
      [/[{}[\]()]/, 'delimiter.bracket'],
      [/\b\d+(?:\.\d+)?\b/, 'number'],
      [/./, 'string.math'],
    ],
  },
});

const COMMON_LATEX_ENVIRONMENTS = [
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

function stripLatexComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '%') continue;
    let escapes = 0;
    for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1)
      escapes += 1;
    if (escapes % 2 === 0) return line.slice(0, index);
  }
  return line;
}

function unmatchedEnvironments(source: string): string[] {
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

const editorThemes: Record<string, monaco.editor.IStandaloneThemeData> = {
  'textra-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'E4E5E2' },
      { token: 'keyword', foreground: '9BC9BB' },
      { token: 'comment', foreground: '909B95', fontStyle: 'italic' },
      { token: 'string.math', foreground: 'D5BD91' },
      { token: 'delimiter.math', foreground: 'D5BD91' },
      { token: 'number', foreground: 'D5BD91' },
      { token: 'delimiter.bracket', foreground: 'B6BBB7' },
    ],
    colors: {
      'editor.background': '#1C1E20',
      'editor.foreground': '#E4E5E2',
      'editorGutter.background': '#1C1E20',
      'editorLineNumber.foreground': '#626B69',
      'editorLineNumber.activeForeground': '#A2B1AB',
      'editorGutter.foldingControlForeground': '#7C8884',
      'editorCursor.foreground': '#9BC9BB',
      'editor.lineHighlightBackground': '#252A29',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#3A585080',
      'editor.inactiveSelectionBackground': '#3A484880',
      'editor.selectionHighlightBackground': '#7CA89722',
      'editorBracketMatch.background': '#9BC9BB18',
      'editorBracketMatch.border': '#9BC9BB66',
      'editorWidget.background': '#222426',
      'editorWidget.border': '#343A38',
      'input.background': '#1C1E20',
      'input.foreground': '#E4E5E2',
      'input.border': '#414B47',
      focusBorder: '#9BC9BB',
      'editor.findMatchBackground': '#92763F80',
      'editor.findMatchHighlightBackground': '#92763F44',
    },
  },
  'textra-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '292F2C' },
      { token: 'keyword', foreground: '326958' },
      { token: 'comment', foreground: '69776F', fontStyle: 'italic' },
      { token: 'string.math', foreground: '8B6229' },
      { token: 'delimiter.math', foreground: '8B6229' },
      { token: 'number', foreground: '8B6229' },
      { token: 'delimiter.bracket', foreground: '646F68' },
    ],
    colors: {
      'editor.background': '#FAF9F6',
      'editor.foreground': '#292F2C',
      'editorGutter.background': '#FAF9F6',
      'editorLineNumber.foreground': '#989F98',
      'editorLineNumber.activeForeground': '#526B5E',
      'editorGutter.foldingControlForeground': '#7E8A82',
      'editorCursor.foreground': '#326958',
      'editor.lineHighlightBackground': '#F0F1EA',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#B7D5C999',
      'editor.inactiveSelectionBackground': '#D9E2DB99',
      'editor.selectionHighlightBackground': '#32695816',
      'editorBracketMatch.background': '#32695812',
      'editorBracketMatch.border': '#32695866',
      'editorWidget.background': '#F4F3EF',
      'editorWidget.border': '#DADFD7',
      'input.background': '#FAF9F6',
      'input.foreground': '#292F2C',
      'input.border': '#B9C5BB',
      focusBorder: '#326958',
      'editor.findMatchBackground': '#E8C98A99',
      'editor.findMatchHighlightBackground': '#E8C98A55',
    },
  },
  'textra-midnight': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'D8E2F2' },
      { token: 'keyword', foreground: '87BFFF' },
      { token: 'comment', foreground: '71829B', fontStyle: 'italic' },
      { token: 'string.math', foreground: 'E5B567' },
      { token: 'delimiter.math', foreground: 'E5B567' },
      { token: 'number', foreground: 'E5B567' },
    ],
    colors: {
      'editor.background': '#121A2A',
      'editor.foreground': '#D8E2F2',
      'editorCursor.foreground': '#87BFFF',
      'editorLineNumber.foreground': '#52637B',
      'editor.lineHighlightBackground': '#1A263A',
      'editor.selectionBackground': '#315B8A88',
    },
  },
  'textra-forest': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'DEE7D9' },
      { token: 'keyword', foreground: '9AC68E' },
      { token: 'comment', foreground: '80907B', fontStyle: 'italic' },
      { token: 'string.math', foreground: 'E3C177' },
      { token: 'delimiter.math', foreground: 'E3C177' },
      { token: 'number', foreground: 'E3C177' },
    ],
    colors: {
      'editor.background': '#18231C',
      'editor.foreground': '#DEE7D9',
      'editorCursor.foreground': '#9AC68E',
      'editorLineNumber.foreground': '#5D725E',
      'editor.lineHighlightBackground': '#223126',
      'editor.selectionBackground': '#496C4488',
    },
  },
  'textra-ocean': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'D9E9ED' },
      { token: 'keyword', foreground: '75C9D7' },
      { token: 'comment', foreground: '759199', fontStyle: 'italic' },
      { token: 'string.math', foreground: 'E6B980' },
      { token: 'delimiter.math', foreground: 'E6B980' },
      { token: 'number', foreground: 'E6B980' },
    ],
    colors: {
      'editor.background': '#10252D',
      'editor.foreground': '#D9E9ED',
      'editorCursor.foreground': '#75C9D7',
      'editorLineNumber.foreground': '#4E737D',
      'editor.lineHighlightBackground': '#16333D',
      'editor.selectionBackground': '#36738388',
    },
  },
  'textra-rose': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'F1E0E5' },
      { token: 'keyword', foreground: 'E8A4B8' },
      { token: 'comment', foreground: 'A27E8A', fontStyle: 'italic' },
      { token: 'string.math', foreground: 'E9C47F' },
      { token: 'delimiter.math', foreground: 'E9C47F' },
      { token: 'number', foreground: 'E9C47F' },
    ],
    colors: {
      'editor.background': '#291B23',
      'editor.foreground': '#F1E0E5',
      'editorCursor.foreground': '#E8A4B8',
      'editorLineNumber.foreground': '#7D5967',
      'editor.lineHighlightBackground': '#38242E',
      'editor.selectionBackground': '#884D6588',
    },
  },
  'textra-sand': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '3B342B' },
      { token: 'keyword', foreground: '946C2E' },
      { token: 'comment', foreground: '827868', fontStyle: 'italic' },
      { token: 'string.math', foreground: 'A85A3A' },
      { token: 'delimiter.math', foreground: 'A85A3A' },
      { token: 'number', foreground: 'A85A3A' },
    ],
    colors: {
      'editor.background': '#F6F0E3',
      'editor.foreground': '#3B342B',
      'editorCursor.foreground': '#946C2E',
      'editorLineNumber.foreground': '#A69A87',
      'editor.lineHighlightBackground': '#ECE2CF',
      'editor.selectionBackground': '#DCC48D99',
    },
  },
};
for (const [name, definition] of Object.entries(editorThemes))
  monaco.editor.defineTheme(name, definition);
monaco.languages.setLanguageConfiguration('latex', {
  comments: { lineComment: '%' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
});

/** A zero-based position, matching the Language Server Protocol. */
export interface TexlabPosition {
  line: number;
  character: number;
}

/** A zero-based, end-exclusive range, matching the Language Server Protocol. */
export interface TexlabRange {
  start: TexlabPosition;
  end: TexlabPosition;
}

/** The current editor snapshot supplied with every language-tool request. */
export interface TexlabEditorDocument {
  path: string;
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface TexlabDiagnostic {
  range: TexlabRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  code?: string;
  source?: string;
}

export interface TexlabCompletion {
  label: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  range?: TexlabRange;
}

export interface TexlabHover {
  contents: string;
  range?: TexlabRange;
}

export interface TexlabLocation {
  path: string;
  uri?: string;
  range: TexlabRange;
}

export interface TexlabDocumentSymbol {
  name: string;
  detail?: string;
  kind?: number;
  range: TexlabRange;
  selectionRange?: TexlabRange;
  children?: TexlabDocumentSymbol[];
}

export interface TexlabFoldingRange {
  startLine: number;
  endLine: number;
  startCharacter?: number;
  endCharacter?: number;
  kind?: 'comment' | 'imports' | 'region';
}

export interface TexlabInlayHint {
  position: TexlabPosition;
  label: string;
  tooltip?: string;
  kind?: 'type' | 'parameter';
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

/**
 * Renderer-facing adapter for an optional TexLab client. It deliberately contains
 * only plain data: Workspace can bridge it to typed IPC without exposing process
 * access to Monaco. Missing methods leave TeXtra's local editor behavior intact.
 */
export interface TexlabEditorAdapter {
  readonly isReady: boolean;
  readonly diagnostics?: ReadonlyMap<string, readonly TexlabDiagnostic[]>;
  /** Supplies the real project file URI so TexLab can resolve includes and bibliographies. */
  documentUri?(document: Pick<OpenDocument, 'projectId' | 'path'>): string;
  syncDocument?(document: TexlabEditorDocument): void | Promise<void>;
  closeDocument?(document: Pick<TexlabEditorDocument, 'path' | 'uri'>): void | Promise<void>;
  requestCompletion?(
    document: TexlabEditorDocument,
    position: TexlabPosition,
  ): Promise<readonly TexlabCompletion[]>;
  requestHover?(
    document: TexlabEditorDocument,
    position: TexlabPosition,
  ): Promise<TexlabHover | null>;
  requestDefinition?(
    document: TexlabEditorDocument,
    position: TexlabPosition,
  ): Promise<readonly TexlabLocation[]>;
  requestReferences?(
    document: TexlabEditorDocument,
    position: TexlabPosition,
  ): Promise<readonly TexlabLocation[]>;
  requestDocumentSymbols?(document: TexlabEditorDocument): Promise<readonly TexlabDocumentSymbol[]>;
  requestFoldingRanges?(document: TexlabEditorDocument): Promise<readonly TexlabFoldingRange[]>;
  requestInlayHints?(
    document: TexlabEditorDocument,
    range: TexlabRange,
  ): Promise<readonly TexlabInlayHint[]>;
}

type EditorFormatCommand =
  'bold' | 'italic' | 'enumerate' | 'itemize' | 'figure' | 'table' | 'heading';

interface EditorFormatRequest {
  command: EditorFormatCommand;
  level?: 1 | 2 | 3 | 4 | 5;
}

function EditorFormattingToolbar({ disabled }: { disabled: boolean }) {
  return <FormattingToolbar disabled={disabled} />;
}

function texlabUri(document: Pick<OpenDocument, 'projectId' | 'path'>) {
  return `file:///textra/${encodeURIComponent(document.projectId)}/${document.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function documentUri(
  document: Pick<OpenDocument, 'projectId' | 'path'>,
  adapter?: TexlabEditorAdapter,
) {
  return adapter?.documentUri?.(document) ?? texlabUri(document);
}

function toTexlabDocument(
  model: monaco.editor.ITextModel,
  document: OpenDocument,
): TexlabEditorDocument {
  return {
    path: document.path,
    uri: model.uri.toString(),
    languageId: model.getLanguageId(),
    version: model.getVersionId(),
    text: model.getValue(),
  };
}

function toTexlabPosition(position: monaco.Position): TexlabPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function toMonacoRange(range: TexlabRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

export function SourceEditor({
  documents,
  activePath,
  theme,
  navigation,
  fontSize,
  wrap,
  readOnly,
  formatToolbarVisible,
  bibliographyEntries,
  texlab,
}: {
  documents: OpenDocument[];
  activePath: string;
  theme: Theme;
  navigation: SourceLocation | null;
  fontSize: number;
  wrap: boolean;
  readOnly: boolean;
  formatToolbarVisible: boolean;
  bibliographyEntries: readonly BibliographyEntry[];
  texlab?: TexlabEditorAdapter;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const current = useRef<string | null>(null);
  const documentsRef = useRef(documents);
  const texlabRef = useRef<TexlabEditorAdapter | undefined>(texlab);
  const bibliographyEntriesRef = useRef(bibliographyEntries);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { autoSave, autoSaveDelayMs, editorMinimap } = useUI((state) => state.preferences);
  const autoSavePreferences = useRef({ enabled: autoSave, delayMs: autoSaveDelayMs, readOnly });
  const minimapPreference = useRef(editorMinimap);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);
  useEffect(() => {
    texlabRef.current = texlab;
  }, [texlab]);
  useEffect(() => {
    bibliographyEntriesRef.current = bibliographyEntries;
  }, [bibliographyEntries]);
  useEffect(() => {
    autoSavePreferences.current = { enabled: autoSave, delayMs: autoSaveDelayMs, readOnly };
    if (!autoSave && autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
  }, [autoSave, autoSaveDelayMs, readOnly]);
  useEffect(() => {
    minimapPreference.current = editorMinimap;
  }, [editorMinimap]);
  useEffect(() => {
    const instance = monaco.editor.create(container.current!, {
      ariaLabel: 'LaTeX source editor',
      editContext: false,
      automaticLayout: true,
      minimap: { enabled: minimapPreference.current },
      fontFamily: "'Cascadia Code', Consolas, monospace",
      fontSize: 14,
      lineHeight: 23,
      padding: { top: 16 },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      // TexLab filters its completion list as the command or environment name is typed.
      // Keep this quiet in prose comments and math/text strings while enabling it in source.
      quickSuggestions: { other: true, comments: false, strings: false },
      quickSuggestionsDelay: 80,
      suggestOnTriggerCharacters: true,
      folding: true,
      foldingStrategy: 'auto',
      showFoldingControls: 'mouseover',
      matchBrackets: 'always',
      autoClosingBrackets: 'languageDefined',
      theme: 'textra-dark',
    });
    editor.current = instance;
    const replaceSource = () => {
      if (!instance.getModel()) return;
      instance.focus();
      void instance.getAction('editor.action.startFindReplaceAction')?.run();
    };
    window.addEventListener('textra:replace-source', replaceSource);
    const insertSource = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; caret: number }>).detail;
      const model = instance.getModel();
      const selection = instance.getSelection();
      if (!model || !selection || !detail) return;
      event.preventDefault();
      const start = model.getOffsetAt(selection.getStartPosition());
      // Model edits work even while the editor is read-only (executeEdits refuses then).
      instance.pushUndoStop();
      model.pushEditOperations(
        [selection],
        [{ range: selection, text: detail.text, forceMoveMarkers: true }],
        () => null,
      );
      instance.pushUndoStop();
      instance.setPosition(model.getPositionAt(start + detail.caret));
      instance.focus();
    };
    window.addEventListener('textra:insert-source', insertSource);
    const formatSource = (event: Event) => {
      const detail = (event as CustomEvent<EditorFormatRequest>).detail;
      const model = instance.getModel();
      const selection = instance.getSelection();
      if (!model || !selection || !detail || model.getLanguageId() !== 'latex') return;
      event.preventDefault();
      const selected = model.getValueInRange(selection);
      const textOrCursor = (prefix: string, suffix: string) => ({
        text: `${prefix}${selected}${suffix}`,
        caret: selected ? prefix.length + selected.length + suffix.length : prefix.length,
      });
      const heading = [
        'section',
        'subsection',
        'subsubsection',
        'paragraph',
        'subparagraph',
      ] as const;
      const line = model.getLineContent(selection.startLineNumber);
      const indentation = /^\s*/.exec(line)?.[0] ?? '';
      const eol = model.getEOL();
      const request = (() => {
        switch (detail.command) {
          case 'bold':
            return textOrCursor('\\textbf{', '}');
          case 'italic':
            return textOrCursor('\\textit{', '}');
          case 'heading': {
            const command = heading[(detail.level ?? 1) - 1];
            return textOrCursor(`\\${command}{`, '}');
          }
          case 'enumerate':
          case 'itemize': {
            const environment = detail.command;
            const item = selected ? `\\item ${selected}` : '\\item ';
            return {
              text: `\\begin{${environment}}${eol}${indentation}\t${item}${eol}${indentation}\\end{${environment}}`,
              caret:
                `\\begin{${environment}}${eol}${indentation}\t\\item `.length + selected.length,
            };
          }
          case 'figure':
            return {
              text: `\\begin{figure}[htbp]${eol}${indentation}\t\\centering${eol}${indentation}\t${selected}${eol}${indentation}\t\\caption{}${eol}${indentation}\t\\label{fig:}${eol}${indentation}\\end{figure}`,
              caret:
                `\\begin{figure}[htbp]${eol}${indentation}\t\\centering${eol}${indentation}\t`
                  .length + selected.length,
            };
          case 'table':
            return {
              text: `\\begin{table}[htbp]${eol}${indentation}\t\\centering${eol}${indentation}\t\\begin{tabular}{ll}${eol}${indentation}\t\t${selected}${eol}${indentation}\t\\end{tabular}${eol}${indentation}\t\\caption{}${eol}${indentation}\t\\label{tab:}${eol}${indentation}\\end{table}`,
              caret:
                `\\begin{table}[htbp]${eol}${indentation}\t\\centering${eol}${indentation}\t\\begin{tabular}{ll}${eol}${indentation}\t\t`
                  .length + selected.length,
            };
        }
      })();
      const start = model.getOffsetAt(selection.getStartPosition());
      instance.pushUndoStop();
      model.pushEditOperations(
        [selection],
        [{ range: selection, text: request.text, forceMoveMarkers: true }],
        () => null,
      );
      instance.pushUndoStop();
      instance.setPosition(model.getPositionAt(start + request.caret));
      instance.focus();
      window.dispatchEvent(
        new CustomEvent('textra:notify', {
          detail: { message: 'Formatting applied', tone: 'success' },
        }),
      );
    };
    window.addEventListener('textra:format-source', formatSource);
    const content = instance.onDidChangeModelContent(() => {
      if (!current.current) return;
      const path = current.current;
      editDocument(path, instance.getValue());
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const autoSaveSettings = autoSavePreferences.current;
      if (autoSaveSettings.enabled && !autoSaveSettings.readOnly) {
        autoSaveTimer.current = setTimeout(() => {
          void saveDocument(path).then((saved) => {
            if (saved)
              window.dispatchEvent(
                new CustomEvent('textra:notify', { detail: { message: 'Saved', tone: 'success' } }),
              );
          });
        }, autoSaveSettings.delayMs);
      }
      const document = documentsRef.current.find(({ path: documentPath }) => documentPath === path);
      const model = instance.getModel();
      if (document && model && texlabRef.current?.isReady)
        void texlabRef.current.syncDocument?.(toTexlabDocument(model, document));
    });
    const cursor = instance.onDidChangeCursorPosition((event) => {
      if (current.current)
        useWorkspace.setState({
          source: { path: current.current, line: event.position.lineNumber },
        });
    });
    const sourceDocument = (model: monaco.editor.ITextModel) =>
      documentsRef.current.find(
        (document) => model.uri.toString() === documentUri(document, texlabRef.current),
      ) ?? documentsRef.current.find((document) => document.path === current.current);
    const localCompletion = (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionItem[] => {
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const match = /\\([A-Za-z@]+)\*?(?:\[[^\]]*\])?\{[^}]*$/.exec(before);
      if (!match || !/^(?:ref|eqref|pageref|autoref|cite)/i.test(match[1])) return [];
      const labels = documentsRef.current.flatMap((document) =>
        analyzeLatexDocument(document.content).labels.map((label) => ({
          ...label,
          path: document.path,
        })),
      );
      const citations = documentsRef.current.flatMap((document) =>
        analyzeLatexDocument(document.content).citations.map((citation) => citation.value),
      );
      const isCitation = /cite/i.test(match[1]);
      const suggestions = isCitation
        ? [
            ...bibliographyEntriesRef.current.map((entry) => ({
              value: entry.key,
              detail: bibliographyDetail(entry),
            })),
            ...citations.map((value) => ({
              value,
              detail: 'Citation key already used in this project',
            })),
          ]
        : labels.map((label) => ({ value: label.value, detail: `Label in ${label.path}` }));
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      return [
        ...new Map(suggestions.map((suggestion) => [suggestion.value, suggestion])).values(),
      ].map((suggestion) => ({
        label: suggestion.value,
        kind: monaco.languages.CompletionItemKind.Reference,
        insertText: suggestion.value,
        detail: suggestion.detail,
        range,
      }));
    };
    const environmentCompletion = (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionItem[] => {
      const before = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const match = /\\(begin|end)\s*\{([^}]*)$/.exec(before);
      if (!match) return [];
      const [, command, partial] = match;
      // Monaco inserts a matching `}` as soon as the opening brace is typed. A begin
      // completion supplies its own brace and full closing environment, so consume that
      // pending auto-close instead of leaving it after the generated `\\end{...}`.
      const pendingAutoClose =
        command === 'begin' &&
        model.getLineContent(position.lineNumber).charAt(position.column - 1) === '}';
      const range = new monaco.Range(
        position.lineNumber,
        position.column - partial.length,
        position.lineNumber,
        position.column + (pendingAutoClose ? 1 : 0),
      );
      const open = unmatchedEnvironments(before);
      const candidates =
        command === 'end'
          ? [...open].reverse()
          : [...new Set([...open, ...COMMON_LATEX_ENVIRONMENTS])];
      return candidates
        .filter((environment) => environment.toLowerCase().startsWith(partial.toLowerCase()))
        .map((environment) => ({
          label: environment,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText:
            command === 'begin' ? `${environment}}\n\t$0\n\\end{${environment}}` : environment,
          ...(command === 'begin'
            ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
            : {}),
          detail:
            command === 'end' && open.includes(environment)
              ? 'Close open environment'
              : command === 'begin'
                ? 'Insert empty environment'
                : 'LaTeX environment',
          range,
        }));
    };
    const environmentEnter = instance.onKeyDown((event) => {
      if (
        event.keyCode !== monaco.KeyCode.Enter ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const model = instance.getModel();
      const position = instance.getPosition();
      if (!model || !position) return;
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const match = /\\begin\s*\{([^}\s]+)\}$/.exec(stripLatexComment(before));
      if (!match) return;
      const environment = match[1];
      const after = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: model.getLineCount(),
        endColumn: model.getLineMaxColumn(model.getLineCount()),
      });
      if (after.trimStart().startsWith(`\\end{${environment}}`)) return;
      event.preventDefault();
      event.stopPropagation();
      const indentation = /^\s*/.exec(model.getLineContent(position.lineNumber))?.[0] ?? '';
      const innerIndentation = `${indentation}\t`;
      const eol = model.getEOL();
      instance.pushUndoStop();
      model.pushEditOperations(
        [],
        [
          {
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            text: `${eol}${innerIndentation}${eol}${indentation}\\end{${environment}}`,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
      instance.pushUndoStop();
      instance.setPosition(
        new monaco.Position(position.lineNumber + 1, innerIndentation.length + 1),
      );
    });
    const completion = monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['\\', '{', ',', '['],
      async provideCompletionItems(model, position) {
        // Environment suggestions are deliberately local and synchronous. They remain stable while
        // Monaco cancels superseded asynchronous LSP requests as the user types.
        const environments = environmentCompletion(model, position);
        if (environments.length) return { suggestions: environments };
        const local = localCompletion(model, position);
        if (local.length) return { suggestions: local };
        const document = sourceDocument(model);
        const adapter = texlabRef.current;
        if (!document || !adapter?.isReady || !adapter.requestCompletion)
          return { suggestions: local };
        try {
          const completions = await adapter.requestCompletion(
            toTexlabDocument(model, document),
            toTexlabPosition(position),
          );
          const seen = new Set(local.map((item) => item.label));
          const suggestions = completions
            .filter((item) => !seen.has(item.label))
            .map((item) => ({
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Text,
              insertText: item.insertText ?? item.label,
              detail: item.detail,
              documentation: item.documentation,
              filterText: item.filterText,
              sortText: item.sortText,
              range: toMonacoRange(
                item.range ??
                  (() => {
                    const word = model.getWordUntilPosition(position);
                    return {
                      start: { line: position.lineNumber - 1, character: word.startColumn - 1 },
                      end: { line: position.lineNumber - 1, character: word.endColumn - 1 },
                    };
                  })(),
              ),
            }));
          return { suggestions: [...suggestions, ...local] };
        } catch {
          return { suggestions: local };
        }
      },
    });
    const hover = monaco.languages.registerHoverProvider('latex', {
      async provideHover(model, position) {
        const document = sourceDocument(model);
        const adapter = texlabRef.current;
        if (!document || !adapter?.isReady || !adapter.requestHover) return null;
        try {
          const hover = await adapter.requestHover(
            toTexlabDocument(model, document),
            toTexlabPosition(position),
          );
          return hover
            ? {
                contents: [{ value: hover.contents }],
                range: hover.range ? toMonacoRange(hover.range) : undefined,
              }
            : null;
        } catch {
          return null;
        }
      },
    });
    const locations =
      (request: keyof Pick<TexlabEditorAdapter, 'requestDefinition' | 'requestReferences'>) =>
      async (model: monaco.editor.ITextModel, position: monaco.Position) => {
        const document = sourceDocument(model);
        const adapter = texlabRef.current;
        const handler = adapter?.[request];
        if (!document || !adapter?.isReady || !handler) return [];
        try {
          const result = await handler.call(
            adapter,
            toTexlabDocument(model, document),
            toTexlabPosition(position),
          );
          return result.map((location) => ({
            uri: monaco.Uri.parse(
              location.uri ?? documentUri({ ...document, path: location.path }, texlabRef.current),
            ),
            range: toMonacoRange(location.range),
          }));
        } catch {
          return [];
        }
      };
    const definition = monaco.languages.registerDefinitionProvider('latex', {
      provideDefinition: locations('requestDefinition'),
    });
    const references = monaco.languages.registerReferenceProvider('latex', {
      provideReferences: locations('requestReferences'),
    });
    const symbols = monaco.languages.registerDocumentSymbolProvider('latex', {
      async provideDocumentSymbols(model) {
        const document = sourceDocument(model);
        const adapter = texlabRef.current;
        if (!document || !adapter?.isReady || !adapter.requestDocumentSymbols) return [];
        const convert = (symbol: TexlabDocumentSymbol): monaco.languages.DocumentSymbol => ({
          name: symbol.name,
          detail: symbol.detail ?? '',
          kind: symbol.kind ?? monaco.languages.SymbolKind.String,
          tags: [],
          range: toMonacoRange(symbol.range),
          selectionRange: toMonacoRange(symbol.selectionRange ?? symbol.range),
          children: symbol.children?.map(convert),
        });
        try {
          return (await adapter.requestDocumentSymbols(toTexlabDocument(model, document))).map(
            convert,
          );
        } catch {
          return [];
        }
      },
    });
    const folding = monaco.languages.registerFoldingRangeProvider('latex', {
      async provideFoldingRanges(model) {
        const document = sourceDocument(model);
        const adapter = texlabRef.current;
        if (document && adapter?.isReady && adapter.requestFoldingRanges)
          try {
            return (await adapter.requestFoldingRanges(toTexlabDocument(model, document))).map(
              (range) => ({
                start: range.startLine + 1,
                end: range.endLine + 1,
                ...(range.kind
                  ? {
                      kind:
                        range.kind === 'imports'
                          ? monaco.languages.FoldingRangeKind.Imports
                          : range.kind === 'comment'
                            ? monaco.languages.FoldingRangeKind.Comment
                            : monaco.languages.FoldingRangeKind.Region,
                    }
                  : {}),
              }),
            );
          } catch {
            // Fall through to TeXtra's deterministic folding parser.
          }
        return latexFoldingRanges(model.getLinesContent()).map((range) => ({
          start: range.start,
          end: range.end,
          ...(range.comment ? { kind: monaco.languages.FoldingRangeKind.Comment } : {}),
        }));
      },
    });
    const inlayHints = monaco.languages.registerInlayHintsProvider('latex', {
      async provideInlayHints(model, range) {
        const document = sourceDocument(model);
        const adapter = texlabRef.current;
        if (!document || !adapter?.isReady || !adapter.requestInlayHints)
          return { hints: [], dispose() {} };
        try {
          const hints = await adapter.requestInlayHints(toTexlabDocument(model, document), {
            start: toTexlabPosition(range.getStartPosition()),
            end: toTexlabPosition(range.getEndPosition()),
          });
          return {
            hints: hints.map((hint) => ({
              position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
              label: hint.label,
              tooltip: hint.tooltip,
              kind:
                hint.kind === 'parameter'
                  ? monaco.languages.InlayHintKind.Parameter
                  : monaco.languages.InlayHintKind.Type,
              paddingLeft: hint.paddingLeft,
              paddingRight: hint.paddingRight,
            })),
            dispose() {},
          };
        } catch {
          return { hints: [], dispose() {} };
        }
      },
    });
    const retainedModels = models.current;
    return () => {
      window.removeEventListener('textra:replace-source', replaceSource);
      window.removeEventListener('textra:insert-source', insertSource);
      window.removeEventListener('textra:format-source', formatSource);
      content.dispose();
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      cursor.dispose();
      environmentEnter.dispose();
      completion.dispose();
      hover.dispose();
      definition.dispose();
      references.dispose();
      symbols.dispose();
      folding.dispose();
      inlayHints.dispose();
      instance.dispose();
      retainedModels.forEach((model, path) => {
        void texlabRef.current?.closeDocument?.({ path, uri: model.uri.toString() });
        model.dispose();
      });
      retainedModels.clear();
      current.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const active = documents.find((document) => document.path === activePath);
    if (!active) return;
    for (const document of documents) {
      let model = models.current.get(document.path);
      if (!model) {
        model = monaco.editor.createModel(
          document.content,
          /\.(tex|bib|sty|cls)$/.test(document.path) ? 'latex' : 'plaintext',
          monaco.Uri.parse(documentUri(document, texlabRef.current)),
        );
        models.current.set(document.path, model);
        if (texlabRef.current?.isReady)
          void texlabRef.current.syncDocument?.(toTexlabDocument(model, document));
      } else if (model.getValue() !== document.content) model.setValue(document.content);
    }
    if (current.current !== activePath) {
      const previousView = instance.saveViewState();
      if (current.current && previousView) views.current.set(current.current, previousView);
      current.current = activePath;
      instance.setModel(models.current.get(activePath)!);
      instance.restoreViewState(views.current.get(activePath) ?? null);
      instance.focus();
    }
    for (const [path, model] of models.current)
      if (!documents.some((document) => document.path === path)) {
        void texlabRef.current?.closeDocument?.({ path, uri: model.uri.toString() });
        model.dispose();
        models.current.delete(path);
        views.current.delete(path);
      }
  }, [documents, activePath]);
  useEffect(() => {
    if (!texlab?.isReady) return;
    for (const document of documents) {
      const model = models.current.get(document.path);
      if (model) void texlab.syncDocument?.(toTexlabDocument(model, document));
    }
  }, [documents, texlab]);
  useEffect(() => {
    const diagnostics = texlab?.diagnostics;
    for (const [path, model] of models.current) {
      const markers = diagnostics?.get(path) ?? [];
      monaco.editor.setModelMarkers(
        model,
        'texlab',
        markers.map((diagnostic) => ({
          ...toMonacoRange(diagnostic.range),
          severity:
            diagnostic.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === 'warning'
                ? monaco.MarkerSeverity.Warning
                : diagnostic.severity === 'info'
                  ? monaco.MarkerSeverity.Info
                  : monaco.MarkerSeverity.Hint,
          message: diagnostic.message,
          code: diagnostic.code,
          source: diagnostic.source ?? 'TexLab',
        })),
      );
    }
  }, [documents, texlab?.diagnostics]);
  useEffect(() => {
    monaco.editor.setTheme(`textra-${theme}`);
  }, [theme]);
  useEffect(() => {
    editor.current?.updateOptions({
      fontSize,
      wordWrap: wrap ? 'on' : 'off',
      readOnly,
      minimap: { enabled: editorMinimap },
    });
  }, [fontSize, wrap, readOnly, editorMinimap]);
  useEffect(() => {
    if (navigation && navigation.path === activePath) {
      editor.current?.setPosition({ lineNumber: navigation.line, column: navigation.column });
      editor.current?.revealLineInCenter(navigation.line);
      editor.current?.focus();
    }
  }, [navigation, activePath]);
  return (
    <div className="source-editor-shell">
      {formatToolbarVisible && (
        <EditorFormattingToolbar disabled={readOnly || !/\.(tex|sty|cls)$/i.test(activePath)} />
      )}
      <div ref={container} className="source-editor" data-testid="source-editor" />
    </div>
  );
}
