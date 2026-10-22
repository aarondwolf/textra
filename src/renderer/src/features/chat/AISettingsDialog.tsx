import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type {
  AIProviderSettings,
  AISettings,
  OllamaLocalStatus,
  Result,
} from '../../../../shared/api';
import {
  AI_DEFAULT_ENDPOINTS,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  supportsAIRole,
  type AIModelInfo,
  type AIModelVisibility,
  type AIProviderConfiguration,
  type AIProviderId,
  type AIProviderLink,
  type AIRole,
} from '../../../../shared/ai';
import { AIChat, Pencil, Play, Plus, RefreshCw, Trash2, X } from '../../icons';
import { ModelPicker } from './ModelPicker';
import {
  aiSavesSettled,
  currentAISaveState,
  publishAISettings,
  trackAISave,
  useAISaveState,
  useAISettings,
  modelUnavailableReason,
  modelGroups,
} from './useAISettings';
import { SaveFooter } from '../save-status/SaveFooter';
import './ai-settings.css';

const LABELS: Record<AIRole, string> = {
  assistant: 'Assistant',
  inlineCompletion: 'Inline edit (Ctrl/Cmd+I)',
  completion: 'Automatic completion (ghost text)',
};
const allModels = (): AIModelVisibility => ({ mode: 'all', models: [] });
const ids = (text: string) => [
  ...new Set(
    text
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];
const providerLabel = (provider: AIProviderSettings) =>
  provider.displayName || AI_PROVIDERS[provider.id].label;

async function openLink(
  provider: AIProviderId,
  link: AIProviderLink,
  onError: (text: string) => void,
) {
  try {
    const result = await window.textra.openAIProviderLink({ provider, link });
    if (!result.ok) onError(result.error);
  } catch {
    onError('Could not open the provider page.');
  }
}

function VisibilityEditor({
  title,
  value,
  models,
  onChange,
}: {
  title: string;
  value: AIModelVisibility;
  models: AIModelInfo[];
  onChange: (value: AIModelVisibility) => void;
}) {
  const [search, setSearch] = useState('');
  const [text, setText] = useState(value.models.join('\n'));
  const visible = models.filter((model) =>
    `${model.id} ${model.label}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <fieldset className="ai-visibility-editor">
      <legend>{title}</legend>
      <select
        aria-label={`${title} visibility`}
        value={value.mode}
        onChange={(event) => {
          const mode = event.target.value as AIModelVisibility['mode'];
          if (mode === 'all') setText('');
          onChange({ mode, models: mode === 'all' ? [] : value.models });
        }}
      >
        <option value="all">All models</option>
        <option value="include">Include selected models</option>
        <option value="exclude">Exclude selected models</option>
      </select>
      <small>
        {value.mode === 'all'
          ? `${models.length} eligible models`
          : `${value.models.length} selected · ${models.length} eligible models`}
      </small>
      <button
        type="button"
        className="text-button"
        aria-label={`Reset ${title} visibility`}
        onClick={() => {
          setSearch('');
          setText('');
          onChange(allModels());
        }}
      >
        Reset visibility
      </button>
      {value.mode !== 'all' && (
        <>
          <input
            aria-label={`Search ${title.toLowerCase()} models`}
            placeholder="Search models"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="ai-visibility-list">
            {visible.map((model) => (
              <label key={model.id}>
                <input
                  type="checkbox"
                  checked={value.models.includes(model.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...value.models, model.id]
                      : value.models.filter((id) => id !== model.id);
                    setText(next.join('\n'));
                    onChange({ ...value, models: next });
                  }}
                />
                <span title={model.id}>
                  {model.label}
                  <small>{model.id}</small>
                </span>
              </label>
            ))}
            {!visible.length && <p>No matching models. Enter exact IDs below.</p>}
          </div>
          <label className="field-label">
            Exact model IDs
            <textarea
              aria-label={`${title} exact model IDs`}
              rows={3}
              value={text}
              placeholder="One ID per line"
              onChange={(event) => {
                setText(event.target.value);
                onChange({ ...value, models: ids(event.target.value) });
              }}
            />
          </label>
        </>
      )}
    </fieldset>
  );
}

function ProviderEditor({
  provider,
  onClose,
}: {
  provider: AIProviderSettings;
  onClose: () => void;
}) {
  const info = AI_PROVIDERS[provider.id];
  const [apiKey, setApiKey] = useState('');
  const [hasSaved, setHasSaved] = useState(provider.configured);
  const [replacing, setReplacing] = useState(!provider.configured);
  const [enabled, setEnabled] = useState(provider.enabled !== false);
  const [endpoint, setEndpoint] = useState(provider.endpoint ?? AI_DEFAULT_ENDPOINTS[provider.id]);
  const [name, setName] = useState(provider.displayName ?? '');
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel ?? '');
  const [filters, setFilters] = useState(
    provider.filters ?? { chat: allModels(), completion: allModels() },
  );
  const [supportsTools, setSupportsTools] = useState(
    provider.supportsTools ?? provider.id !== 'custom',
  );
  const [manual, setManual] = useState((provider.manualModels ?? []).join('\n'));
  const [models, setModels] = useState(provider.models);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [ollama, setOllama] = useState<OllamaLocalStatus | null>(null);
  const label = name.trim() || info.label;
  const manualIds = ids(manual);
  const catalog: AIModelInfo[] = [
    ...models,
    ...manualIds
      .filter((id) => !models.some((model) => model.id === id))
      .map((id) => ({ id, label: id })),
  ];
  const configuration = (): AIProviderConfiguration => ({
    provider: provider.id,
    enabled,
    endpoint: endpoint.trim(),
    displayName: name.trim() || undefined,
    apiKey: replacing && apiKey.trim() ? apiKey.trim() : undefined,
    defaultModel: defaultModel || null,
    filters,
    supportsTools,
    manualModels: manualIds,
  });
  async function save(close: boolean, refresh = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await trackAISave(window.textra.configureAIProvider(configuration()));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      publishAISettings(result.value);
      setHasSaved(true);
      setApiKey('');
      setReplacing(false);
      if (refresh) {
        const tested = await trackAISave(window.textra.refreshAIModels({ provider: provider.id }));
        if (!tested.ok) {
          setError(tested.error);
          const saved = await window.textra.getAISettings();
          if (saved.ok) publishAISettings(saved.value);
          return;
        }
        publishAISettings(tested.value);
        setModels(tested.value.providers.find((item) => item.id === provider.id)?.models ?? []);
        setStatus('Connection tested. Models refreshed.');
      } else setStatus('Connection saved.');
      if (close) onClose();
    } catch {
      setError('Could not update this connection. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function localAction(start: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await (start ? window.textra.startOllama() : window.textra.getOllamaStatus());
      if (result.ok) setOllama(result.value);
      else setError(result.error);
    } catch {
      setError('Could not check Ollama.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay ai-provider-editor-overlay" />
        <Dialog.Content
          className="ai-provider-editor ai-settings-dialog"
          aria-describedby="ai-provider-description"
        >
          <div className="ai-settings-heading">
            <Dialog.Title>
              {hasSaved ? 'Edit' : 'Add'} {info.label}
            </Dialog.Title>
            <Dialog.Close
              className="icon-button"
              disabled={busy}
              aria-label="Close provider editor"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description id="ai-provider-description">
            Save connection details locally. Test / Refresh contacts this provider only when you
            choose it.
          </Dialog.Description>
          <form
            className="ai-provider-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save(true);
            }}
          >
            <fieldset disabled={busy} className="ai-provider-fields">
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Connection enabled
              </label>
              {provider.id === 'custom' && (
                <label className="field-label">
                  Connection name
                  <input
                    value={name}
                    placeholder="OpenAI-compatible"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              {(!info.local || provider.id === 'custom') && (
                <div className="ai-provider-key">
                  {hasSaved && !replacing ? (
                    <>
                      <span className="ai-provider-key-status">Credentials unchanged</span>
                      <div className="ai-provider-key-actions">
                        <button type="button" onClick={() => setReplacing(true)}>
                          Replace key
                        </button>
                        {info.links.keys && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void openLink(provider.id, 'keys', setError)}
                          >
                            Get a key
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <label className="field-label">
                      {info.keyLabel}
                      <input
                        type="password"
                        value={apiKey}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={
                          hasSaved ? 'Leave blank to keep the saved key' : 'Paste API key'
                        }
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </label>
                  )}
                  {hasSaved && replacing && (
                    <div className="ai-provider-key-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setReplacing(false);
                          setApiKey('');
                        }}
                      >
                        Keep saved key
                      </button>
                      {info.links.keys && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void openLink(provider.id, 'keys', setError)}
                        >
                          Get a key
                        </button>
                      )}
                    </div>
                  )}
                  {!hasSaved && info.links.keys && (
                    <button
                      type="button"
                      className="ai-provider-key-link"
                      onClick={() => void openLink(provider.id, 'keys', setError)}
                    >
                      Get a key
                    </button>
                  )}
                </div>
              )}
              {info.local && (
                <div className="ai-provider-row">
                  <button type="button" onClick={() => void localAction(false)}>
                    Check Ollama
                  </button>
                  {ollama && (
                    <span>
                      {ollama.running
                        ? 'Running'
                        : ollama.installed
                          ? 'Not running'
                          : 'Not installed'}
                    </span>
                  )}
                  {ollama && !ollama.running && ollama.installed && (
                    <button type="button" onClick={() => void localAction(true)}>
                      <Play size={12} />
                      Start Ollama
                    </button>
                  )}
                  {ollama && !ollama.installed && (
                    <button
                      type="button"
                      onClick={() => void openLink(provider.id, 'download', setError)}
                    >
                      Download Ollama
                    </button>
                  )}
                </div>
              )}
              <div className="ai-provider-default-model">
                <label className="field-label">
                  Connection default model
                  <select
                    value={defaultModel}
                    onChange={(event) => setDefaultModel(event.target.value)}
                  >
                    <option value="">Not set</option>
                    {defaultModel && !catalog.some((model) => model.id === defaultModel) && (
                      <option value={defaultModel}>{defaultModel} (unavailable)</option>
                    )}
                    {catalog.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDefaultModel('')}
                  disabled={!defaultModel}
                >
                  Reset default model
                </button>
              </div>
              <div className="ai-provider-row">
                <button type="button" onClick={() => void save(false, true)}>
                  <RefreshCw size={13} />
                  Test / Refresh models
                </button>
                <small>
                  {catalog.length} cached models ·{' '}
                  {provider.modelsFetchedAt
                    ? `refreshed ${new Date(provider.modelsFetchedAt).toLocaleString()}`
                    : 'not refreshed yet'}
                </small>
              </div>
              <details
                className="ai-provider-advanced"
                open={provider.id === 'custom' || undefined}
              >
                <summary>Advanced</summary>
                <VisibilityEditor
                  title="Assistant and inline completion"
                  value={filters.chat}
                  models={catalog.filter((model) => supportsAIRole(model, 'assistant'))}
                  onChange={(chat) => setFilters((current) => ({ ...current, chat }))}
                />
                <VisibilityEditor
                  title="Automatic completion"
                  value={filters.completion}
                  models={catalog.filter((model) => supportsAIRole(model, 'completion'))}
                  onChange={(completion) => setFilters((current) => ({ ...current, completion }))}
                />
                <div className="ai-provider-endpoint">
                  <label className="field-label">
                    Endpoint
                    <input
                      type="url"
                      value={endpoint}
                      placeholder="https://example.com/v1"
                      onChange={(event) => setEndpoint(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setEndpoint(AI_DEFAULT_ENDPOINTS[provider.id])}
                  >
                    Reset endpoint
                  </button>
                </div>
                {/^http:/i.test(endpoint.trim()) && (
                  <p className="ai-settings-note">
                    HTTP sends requests without transport encryption. Use it only for a server you
                    trust.
                  </p>
                )}
                {provider.id === 'custom' && (
                  <label className="ai-check">
                    <input
                      type="checkbox"
                      checked={supportsTools}
                      onChange={(event) => setSupportsTools(event.target.checked)}
                    />
                    Supports tool calls (lets the assistant read and propose document edits)
                  </label>
                )}
                <label className="field-label">
                  Manual model IDs
                  <textarea
                    rows={3}
                    value={manual}
                    placeholder="One exact model ID per line"
                    onChange={(event) => setManual(event.target.value)}
                  />
                </label>
              </details>
            </fieldset>
            {error && (
              <p role="alert" className="ai-error">
                {error}
              </p>
            )}
            {status && (
              <p role="status" className="ai-provider-status">
                {status}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="ai-primary" disabled={busy}>
                {busy ? 'Saving…' : `Save ${label}`}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddProvider({
  settings,
  onPick,
  onClose,
}: {
  settings: AISettings;
  onPick: (id: AIProviderId) => void;
  onClose: () => void;
}) {
  const choices = AI_PROVIDER_IDS.filter(
    (id) =>
      id !== 'codestral' &&
      !settings.providers.some((provider) => provider.id === id && provider.configured),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay ai-provider-editor-overlay" />
        <Dialog.Content className="ai-provider-chooser ai-settings-dialog">
          <div className="ai-settings-heading">
            <Dialog.Title>Add provider</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close provider chooser">
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Choose a connection. You can add one of each provider.
          </Dialog.Description>
          <div className="ai-provider-choices">
            {choices.map((id) => (
              <button type="button" key={id} onClick={() => onPick(id)}>
                {AI_PROVIDERS[id].label}
              </button>
            ))}
            {!choices.length && <p>All providers have been added.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AISettingsDialog({
  onClose,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  inline?: boolean;
  onClose?: () => void;
}) {
  const { settings, error, refresh } = useAISettings(true);
  const [message, setMessage] = useState('');
  const [updating, setUpdating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AIProviderId | null>(null);
  const [completionHealth, setCompletionHealth] = useState<{ status: string; error?: string }>({
    status: 'idle',
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; error?: string }>).detail;
      if (detail && ['idle', 'loading', 'ready', 'paused', 'error'].includes(detail.status ?? '')) {
        setCompletionHealth((current) =>
          ['idle', 'loading'].includes(detail.status!) &&
          ['paused', 'error'].includes(current.status)
            ? current
            : { status: detail.status!, error: detail.error },
        );
      }
    };
    window.addEventListener('textra-ai-completion-health', listener);
    return () => window.removeEventListener('textra-ai-completion-health', listener);
  }, []);
  const saveState = useAISaveState();
  async function apply(action: () => Promise<Result<AISettings | null>>) {
    if (updating) return;
    setUpdating(true);
    setMessage('');
    try {
      const result = await trackAISave(action());
      if (result.ok && result.value) publishAISettings(result.value);
      else if (!result.ok && result.code !== 'AI_CANCELLED') setMessage(result.error);
    } catch {
      setMessage('Could not update AI settings. Try again.');
    } finally {
      setUpdating(false);
    }
  }
  function roleSelector(role: AIRole) {
    if (!settings) return null;
    const ref = settings.roleDefaults[role];
    const unavailable = modelUnavailableReason(settings, ref, role);
    return (
      <div className="ai-role-row" key={role}>
        <span>{LABELS[role]}</span>
        <div className="ai-role-model">
          <ModelPicker
            settings={settings}
            role={role}
            label={`${LABELS[role]} model`}
            value={settings.roleDefaults[role]}
            disabled={updating}
            placeholder="Not configured"
            onChange={(model) => void apply(() => window.textra.setAIRoleDefault({ role, model }))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`Clear ${LABELS[role]} model`}
            disabled={updating || !settings.roleDefaults[role]}
            onClick={() => void apply(() => window.textra.setAIRoleDefault({ role, model: null }))}
          >
            <X size={13} />
          </button>
        </div>
        {unavailable && ref && (
          <div className="ai-role-availability" role="status">
            <span>{unavailable}</span>
            {ref.provider !== 'codestral' && (
              <button type="button" onClick={() => setEditing(ref.provider)}>
                Edit provider
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  const provider = editing
    ? (settings?.providers.find((item) => item.id === editing) ?? {
        id: editing,
        configured: false,
        defaultModel: null,
        models: [],
        modelsFetchedAt: null,
        error: null,
      })
    : null;
  const connections =
    settings?.providers.filter((item) => item.id !== 'codestral' && item.configured) ?? [];
  return (
    <div className="ai-settings-dialog ai-settings-inline">
      <div className="ai-settings-heading">
        <h2>
          <AIChat size={18} aria-hidden="true" />
          AI Settings
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close AI settings"
          onClick={() => {
            onClose?.();
            onOpenChange?.(false);
          }}
        >
          <X size={18} />
        </button>
      </div>
      <p>Choose models and manage your connections.</p>
      <div className="ai-settings-scroll">
        {error && (
          <div className="ai-settings-failure">
            <p role="alert" className="ai-error">
              {error}
            </p>
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {!settings && !error && <p role="status">Loading AI settings…</p>}
        {settings && (
          <>
            <section className="ai-role-defaults" aria-label="Default models">
              <h3>Models</h3>
              {(['assistant', 'inlineCompletion'] as const).map(roleSelector)}
              <p className="ai-settings-note">
                Assistant and Ctrl/Cmd+I selections in the workspace are temporary until restart.
              </p>
            </section>
            <section className="ai-completion-settings" aria-label="Automatic completion">
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={settings.completion.enabled}
                  disabled={updating}
                  onChange={(event) =>
                    void apply(() =>
                      window.textra.setAICompletionSettings({
                        enabled: event.target.checked,
                        allowOutsideEnvironments: settings.completion.allowOutsideEnvironments,
                      }),
                    )
                  }
                />
                <span>Enable automatic completion (ghost text)</span>
              </label>
              {settings.completion.enabled && (
                <>
                  {roleSelector('completion')}
                  <label className="ai-check">
                    <input
                      type="checkbox"
                      checked={settings.completion.allowOutsideEnvironments}
                      disabled={updating}
                      onChange={(event) =>
                        void apply(() =>
                          window.textra.setAICompletionSettings({
                            enabled: settings.completion.enabled,
                            allowOutsideEnvironments: event.target.checked,
                          }),
                        )
                      }
                    />
                    Allow automatic completion in ordinary prose
                  </label>
                </>
              )}
              <p className="ai-settings-note">
                Automatic suggestions use environments and math; ordinary prose stays quiet by
                default. Ctrl/Cmd+I opens an inline edit prompt. Tab accepts completion ghost text;
                Escape dismisses it.
              </p>
              {settings.completion.enabled && settings.roleDefaults.completion && (
                <p className="ai-settings-note">
                  Suggestions use{' '}
                  {settings.roleDefaults.completion.provider === 'ollama-local' &&
                  /cloud/i.test(settings.roleDefaults.completion.model)
                    ? 'Ollama Cloud via Local Ollama'
                    : AI_PROVIDERS[settings.roleDefaults.completion.provider].label}
                  .
                </p>
              )}
              {['paused', 'error'].includes(completionHealth.status) && (
                <p className="ai-error" role="status">
                  {completionHealth.error || 'Automatic suggestions are paused.'}
                </p>
              )}
              {['paused', 'error'].includes(completionHealth.status) && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setCompletionHealth({ status: 'idle' });
                    window.dispatchEvent(new Event('textra-ai-completion-retry'));
                  }}
                >
                  Retry paused suggestions
                </button>
              )}
            </section>
            <section aria-label="Provider connections">
              <div className="ai-connections-heading">
                <h3>Connections</h3>
                <button type="button" onClick={() => setAdding(true)}>
                  <Plus size={13} />
                  Add provider
                </button>
              </div>
              {!connections.length && <p className="ai-settings-note">No connections yet.</p>}
              <div className="ai-provider-connections">
                {connections.map((connection) => (
                  <section
                    key={connection.id}
                    className="ai-provider-connection"
                    aria-label={providerLabel(connection)}
                  >
                    <div className="ai-connection-main">
                      <label className="ai-check">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${providerLabel(connection)} enabled`}
                          checked={connection.enabled !== false}
                          disabled={updating}
                          onChange={(event) =>
                            void apply(() =>
                              window.textra.configureAIProvider({
                                provider: connection.id,
                                enabled: event.target.checked,
                                endpoint:
                                  connection.endpoint ?? AI_DEFAULT_ENDPOINTS[connection.id],
                                displayName: connection.displayName,
                                defaultModel: connection.defaultModel,
                                filters: connection.filters ?? {
                                  chat: allModels(),
                                  completion: allModels(),
                                },
                                supportsTools: connection.supportsTools !== false,
                                manualModels: connection.manualModels ?? [],
                              }),
                            )
                          }
                        />
                        <span>{providerLabel(connection)}</span>
                      </label>
                      <div className="ai-connection-meta">
                        <small>
                          {connection.enabled === false
                            ? 'Disabled'
                            : `${modelGroups(settings, connection.id, 'assistant')[0]?.models.length ?? 0} assistant · ${modelGroups(settings, connection.id, 'completion')[0]?.models.length ?? 0} automatic`}
                        </small>
                        <small title={connection.endpoint ?? AI_DEFAULT_ENDPOINTS[connection.id]}>
                          {connection.endpoint ?? AI_DEFAULT_ENDPOINTS[connection.id]}
                        </small>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${providerLabel(connection)}`}
                      onClick={() => setEditing(connection.id)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${providerLabel(connection)}`}
                      disabled={updating}
                      onClick={() =>
                        void apply(() =>
                          window.textra.removeAIProvider({ provider: connection.id }),
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                    {connection.error && (
                      <p className="ai-error" role="status">
                        {connection.error}
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </section>
            <label className="ai-check ai-auto-send">
              <input
                type="checkbox"
                checked={settings.autoSendProblems}
                disabled={updating}
                onChange={(event) =>
                  void apply(() =>
                    window.textra.setAIAutoSend({ autoSendProblems: event.target.checked }),
                  )
                }
              />
              <span>
                Automatically send Problems prompts
                <small>
                  Ask in Chat sends the selected error and nearby source immediately. Leave off to
                  review first.
                </small>
              </span>
            </label>
            <p className="ai-settings-note">
              Keys are encrypted locally. Requests go to the selected connection; local-only models
              stay on this computer.
            </p>
            {message && (
              <p role="alert" className="ai-error">
                {message}
              </p>
            )}
          </>
        )}
      </div>
      <SaveFooter
        state={saveState}
        error={saveState === 'error' ? 'A setting was not saved. Review the error above.' : null}
        onSave={async () => {
          await aiSavesSettled();
          return currentAISaveState() !== 'error';
        }}
        onClose={() => {
          onClose?.();
          onOpenChange?.(false);
        }}
      />
      {adding && settings && (
        <AddProvider
          settings={settings}
          onClose={() => setAdding(false)}
          onPick={(id) => {
            setAdding(false);
            setEditing(id);
          }}
        />
      )}
      {provider && (
        <ProviderEditor key={provider.id} provider={provider} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

export const AISettingsPanel = AISettingsDialog;
