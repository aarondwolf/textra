import { useRef, useState } from 'react';
import {
  CaretDown,
  EyeSlash,
  FilePdf,
  FileText,
  ImageSquare,
  ListBullets,
  ListNumbers,
  Table,
  TextB,
  TextItalic,
} from '@phosphor-icons/react';

type FormatCommand = 'bold' | 'italic' | 'enumerate' | 'itemize' | 'figure' | 'table' | 'heading';

interface FormatRequest {
  command: FormatCommand;
  level?: 1 | 2 | 3 | 4 | 5;
}

function dispatch(request: FormatRequest): void {
  window.dispatchEvent(new CustomEvent<FormatRequest>('textra:format-source', { detail: request }));
}

export default function FormattingToolbar({
  disabled,
  hasPdf = false,
  isMarkdown = false,
  onOpenPdf,
  onOpenMarkdown,
  onHide,
}: {
  disabled: boolean;
  hasPdf?: boolean;
  isMarkdown?: boolean;
  onOpenPdf?: () => void;
  onOpenMarkdown?: () => void;
  onHide: () => void;
}) {
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
  const closeMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelCloseMenu = () => {
    if (closeMenuTimer.current) clearTimeout(closeMenuTimer.current);
  };
  const scheduleCloseMenu = () => {
    cancelCloseMenu();
    closeMenuTimer.current = setTimeout(() => setHeadingMenuOpen(false), 140);
  };
  return (
    <div className="editor-format-toolbar" role="toolbar" aria-label="LaTeX formatting">
      <button
        type="button"
        aria-label="Bold"
        title="Bold (\\textbf)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'bold' })}
      >
        <TextB size={15} weight="bold" />
      </button>
      <button
        type="button"
        aria-label="Italic"
        title="Italic (\\textit)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'italic' })}
      >
        <TextItalic size={15} />
      </button>
      <span className="editor-format-separator" aria-hidden="true" />
      <button
        type="button"
        aria-label="Numbered list"
        title="Numbered list (enumerate)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'enumerate' })}
      >
        <ListNumbers size={15} />
      </button>
      <button
        type="button"
        aria-label="Bulleted list"
        title="Bulleted list (itemize)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'itemize' })}
      >
        <ListBullets size={15} />
      </button>
      <span className="editor-format-separator" aria-hidden="true" />
      <button
        type="button"
        aria-label="Insert figure"
        title="Insert figure"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'figure' })}
      >
        <ImageSquare size={15} />
      </button>
      <button
        type="button"
        aria-label="Insert table"
        title="Insert table"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'table' })}
      >
        <Table size={15} />
      </button>
      <span className="editor-format-separator" aria-hidden="true" />
      <div
        className="editor-format-heading"
        onMouseEnter={cancelCloseMenu}
        onMouseLeave={scheduleCloseMenu}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHeadingMenuOpen(false);
        }}
      >
        <button
          type="button"
          className="editor-format-heading-trigger"
          aria-label="Insert heading"
          aria-haspopup="menu"
          aria-expanded={headingMenuOpen}
          title="Insert heading"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setHeadingMenuOpen((open) => !open)}
        >
          Heading <CaretDown size={11} aria-hidden="true" />
        </button>
        {headingMenuOpen && (
          <div className="editor-format-heading-menu" role="menu" aria-label="Heading levels">
            {[
              ['Section', 1],
              ['Subsection', 2],
              ['Subsubsection', 3],
              ['Paragraph', 4],
              ['Subparagraph', 5],
            ].map(([label, level]) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  dispatch({ command: 'heading', level: level as 1 | 2 | 3 | 4 | 5 });
                  setHeadingMenuOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="editor-format-spacer" />
      {isMarkdown ? (
        <button
          type="button"
          className="editor-format-pdf"
          aria-label="View Markdown preview"
          title="View Markdown preview"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenMarkdown}
        >
          <FileText size={15} />
        </button>
      ) : (
        <button
          type="button"
          className="editor-format-pdf"
          aria-label="View PDF in preview"
          title={hasPdf ? 'View compiled PDF in Preview' : 'No compiled PDF found'}
          disabled={disabled || !hasPdf}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenPdf}
        >
          <FilePdf size={15} />
        </button>
      )}
      <button
        type="button"
        className="editor-format-hide"
        aria-label="Hide formatting toolbar"
        title="Hide formatting toolbar"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onHide}
      >
        <EyeSlash size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
