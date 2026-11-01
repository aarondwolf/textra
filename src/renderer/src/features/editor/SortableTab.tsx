import * as ContextMenu from '@radix-ui/react-context-menu';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppTooltip } from '../../components/HelpTooltip';
import { useOverlayZIndex } from '../../components/overlay-layers';
import { FileText, Warning, X } from '../../icons';

interface SortableTabProps {
  document: {
    path: string;
    conflict?: boolean;
  };
  index: number;
  total: number;
  activePath: string | null;
  previewPath: string | null;
  savedTabPath: string | null;
  tabCloseButtons: 'always' | 'hover';
  isDirty: boolean;
  hasSavedTabs: boolean;
  project: { id: string; name: string } | null;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseSaved: () => void;
  onViewHistory: () => void;
  onReveal: () => void;
  onCopyRelativePath: () => void;
}

export function SortableTab({
  document,
  index,
  total,
  activePath,
  previewPath,
  savedTabPath,
  tabCloseButtons,
  isDirty,
  hasSavedTabs,
  project,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseSaved,
  onViewHistory,
  onReveal,
  onCopyRelativePath,
}: SortableTabProps) {
  const floatingZIndex = useOverlayZIndex('floating');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: document.path,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <ContextMenu.Root key={document.path}>
      <ContextMenu.Trigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={`document-tab ${document.path === activePath ? 'selected' : ''}${document.path === previewPath ? ' preview-tab' : ''}${savedTabPath === document.path ? ' tab-saved-pulse' : ''}${isDragging ? ' is-dragging' : ''}`}
          data-close-buttons={tabCloseButtons}
          {...attributes}
          {...listeners}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose();
            }
          }}
        >
          <AppTooltip content={document.path}>
            <button
              role="tab"
              aria-label={`Edit ${document.path}`}
              aria-selected={document.path === activePath}
              onClick={onSelect}
            >
              <FileText size={13} />
              <span>{document.path.split('/').at(-1)}</span>
              <span
                className={`dirty-dot ${isDirty ? 'is-dirty' : ''}`}
                aria-label={isDirty ? 'Unsaved changes' : undefined}
              />
              {document.conflict && <Warning size={12} aria-label="External change conflict" />}
            </button>
          </AppTooltip>
          <button
            className="tab-close"
            aria-label={`Close ${document.path}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X size={12} />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="file-menu tab-context-menu"
          role="menu"
          aria-label={'Tab actions for ' + document.path}
          style={{ zIndex: floatingZIndex }}
        >
          <div className="file-menu-name">{document.path.split('/').at(-1)}</div>
          <ContextMenu.Item role="menuitem" onSelect={onClose}>
            Close
          </ContextMenu.Item>
          <ContextMenu.Item role="menuitem" disabled={total <= 1} onSelect={onCloseOthers}>
            Close Other Tabs
          </ContextMenu.Item>
          <ContextMenu.Item role="menuitem" disabled={index >= total - 1} onSelect={onCloseToRight}>
            Close Tabs to the Right
          </ContextMenu.Item>
          <ContextMenu.Item role="menuitem" disabled={!hasSavedTabs} onSelect={onCloseSaved}>
            Close Saved Tabs
          </ContextMenu.Item>
          <ContextMenu.Item role="menuitem" onSelect={onViewHistory}>
            View File History
          </ContextMenu.Item>
          <ContextMenu.Item role="menuitem" onSelect={onCopyRelativePath}>
            Copy Relative Path
          </ContextMenu.Item>
          {project && (
            <ContextMenu.Item role="menuitem" onSelect={onReveal}>
              Open in File Explorer
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
