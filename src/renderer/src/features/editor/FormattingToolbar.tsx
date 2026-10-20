import { useState } from 'react';
import {
  CaretDown,
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

export default function FormattingToolbar({ disabled }: { disabled: boolean }) {
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
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
    </div>
  );
}
