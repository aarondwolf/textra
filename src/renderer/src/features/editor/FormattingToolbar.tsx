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
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useLayoutEffect, useRef, useState } from 'react';
import type { TexEditorMode } from '../../../../shared/api';
import { Ellipsis, MarkdownLogo } from '../../icons';
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
  texEditorMode,
  onTexEditorModeChange,
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
  texEditorMode?: TexEditorMode;
  onTexEditorModeChange?: (mode: TexEditorMode) => void;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const hasSave = Boolean(onSave);
  const hasSaveAs = Boolean(onSaveAs);
  const hasFontSize = typeof fontSize === 'number' && Boolean(onFontSizeChange);
  const hasWrap = Boolean(onToggleWrap);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const actions = actionsRef.current;
    const fixed = fixedRef.current;
    if (!toolbar || !actions || !fixed) return;
    const measure = () => {
      const style = getComputedStyle(toolbar);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      const available = toolbar.clientWidth - padding - fixed.offsetWidth - gap;
      setCollapsed(actions.scrollWidth > available + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(actions);
    observer.observe(fixed);
    for (const child of actions.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [hasSave, hasSaveAs, hasFontSize, hasWrap]);

  const fontSizes = [...new Set([12, 14, 16, 18, 20, 24, ...(fontSize ? [fontSize] : [])])].sort(
    (a, b) => a - b,
  );

  return (
    <div
      ref={toolbarRef}
      className="editor-format-toolbar"
      role="toolbar"
      aria-label="LaTeX formatting"
    >
      <div
        ref={actionsRef}
        className={`editor-format-actions${collapsed ? ' is-collapsed' : ''}`}
        aria-hidden={collapsed || undefined}
        inert={collapsed}
      >
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
            items={fontSizes.map((size) => ({ value: String(size), label: `${size}px` }))}
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
      </div>
      {collapsed && (
        <DropdownMenu
          ariaLabel="More formatting actions"
          title="More formatting actions"
          className="editor-format-overflow"
          mode="actions"
          customTrigger={
            <TooltipButton
              type="button"
              className="editor-format-overflow-button"
              aria-label="More formatting actions"
              title="More formatting actions"
              onMouseDown={(event) => event.preventDefault()}
            >
              <Ellipsis size={16} />
            </TooltipButton>
          }
          items={[
            {
              group: 'Formatting',
              items: [
                {
                  value: 'bold',
                  label: 'Bold',
                  disabled: formattingDisabled,
                  onClick: () => dispatch({ command: 'bold' }),
                },
                {
                  value: 'italic',
                  label: 'Italic',
                  disabled: formattingDisabled,
                  onClick: () => dispatch({ command: 'italic' }),
                },
                {
                  value: 'enumerate',
                  label: 'Numbered list',
                  disabled: formattingDisabled,
                  onClick: () => dispatch({ command: 'enumerate' }),
                },
                {
                  value: 'itemize',
                  label: 'Bulleted list',
                  disabled: formattingDisabled,
                  onClick: () => dispatch({ command: 'itemize' }),
                },
                {
                  value: 'figure',
                  label: 'Insert figure',
                  disabled: formattingDisabled,
                  onClick: () => dispatch({ command: 'figure' }),
                },
                {
                  value: 'table',
                  label: 'Insert table',
                  disabled: formattingDisabled,
                  onClick: () => dispatch({ command: 'table' }),
                },
              ],
            },
            {
              group: 'Headings',
              items: (
                ['Section', 'Subsection', 'Subsubsection', 'Paragraph', 'Subparagraph'] as const
              ).map((label, index) => ({
                value: `heading-${index + 1}`,
                label,
                disabled: formattingDisabled,
                onClick: () =>
                  dispatch({ command: 'heading', level: (index + 1) as 1 | 2 | 3 | 4 | 5 }),
              })),
            },
            ...(onSave || onSaveAs
              ? [
                  {
                    group: 'File',
                    items: [
                      ...(onSave
                        ? [
                            {
                              value: 'save',
                              label: 'Save file',
                              disabled: disabled || saveDisabled,
                              onClick: onSave,
                            },
                          ]
                        : []),
                      ...(onSaveAs
                        ? [{ value: 'save-as', label: 'Save file as', disabled, onClick: onSaveAs }]
                        : []),
                    ],
                  },
                ]
              : []),
            ...(typeof fontSize === 'number' && onFontSizeChange
              ? [
                  {
                    group: 'Font size',
                    items: fontSizes.map((size) => ({
                      value: `font-${size}`,
                      label: `${size}px`,
                      description: size === fontSize ? 'Current' : undefined,
                      onClick: () => onFontSizeChange(size),
                    })),
                  },
                ]
              : []),
            ...(onToggleWrap
              ? [
                  {
                    group: 'Editor',
                    items: [
                      {
                        value: 'wrap',
                        label: 'Toggle word wrap',
                        description: wrap ? 'On' : 'Off',
                        onClick: onToggleWrap,
                      },
                    ],
                  },
                ]
              : []),
          ]}
        />
      )}
      <div ref={fixedRef} className="editor-format-fixed">
        {texEditorMode && onTexEditorModeChange && (
          <RadioGroup.Root
            className="editor-mode-control"
            aria-label="Editor mode"
            value={texEditorMode}
            orientation="horizontal"
            onKeyDownCapture={(event) => {
              const mode =
                event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? 'code'
                  : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 'visual'
                    : null;
              if (!mode) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.querySelector<HTMLButtonElement>(`[value="${mode}"]`)?.focus();
              onTexEditorModeChange(mode);
            }}
            onValueChange={(value) => {
              if (value === 'code' || value === 'visual') onTexEditorModeChange(value);
            }}
          >
            <RadioGroup.Item className="editor-mode-option" value="code">
              Code
            </RadioGroup.Item>
            <RadioGroup.Item className="editor-mode-option" value="visual">
              Visual
            </RadioGroup.Item>
          </RadioGroup.Root>
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
    </div>
  );
}
