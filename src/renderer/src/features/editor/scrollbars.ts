import type { editor } from 'monaco-editor';

/** Monaco draws its own scrollbars rather than using the shared native CSS. */
export const minimalEditorScrollbars: editor.IEditorScrollbarOptions = {
  verticalScrollbarSize: 5,
  horizontalScrollbarSize: 5,
  verticalHasArrows: false,
  horizontalHasArrows: false,
  useShadows: false,
};
