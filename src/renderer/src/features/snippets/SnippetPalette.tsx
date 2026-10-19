import { useRef, useState } from 'react';
import { insertIntoSource } from '../equations/EquationPalette';
import { DEFAULT_SNIPPETS, type Snippet } from './snippets';
import './snippets.css';

export default function SnippetPalette({ canInsert }: { canInsert: boolean }) {
  const [hint, setHint] = useState<Snippet | null>(null);
  const [status, setStatus] = useState('');
  const timer = useRef(0);
  function insert(snippet: Snippet) {
    setStatus(
      insertIntoSource(snippet.tex) ? 'Inserted.' : 'Could not insert. Click in a .tex file first.',
    );
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 2000);
  }
  return (
    <div className="snippet-palette">
      <p className="equation-hint" role="status">
        {status ||
          (hint?.packages
            ? `Needs ${hint.packages.map((name) => `\\usepackage{${name}}`).join(' ')}`
            : canInsert
              ? 'Double-click a snippet to insert it at the cursor.'
              : 'Open a .tex file to insert snippets.')}
      </p>
      <ul className="snippet-list">
        {DEFAULT_SNIPPETS.map((snippet) => (
          <li key={snippet.name}>
            <button
              type="button"
              className="snippet"
              title={snippet.tex.replace('$0', '')}
              // Keep focus (and the visible caret) in the editor so the insertion point is clear.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHint(snippet)}
              onFocus={() => setHint(snippet)}
              onMouseLeave={() => setHint(null)}
              onBlur={() => setHint(null)}
              onClick={(event) => {
                if (event.detail === 2) insert(snippet);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  insert(snippet);
                }
              }}
            >
              <strong>{snippet.name}</strong>
              <span>{snippet.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
