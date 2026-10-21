/** The chat prompt reserves this explicit label for a concrete proposed correction. */
export function hasSuggestedFix(source: string): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let fence: { character: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (
        fence.character === marker[0] &&
        marker.length >= fence.length &&
        line.slice(marker.length).trim() === ''
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const label = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*|__/g, '')
      .replace(/\s+#+\s*$/, '');
    const match = /^suggested[ \t]+fix[ \t]*(?::[ \t]*(.*))?$/i.exec(label);
    if (!match) continue;
    if (match[1]?.trim()) return true;
    for (const next of lines.slice(index + 1)) {
      const content = next.trim();
      if (!content || /^(`{3,}|~{3,})/.test(content)) continue;
      if (/^#{1,6}\s+/.test(content) || /^[-*_]{3,}$/.test(content)) break;
      return true;
    }
  }
  return false;
}
