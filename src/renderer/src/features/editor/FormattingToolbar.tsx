import {
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
      <select
        aria-label="Heading level"
        defaultValue=""
        disabled={disabled}
        onChange={(event) => {
          const level = Number(event.target.value);
          event.target.value = '';
          if (level >= 1 && level <= 5)
            dispatch({ command: 'heading', level: level as 1 | 2 | 3 | 4 | 5 });
        }}
      >
        <option value="">Heading</option>
        <option value="1">Section</option>
        <option value="2">Subsection</option>
        <option value="3">Subsubsection</option>
        <option value="4">Paragraph</option>
        <option value="5">Subparagraph</option>
      </select>
    </div>
  );
}
