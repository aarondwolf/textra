/** Visual offsets are UTF-16 offsets in the LF-normalized Monaco text. */
export interface VisualSourceEdit {
  from: number;
  to: number;
  insert: string;
}

export interface SourcePosition {
  lineNumber: number;
  column: number;
}

export function positionAtLfOffset(text: string, offset: number): SourcePosition {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    throw new RangeError('Invalid visual source offset');
  let lineNumber = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (text.charCodeAt(index) === 10) {
      lineNumber++;
      lineStart = index + 1;
    }
  }
  return { lineNumber, column: offset - lineStart + 1 };
}

/** Reject overlapping or out-of-bounds edits before touching the authoritative model. */
export function validateVisualEdits(text: string, edits: readonly VisualSourceEdit[]): boolean {
  let previousEnd = 0;
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < previousEnd ||
      edit.to < edit.from ||
      edit.to > text.length ||
      typeof edit.insert !== 'string'
    )
      return false;
    previousEnd = edit.to;
  }
  return true;
}
