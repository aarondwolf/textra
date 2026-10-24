/** The component owns this lifetime and disposes it on mouseup, restart, or unmount. */
export function beginHistoryResize(
  startY: number,
  initialHeight: number,
  onHeight: (height: number) => void,
): () => void {
  const previousCursor = document.body.style.cursor;
  const previousSelection = document.body.style.userSelect;
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
  let active = true;
  const move = (event: MouseEvent) => {
    if (active) onHeight(Math.max(70, Math.min(450, initialHeight + startY - event.clientY)));
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', dispose);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelection;
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', dispose);
  return dispose;
}
