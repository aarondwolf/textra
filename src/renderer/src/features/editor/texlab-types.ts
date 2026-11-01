import type { OpenDocument } from '../../state/workspace';

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
  readonly resourceEpoch?: number;
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
