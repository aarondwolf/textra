import { AppTooltip } from '../../components/HelpTooltip';
import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ResizableSeparator } from '../../components/ResizableSeparator';
import { PanelState } from '../../components/PanelState';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  NotePencil,
  Scroll,
  TextIndent,
  WarningCircle,
} from '../../icons';
import './writing.css';

/** One heading in the active document's source outline. Lines are one-based. */
export interface WritingOutlineItem {
  id: string;
  title: string;
  line: number;
  level: number;
}

/** A source annotation found while scanning the active document. Lines are one-based. */
export interface WritingTodoItem {
  id: string;
  line: number;
  kind: 'TODO' | 'FIXME';
  text: string;
}

/** Counts are intentionally supplied by the caller so the panel stays renderer-only. */
export interface WritingSummary {
  words: number;
  characters: number;
  sections: number;
  equations: number;
  figures: number;
  tables: number;
  citations: number;
  outline: WritingOutlineItem[];
  todos: WritingTodoItem[];
}

export interface WritingPanelProps {
  summary: WritingSummary;
  /** The active source line, used to highlight the containing outline heading. */
  activeLine: number | null;
  onJumpToLine: (line: number) => void;
  /** Opens a safe latexindent preview; the workspace owns formatting and applying changes. */
  onFormatDocument?: () => void;
  formatAvailable?: boolean;
  /** Reorders a section in the document source by moving it before or after another section. */
  onMoveSection?: (fromIndex: number, toIndex: number, position: 'before' | 'after') => void;
}

function activeOutlineId(outline: WritingOutlineItem[], line: number | null): string | null {
  if (line === null || line < 1) return null;
  let active: WritingOutlineItem | undefined;
  for (const item of outline) {
    if (item.line <= line) active = item;
    else break;
  }
  return active?.id ?? null;
}

interface SortableOutlineItemProps {
  item: WritingOutlineItem;
  index: number;
  total: number;
  activeId: string | null;
  onMoveSection?: (fromIndex: number, toIndex: number, position: 'before' | 'after') => void;
  onJumpToLine: (line: number) => void;
}

function SortableOutlineItem({
  item,
  index,
  total,
  activeId,
  onMoveSection,
  onJumpToLine,
}: SortableOutlineItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !onMoveSection,
  });

  const depth = Math.min(Math.max(0, item.level - 1), 4);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`writing-outline-row ${isDragging ? 'is-dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <AppTooltip
        content={`Go to line ${item.line}${onMoveSection ? ' (drag or use arrow keys to reorder)' : ''}`}
      >
        <button
          type="button"
          className="writing-outline-item"
          aria-current={item.id === activeId ? 'location' : undefined}
          style={{ paddingLeft: 10 + depth * 12 }}

          onClick={() => onJumpToLine(item.line)}
        >
          <span>{item.title}</span>
          <small className="writing-outline-line">Ln {item.line}</small>
        </button>
      </AppTooltip>
      {onMoveSection && (
        <div className="writing-outline-actions" role="group" aria-label="Reorder section">
          <AppTooltip content={'Move section up'}>
            <span className="tooltip-disabled-trigger">
              <button
                type="button"
                className="writing-outline-action-button"

                aria-label="Move section up"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveSection(index, index - 1, 'before');
                }}
              >
                <ChevronUp size={11} aria-hidden="true" />
              </button>
            </span>
          </AppTooltip>
          <AppTooltip content={'Move section down'}>
            <span className="tooltip-disabled-trigger">
              <button
                type="button"
                className="writing-outline-action-button"

                aria-label="Move section down"
                disabled={index === total - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveSection(index, index + 1, 'after');
                }}
              >
                <ChevronDown size={11} aria-hidden="true" />
              </button>
            </span>
          </AppTooltip>
        </div>
      )}
    </li>
  );
}

/**
 * Compact, source-agnostic writing utilities for an active LaTeX document.
 * Includes Outline and Notes in two collapsible, vertically-resizable panes.
 */
export function WritingPanel({
  summary,
  activeLine,
  onJumpToLine,
  onFormatDocument,
  formatAvailable = false,
  onMoveSection,
}: WritingPanelProps) {
  const activeId = activeOutlineId(summary.outline, activeLine);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [notesHeight, setNotesHeight] = useState(130);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleOutlineDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (onMoveSection && over && active.id !== over.id) {
      const oldIndex = summary.outline.findIndex((i) => i.id === active.id);
      const newIndex = summary.outline.findIndex((i) => i.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onMoveSection(oldIndex, newIndex, oldIndex < newIndex ? 'after' : 'before');
      }
    }
  };

  return (
    <div className="writing-panel">
      <div className="sidebar-title writing-title">
        <span className="sidebar-heading">Writing</span>
        <div className="writing-header-actions">
          <AppTooltip
            content={
              formatAvailable
                ? 'Format document with latexindent'
                : 'latexindent is not available. Install it to format LaTeX.'
            }
          >
            <span className="tooltip-disabled-trigger">
              <button
                type="button"
                className="icon-button small writing-header-button"
                aria-label="Format document with latexindent"

                disabled={!onFormatDocument || !formatAvailable}
                onClick={onFormatDocument}
              >
                <TextIndent size={14} aria-hidden="true" />
              </button>
            </span>
          </AppTooltip>
        </div>
      </div>

      <div className="writing-content">
        {/* Section 1: Outline */}
        <CollapsibleSection
          className="writing-section writing-outline-section"
          title="Outline"
          id="writing-outline-heading"
          icon={<Scroll size={13} aria-hidden="true" />}
          count={summary.outline.length}
          open={outlineOpen}
          onOpenChange={setOutlineOpen}
          headerClassName="writing-section-toggle"
          headerRowClassName="writing-section-header-row"
          bodyClassName="writing-section-body"
          style={{
            flex: outlineOpen ? '1 1 0' : '0 0 32px',
            height: outlineOpen ? undefined : '32px',
            minHeight: outlineOpen ? '60px' : '32px',
          }}
        >
          {outlineOpen && (
            <>
              {summary.outline.length === 0 ? (
                <PanelState className="writing-empty" title="No section headings yet" />
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleOutlineDragEnd}
                >
                  <SortableContext
                    items={summary.outline.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="writing-list">
                      {summary.outline.map((item, index) => (
                        <SortableOutlineItem
                          key={item.id}
                          item={item}
                          index={index}
                          total={summary.outline.length}
                          activeId={activeId}
                          onMoveSection={onMoveSection}
                          onJumpToLine={onJumpToLine}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Resizer Splitter between Outline and Notes */}
        {outlineOpen && notesOpen && (
          <ResizableSeparator
            orientation="horizontal"
            className="writing-resizer"
            label="Notes height"
            value={notesHeight}
            min={70}
            max={450}
            defaultValue={130}
            step={16}
            title="Drag or use arrow keys to resize Outline and Notes"
            onResize={setNotesHeight}
            computeValueFromPointer={(event, start) => {
              return start.value + (start.y - event.clientY);
            }}
          />
        )}

        {/* Section 2: Notes */}
        <CollapsibleSection
          className="writing-section writing-todos-section"
          title="Notes"
          id="writing-todos-heading"
          icon={<NotePencil size={13} aria-hidden="true" />}
          count={summary.todos.length}
          open={notesOpen}
          onOpenChange={setNotesOpen}
          headerClassName="writing-section-toggle"
          bodyClassName="writing-section-body"
          headerRowClassName="writing-section-header-row"
          style={{
            height: notesOpen ? (outlineOpen ? `${notesHeight}px` : undefined) : '32px',
            flex: notesOpen ? (outlineOpen ? `0 0 ${notesHeight}px` : '1 1 0') : '0 0 32px',
            minHeight: notesOpen ? '60px' : '32px',
          }}
          bodyStyle={{ height: '100%' }}
        >
          {notesOpen && (
            <>
              {summary.todos.length === 0 ? (
                <PanelState className="writing-empty" title="No % TODO or % FIXME notes" />
              ) : (
                <ul className="writing-list">
                  {summary.todos.map((item) => (
                    <li key={item.id}>
                      <AppTooltip content={`Go to ${item.kind} on line ${item.line}`}>
                        <button
                          type="button"
                          className={`writing-todo-item is-${item.kind.toLowerCase()}`}

                          onClick={() => onJumpToLine(item.line)}
                        >
                          {item.kind === 'TODO' && (
                            <ListChecks className="todo-icon" size={13} aria-hidden="true" />
                          )}
                          {item.kind === 'FIXME' && (
                            <WarningCircle className="fixme-icon" size={13} aria-hidden="true" />
                          )}
                          <span className={'writing-tag ' + item.kind.toLowerCase()}>
                            {item.kind}
                          </span>
                          <span className="writing-todo-text">
                            {item.text || `${item.kind} on line ${item.line}`}
                          </span>
                          <small>Ln {item.line}</small>
                        </button>
                      </AppTooltip>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}
