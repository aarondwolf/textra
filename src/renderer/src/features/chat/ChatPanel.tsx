import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIMessage, AISettings } from '../../../../shared/api';
import { AI_SETTINGS_CHANGED, AISettingsForm } from './AISettingsForm';
import { MarkdownPreview } from '../markdown/MarkdownPreview';
import { ArrowUp, Check, ChevronDown, Copy, Square } from '../../icons';
import './chat.css';

function ResponseContent({ text, incomplete = false }: { text: string; incomplete?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <>
      {incomplete && <small className="ai-partial-label">Incomplete response</small>}
      <MarkdownPreview source={text} className="ai-message-markdown" />
      <button
        className="ai-copy-response"
        type="button"
        aria-label={copied ? 'Copied response' : 'Copy response'}
        title={copied ? 'Copied' : 'Copy response'}
        onClick={() => {
          setCopyError('');
          void window.textra
            .copyText(text)
            .then((result) => {
              if (result.ok) setCopied(true);
              else setCopyError(result.error);
            })
            .catch(() => setCopyError('Could not copy this response. Try again.'));
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      {copyError && (
        <p role="alert" className="ai-copy-error">
          {copyError}
        </p>
      )}
    </>
  );
}

export interface ChatDraft {
  id: number;
  text: string;
}

function appendQuestion(messages: AIMessage[], text: string): AIMessage[] {
  const last = messages.at(-1);
  // A failed/cancelled response leaves a user turn pending. Keep SDK turns alternating.
  if (last?.role === 'user') {
    return [...messages.slice(0, -1), { role: 'user', text: `${last.text}\n\n${text}` }];
  }
  return [...messages, { role: 'user', text }];
}

export function ChatPanel({
  draft,
  onDraftConsumed,
  active = true,
  resetKey,
}: {
  draft: ChatDraft | null;
  onDraftConsumed?: () => void;
  active?: boolean;
  /** Changing projects clears the conversation so source context never crosses projects. */
  resetKey?: string | null;
}) {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [retryMessages, setRetryMessages] = useState<AIMessage[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [partialResponse, setPartialResponse] = useState('');
  const sending = useRef(false);
  const requestId = useRef(0);
  const consumedDraft = useRef<number | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const streamRequestId = useRef<string | null>(null);
  const previousResetKey = useRef(resetKey);

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    const currentId = ++requestId.current;
    streamRequestId.current = null;
    setPartialResponse('');
    followResponse.current = true;
    setMessages([]);
    setInput('');
    setError('');
    setRetryMessages(null);
    if (sending.current) {
      setCancelling(true);
      void window.textra
        .cancelAIMessage()
        .finally(() => {
          if (currentId !== requestId.current) return;
          sending.current = false;
          setLoading(false);
          setCancelling(false);
        })
        .catch(() => {
          if (currentId === requestId.current)
            setError('Could not confirm cancellation of the previous response.');
        });
    }
  }, [resetKey]);

  const refreshSettings = useCallback(async () => {
    try {
      const result = await window.textra.getAISettings();
      if (result.ok) {
        setSettings(result.value);
        setSettingsError('');
      } else setSettingsError(result.error);
    } catch {
      setSettingsError('Could not load Gemini settings. Please try again.');
    }
  }, []);

  useEffect(() => {
    if (active) void refreshSettings();
    const refresh = () => void refreshSettings();
    window.addEventListener(AI_SETTINGS_CHANGED, refresh);
    return () => window.removeEventListener(AI_SETTINGS_CHANGED, refresh);
  }, [active, refreshSettings]);

  useEffect(() => {
    return window.textra.onAIResponseChunk((event) => {
      if (event.requestId === streamRequestId.current) setPartialResponse(event.text);
    });
  }, []);

  useEffect(() => {
    const container = history.current;
    if (container && followResponse.current && active) container.scrollTop = container.scrollHeight;
  }, [messages, partialResponse, loading, active]);

  const send = useCallback(async (conversation: AIMessage[]) => {
    if (sending.current) return;
    if (
      conversation.length > 40 ||
      conversation.some((message) => message.text.length > 32_000) ||
      conversation.reduce((size, message) => size + message.text.length, 0) > 64_000
    ) {
      setInput(conversation.at(-1)?.text ?? '');
      setError(
        'This conversation has reached its size limit. Start a new chat or shorten the question. Your question is preserved below.',
      );
      return;
    }
    sending.current = true;
    const currentId = ++requestId.current;
    const streamId = crypto.randomUUID();
    streamRequestId.current = streamId;
    setPartialResponse('');
    followResponse.current = true;
    setMessages(conversation);
    setLoading(true);
    setError('');
    setRetryMessages(null);
    try {
      const result = await window.textra.sendAIMessage({
        messages: conversation,
        requestId: streamId,
      });
      if (currentId !== requestId.current) return;
      if (result.ok) {
        setPartialResponse('');
        setMessages([...conversation, { role: 'model', text: result.value }]);
      } else {
        setError(
          result.code === 'AI_RATE_LIMIT'
            ? 'Gemini is receiving too many requests. Please wait a little and retry. Google may also have a daily quota for your account.'
            : result.error,
        );
        setRetryMessages(conversation);
      }
    } catch {
      if (currentId !== requestId.current) return;
      setError('Could not reach Gemini. Check your connection and try again.');
      setRetryMessages(conversation);
    } finally {
      if (currentId === requestId.current) {
        streamRequestId.current = null;
        sending.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!draft || !settings?.configured || consumedDraft.current === draft.id || loading) return;
    let current = true;
    // Recheck consent at the moment a Problems prompt is consumed.
    void window.textra
      .getAISettings()
      .then((result) => {
        if (!current) return;
        consumedDraft.current = draft.id;
        onDraftConsumed?.();
        if (
          result.ok &&
          result.value.configured &&
          result.value.autoSendProblems &&
          !sending.current
        ) {
          void send(appendQuestion(messages, draft.text));
        } else {
          setInput((previous) => (previous ? `${previous}\n\n${draft.text}` : draft.text));
          if (!result.ok) setSettingsError(result.error);
        }
      })
      .catch(() => {
        if (!current) return;
        consumedDraft.current = draft.id;
        onDraftConsumed?.();
        setInput((previous) => (previous ? `${previous}\n\n${draft.text}` : draft.text));
        setSettingsError(
          'Could not check auto-send settings. Review the snippet and send manually.',
        );
      });
    return () => {
      current = false;
    };
  }, [draft, settings?.configured, loading, messages, onDraftConsumed, send]);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    const currentId = ++requestId.current;
    streamRequestId.current = null;
    try {
      const result = await window.textra.cancelAIMessage();
      if (currentId !== requestId.current) return;
      setError(result.ok ? 'Response cancelled. You can retry when ready.' : result.error);
    } catch {
      if (currentId !== requestId.current) return;
      setError('Could not confirm cancellation. Please wait before retrying.');
    } finally {
      if (currentId === requestId.current) {
        sending.current = false;
        setLoading(false);
        setCancelling(false);
        setRetryMessages(messages);
      }
    }
  }

  return (
    <section className="ai-chat" aria-label="AI debugging chat">
      <header className="ai-chat-header">
        <div>
          <strong>Chat</strong>
        </div>
        <button
          type="button"
          disabled={loading || messages.length === 0}
          onClick={() => {
            setMessages([]);
            streamRequestId.current = null;
            setPartialResponse('');
            followResponse.current = true;
            setError('');
            setRetryMessages(null);
          }}
        >
          New chat
        </button>
        <button
          type="button"
          onClick={() => setShowSettings((value) => !value)}
          aria-expanded={showSettings}
        >
          {showSettings ? 'Back' : 'Settings'}
        </button>
      </header>
      {settingsError && (
        <div className="ai-settings-failure">
          <p role="alert">{settingsError}</p>
          <button type="button" onClick={() => void refreshSettings()}>
            Retry settings
          </button>
        </div>
      )}
      {!settings && !settingsError && <p role="status">Loading AI settings…</p>}
      {(settings && !settings.configured) || showSettings ? (
        <div className="ai-chat-setup">
          <AISettingsForm
            onSettingsChanged={(value) => {
              setSettings(value);
              if (value.configured) setShowSettings(false);
            }}
          />
        </div>
      ) : settings?.configured ? (
        <>
          {messages.length === 0 && (
            <p className="ai-chat-privacy">
              Messages and selected snippets are sent to Google. No file access or editing tools.
              Check suggestions before applying them.
            </p>
          )}
          <div
            ref={history}
            className="ai-chat-history"
            onScroll={(event) => {
              const container = event.currentTarget;
              followResponse.current =
                container.scrollHeight - container.scrollTop - container.clientHeight < 64;
            }}
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 && (
              <div className="ai-chat-empty">
                <strong>Let’s untangle that error.</strong>
                <p>
                  Ask a LaTeX question or choose Ask in Chat from Problems. Review any source
                  snippet before sending.
                </p>
              </div>
            )}
            {messages.map((message, index) => (
              <article
                className={`ai-message ai-message-${message.role}`}
                key={index}
                aria-label={message.role === 'model' ? 'Assistant response' : 'Your message'}
              >
                {message.role === 'model' ? (
                  <ResponseContent text={message.text} />
                ) : (
                  <>
                    <strong>You</strong>
                    <div className="ai-message-text">{message.text}</div>
                  </>
                )}
              </article>
            ))}
            {partialResponse && (
              <article
                className="ai-message ai-message-model"
                aria-label={loading ? 'Response in progress' : 'Incomplete response'}
              >
                <ResponseContent text={partialResponse} incomplete={!loading} />
              </article>
            )}
            {loading && !partialResponse && (
              <p className="ai-chat-typing" role="status">
                Gemini is thinking<span aria-hidden="true">…</span>
              </p>
            )}
          </div>
          {error && (
            <div className="ai-chat-failure">
              <p role="alert" className="ai-error">
                {error}
              </p>
              {retryMessages && !loading && (
                <button type="button" onClick={() => void send(retryMessages)}>
                  Retry response
                </button>
              )}
            </div>
          )}
          <form
            className="ai-chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              if (!input.trim() || sending.current) return;
              const text = input.trim();
              setInput('');
              void send(appendQuestion(messages, text));
            }}
          >
            <textarea
              id="ai-chat-message"
              aria-label="Message Gemini"
              rows={2}
              value={input}
              maxLength={30000}
              placeholder="Ask about your LaTeX…"
              onChange={(event) => setInput(event.target.value)}
            />
            <div className="ai-chat-actions">
              <button
                type="button"
                className="ai-chat-model"
                disabled
                aria-label="Model: Gemini 3.5 Flash Lite (locked)"
                title="Gemini 3.5 Flash Lite · Model selection is locked"
              >
                <span className="ai-chat-model-label">Gemini 3.5 Flash Lite</span>
                <ChevronDown size={10} aria-hidden="true" />
              </button>
              {loading ? (
                <button
                  type="button"
                  className="ai-chat-send"
                  data-active="true"
                  disabled={cancelling}
                  onClick={() => void cancel()}
                  aria-label={cancelling ? 'Cancelling response' : 'Cancel response'}
                  title="Stop response"
                >
                  <Square size={13} weight="fill" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="ai-chat-send"
                  data-active={Boolean(input.trim())}
                  disabled={!input.trim()}
                  aria-label="Send message"
                  title="Send message"
                >
                  <ArrowUp size={14} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
