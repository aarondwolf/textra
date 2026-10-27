import { AppTooltip } from '../../components/HelpTooltip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import type { AISettings } from '../../../../shared/api';
import {
  AI_PROVIDERS,
  sameModel,
  supportsAIRole,
  type AIRole,
  type AIModelRef,
  type AIProviderId,
} from '../../../../shared/ai';
import { Check, ChevronDown, ChevronUp, Star } from '../../icons';
import { findModel, modelGroups, modelUnavailableReason } from './useAISettings';
import { useOverlayZIndex } from '../../components/overlay-layers';
import './model-picker.css';

function matches(query: string, ...fields: string[]): boolean {
  const haystack = fields.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function modelValue(ref: AIModelRef): string {
  // Model IDs are provider-scoped, so cmdk's item key must preserve both fields.
  return JSON.stringify([ref.provider, ref.model]);
}

/**
 * Accessible, provider-grouped model chooser built on Radix Popover.
 * Provides portal rendering, collision detection, and keyboard navigation.
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
  const [activeValue, setActiveValue] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const floatingLayer = useOverlayZIndex('floating');
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
  const found = findModel(settings, value, role);
  const current = found && (!role || supportsAIRole(found, role)) ? found : null;
  const display = current?.label ?? (value ? `${value.model} (unavailable)` : placeholder);
  useEffect(() => {
    if (open) {
      setQuery('');
      const all = groups.flatMap((group) =>
        group.models.map((model) => ({ provider: group.provider, model: model.id })),
      );
      const selected = all.find((ref) => sameModel(ref, value));
      const initial = selected ?? all[0];
      setActiveValue(initial ? modelValue(initial) : '');
    }
  }, [open, groups, value]);

  function choose(ref: AIModelRef) {
    onChange(ref);
    setOpen(false);
    button.current?.focus();
  }

  const handleSearchChange = (nextQuery: string) => {
    setQuery(nextQuery);
    let firstMatch: AIModelRef | null = null;
    for (const group of groups) {
      const model = group.models.find((candidate) =>
        matches(nextQuery, candidate.label, candidate.id, group.label),
      );
      if (model) {
        firstMatch = { provider: group.provider, model: model.id };
        break;
      }
    }
    setActiveValue(firstMatch ? modelValue(firstMatch) : '');
  };

  return (
    <div className={`model-picker model-picker-${variant}`}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <AppTooltip
          content={
            current && value
              ? `${current.label} (${settings?.providers.find((provider) => provider.id === value.provider)?.displayName || AI_PROVIDERS[value.provider].label})`
              : (modelUnavailableReason(settings, value, role) ?? placeholder)
          }
        >
          <span className="tooltip-disabled-trigger">
            <Popover.Trigger asChild>
              <button
                ref={button}
                type="button"
                className="model-picker-button"
                disabled={disabled || !groups.length}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`${label}: ${display}`}
              >
                <span className="model-picker-value">
                  <span className="model-picker-name">{display}</span>
                  {variant === 'field' && value && current && !only && (
                    <small className="model-picker-provider">
                      {settings?.providers.find((provider) => provider.id === value.provider)
                        ?.displayName || AI_PROVIDERS[value.provider].label}
                    </small>
                  )}
                </span>
                {placement === 'up' ? (
                  <ChevronUp size={variant === 'compact' ? 10 : 12} aria-hidden="true" />
                ) : (
                  <ChevronDown size={variant === 'compact' ? 10 : 12} aria-hidden="true" />
                )}
              </button>
            </Popover.Trigger>
          </span>
        </AppTooltip>
        <Popover.Portal>
          <Popover.Content
            side={placement === 'up' ? 'top' : 'bottom'}
            sideOffset={4}
            collisionPadding={8}
            align="start"
            className="model-picker-popup"
            style={{
              width: 'var(--radix-popover-trigger-width)',
              minWidth: 220,
              maxWidth: 380,
              zIndex: floatingLayer,
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <Command
              className="model-picker-command"
              label={`Search ${label.toLowerCase()}`}
              shouldFilter={false}
              loop
              value={activeValue}
              onValueChange={setActiveValue}
            >
              <div className="model-picker-search">
                <Command.Input
                  ref={input}
                  aria-label={`Search ${label.toLowerCase()}`}
                  placeholder="Search models"
                  value={query}
                  spellCheck={false}
                  onValueChange={handleSearchChange}
                />
              </div>
              <Command.List className="model-picker-list" label={label}>
                {!filtered.some((group) => group.models.length) && (
                  <Command.Empty className="model-picker-empty">
                    No models match “{query}”.
                  </Command.Empty>
                )}
                {filtered.map((group) => (
                  <Command.Group
                    key={group.provider}
                    value={group.provider}
                    heading={!only ? group.label : undefined}
                    className="model-picker-group-container"
                  >
                    {group.models.map((model) => {
                      const ref = { provider: group.provider, model: model.id };
                      const selected = sameModel(ref, value);
                      return (
                        <AppTooltip key={modelValue(ref)} content={model.id}>
                          <Command.Item
                            value={modelValue(ref)}
                            keywords={[model.label, model.id, group.label, group.provider]}
                            data-current-model={selected ? 'true' : undefined}
                            className="model-picker-option"
                            onSelect={() => choose(ref)}
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
                          </Command.Item>
                        </AppTooltip>
                      );
                    })}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
