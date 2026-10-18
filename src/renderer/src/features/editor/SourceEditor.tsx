import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
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
      [/\\[a-zA-Z@]+|\\./, 'keyword'],
      [/[{}]/, 'delimiter.bracket'],
      [/\$\$?|\\\[|\\\]/, 'string'],
      [/\b\d+\b/, 'number'],
    ],
  },
});
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
      theme: 'vs-dark',
    });
    editor.current = instance;
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
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
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
