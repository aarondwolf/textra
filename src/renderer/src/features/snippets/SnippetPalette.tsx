import { useEffect, useMemo, useRef, useState } from 'react';
import { Code, MathOperations, Sparkle } from '@phosphor-icons/react';
import { Check, Copy, Lock, LockOpen, Pencil, Plus, Trash2 } from '../../icons';
import { insertIntoSource } from '../equations/EquationPalette';
import { SYMBOL_GROUPS } from '../equations/symbols';
import { DEFAULT_SNIPPETS, type Snippet } from './snippets';
import { createSnippetPrompt } from './snippet-prompt';
import { useUI } from '../../state/ui';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { AddButton, TooltipButton } from '../../components/Button';
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
  const [expandedSnippetKey, setExpandedSnippetKey] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTex, setEditTex] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTex, setNewTex] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  const timer = useRef(0);

  useEffect(() => {
    saveCustomSnippets(customSnippets);
  }, [customSnippets]);

  function handleStartEdit(idx: number, snippet: Snippet) {
    setEditingIndex(idx);
    setEditName(snippet.name);
    setEditDesc(snippet.description || '');
    setEditTex(snippet.tex);
  }

  function handleSaveEdit(e: React.FormEvent, idx: number) {
    e.preventDefault();
    if (!editName.trim() || !editTex.trim()) return;
    setCustomSnippets((prev) =>
      prev.map((s, i) =>
        i === idx
          ? {
              name: editName.trim(),
              description: editDesc.trim() || 'Custom snippet',
              tex: editTex,
            }
          : s,
      ),
    );
    setEditingIndex(null);
  }

  async function copySnippetCode(tex: string) {
    const result = await window.textra.copyText(tex.replace('$0', ''));
    setStatus(result.ok ? 'Code copied.' : result.error);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 2000);
  }

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
        <CollapsibleSection
          className="palette-section"
          title="Math Symbols"
          icon={<MathOperations size={13} aria-hidden="true" />}
          actionsBeforeCount
          count={filteredSymbolGroups.reduce((acc, g) => acc + g.symbols.length, 0)}
          open={symbolsOpen}
          onOpenChange={setSymbolsOpen}
          headerClassName="palette-section-header"
          headerRowClassName="palette-section-header-row"
          bodyClassName="palette-section-content"
          headerActions={
            <TooltipButton
              type="button"
              className={`palette-lock-btn ${preferences.snippetsSymbolsOpenDefault ? 'locked' : ''}`}
              title={
                preferences.snippetsSymbolsOpenDefault
                  ? 'Keep open by default: On (click to toggle off)'
                  : 'Keep open by default: Off (click to keep this section open by default)'
              }
              aria-label="Keep Math Symbols open by default"
              aria-pressed={Boolean(preferences.snippetsSymbolsOpenDefault)}
              onClick={() => {
                const next = !preferences.snippetsSymbolsOpenDefault;
                updatePreferences({ snippetsSymbolsOpenDefault: next });
                if (next) setSymbolsOpen(true);
              }}
            >
              {preferences.snippetsSymbolsOpenDefault ? <Lock size={12} /> : <LockOpen size={12} />}
            </TooltipButton>
          }
        >
          {symbolsOpen && (
            <>
              {filteredSymbolGroups.map((group) => (
                <div key={group.name} className="palette-symbol-group">
                  <h4 className="palette-group-name">{group.name}</h4>
                  <div className={group.wide ? 'symbol-grid wide' : 'symbol-grid'}>
                    {group.symbols.map((symbol) => (
                      <TooltipButton
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
                      </TooltipButton>
                    ))}
                  </div>
                </div>
              ))}
              {!filteredSymbolGroups.length && (
                <p className="palette-empty-note">No symbols match.</p>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Templates & Snippets Section (with Custom Snippets consolidated inside) */}
        <CollapsibleSection
          className="palette-section"
          title="Templates & Snippets"
          icon={<Code size={13} aria-hidden="true" />}
          actionsBeforeCount
          count={totalSnippetsCount}
          open={snippetsOpen}
          onOpenChange={setSnippetsOpen}
          headerClassName="palette-section-header"
          headerRowClassName="palette-section-header-row"
          bodyClassName="palette-section-content"
          headerActions={
            <div className="palette-header-actions">
              <TooltipButton
                type="button"
                className={`palette-lock-btn ${preferences.snippetsTemplatesOpenDefault ? 'locked' : ''}`}
                title={
                  preferences.snippetsTemplatesOpenDefault
                    ? 'Keep open by default: On (click to toggle off)'
                    : 'Keep open by default: Off (click to keep this section open by default)'
                }
                aria-label="Keep Templates & Snippets open by default"
                aria-pressed={Boolean(preferences.snippetsTemplatesOpenDefault)}
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
              </TooltipButton>
            </div>
          }
        >
          {snippetsOpen && (
            <>
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
                    <TooltipButton type="button" onClick={() => void copySnippetPrompt()}>
                      {promptCopied ? <Check size={13} /> : <Copy size={13} />}
                      {promptCopied ? 'Copied' : 'Copy prompt'}
                    </TooltipButton>
                    <TooltipButton
                      type="button"
                      className="primary-pill"
                      disabled={!onAskChat}
                      onClick={() => onAskChat?.(createSnippetPrompt(newName, newDesc))}
                    >
                      <Sparkle size={13} />
                      Ask in Chat
                    </TooltipButton>
                  </div>
                  <div className="palette-form-actions">
                    <TooltipButton type="button" onClick={() => setIsAdding(false)}>
                      Cancel
                    </TooltipButton>
                    <TooltipButton type="submit" className="primary-pill">
                      Save
                    </TooltipButton>
                  </div>
                </form>
              )}

              <ul className="snippet-list">
                {/* Custom Snippets */}
                {filteredCustomSnippets.map((snippet, idx) => {
                  const key = `custom-${snippet.name}-${idx}`;
                  const isExpanded = expandedSnippetKey === key;
                  const isEditing = editingIndex === idx;

                  return (
                    <li key={key} className="snippet-item-wrap">
                      <div className="custom-snippet-item">
                        <TooltipButton
                          type="button"
                          className={`snippet ${isExpanded ? 'expanded' : ''}`}
                          title={snippet.tex.replace('$0', '')}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setHint(`${snippet.name} (Custom)`)}
                          onMouseLeave={() => setHint(null)}
                          onClick={(event) => {
                            if (event.detail === 2) {
                              insertSnippet(snippet);
                            } else {
                              setExpandedSnippetKey((curr) => (curr === key ? null : key));
                            }
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
                        </TooltipButton>
                        <div
                          style={{
                            position: 'absolute',
                            right: 8,
                            top: 12,
                            display: 'flex',
                            gap: 2,
                          }}
                        >
                          <TooltipButton
                            type="button"
                            className="snippet-icon-btn"
                            title="Edit snippet"
                            aria-label={`Edit ${snippet.name}`}
                            onClick={() => {
                              setExpandedSnippetKey(key);
                              handleStartEdit(idx, snippet);
                            }}
                          >
                            <Pencil size={13} />
                          </TooltipButton>
                          <TooltipButton
                            type="button"
                            className="snippet-icon-btn danger"
                            title="Delete custom snippet"
                            aria-label={`Delete custom snippet ${snippet.name}`}
                            onClick={() => handleDeleteCustomSnippet(idx)}
                          >
                            <Trash2 size={13} />
                          </TooltipButton>
                        </div>
                      </div>

                      {isExpanded &&
                        (isEditing ? (
                          <form
                            className="palette-custom-form"
                            onSubmit={(e) => handleSaveEdit(e, idx)}
                          >
                            <input
                              placeholder="Snippet name"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              required
                            />
                            <input
                              placeholder="Description (optional)"
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                            />
                            <textarea
                              placeholder="LaTeX code (use $0 for cursor position)"
                              value={editTex}
                              onChange={(e) => setEditTex(e.target.value)}
                              rows={4}
                              required
                            />
                            <div className="palette-form-actions">
                              <TooltipButton type="button" onClick={() => setEditingIndex(null)}>
                                Cancel
                              </TooltipButton>
                              <TooltipButton type="submit" className="primary-pill">
                                Save
                              </TooltipButton>
                            </div>
                          </form>
                        ) : (
                          <div className="snippet-expanded-card">
                            <div className="snippet-expanded-header">
                              <span className="snippet-expanded-title">{snippet.name}</span>
                              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <TooltipButton
                                  type="button"
                                  className="snippet-icon-btn"
                                  title="Edit snippet"
                                  aria-label={`Edit ${snippet.name}`}
                                  onClick={() => handleStartEdit(idx, snippet)}
                                >
                                  <Pencil size={13} />
                                </TooltipButton>
                                <TooltipButton
                                  type="button"
                                  className="snippet-icon-btn danger"
                                  title="Delete custom snippet"
                                  aria-label={`Delete ${snippet.name}`}
                                  onClick={() => handleDeleteCustomSnippet(idx)}
                                >
                                  <Trash2 size={13} />
                                </TooltipButton>
                              </div>
                            </div>
                            {snippet.description && (
                              <span className="snippet-expanded-desc">{snippet.description}</span>
                            )}
                            <pre className="snippet-expanded-code">{snippet.tex}</pre>
                            <div className="snippet-expanded-actions">
                              <TooltipButton
                                type="button"
                                className="text-button"
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                onClick={() => insertSnippet(snippet)}
                              >
                                <Plus size={12} /> Insert
                              </TooltipButton>
                              <TooltipButton
                                type="button"
                                className="text-button"
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                onClick={() => void copySnippetCode(snippet.tex)}
                              >
                                <Copy size={12} /> Copy code
                              </TooltipButton>
                            </div>
                          </div>
                        ))}
                    </li>
                  );
                })}

                {/* Built-in Snippets */}
                {filteredDefaultSnippets.map((snippet) => {
                  const key = `default-${snippet.name}`;
                  const isExpanded = expandedSnippetKey === key;

                  return (
                    <li key={snippet.name} className="snippet-item-wrap">
                      <TooltipButton
                        type="button"
                        className={`snippet ${isExpanded ? 'expanded' : ''}`}
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
                          if (event.detail === 2) {
                            insertSnippet(snippet);
                          } else {
                            setExpandedSnippetKey((curr) => (curr === key ? null : key));
                          }
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
                      </TooltipButton>

                      {isExpanded && (
                        <div className="snippet-expanded-card">
                          <div className="snippet-expanded-header">
                            <span className="snippet-expanded-title">{snippet.name}</span>
                          </div>
                          {snippet.description && (
                            <span className="snippet-expanded-desc">{snippet.description}</span>
                          )}
                          <pre className="snippet-expanded-code">{snippet.tex}</pre>
                          <div className="snippet-expanded-actions">
                            <TooltipButton
                              type="button"
                              className="text-button"
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              onClick={() => insertSnippet(snippet)}
                            >
                              <Plus size={12} /> Insert
                            </TooltipButton>
                            <TooltipButton
                              type="button"
                              className="text-button"
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              onClick={() => void copySnippetCode(snippet.tex)}
                            >
                              <Copy size={12} /> Copy code
                            </TooltipButton>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}

                {!filteredDefaultSnippets.length && !filteredCustomSnippets.length && !isAdding && (
                  <p className="palette-empty-note">No snippets match.</p>
                )}
              </ul>
              {!isAdding && (
                <AddButton
                  type="button"
                  className="recipe-add-step-faded"
                  style={{ marginTop: '8px', width: '100%' }}
                  onClick={() => {
                    setIsAdding(true);
                    if (!snippetsOpen) setSnippetsOpen(true);
                  }}
                >
                  <Plus size={13} />
                  <span>Add snippet</span>
                </AddButton>
              )}
            </>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}
