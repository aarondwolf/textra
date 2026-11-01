import { useEffect, useRef, useState } from 'react';
import { FileText, Folder } from '../../icons';

/** VS Code-style inline name entry shown in the tree while creating a file or folder. */
export function NewEntryRow({
  kind,
  depth,
  onSubmit,
  onCancel,
}: {
  kind: 'file' | 'directory';
  depth: number;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  async function submit() {
    const name = value.trim();
    if (!name) return onCancel();
    if (/[\\/]/.test(name)) return setError('Enter a name, not a path.');
    if (working.current) return;
    working.current = true;
    try {
      await onSubmit(name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The item could not be created.');
    } finally {
      working.current = false;
    }
  }
  return (
    <div className="file-row new-entry" style={{ paddingLeft: `${depth * 14}px` }}>
      <div className="file-entry new-entry-field" data-invalid={error ? 'true' : undefined}>
        {kind === 'directory' ? <Folder size={14} /> : <FileText size={14} />}
        <input
          ref={input}
          aria-label={kind === 'file' ? 'New file name' : 'New folder name'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'new-entry-error' : undefined}
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          onBlur={() => {
            if (!working.current) onCancel();
          }}
        />
      </div>
      {error && (
        <p id="new-entry-error" role="alert" className="new-entry-error">
          {error}
        </p>
      )}
    </div>
  );
}
