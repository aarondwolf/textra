import type { HistorySnapshotSummary, FileSnapshot, Result } from '../../../shared/api';
import { documentSessions, type DocumentCapture } from './document-sessions';
import { replaceDocument, useWorkspace } from './workspace';
import { runLanguageRequest } from './language-requests';

export interface FormattingPreview {
  capture: DocumentCapture;
  content: string;
}

export async function prepareFormatting(
  projectId: string,
  path: string,
): Promise<FormattingPreview | null> {
  const capture = documentSessions.capture(projectId, path);
  if (!capture) return null;
  const result = await runLanguageRequest(projectId, path, 'format', (requestId) =>
    window.textra.formatLatex({ projectId, path, content: capture.content, requestId }),
  );
  if (!result) return null;
  if (!result.ok) throw new Error(result.error);
  if (!documentSessions.matches(capture)) return null;
  return { capture, content: result.value.content };
}

export function applyFormatting(preview: FormattingPreview): boolean {
  return replaceDocument(preview.capture, preview.content);
}

/** Disk restoration and backup are authoritative in main. Preserve any newer renderer edits. */
export async function restoreHistoryDocument(
  projectId: string,
  snapshot: HistorySnapshotSummary,
): Promise<Result<FileSnapshot>> {
  const capture = documentSessions.capture(projectId, snapshot.path);
  const disk = capture ? null : await window.textra.readFile({ projectId, path: snapshot.path });
  if (disk && !disk.ok) return disk;
  const original = capture ?? (disk?.ok ? disk.value : null);
  if (!original) throw new Error('The document is no longer available.');
  const result = await window.textra.restoreFileHistorySnapshot({
    projectId,
    path: snapshot.path,
    snapshotId: snapshot.id,
    expectedRevision: original.revision,
    recoveryBuffer: original.content,
  });
  if (!result.ok || !capture || !documentSessions.owns(capture)) return result;
  const unchanged = documentSessions.matches(capture);
  useWorkspace.setState((state) => ({
    documents: state.documents.map((document) =>
      document.projectId === projectId && document.path === snapshot.path
        ? {
            ...document,
            ...(unchanged ? { content: result.value.content } : {}),
            savedContent: result.value.content,
            revision: result.value.revision,
            conflict: false,
            externalState: null,
          }
        : document,
    ),
  }));
  return result;
}
