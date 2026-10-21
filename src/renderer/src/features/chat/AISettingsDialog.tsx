import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type {
  AIProviderSettings,
  AISettings,
  OllamaLocalStatus,
  Result,
} from '../../../../shared/api';
import {
  AI_PROVIDERS,
  AI_ROLES,
  type AIRole,
  type AIProviderId,
  type AIProviderLink,
} from '../../../../shared/ai';
import { Play, RefreshCw, X } from '../../icons';
import { ModelPicker } from './ModelPicker';
import {
  aiSavesSettled,
  publishAISettings,
  trackAISave,
  useAISaveState,
  useAISettings,
} from './useAISettings';
import { SaveFooter } from '../save-status/SaveFooter';
import './ai-settings.css';

const ROLE_LABELS: Record<AIRole, string> = {
  chat: 'Chat',
  agent: 'Agent',
  completion: 'Automatic completion',
  inlineCompletion: 'Inline completion (Ctrl+I)',
};

function openLink(provider: AIProviderId, link: AIProviderLink, onError: (text: string) => void) {
  void window.textra
    .openAIProviderLink({ provider, link })
    .then((result) => {
      if (!result.ok) onError(result.error);
    })
    .catch(() => onError('Could not open the provider page.'));
}

function fetchedLabel(time: number | null): string {
  if (!time) return '';
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes} min ago`;
  return `updated ${new Date(time).toLocaleDateString()}`;
}

function ProviderCard({
  provider,
  settings,
  ollama,
  onOllamaStatus,
  registerDraft,
}: {
  provider: AIProviderSettings;
  settings: AISettings;
  ollama: OllamaLocalStatus | null;
  onOllamaStatus: (status: OllamaLocalStatus) => void;
  /** Lets the dialog's Save settings button submit a typed but unsaved key. */
  registerDraft: (provider: AIProviderId, save: (() => Promise<boolean>) | null) => void;
}) {
  const info = AI_PROVIDERS[provider.id];
  const Heading = info.parent ? 'h5' : 'h4';
  const subproviders = settings.providers.filter(
    (candidate) => AI_PROVIDERS[candidate.id].parent === provider.id,
  );
  const keyId = useId();
  const [apiKey, setApiKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function run(
    label: string,
    action: () => Promise<Result<AISettings | null>>,
    done?: string,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(label);
    setError('');
    setStatus('');
    try {
      const result = await trackAISave(action());
      if (!result.ok) setError(result.error);
      else if (result.value) {
        publishAISettings(result.value);
        if (done) setStatus(done);
      }
      return result.ok;
    } catch {
      setError('The request failed. Please try again.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save(): Promise<boolean> {
    if (info.needsKey && !apiKey.trim()) return true;
    const ok = await run(
      'save',
      () =>
        window.textra.saveAIProvider(
          info.needsKey
            ? { provider: provider.id, apiKey: apiKey.trim() }
            : { provider: provider.id },
        ),
      'Connected. Models loaded.',
    );
    if (ok) {
      setApiKey('');
      setEditing(false);
    }
    return ok;
  }

  async function startOllama() {
    if (busy) return;
    setBusy('start');
    setError('');
    setStatus('');
    try {
      const result = await window.textra.startOllama();
      if (result.ok) {
        onOllamaStatus(result.value);
        setStatus('Ollama is running.');
      } else setError(result.error);
    } catch {
      setError('Could not start Ollama.');
    } finally {
      setBusy(null);
    }
  }

  const local = info.local;
  const running = Boolean(ollama?.running);
  let pill: { text: string; tone: 'ok' | 'warn' | 'off' };
  if (local)
    pill = running
      ? { text: ollama?.version ? `Running ${ollama.version}` : 'Running', tone: 'ok' }
      : ollama === null
        ? { text: 'Checking…', tone: 'off' }
        : ollama.installed
          ? { text: 'Not running', tone: 'warn' }
          : { text: 'Not installed', tone: 'off' };
  else
    pill = provider.configured
      ? { text: 'Connected', tone: 'ok' }
      : { text: 'Not set up', tone: 'off' };
  const showKeyForm = info.needsKey && (!provider.configured || editing);
  const hasDraft = showKeyForm && Boolean(apiKey.trim());
  useEffect(() => {
    registerDraft(provider.id, hasDraft ? save : null);
    return () => registerDraft(provider.id, null);
    // save reads the latest key; re-register whenever the draft changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraft, apiKey, provider.id, registerDraft]);

  return (
    <section
      className={`ai-provider-card${info.parent ? ' ai-provider-subcard' : ''}`}
      data-configured={provider.configured}
      aria-label={info.label}
    >
      <header>
        <Heading>{info.label}</Heading>
        <span className="ai-provider-pill" data-tone={pill.tone}>
          {pill.text}
        </span>
      </header>
      {info.setupHint && <p className="ai-settings-note">{info.setupHint}</p>}

      {local && !running && ollama && (
        <div className="ai-provider-row">
          {ollama.installed ? (
            <button
              type="button"
              className="ai-primary"
              disabled={Boolean(busy)}
              onClick={() => void startOllama()}
            >
              <Play size={12} weight="fill" aria-hidden="true" />
              {busy === 'start' ? 'Starting…' : 'Start Ollama'}
            </button>
          ) : (
            <button type="button" onClick={() => openLink(provider.id, 'download', setError)}>
              Download Ollama
            </button>
          )}
          <small>Run models through Ollama.</small>
        </div>
      )}
      {local && running && !provider.configured && (
        <div className="ai-provider-row">
          <button
            type="button"
            className="ai-primary"
            disabled={Boolean(busy)}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Loading models…' : 'Use local Ollama'}
          </button>
          <small>Use your Ollama models.</small>
        </div>
      )}

      {showKeyForm && (
        <form
          className="ai-provider-key"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={keyId}>{info.keyLabel}</label>
          <div className="ai-provider-row">
            <input
              id={keyId}
              type="password"
              value={apiKey}
              placeholder="Paste your API key"
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button type="submit" className="ai-primary" disabled={Boolean(busy) || !apiKey.trim()}>
              {busy === 'save' ? 'Testing…' : 'Save & load models'}
            </button>
            {editing && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setApiKey('');
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {info.links.keys && (
            <small>
              <a
                href={info.links.keys}
                onClick={(event) => {
                  event.preventDefault();
                  openLink(provider.id, 'keys', setError);
                }}
              >
                Get a key
              </a>
            </small>
          )}
        </form>
      )}

      {provider.configured && (
        <>
          <div className="ai-provider-default">
            <span>Default model</span>
            <ModelPicker
              settings={settings}
              only={provider.id}
              label={`${info.label} default model`}
              value={
                provider.defaultModel
                  ? { provider: provider.id, model: provider.defaultModel }
                  : null
              }
              disabled={Boolean(busy)}
              onChange={(ref) => void run('default', () => window.textra.setAIProviderDefault(ref))}
            />
          </div>
          <div className="ai-provider-row ai-provider-meta">
            <small>
              {provider.models.length} model{provider.models.length === 1 ? '' : 's'}
              {provider.modelsFetchedAt ? ` · ${fetchedLabel(provider.modelsFetchedAt)}` : ''}
            </small>
            <span className="ai-provider-actions">
              <button
                type="button"
                className="ai-icon-text"
                disabled={Boolean(busy) || (local && !running)}
                onClick={() =>
                  void run(
                    'refresh',
                    () => window.textra.refreshAIModels({ provider: provider.id }),
                    'Model list refreshed.',
                  )
                }
              >
                <RefreshCw size={12} aria-hidden="true" />
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
              </button>
              {info.needsKey && !editing && (
                <button type="button" disabled={Boolean(busy)} onClick={() => setEditing(true)}>
                  Replace key
                </button>
              )}
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run('remove', () =>
                    window.textra.removeAIProvider({ provider: provider.id }),
                  )
                }
              >
                {local ? 'Disable' : 'Remove'}
              </button>
            </span>
          </div>
        </>
      )}
      {(error || provider.error) && (
        <p role="alert" className="ai-error">
          {error || provider.error}
        </p>
      )}
      {status && !error && (
        <p role="status" className="ai-provider-status">
          {status}
        </p>
      )}
      {subproviders.map((subprovider) => (
        <ProviderCard
          key={subprovider.id}
          provider={subprovider}
          settings={settings}
          ollama={ollama}
          onOllamaStatus={onOllamaStatus}
          registerDraft={registerDraft}
        />
      ))}
    </section>
  );
}

export function AISettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings, error, refresh } = useAISettings(open);
  const completionModel = settings?.roleDefaults.completion;
  const completionDestination = completionModel
    ? completionModel.provider === 'ollama-local' &&
      /(?:[:/-].*cloud|cloud$)/i.test(completionModel.model)
      ? 'Ollama Cloud via Local Ollama'
      : AI_PROVIDERS[completionModel.provider].label
    : null;
  const [ollama, setOllama] = useState<OllamaLocalStatus | null>(null);
  const [message, setMessage] = useState('');
  const [updating, setUpdating] = useState(false);
  const saveState = useAISaveState();
  const drafts = useRef(new Map<AIProviderId, () => Promise<boolean>>());
  const registerDraft = useCallback(
    (provider: AIProviderId, save: (() => Promise<boolean>) | null) => {
      if (save) drafts.current.set(provider, save);
      else drafts.current.delete(provider);
    },
    [],
  );
  async function saveAll(): Promise<boolean> {
    const results = await Promise.all([...drafts.current.values()].map((save) => save()));
    await aiSavesSettled();
    return results.every(Boolean);
  }

  const checkOllama = useCallback(async () => {
    try {
      const result = await window.textra.getOllamaStatus();
      if (result.ok) setOllama(result.value);
    } catch {
      /* The card shows the last known status. */
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    void checkOllama();
    const timer = window.setInterval(() => void checkOllama(), 4000);
    return () => window.clearInterval(timer);
  }, [open, checkOllama]);

  async function apply(action: () => Promise<Result<AISettings | null>>) {
    if (updating) return;
    setUpdating(true);
    setMessage('');
    try {
      const result = await trackAISave(action());
      if (result.ok && result.value) publishAISettings(result.value);
      else if (result.ok) return;
      else if (result.code === 'AI_CANCELLED') return;
      else setMessage(result.error);
    } catch {
      setMessage('Could not update AI settings. Please try again.');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay ai-settings-overlay" />
        <Dialog.Content className="ai-settings-dialog">
          <div className="ai-settings-heading">
            <Dialog.Title>AI settings</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close AI settings">
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>Connect a provider, then choose a model.</Dialog.Description>
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
                  <h3>Default models</h3>
                  <p className="ai-settings-note">
                    Choose independently for each role. Chat and Agent choices in the workspace last
                    until restart.
                  </p>
                  {AI_ROLES.map((role) => (
                    <div className="ai-settings-default" key={role}>
                      <span>{ROLE_LABELS[role]}</span>
                      <div className="ai-role-model">
                        <ModelPicker
                          settings={settings}
                          role={role}
                          label={`${ROLE_LABELS[role]} model`}
                          value={settings.roleDefaults[role]}
                          disabled={updating}
                          placeholder="Not configured"
                          onChange={(model) =>
                            void apply(() => window.textra.setAIRoleDefault({ role, model }))
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Clear ${ROLE_LABELS[role]} model`}
                          disabled={updating || !settings.roleDefaults[role]}
                          onClick={() =>
                            void apply(() => window.textra.setAIRoleDefault({ role, model: null }))
                          }
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
                <section className="ai-completion-settings" aria-label="Automatic completion">
                  {completionDestination && (
                    <p className="ai-settings-note">
                      Automatic suggestions use {completionDestination}.
                    </p>
                  )}
                  <label className="ai-auto-send">
                    <input
                      type="checkbox"
                      checked={settings.completion.enabled}
                      disabled={updating || !settings.roleDefaults.completion}
                      onChange={(event) =>
                        void apply(() =>
                          window.textra.setAICompletionSettings({
                            enabled: event.target.checked,
                            allowOutsideEnvironments: settings.completion.allowOutsideEnvironments,
                          }),
                        )
                      }
                    />
                    <span>
                      Enable automatic completion
                      <small>
                        Suggest text as you type. Enabling asks permission to share nearby source
                        with the selected model.
                      </small>
                    </span>
                  </label>
                  <label className="ai-auto-send">
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
                    <span>
                      Allow automatic completion outside environments
                      <small>Off by default. Ctrl+I requests inline completion manually.</small>
                    </span>
                  </label>
                </section>
                <h3>Providers</h3>
                <div className="ai-provider-grid">
                  {settings.providers
                    .filter((provider) => !AI_PROVIDERS[provider.id].parent)
                    .map((provider) => (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        settings={settings}
                        ollama={ollama}
                        onOllamaStatus={setOllama}
                        registerDraft={registerDraft}
                      />
                    ))}
                </div>
                <label className="ai-auto-send">
                  <input
                    type="checkbox"
                    checked={settings.autoSendProblems}
                    onChange={(event) =>
                      void apply(() =>
                        window.textra.setAIAutoSend({ autoSendProblems: event.target.checked }),
                      )
                    }
                  />
                  <span>
                    Automatically send Problems prompts
                    <small>
                      Ask in Chat sends the selected error and nearby source immediately. Leave off
                      to review before sending.
                    </small>
                  </span>
                </label>
                <p className="ai-settings-note">
                  Keys are encrypted on this computer. Sent messages and source go to your chosen
                  provider. Local-only models stay on this computer.
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
            error={
              saveState === 'error' ? 'The last change was not saved. See the card above.' : null
            }
            onSave={saveAll}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Settings-window entry point: a short summary and a button that opens the AI dialog. */
export function AISettingsLauncher() {
  const [open, setOpen] = useState(false);
  const { settings } = useAISettings(true);
  const connected = settings?.providers.filter((provider) => provider.configured) ?? [];
  return (
    <section className="ai-settings-launcher">
      <h3>AI Chat</h3>
      <p className="setup-hint">
        {connected.length
          ? `Connected: ${connected.map((provider) => AI_PROVIDERS[provider.id].label).join(', ')}.`
          : 'No AI provider is connected yet. AI is optional; editing and compiling never need it.'}
      </p>
      <button type="button" onClick={() => setOpen(true)}>
        Configure AI providers…
      </button>
      <AISettingsDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
