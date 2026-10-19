import { useMemo, useRef, useState } from 'react';
import { insertion, SYMBOL_GROUPS, type MathSymbol } from './symbols';
import './equations.css';

/** Asks the active source editor to insert text at its cursor. */
export function insertIntoSource(tex: string): boolean {
  // The editor cancels the event once it has inserted the text.
  return !window.dispatchEvent(
    new CustomEvent('textra:insert-source', { detail: insertion(tex), cancelable: true }),
  );
}

export default function EquationPalette({ canInsert }: { canInsert: boolean }) {
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState<MathSymbol | null>(null);
  const [status, setStatus] = useState('');
  const timer = useRef(0);
  function insert(tex: string) {
    setStatus(
      insertIntoSource(tex) ? 'Inserted.' : 'Could not insert. Click in a .tex file first.',
    );
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 2000);
  }
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return SYMBOL_GROUPS;
    return SYMBOL_GROUPS.map((group) => ({
      ...group,
      symbols: group.symbols.filter(
        (symbol) =>
          symbol.tex.toLowerCase().includes(needle) ||
          group.name.toLowerCase().includes(needle) ||
          symbol.glyph?.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.symbols.length);
  }, [query]);
  return (
    <div className="equation-palette">
      <div className="equation-bar">
        <input
          aria-label="Search symbols"
          placeholder="Search symbols, for example alpha or sum"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="equation-hint" role="status">
          {status ? (
            status
          ) : hint ? (
            <>
              <code>{hint.tex.replace(/\n/g, ' ')}</code>
              {hint.package ? ` needs \\usepackage{${hint.package}}` : ''}
            </>
          ) : canInsert ? (
            'Double-click a symbol to insert it at the cursor.'
          ) : (
            'Open a .tex file to insert symbols.'
          )}
        </p>
      </div>
      <div className="equation-scroll">
        {groups.map((group) => (
          <section key={group.name} aria-label={group.name}>
            <h3>{group.name}</h3>
            <div className={group.wide ? 'symbol-grid wide' : 'symbol-grid'}>
              {group.symbols.map((symbol) => (
                <button
                  key={symbol.tex}
                  type="button"
                  className="symbol"
                  title={
                    symbol.tex.replace(/\n/g, ' ') + (symbol.package ? ` (${symbol.package})` : '')
                  }
                  aria-label={`Insert ${symbol.tex.replace(/\n/g, ' ')}`}
                  // Keep focus (and the visible caret) in the editor so the insertion point is clear.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHint(symbol)}
                  onFocus={() => setHint(symbol)}
                  onMouseLeave={() => setHint(null)}
                  onBlur={() => setHint(null)}
                  onClick={(event) => {
                    if (event.detail === 2) insert(symbol.tex);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      insert(symbol.tex);
                    }
                  }}
                >
                  {symbol.glyph ?? symbol.tex}
                </button>
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <p className="equation-hint">No symbols match.</p>}
      </div>
    </div>
  );
}
