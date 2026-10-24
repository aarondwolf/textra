import { diffLines } from 'diff';

export interface AIEditHunk {
  id: string;
  start: number;
  end: number;
  text: string;
}

/** Deterministic line hunks shared by review and main; work/memory stays bounded. */
export function agentEditHunks(original: string, modified: string): AIEditHunk[] {
  if (original === modified) return [];
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const before = lines(original);
  const after = lines(modified);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  let lastBefore = before.length;
  let lastAfter = after.length;
  while (
    lastBefore > prefix &&
    lastAfter > prefix &&
    before[lastBefore - 1] === after[lastAfter - 1]
  ) {
    lastBefore--;
    lastAfter--;
  }

  const offsets = [0];
  for (const line of before) offsets.push(offsets[offsets.length - 1] + line.length);
  const rows = lastBefore - prefix;
  const columns = lastAfter - prefix;
  const hunks: AIEditHunk[] = [];

  const add = (start: number, end: number, text: string) => {
    if (start !== end || text) hunks.push({ id: `hunk-${hunks.length + 1}`, start, end, text });
  };

  if ((rows + 1) * (columns + 1) > 250_000) {
    add(offsets[prefix], offsets[lastBefore], after.slice(prefix, lastAfter).join(''));
    return hunks;
  }

  const trimmedBefore = before.slice(prefix, lastBefore).join('');
  const trimmedAfter = after.slice(prefix, lastAfter).join('');
  const changes = diffLines(trimmedBefore, trimmedAfter);

  let currentOffset = offsets[prefix];
  let currentStart = -1;
  let currentRemovedLength = 0;
  let currentAddedText = '';

  for (const part of changes) {
    if (part.added) {
      if (currentStart === -1) {
        currentStart = currentOffset;
      }
      currentAddedText += part.value;
    } else if (part.removed) {
      if (currentStart === -1) {
        currentStart = currentOffset;
      }
      currentRemovedLength += part.value.length;
      currentOffset += part.value.length;
    } else {
      if (currentStart !== -1) {
        add(currentStart, currentStart + currentRemovedLength, currentAddedText);
        currentStart = -1;
        currentRemovedLength = 0;
        currentAddedText = '';
      }
      currentOffset += part.value.length;
    }
  }

  if (currentStart !== -1) {
    add(currentStart, currentStart + currentRemovedLength, currentAddedText);
  }

  return hunks;
}

/** Only complete, named proposal hunks can be included; no arbitrary replacement text. */
export function applyAgentHunks(original: string, hunks: AIEditHunk[], ids: string[]): string {
  const selected = new Set(ids);
  const available = new Set(hunks.map((hunk) => hunk.id));
  if (!ids.length || selected.size !== ids.length || ids.some((id) => !available.has(id)))
    throw new Error('Choose valid proposal changes.');
  let result = original;
  for (const hunk of [...hunks].reverse())
    if (selected.has(hunk.id))
      result = result.slice(0, hunk.start) + hunk.text + result.slice(hunk.end);
  return result;
}
