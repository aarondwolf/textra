import { useState, useEffect } from 'react';
import { DialogShell } from '../../components/DialogShell';
import { Button } from '../../components/Button';
import { X, Check } from '../../icons';
import {
  RECIPE_COMMANDS,
  createDefaultRecipeSettings,
  type RecipeTool,
} from '../../../../shared/recipes';
import {
  ARG_HELP,
  addArg,
  classifyArg,
  isArgOn,
  toggleArg,
  toolKind,
} from '../../../../shared/recipe-help';

interface ToolEditorDialogProps {
  open: boolean;
  tool: RecipeTool | null;
  onSave: (tool: RecipeTool) => void;
  onClose: () => void;
}

export function ToolEditorDialog({ open, tool, onSave, onClose }: ToolEditorDialogProps) {
  const [draft, setDraft] = useState<RecipeTool | null>(null);
  const [customArg, setCustomArg] = useState('');
  const [help, setHelp] = useState('');

  useEffect(() => {
    if (tool) {
      setDraft(structuredClone(tool));
      setCustomArg('');
      setHelp('');
    }
  }, [tool, open]);

  if (!draft) return null;

  const kind = toolKind(draft.command);
  const catalog = ARG_HELP[kind] ?? [];
  const extras = draft.args.filter((arg) => classifyArg(arg, kind) === 'custom');

  function addCustom() {
    const val = customArg.trim();
    if (!val || !draft) return;
    if (draft.args.includes(val)) {
      setCustomArg('');
      return;
    }
    setDraft({ ...draft, args: addArg(draft.args, val) });
    setCustomArg('');
  }

  function handleSave() {
    if (!draft || !draft.name.trim()) return;
    onSave(draft);
    onClose();
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      className="dialog-content tool-editor-modal"
      title={<>Edit Tool: {draft.name}</>}
      description="Configure the program executable and arguments used when executing this step."
    >
      <div className="tool-editor-body">
        <label className="field-label">
          Tool Name
          <input
            aria-label="Tool name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <label className="field-label">
          Program Command
          <select
            aria-label="Program command"
            value={draft.command.replace(/\.exe$/i, '').toLowerCase()}
            onChange={(e) => {
              const defaultTools = createDefaultRecipeSettings()['latex-workshop.latex.tools'];
              const preset = defaultTools.find((p) => p.command === e.target.value);
              setDraft({
                ...draft,
                command: preset ? preset.command : e.target.value,
                args: preset ? structuredClone(preset.args) : draft.args,
              });
            }}
          >
            {RECIPE_COMMANDS.map((cmd) => (
              <option key={cmd} value={cmd}>
                {cmd}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">Common Options</label>
        <div className="chip-row" role="group" aria-label="Tool options">
          {catalog.map((entry) => (
            <Button
              type="button"
              key={entry.arg}
              className="chip"
              aria-pressed={isArgOn(draft.args, entry)}
              title={entry.description}
              onMouseEnter={() => setHelp(`${entry.arg}: ${entry.description}`)}
              onFocus={() => setHelp(`${entry.arg}: ${entry.description}`)}
              onClick={() => setDraft({ ...draft, args: toggleArg(draft.args, kind, entry) })}
            >
              {entry.label} <code>{entry.arg}</code>
            </Button>
          ))}
          {extras.map((arg) => (
            <Button
              type="button"
              key={arg}
              className="chip"
              aria-pressed="true"
              title="Custom argument. Click to remove."
              onClick={() => setDraft({ ...draft, args: draft.args.filter((a) => a !== arg) })}
            >
              <code>{arg}</code>
              <X size={11} aria-hidden="true" />
            </Button>
          ))}
        </div>
        {help && <p className="recipe-hint chip-help">{help}</p>}

        <div className="chip-add" style={{ marginTop: '8px' }}>
          <input
            aria-label="Add custom argument"
            placeholder="Add custom argument, e.g. -draftmode"
            value={customArg}
            onChange={(e) => setCustomArg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <Button type="button" onClick={addCustom} disabled={!customArg.trim()}>
            Add
          </Button>
        </div>

        <details style={{ marginTop: '12px' }}>
          <summary className="setup-hint" style={{ cursor: 'pointer' }}>
            All arguments (text view)
          </summary>
          <textarea
            aria-label="Arguments text view"
            rows={4}
            value={draft.args.join('\n')}
            spellCheck={false}
            onChange={(e) =>
              setDraft({
                ...draft,
                args: e.target.value.split(/\r?\n/).filter(Boolean),
              })
            }
            style={{
              width: '100%',
              marginTop: '6px',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          />
        </details>

        <label className="field-label" style={{ marginTop: '12px' }}>
          Working Directory (optional)
          <input
            aria-label="Working directory"
            placeholder="Leave blank for project root"
            value={draft.cwd ?? ''}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value || undefined })}
          />
        </label>
      </div>

      <div className="dialog-actions" style={{ marginTop: '16px' }}>
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="primary-button" onClick={handleSave}>
          <Check size={14} /> Save Tool
        </Button>
      </div>
    </DialogShell>
  );
}
