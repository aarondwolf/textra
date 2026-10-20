import { useEffect, useId, useState } from 'react';
import type { AISettings } from '../../../../shared/api';
import './chat.css';

export const AI_SETTINGS_CHANGED = 'textra-ai-settings-changed';

export function AISettingsForm({
  onSettingsChanged,
}: {
  onSettingsChanged?: (settings: AISettings) => void;
}) {
  const keyId = useId();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    let current = true;
    void window.textra
      .getAISettings()
      .then((result) => {
        if (!current) return;
        if (result.ok) setSettings(result.value);
        else setError(result.error);
      })
      .catch(() => {
        if (current) setError('Could not load AI settings. Reopen settings to try again.');
      });
    return () => {
      current = false;
    };
  }, []);

  function updateSettings(value: AISettings) {
    setSettings(value);
    window.dispatchEvent(new Event(AI_SETTINGS_CHANGED));
    onSettingsChanged?.(value);
  }

  async function saveKey() {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await window.textra.saveAIKey({ apiKey: apiKey.trim() });
      if (result.ok) {
        setApiKey('');
        setReplacing(false);
        updateSettings(result.value);
        setStatus(
          settings?.configured
            ? 'API key tested and replaced.'
            : 'API key tested and saved. You can start chatting.',
        );
      } else setError(result.error);
    } catch {
      setError('Could not test the key. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteKey() {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await window.textra.deleteAIKey();
      if (!result.ok) setError(result.error);
      else if (result.value) {
        setApiKey('');
        setReplacing(false);
        updateSettings(result.value);
        setStatus('Saved API key deleted from TeXtra.');
      }
    } catch {
      setError('Could not delete the saved key. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function changeAutoSend(autoSendProblems: boolean) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await window.textra.setAIAutoSend({ autoSendProblems });
      if (result.ok) updateSettings(result.value);
      else setError(result.error);
    } catch {
      setError('Could not update AI settings. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-settings" aria-label="Gemini debugging settings">
      <h3>Debug with Gemini</h3>
      <p>
        TeXtra uses Gemini 3.5 Flash Lite for fast, conversational LaTeX debugging. Google offers a
        free API tier; availability and usage limits depend on your account and region.
      </p>
      {(!settings?.configured || replacing) && (
        <ol>
          <li>
            Get an API key from{' '}
            <a
              href="https://aistudio.google.com/"
              onClick={(event) => {
                event.preventDefault();
                void window.textra.openAIStudio().then((result) => {
                  if (!result.ok) setError(result.error);
                });
              }}
            >
              Google AI Studio
            </a>
            .
          </li>
          <li>
            {settings?.configured
              ? 'Test a replacement key before it replaces your saved key.'
              : 'Paste your key below. Save & Test Key sends a small verification request.'}
          </li>
        </ol>
      )}
      {settings?.configured && (
        <div className="ai-saved-key">
          <p className="ai-key-ready">A tested API key is saved.</p>
          <p>TeXtra stores one API key at a time.</p>
          <div className="ai-key-actions">
            <button
              type="button"
              disabled={busy || replacing}
              aria-expanded={replacing}
              onClick={() => {
                setApiKey('');
                setError('');
                setStatus('');
                setReplacing(true);
              }}
            >
              Replace key
            </button>
            <button type="button" disabled={busy} onClick={() => void deleteKey()}>
              Delete key
            </button>
          </div>
        </div>
      )}
      {(!settings?.configured || replacing) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <label htmlFor={keyId}>
            {settings?.configured ? 'Replace Gemini API key' : 'Gemini API key'}
          </label>
          <input
            id={keyId}
            type="password"
            value={apiKey}
            placeholder="Paste your API key"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button type="submit" disabled={busy || !apiKey.trim()}>
            {busy
              ? 'Please wait…'
              : settings?.configured
                ? 'Test & Replace Key'
                : 'Save & Test Key'}
          </button>
          {replacing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setApiKey('');
                setError('');
                setStatus('');
                setReplacing(false);
              }}
            >
              Cancel replacement
            </button>
          )}
        </form>
      )}
      <label className="ai-auto-send">
        <input
          type="checkbox"
          checked={settings?.autoSendProblems ?? false}
          disabled={busy || !settings}
          onChange={(event) => void changeAutoSend(event.target.checked)}
        />
        <span>
          Automatically send Problems prompts
          <small>
            Clicking Ask in Chat sends the selected error and nearby source to Google immediately.
            Off by default so you can review the snippet first.
          </small>
        </span>
      </label>
      <p>
        Only the conversation and snippets you send are shared with Google. This assistant cannot
        read, write, or change workspace files. Chat history stays in this window session; the API
        key is stored separately from portable settings.
      </p>
      {error && (
        <p role="alert" className="ai-error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
