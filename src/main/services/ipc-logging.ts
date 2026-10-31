/** Expected cancellations and reference misses are normal control flow, not warnings. */
export function shouldLogIpcFailure(channel: string, code: string): boolean {
  const expectedCompletionStop =
    (channel === 'textra:ai:completion:request' || channel === 'textra:ai:inline-edit:request') &&
    (code === 'AI_CANCELLED' || code === 'AI_BUSY');
  const expectedWorkspaceStop = [
    'LANGUAGE_CANCELLED',
    'WATCH_CANCELLED',
    'WORKSPACE_BUSY',
    'APP_CLOSING',
  ].includes(code);
  const expectedMissingReference =
    (channel === 'textra:file:read-reference-candidate' ||
      channel === 'textra:pdf:read-project-candidate') &&
    code === 'NOT_FOUND';
  return !expectedCompletionStop && !expectedWorkspaceStop && !expectedMissingReference;
}
