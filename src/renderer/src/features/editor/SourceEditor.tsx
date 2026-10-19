import { useEffect, useRef } from 'react';
import { latexFoldingRanges } from './folding';
// editor.api.js does not load the icon font that Monaco's widgets (find, suggest) use, and the
// package exports map cannot address a .css file, so import it by path.
import '../../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
// editor.api.js ships no optional features; each one must be imported to exist.
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import type { Theme, SourceLocation } from '../../../../shared/api';
import { editDocument, useWorkspace, type OpenDocument } from '../../state/workspace';

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

monaco.languages.registerFoldingRangeProvider('latex', {
  provideFoldingRanges(model) {
    return latexFoldingRanges(model.getLinesContent()).map((range) => ({
      start: range.start,
      end: range.end,
      ...(range.comment ? { kind: monaco.languages.FoldingRangeKind.Comment } : {}),
    }));
  },
});

export function SourceEditor({
  documents,
  activePath,
  theme,
  navigation,
  fontSize,
  wrap,
  readOnly,
}: {
  documents: OpenDocument[];
  activePath: string;
  theme: Theme;
  navigation: SourceLocation | null;
  fontSize: number;
  wrap: boolean;
  readOnly: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const current = useRef<string | null>(null);
  useEffect(() => {
    const instance = monaco.editor.create(container.current!, {
      ariaLabel: 'LaTeX source editor',
      editContext: false,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: "'Cascadia Code', Consolas, monospace",
      fontSize: 14,
      lineHeight: 23,
      padding: { top: 16 },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      quickSuggestions: false,
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
    const content = instance.onDidChangeModelContent(() => {
      if (current.current) editDocument(current.current, instance.getValue());
    });
    const cursor = instance.onDidChangeCursorPosition((event) => {
      if (current.current)
        useWorkspace.setState({
          source: { path: current.current, line: event.position.lineNumber },
        });
    });
    const retainedModels = models.current;
    return () => {
      window.removeEventListener('textra:replace-source', replaceSource);
      window.removeEventListener('textra:insert-source', insertSource);
      content.dispose();
      cursor.dispose();
      instance.dispose();
      retainedModels.forEach((model) => model.dispose());
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
          monaco.Uri.parse(
            `inmemory://textra/${encodeURIComponent(document.projectId)}/${document.path}`,
          ),
        );
        models.current.set(document.path, model);
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
        model.dispose();
        models.current.delete(path);
        views.current.delete(path);
      }
  }, [documents, activePath]);
  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'textra-dark' : 'textra-light');
  }, [theme]);
  useEffect(() => {
    editor.current?.updateOptions({ fontSize, wordWrap: wrap ? 'on' : 'off', readOnly });
  }, [fontSize, wrap, readOnly]);
  useEffect(() => {
    if (navigation && navigation.path === activePath) {
      editor.current?.setPosition({ lineNumber: navigation.line, column: navigation.column });
      editor.current?.revealLineInCenter(navigation.line);
      editor.current?.focus();
    }
  }, [navigation, activePath]);
  return <div ref={container} className="source-editor" data-testid="source-editor" />;
}
