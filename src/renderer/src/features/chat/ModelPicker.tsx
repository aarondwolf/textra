import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AISettings } from '../../../../shared/api';
import {
  AI_PROVIDERS,
  sameModel,
  supportsAIRole,
  type AIRole,
  type AIModelRef,
  type AIProviderId,
} from '../../../../shared/ai';
import { Check, ChevronDown, Search, Star } from '../../icons';
import { findModel, modelGroups } from './useAISettings';
import './model-picker.css';

function matches(query: string, ...fields: string[]): boolean {
  const haystack = fields.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/**
 * Searchable, provider-grouped model chooser. Typing filters by model name, id
 * or provider; arrow keys move, Enter picks, Escape closes.
 */
export function ModelPicker({
  settings,
  value,
  onChange,
  only,
  role,
  placement = 'down',
  variant = 'field',
  disabled = false,
  label,
  placeholder = 'Choose a model',
}: {
  settings: AISettings | null;
  value: AIModelRef | null;
  onChange: (ref: AIModelRef) => void;
  /** Restrict the list to one provider (used for per-provider defaults). */
  only?: AIProviderId;
  role?: AIRole;
  placement?: 'up' | 'down';
  variant?: 'field' | 'compact';
  disabled?: boolean;
  label: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const groups = useMemo(() => modelGroups(settings, only, role), [settings, only, role]);
  const filtered = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          models: group.models.filter((model) =>
            matches(query, model.label, model.id, group.label),
          ),
        }))
        .filter((group) => group.models.length),
    [groups, query],
  );
  const flat = useMemo(
    () =>
      filtered.flatMap((group) =>
        group.models.map((model) => ({ provider: group.provider, model: model.id })),
      ),
    [filtered],
  );
  const found = findModel(settings, value);
  const current = found && (!role || supportsAIRole(found, role)) ? found : null;
  const display = current?.label ?? (value ? `${value.model} (unavailable)` : placeholder);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    function outside(event: MouseEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // optionId only depends on the stable listId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  function show() {
    if (disabled) return;
    setQuery('');
    const all = groups.flatMap((group) =>
      group.models.map((model) => ({ provider: group.provider, model: model.id })),
    );
    setActive(
      Math.max(
        0,
        all.findIndex((ref) => sameModel(ref, value)),
      ),
    );
    setOpen(true);
  }
  function choose(ref: AIModelRef) {
    onChange(ref);
    setOpen(false);
    button.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!flat.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + flat.length) % flat.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : Math.max(0, flat.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const ref = flat[active];
      if (ref) choose(ref);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
  }

  let index = -1;
  return (
    <div className={`model-picker model-picker-${variant}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="model-picker-button"
        disabled={disabled || !groups.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${display}`}
        title={
          current && value
            ? `${current.label} (${AI_PROVIDERS[value.provider].label})`
            : placeholder
        }
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="model-picker-value">
          <span className="model-picker-name">{display}</span>
          {variant === 'field' && value && current && !only && (
            <small>{AI_PROVIDERS[value.provider].label}</small>
          )}
        </span>
        <ChevronDown size={variant === 'compact' ? 10 : 12} aria-hidden="true" />
      </button>
      {open && (
        <div className="model-picker-popup" data-placement={placement}>
          <div className="model-picker-search">
            <Search size={12} aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length ? optionId(active) : undefined}
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search models"
              value={query}
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="model-picker-list" id={listId} role="listbox" aria-label={label}>
            {!flat.length && <p className="model-picker-empty">No models match “{query}”.</p>}
            {filtered.map((group) => (
              <div key={group.provider} role="group" aria-label={group.label}>
                {!only && <div className="model-picker-group">{group.label}</div>}
                {group.models.map((model) => {
                  const position = ++index;
                  const ref = { provider: group.provider, model: model.id };
                  const selected = sameModel(ref, value);
                  return (
                    <div
                      key={model.id}
                      id={optionId(position)}
                      role="option"
                      aria-selected={selected}
                      data-active={position === active}
                      className="model-picker-option"
                      title={model.id}
                      onMouseMove={() => setActive(position)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(ref)}
                    >
                      <span className="model-picker-option-text">
                        <span>{model.label}</span>
                        {model.label !== model.id && <small>{model.id}</small>}
                      </span>
                      {role && sameModel(settings?.roleDefaults[role], ref) && (
                        <Star size={11} weight="fill" aria-label="Role default" />
                      )}
                      {(!role || !sameModel(settings?.roleDefaults[role], ref)) &&
                        group.defaultModel === model.id &&
                        !only && <small className="model-picker-tag">default</small>}
                      {selected && <Check size={11} aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
