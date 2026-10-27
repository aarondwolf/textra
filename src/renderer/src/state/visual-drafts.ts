/** Recovery drafts are separate from the canonical model and must not be discarded silently. */
const drafts = new Set<string>();
const key = (projectId: string, path: string) => `${projectId}\0${path}`;

export function setVisualDraft(projectId: string, path: string, present: boolean): void {
  if (present) drafts.add(key(projectId, path));
  else drafts.delete(key(projectId, path));
}

export function hasVisualDraft(projectId: string, path: string): boolean {
  return drafts.has(key(projectId, path));
}

export function hasAnyVisualDraft(): boolean {
  return drafts.size > 0;
}
