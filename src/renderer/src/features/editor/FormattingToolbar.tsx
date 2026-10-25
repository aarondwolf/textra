import {
  EyeSlash,
  FilePlus,
  FloppyDiskBack,
  TextAlignLeft,
  FilePdf,
  ImageSquare,
  ListBullets,
  ListNumbers,
  Table,
  TextB,
  TextItalic,
} from '@phosphor-icons/react';
import { MarkdownLogo } from '../../icons';
import { DropdownMenu } from '../../components/DropdownMenu';
import { TooltipButton } from '../../components/Button';

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
  formattingDisabled = disabled,
  hasPdf = false,
  isMarkdown = false,
  onOpenPdf,
  onOpenMarkdown,
  onHide,
  onSave,
  saveDisabled = false,
  onSaveAs,
  fontSize,
  onFontSizeChange,
  wrap,
  onToggleWrap,
}: {
  disabled: boolean;
  formattingDisabled?: boolean;
  hasPdf?: boolean;
  isMarkdown?: boolean;
  onOpenPdf?: () => void;
  onOpenMarkdown?: () => void;
  onHide: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  onSaveAs?: () => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
  wrap?: boolean;
  onToggleWrap?: () => void;
}) {
  return (
    <div className="editor-format-toolbar" role="toolbar" aria-label="LaTeX formatting">
      <TooltipButton
        type="button"
        aria-label="Bold"
        title="Bold (\\textbf)"
        disabled={formattingDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'bold' })}
      >
        <TextB size={15} weight="bold" />
      </TooltipButton>
      <TooltipButton
        type="button"
        aria-label="Italic"
        title="Italic (\\textit)"
        disabled={formattingDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'italic' })}
      >
        <TextItalic size={15} />
      </TooltipButton>
      <span className="editor-format-separator" aria-hidden="true" />
      <TooltipButton
        type="button"
        aria-label="Numbered list"
        title="Numbered list (enumerate)"
        disabled={formattingDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'enumerate' })}
      >
        <ListNumbers size={15} />
      </TooltipButton>
      <TooltipButton
        type="button"
        aria-label="Bulleted list"
        title="Bulleted list (itemize)"
        disabled={formattingDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'itemize' })}
      >
        <ListBullets size={15} />
      </TooltipButton>
      <span className="editor-format-separator" aria-hidden="true" />
      <TooltipButton
        type="button"
        aria-label="Insert figure"
        title="Insert figure"
        disabled={formattingDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'figure' })}
      >
        <ImageSquare size={15} />
      </TooltipButton>
      <TooltipButton
        type="button"
        aria-label="Insert table"
        title="Insert table"
        disabled={formattingDisabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => dispatch({ command: 'table' })}
      >
        <Table size={15} />
      </TooltipButton>
      <span className="editor-format-separator" aria-hidden="true" />
      <DropdownMenu
        ariaLabel="Insert heading"
        title="Insert heading"
        placeholder="Heading"
        fullWidth={false}
        disabled={formattingDisabled}
        preventFocusSteal={true}
        items={[
          {
            value: '1',
            label: 'Section',
            onClick: () => dispatch({ command: 'heading', level: 1 }),
          },
          {
            value: '2',
            label: 'Subsection',
            onClick: () => dispatch({ command: 'heading', level: 2 }),
          },
          {
            value: '3',
            label: 'Subsubsection',
            onClick: () => dispatch({ command: 'heading', level: 3 }),
          },
          {
            value: '4',
            label: 'Paragraph',
            onClick: () => dispatch({ command: 'heading', level: 4 }),
          },
          {
            value: '5',
            label: 'Subparagraph',
            onClick: () => dispatch({ command: 'heading', level: 5 }),
          },
        ]}
      />
      <span className="editor-format-spacer" />
      {onSave && (
        <TooltipButton
          type="button"
          aria-label="Save file"
          title="Save (Ctrl/Cmd+S)"
          disabled={disabled || saveDisabled}
          onClick={onSave}
        >
          <FloppyDiskBack size={15} />
        </TooltipButton>
      )}
      {onSaveAs && (
        <TooltipButton
          type="button"
          aria-label="Save file as"
          title="Save as…"
          disabled={disabled}
          onClick={onSaveAs}
        >
          <FilePlus size={15} />
        </TooltipButton>
      )}
      {typeof fontSize === 'number' && onFontSizeChange && (
        <DropdownMenu
          ariaLabel="Editor font size"
          title="Editor font size"
          className="editor-format-font-size"
          fullWidth={false}
          value={String(fontSize)}
          items={[...new Set([12, 14, 16, 18, 20, 24, fontSize])]
            .sort((a, b) => a - b)
            .map((size) => ({ value: String(size), label: `${size}px` }))}
          onChange={(value) => onFontSizeChange(Number(value))}
        />
      )}
      {onToggleWrap && (
        <TooltipButton
          className="editor-format-wrap-control"
          type="button"
          aria-label="Toggle word wrap"
          title={`Word wrap ${wrap ? 'on' : 'off'}`}
          aria-pressed={wrap}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleWrap}
        >
          <TextAlignLeft size={15} />
        </TooltipButton>
      )}
      {isMarkdown ? (
        <TooltipButton
          type="button"
          className="editor-format-pdf"
          aria-label="View Markdown preview"
          title="View Markdown preview"
          disabled={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenMarkdown}
        >
          <MarkdownLogo size={15} />
        </TooltipButton>
      ) : (
        <TooltipButton
          type="button"
          className="editor-format-pdf"
          aria-label="View PDF in preview"
          title={hasPdf ? 'View compiled PDF in Preview' : 'No compiled PDF found'}
          disabled={disabled || !hasPdf}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenPdf}
        >
          <FilePdf size={15} />
        </TooltipButton>
      )}
      <TooltipButton
        type="button"
        className="editor-format-hide"
        aria-label="Hide formatting toolbar"
        title="Hide formatting toolbar"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onHide}
      >
        <EyeSlash size={15} aria-hidden="true" />
      </TooltipButton>
    </div>
  );
}
