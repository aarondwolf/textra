import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type {
  AIProviderSettings,
  AISettings,
  OllamaLocalStatus,
  Result,
} from '../../../../shared/api';
import { AI_PROVIDERS, type AIProviderId, type AIProviderLink } from '../../../../shared/ai';
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

  const local = provider.id === 'ollama-local';
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
      className="ai-provider-card"
      data-configured={provider.configured}
      aria-label={info.label}
    >
      <header>
        <div>
          <h4>{info.label}</h4>
          <small>{info.protocol}</small>
        </div>
        <span className="ai-provider-pill" data-tone={pill.tone}>
          {pill.text}
        </span>
      </header>

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
          <small>TeXtra checks 127.0.0.1:11434 every few seconds.</small>
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
          <small>Requests stay on this computer.</small>
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
              <button type="button" disabled={Boolean(busy)} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <small>
            The key is tested by listing your models, then encrypted with your OS account.{' '}
            {info.links.keys && (
              <a
                href={info.links.keys}
                onClick={(event) => {
                  event.preventDefault();
                  openLink(provider.id, 'keys', setError);
                }}
              >
                Get a key
              </a>
            )}
          </small>
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
  const [ollama, setOllama] = useState<OllamaLocalStatus | null>(null);
  const [message, setMessage] = useState('');
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

  async function apply(action: () => Promise<Result<AISettings>>) {
    setMessage('');
    try {
      const result = await trackAISave(action());
      if (result.ok) publishAISettings(result.value);
      else setMessage(result.error);
    } catch {
      setMessage('Could not update AI settings. Please try again.');
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
          <Dialog.Description>
            Connect one or more providers. TeXtra lists each provider’s models and sends requests in
            that provider’s own format.
          </Dialog.Description>
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
                <section className="ai-settings-default" aria-label="Default model">
                  <div>
                    <h3>Default model</h3>
                    <p>Used for new chats and Agent requests. You can switch models in the chat.</p>
                  </div>
                  <ModelPicker
                    settings={settings}
                    label="Overall default model"
                    placeholder={
                      settings.providers.some((provider) => provider.configured)
                        ? 'Choose a model'
                        : 'Connect a provider below'
                    }
                    value={settings.defaultModel}
                    onChange={(ref) => void apply(() => window.textra.setAIDefaultModel(ref))}
                  />
                </section>
                <h3>Providers</h3>
                <div className="ai-provider-grid">
                  {settings.providers.map((provider) => (
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
                      Clicking Ask in Chat sends the selected error and nearby source to the chosen
                      model immediately. Off by default so you can review the snippet first.
                    </small>
                  </span>
                </label>
                <p className="ai-settings-note">
                  Only the conversation and snippets you send are shared, and only with the provider
                  of the model you choose. Local Ollama never leaves this computer. Keys are
                  encrypted with your OS account and stored apart from portable settings.
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
