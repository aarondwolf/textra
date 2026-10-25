import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { AppTooltip } from './HelpTooltip';

export interface ResizableSeparatorProps {
  orientation: 'horizontal' | 'vertical';
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue?: number;
  step?: number;
  className?: string;
  title?: string;
  tabIndex?: number;
  onResize: (newValue: number) => void;
  computeValueFromPointer: (
    event: PointerEvent<HTMLDivElement>,
    start: { x: number; y: number; value: number },
  ) => number;
}

/** Accessible, keyboard-navigable split pane resizer with pointer capture and WAI-ARIA separator semantics. */
export function ResizableSeparator({
  orientation,
  label,
  value,
  min,
  max,
  defaultValue,
  step = 16,
  className = orientation === 'vertical' ? 'split-handle' : 'writing-resizer',
  title,
  tabIndex = 0,
  onResize,
  computeValueFromPointer,
}: ResizableSeparatorProps) {
  const dragging = useRef(false);
  const startRef = useRef({ x: 0, y: 0, value: 0 });

  const clamp = (val: number) => Math.round(Math.min(max, Math.max(min, val)));

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    startRef.current = { x: event.clientX, y: event.clientY, value };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute('data-resizing', 'true');
    const nextVal = computeValueFromPointer(event, startRef.current);
    onResize(clamp(nextVal));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const nextVal = computeValueFromPointer(event, startRef.current);
    onResize(clamp(nextVal));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.removeAttribute('data-resizing');
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignored if capture was already released
    }
  };

  const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.removeAttribute('data-resizing');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (orientation === 'vertical') {
      const deltaMap: Record<string, number> = {
        ArrowLeft: value - step,
        ArrowRight: value + step,
        Home: min,
        End: max,
      };
      if (event.key in deltaMap) {
        event.preventDefault();
        onResize(clamp(deltaMap[event.key]));
      }
    } else {
      const deltaMap: Record<string, number> = {
        ArrowUp: value + step,
        ArrowDown: value - step,
        Home: min,
        End: max,
      };
      if (event.key in deltaMap) {
        event.preventDefault();
        onResize(clamp(deltaMap[event.key]));
      }
    }
  };

  const handleDoubleClick = () => {
    if (defaultValue !== undefined) {
      onResize(clamp(defaultValue));
    }
  };

  const separator = (
    <div
      className={className}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={tabIndex}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
    />
  );
  return title ? <AppTooltip content={title}>{separator}</AppTooltip> : separator;
}
