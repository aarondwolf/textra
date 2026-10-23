import { lazy, Suspense, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { AIProviderSettings, AISettings, Result } from '../../../../shared/api';
import {
  AI_DEFAULT_ENDPOINTS,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AIModelVisibility,
  type AIProviderId,
  type AIRole,
} from '../../../../shared/ai';
import { Pencil, Plus, Trash2, X } from '../../icons';
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
import { StatusMessage } from '../../components/Layout';
const ProviderEditor = lazy(() => import('./AIProviderEditor'));

const LABELS: Record<AIRole, string> = {
  assistant: 'Assistant',
  inlineCompletion: 'Inline edit (Ctrl/Cmd+I)',
  completion: 'Automatic completion (ghost text)',
};
const allModels = (): AIModelVisibility => ({ mode: 'all', models: [] });
const providerLabel = (provider: AIProviderSettings) =>
  provider.displayName || AI_PROVIDERS[provider.id].label;

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

export function AISettingsPanel({
  onClose,
  onOpenChange,
  embedded = false,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  inline?: boolean;
  embedded?: boolean;
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
      <h3>AI Settings</h3>
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
      {!embedded && (
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
      )}
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
        <Suspense fallback={<StatusMessage>Loading provider settings…</StatusMessage>}>
          <ProviderEditor key={provider.id} provider={provider} onClose={() => setEditing(null)} />
        </Suspense>
      )}
    </div>
  );
}

export const AISettingsDialog = AISettingsPanel;
