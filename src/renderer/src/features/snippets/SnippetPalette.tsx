import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { Check, ChevronDown, ChevronRight, Copy, Lock, LockOpen, Plus, Trash2 } from '../../icons';
import { insertIntoSource } from '../equations/EquationPalette';
import { SYMBOL_GROUPS } from '../equations/symbols';
import { DEFAULT_SNIPPETS, type Snippet } from './snippets';
import { createSnippetPrompt } from './snippet-prompt';
import { useUI } from '../../state/ui';
import '../equations/equations.css';
import './snippets.css';

const CUSTOM_SNIPPETS_STORAGE = 'textra:custom-snippets';

function loadCustomSnippets(): Snippet[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_SNIPPETS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomSnippets(snippets: Snippet[]): void {
  try {
    window.localStorage.setItem(CUSTOM_SNIPPETS_STORAGE, JSON.stringify(snippets));
  } catch {
    // Local storage unavailable
  }
}

export default function SnippetPalette({
  canInsert,
  onAskChat,
}: {
  canInsert: boolean;
  onAskChat?: (prompt: string) => void;
}) {
  const preferences = useUI((state) => state.preferences);
  const updatePreferences = useUI((state) => state.updatePreferences);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [symbolsOpen, setSymbolsOpen] = useState(
    () => preferences.snippetsSymbolsOpenDefault ?? false,
  );
  const [snippetsOpen, setSnippetsOpen] = useState(
    () => preferences.snippetsTemplatesOpenDefault ?? false,
  );
  const [customSnippets, setCustomSnippets] = useState<Snippet[]>(loadCustomSnippets);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTex, setNewTex] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  const timer = useRef(0);

  useEffect(() => {
    saveCustomSnippets(customSnippets);
  }, [customSnippets]);

  function notifyInsert(success: boolean) {
    setStatus(success ? 'Inserted.' : 'Could not insert. Click in a .tex file first.');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 2000);
  }

  function insertSymbol(tex: string) {
    notifyInsert(insertIntoSource(tex));
  }

  function insertSnippet(snippet: Snippet) {
    notifyInsert(insertIntoSource(snippet.tex));
  }

  function handleAddCustomSnippet(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newTex.trim()) return;
    const snippet: Snippet = {
      name: newName.trim(),
      description: newDesc.trim() || 'Custom snippet',
      tex: newTex,
    };
    setCustomSnippets((prev) => [snippet, ...prev]);
    setNewName('');
    setNewDesc('');
    setNewTex('');
    setIsAdding(false);
  }

  function handleDeleteCustomSnippet(index: number) {
    setCustomSnippets((prev) => prev.filter((_, i) => i !== index));
  }

  async function copySnippetPrompt() {
    const result = await window.textra.copyText(createSnippetPrompt(newName, newDesc));
    setStatus(result.ok ? 'Prompt copied.' : result.error);
    setPromptCopied(result.ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setStatus('');
      setPromptCopied(false);
    }, 2000);
  }

  const needle = query.trim().toLowerCase();

  // Filtered symbols
  const filteredSymbolGroups = useMemo(() => {
    if (!needle) return SYMBOL_GROUPS;
    return SYMBOL_GROUPS.map((group) => ({
      ...group,
      symbols: group.symbols.filter(
        (symbol) =>
          symbol.tex.toLowerCase().includes(needle) ||
          group.name.toLowerCase().includes(needle) ||
          symbol.glyph?.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.symbols.length > 0);
  }, [needle]);

  // Filtered built-in snippets
  const filteredDefaultSnippets = useMemo(() => {
    if (!needle) return DEFAULT_SNIPPETS;
    return DEFAULT_SNIPPETS.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle) ||
        s.tex.toLowerCase().includes(needle),
    );
  }, [needle]);

  // Filtered custom snippets
  const filteredCustomSnippets = useMemo(() => {
    if (!needle) return customSnippets;
    return customSnippets.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle) ||
        s.tex.toLowerCase().includes(needle),
    );
  }, [customSnippets, needle]);

  const totalSnippetsCount = filteredCustomSnippets.length + filteredDefaultSnippets.length;

  return (
    <div className="snippet-palette">
      <div className="palette-search-bar">
        <input
          aria-label="Search snippets and symbols"
          placeholder="Search symbols or snippets…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="equation-hint" role="status">
          {status ||
            hint ||
            (canInsert ? 'Double-click to insert at cursor.' : 'Open a .tex file to insert.')}
        </p>
      </div>

      <div className="palette-sections">
        {/* Math Symbols Collapsible Section */}
        <section className="palette-section">
          <div className="palette-section-header-row">
            <button
              type="button"
              className="palette-section-header"
              aria-expanded={symbolsOpen}
              onClick={() => setSymbolsOpen(!symbolsOpen)}
            >
              {symbolsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Math Symbols</span>
              <span className="palette-count">
                {filteredSymbolGroups.reduce((acc, g) => acc + g.symbols.length, 0)}
              </span>
            </button>
            <button
              type="button"
              className={`palette-lock-btn ${preferences.snippetsSymbolsOpenDefault ? 'locked' : ''}`}
              title={
                preferences.snippetsSymbolsOpenDefault
                  ? 'Keep open by default: On (click to toggle off)'
                  : 'Keep open by default: Off (click to keep this section open by default)'
              }
              aria-label="Keep Math Symbols open by default"
              onClick={() => {
                const next = !preferences.snippetsSymbolsOpenDefault;
                updatePreferences({ snippetsSymbolsOpenDefault: next });
                if (next) setSymbolsOpen(true);
              }}
            >
              {preferences.snippetsSymbolsOpenDefault ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
          </div>

          {symbolsOpen && (
            <div className="palette-section-content">
              {filteredSymbolGroups.map((group) => (
                <div key={group.name} className="palette-symbol-group">
                  <h4 className="palette-group-name">{group.name}</h4>
                  <div className={group.wide ? 'symbol-grid wide' : 'symbol-grid'}>
                    {group.symbols.map((symbol) => (
                      <button
                        key={symbol.tex}
                        type="button"
                        className="symbol"
                        title={
                          symbol.tex.replace(/\n/g, ' ') +
                          (symbol.package ? ` (${symbol.package})` : '')
                        }
                        aria-label={`Insert ${symbol.tex.replace(/\n/g, ' ')}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() =>
                          setHint(
                            `${symbol.tex}${symbol.package ? ` (needs \\usepackage{${symbol.package}})` : ''}`,
                          )
                        }
                        onMouseLeave={() => setHint(null)}
                        onClick={(event) => {
                          if (event.detail === 2) insertSymbol(symbol.tex);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            insertSymbol(symbol.tex);
                          }
                        }}
                      >
                        {symbol.glyph ?? symbol.tex}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!filteredSymbolGroups.length && (
                <p className="palette-empty-note">No symbols match.</p>
              )}
            </div>
          )}
        </section>

        {/* Templates & Snippets Section (with Custom Snippets consolidated inside) */}
        <section className="palette-section">
          <div className="palette-section-header-row">
            <button
              type="button"
              className="palette-section-header"
              aria-expanded={snippetsOpen}
              onClick={() => setSnippetsOpen(!snippetsOpen)}
            >
              {snippetsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Templates & Snippets</span>
              <span className="palette-count">{totalSnippetsCount}</span>
            </button>
            <div className="palette-header-actions">
              <button
                type="button"
                className="palette-add-btn"
                title="Add custom snippet"
                aria-label="Add custom snippet"
                onClick={() => {
                  setIsAdding(!isAdding);
                  if (!snippetsOpen) setSnippetsOpen(true);
                }}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                className={`palette-lock-btn ${preferences.snippetsTemplatesOpenDefault ? 'locked' : ''}`}
                title={
                  preferences.snippetsTemplatesOpenDefault
                    ? 'Keep open by default: On (click to toggle off)'
                    : 'Keep open by default: Off (click to keep this section open by default)'
                }
                aria-label="Keep Templates & Snippets open by default"
                onClick={() => {
                  const next = !preferences.snippetsTemplatesOpenDefault;
                  updatePreferences({ snippetsTemplatesOpenDefault: next });
                  if (next) setSnippetsOpen(true);
                }}
              >
                {preferences.snippetsTemplatesOpenDefault ? (
                  <Lock size={12} />
                ) : (
                  <LockOpen size={12} />
                )}
              </button>
            </div>
          </div>

          {snippetsOpen && (
            <div className="palette-section-content">
              {isAdding && (
                <form className="palette-custom-form" onSubmit={handleAddCustomSnippet}>
                  <input
                    placeholder="Snippet name (e.g. My Theorem)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                  <input
                    placeholder="Description (optional)"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                  <textarea
                    placeholder="LaTeX code (use $0 for cursor position)"
                    value={newTex}
                    onChange={(e) => setNewTex(e.target.value)}
                    rows={4}
                    required
                  />
                  <div className="palette-prompt-actions">
                    <button type="button" onClick={() => void copySnippetPrompt()}>
                      {promptCopied ? <Check size={13} /> : <Copy size={13} />}
                      {promptCopied ? 'Copied' : 'Copy prompt'}
                    </button>
                    <button
                      type="button"
                      className="primary-pill"
                      disabled={!onAskChat}
                      onClick={() => onAskChat?.(createSnippetPrompt(newName, newDesc))}
                    >
                      <Sparkle size={13} />
                      Ask in Chat
                    </button>
                  </div>
                  <div className="palette-form-actions">
                    <button type="button" onClick={() => setIsAdding(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="primary-pill">
                      Save
                    </button>
                  </div>
                </form>
              )}

              <ul className="snippet-list">
                {/* Custom Snippets */}
                {filteredCustomSnippets.map((snippet, idx) => (
                  <li key={`custom-${snippet.name}-${idx}`} className="custom-snippet-item">
                    <button
                      type="button"
                      className="snippet"
                      title={snippet.tex.replace('$0', '')}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHint(`${snippet.name} (Custom)`)}
                      onMouseLeave={() => setHint(null)}
                      onClick={(event) => {
                        if (event.detail === 2) insertSnippet(snippet);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          insertSnippet(snippet);
                        }
                      }}
                    >
                      <strong>{snippet.name}</strong>
                      <span>{snippet.description}</span>
                    </button>
                    <button
                      type="button"
                      className="snippet-delete-btn"
                      title="Delete custom snippet"
                      aria-label={`Delete custom snippet ${snippet.name}`}
                      onClick={() => handleDeleteCustomSnippet(idx)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}

                {/* Built-in Snippets */}
                {filteredDefaultSnippets.map((snippet) => (
                  <li key={snippet.name}>
                    <button
                      type="button"
                      className="snippet"
                      title={snippet.tex.replace('$0', '')}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() =>
                        setHint(
                          snippet.packages
                            ? `Needs ${snippet.packages.map((name) => `\\usepackage{${name}}`).join(' ')}`
                            : snippet.name,
                        )
                      }
                      onMouseLeave={() => setHint(null)}
                      onClick={(event) => {
                        if (event.detail === 2) insertSnippet(snippet);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          insertSnippet(snippet);
                        }
                      }}
                    >
                      <strong>{snippet.name}</strong>
                      <span>{snippet.description}</span>
                    </button>
                  </li>
                ))}

                {!filteredDefaultSnippets.length && !filteredCustomSnippets.length && !isAdding && (
                  <p className="palette-empty-note">No snippets match.</p>
                )}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
