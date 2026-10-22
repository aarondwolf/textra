import { AGENT_SOURCE_LIMIT } from '../../shared/ai';
import { AIError } from './ai-service';

/**
 * In-memory staging buffer and validated text operations for the assistant's document tools.
 * Nothing here writes files, mutates Monaco, or knows about providers: SDK tool handlers call
 * these operations, and user approval later applies the staged result.
 */

/** A tool error the model may correct within the same bounded run. */
export class CorrectableToolError extends Error {}
function correct(message: string): never {
  throw new CorrectableToolError(message);
}
export function invalidOperation(
  message = 'The proposed text operation was invalid. No change was applied.',
): never {
  throw new AIError('AI_AGENT_ARGUMENT', message);
}
export function agentLimit(reason: string): never {
  throw new AIError(
    'AI_AGENT_LIMIT',
    `The assistant reached ${reason}. No changes were applied. Try a smaller request or choose another model.`,
  );
}
function exact(value: Record<string, unknown>, fields: string[]): boolean {
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

export interface StagedLine {
  line: number;
  offset: number;
  text: string;
  endColumn: number;
}
export function linesOf(text: string): StagedLine[] {
  let offset = 0;
  return text.split('\n').map((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const entry = { line: index + 1, offset, text: line, endColumn: Array.from(line).length + 1 };
    offset += raw.length + 1;
    return entry;
  });
}

export type EditToolName = 'insert_text' | 'replace_range' | 'delete_range';

/** Validates one edit against the staged text and returns the next staged text. */
export function applyStagedEdit(
  staged: string,
  name: EditToolName,
  args: Record<string, unknown>,
  read: boolean,
): string {
  const forms =
    name === 'insert_text'
      ? [
          ['line', 'column', 'text'],
          ['offset', 'text'],
        ]
      : name === 'replace_range'
        ? [
            ['expected', 'text'],
            ['start', 'end', 'expected', 'text'],
          ]
        : [['expected'], ['start', 'end', 'expected']];
  const known = new Set(forms.flat());
  if (Object.keys(args).some((key) => !known.has(key))) invalidOperation();
  if (!forms.some((fields) => exact(args, fields)))
    correct(
      'Use insert_text with line/column/text, replace_range with expected/text, or delete_range with expected text. Do not mix addressing forms.',
    );
  if (!read) correct('The active document snapshot is unavailable. Read the current staged text.');
  if (name !== 'delete_range' && (typeof args.text !== 'string' || !args.text))
    correct(
      'Provide non-empty text for an insertion or replacement. Use delete_range to remove text.',
    );
  let start: number;
  let end: number;
  if (name === 'insert_text' && 'line' in args) {
    if (
      typeof args.line !== 'number' ||
      !Number.isInteger(args.line) ||
      typeof args.column !== 'number' ||
      !Number.isInteger(args.column)
    )
      correct('Line and column must be 1-based integers.');
    const row = linesOf(staged)[args.line - 1];
    if (!row) correct(`Line ${args.line} does not exist. Read the current staged line table.`);
    if (args.column < 1 || args.column > row.endColumn)
      correct(
        `Line ${args.line} allows columns 1 through ${row.endColumn}. Use column ${row.endColumn} to append, or column 1 to prepend. Do not repeat the invalid column.`,
      );
    start =
      row.offset +
      Array.from(row.text)
        .slice(0, args.column - 1)
        .join('').length;
    end = start;
  } else if (name !== 'insert_text' && !('start' in args)) {
    if (typeof args.expected !== 'string' || !args.expected)
      correct('Provide exact non-empty expected text from the active document snapshot.');
    start = staged.indexOf(args.expected);
    if (start < 0)
      correct('Expected text was not found. Copy an exact substring from current staged text.');
    if (staged.indexOf(args.expected, start + 1) !== -1)
      correct('Expected text is ambiguous. Include surrounding text so it occurs exactly once.');
    end = start + args.expected.length;
  } else {
    const first = name === 'insert_text' ? args.offset : args.start;
    const last = name === 'insert_text' ? args.offset : args.end;
    if (
      typeof first !== 'number' ||
      !Number.isInteger(first) ||
      typeof last !== 'number' ||
      !Number.isInteger(last) ||
      first < 0 ||
      last < first ||
      last > staged.length
    )
      correct(
        'Use valid integer UTF-16 offsets, or prefer line/column insertion or exact expected-text addressing.',
      );
    start = first;
    end = last;
  }
  if (
    name !== 'insert_text' &&
    (start === end ||
      typeof args.expected !== 'string' ||
      !args.expected ||
      staged.slice(start, end) !== args.expected ||
      (name === 'replace_range' && args.expected === args.text))
  )
    correct('The range must exactly match non-empty expected text; replacements must change it.');
  for (const offset of [start, end])
    if (
      offset > 0 &&
      /[\uD800-\uDBFF]/.test(staged[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(staged[offset] ?? '')
    )
      correct(
        'The position splits a Unicode character. Use line/column or expected-text addressing.',
      );
  const next =
    staged.slice(0, start) + (name === 'delete_range' ? '' : args.text) + staged.slice(end);
  if (next.length > AGENT_SOURCE_LIMIT) agentLimit('the 64,000-character document limit');
  return next;
}

export type StagedToolResult = Record<string, unknown>;

/**
 * The staging buffer for one assistant request. It starts from the captured document snapshot
 * and only ever changes in memory.
 */
export class StagingBuffer {
  private text: string;
  // Agent mode sends the captured active document with the user's request, so edits can begin
  // after the first model response instead of spending a separate round trip reading it.
  private hasRead = true;
  constructor(readonly original: string) {
    this.text = original;
  }
  get staged(): string {
    return this.text;
  }
  get changed(): boolean {
    return this.text !== this.original;
  }
  read(): StagedToolResult {
    this.hasRead = true;
    const lines = linesOf(this.text);
    return {
      text: this.text,
      lines: lines.slice(0, 2000),
      totalLines: lines.length,
      lineTableTruncated: lines.length > 2000,
    };
  }
  /** Applies an edit, returning a recoverable error result instead of throwing for model mistakes. */
  edit(name: EditToolName, args: unknown): StagedToolResult {
    if (!args || typeof args !== 'object' || Array.isArray(args)) invalidOperation();
    try {
      this.text = applyStagedEdit(this.text, name, args as Record<string, unknown>, this.hasRead);
      return { staged: true, length: this.text.length };
    } catch (error) {
      if (!(error instanceof CorrectableToolError)) throw error;
      return {
        error: {
          code: 'INVALID_TEXT_OPERATION',
          message: error.message.slice(0, 500),
          recoverable: true,
        },
        staged: false,
      };
    }
  }
}
