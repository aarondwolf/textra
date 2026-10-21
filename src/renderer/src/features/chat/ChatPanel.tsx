import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import type { AIMessage } from '../../../../shared/api';
import { hasSuggestedFix } from '../../../../shared/ai-suggestions';
import {
  AI_PROVIDERS,
  type AIAgentContext,
  type AIEditProposal,
  type AIMode,
  type AIStoredChat,
} from '../../../../shared/ai';
import { AISettingsDialog } from './AISettingsDialog';
import { ModelPicker } from './ModelPicker';
import { useAISettings } from './useAISettings';
import { getAIRoleSelection, useAIRoleSelection } from '../../state/ai-role-selections';
import { MarkdownPreview } from '../markdown/MarkdownPreview';
import { ArrowUp, Check, Copy, Square, History, Trash2 } from '../../icons';
import './chat.css';

const AGENT_NOTICE_SEEN_KEY = 'textra:agent-notice-seen:v1';
let agentNoticeSeenThisSession = false;

function agentNoticeWasSeen(): boolean {
  if (agentNoticeSeenThisSession) return true;
  try {
    return localStorage.getItem(AGENT_NOTICE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

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

function providerMessages(messages: AIMessage[]): AIMessage[] {
  const result: AIMessage[] = [];
  for (const message of messages) {
    const last = result.at(-1);
    if (last?.role === message.role) last.text += `\n\n${message.text}`;
    else result.push({ ...message });
  }
  return result;
}

function storedChat(id: string, messages: AIMessage[]): AIStoredChat {
  return {
    id,
    title: (messages.find((message) => message.role === 'user')?.text ?? 'Untitled chat')
      .replace(/\s+/g, ' ')
      .slice(0, 80),
    updatedAt: Date.now(),
    messages: messages.map((message) => ({ ...message })),
  };
}

function mergeChats(...groups: AIStoredChat[][]): AIStoredChat[] {
  const chats = new Map<string, AIStoredChat>();
  for (const group of groups)
    for (const chat of group) {
      const previous = chats.get(chat.id);
      if (!previous || previous.updatedAt < chat.updatedAt) chats.set(chat.id, chat);
    }
  return [...chats.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 100);
}

function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)',
    ),
  ];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

export function ChatPanel({
  draft,
  onDraftConsumed,
  active = true,
  resetKey,
  agentContext = null,
  onReviewProposal,
  reviewActive = false,
  reviewControls,
}: {
  draft: ChatDraft | null;
  onDraftConsumed?: () => void;
  active?: boolean;
  /** Changing projects clears the conversation so source context never crosses projects. */
  resetKey?: string | null;
  agentContext?: AIAgentContext | null;
  onReviewProposal?: (proposal: AIEditProposal) => void;
  reviewActive?: boolean;
  reviewControls?: ReactNode;
}) {
  const { settings, error: settingsLoadError, refresh: refreshSettings } = useAISettings(active);
  const [settingsWarning, setSettingsError] = useState('');
  const settingsError = settingsLoadError || settingsWarning;
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [retryMessages, setRetryMessages] = useState<AIMessage[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [partialResponse, setPartialResponse] = useState('');
  const [mode, setMode] = useState<AIMode>('chat');
  const {
    model,
    available: modelAvailable,
    selectModel: setModel,
  } = useAIRoleSelection(resetKey, mode, settings);
  const [rateLimited, setRateLimited] = useState(false);
  const [agentNoticePhase, setAgentNoticePhase] = useState<'hidden' | 'visible' | 'fading'>(
    'hidden',
  );
  const [noticeWasSeen] = useState(agentNoticeWasSeen);
  const noticeSeen = useRef(noticeWasSeen);
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID());
  const [sessionProject, setSessionProject] = useState(resetKey ?? null);
  const [savedChats, setSavedChats] = useState<AIStoredChat[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyControl = useRef<HTMLDivElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const projectGeneration = useRef(0);
  const chatInteraction = useRef(0);
  const liveProject = useRef(resetKey ?? null);
  liveProject.current = resetKey ?? null;
  const projectSessions = useRef(
    new Map<string, { id: string; messages: AIMessage[]; input: string }>(),
  );
  const saves = useRef(new Map<string, Promise<void>>());
  const session = useRef({ projectId: sessionProject, id: chatId, messages, input, loading });
  session.current = { projectId: sessionProject, id: chatId, messages, input, loading };
  const settled = useRef<{ projectId: string; chat: AIStoredChat } | null>(null);
  const latestContext = useRef(agentContext?.contextId);
  latestContext.current = agentContext?.contextId;
  const sending = useRef(false);
  const requestId = useRef(0);
  const consumedDraft = useRef<number | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const streamRequestId = useRef<string | null>(null);
  const previousResetKey = useRef<string | null | undefined>(undefined);
  const previousContext = useRef(agentContext?.contextId);

  const clearConversation = useCallback(() => {
    ++requestId.current;
    streamRequestId.current = null;
    setMessages([]);
    setPartialResponse('');
    setRetryMessages(null);
    setError('');
    setRateLimited(false);
    followResponse.current = true;
  }, []);

  const changeMode = useCallback(
    (next: AIMode) => {
      if (mode === next || sending.current || reviewActive || historyBusy) return;
      ++requestId.current;
      streamRequestId.current = null;
      setPartialResponse('');
      setRetryMessages(null);
      setError('');
      setRateLimited(false);
      setMode(next);
      if (next === 'agent') {
        if (!noticeSeen.current) {
          noticeSeen.current = true;
          agentNoticeSeenThisSession = true;
          setAgentNoticePhase('visible');
          try {
            localStorage.setItem(AGENT_NOTICE_SEEN_KEY, '1');
          } catch {
            /* The session fallback still prevents repeated notices. */
          }
        }
      } else setAgentNoticePhase('hidden');
    },
    [mode, reviewActive, historyBusy],
  );

  useEffect(() => {
    if (agentNoticePhase === 'hidden') return;
    const timer = window.setTimeout(
      () => setAgentNoticePhase(agentNoticePhase === 'visible' ? 'fading' : 'hidden'),
      agentNoticePhase === 'visible' ? 5000 : 500,
    );
    return () => window.clearTimeout(timer);
  }, [agentNoticePhase]);

  const persist = useCallback(async (projectId: string, chat: AIStoredChat) => {
    if (!chat.messages.length) return;
    const key = `${projectId}:${chat.id}`;
    const previous = saves.current.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const result = await window.textra.saveAIChat({ projectId, chat });
        if (!result.ok) throw new Error(result.error);
        if (liveProject.current === projectId)
          setSavedChats((current) => mergeChats([chat], current));
      });
    saves.current.set(key, operation);
    try {
      await operation;
    } finally {
      if (saves.current.get(key) === operation) saves.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (!sessionProject || sessionProject !== (resetKey ?? null) || loading || !messages.length)
      return;
    const snapshot = { projectId: sessionProject, chat: storedChat(chatId, messages) };
    settled.current = snapshot;
    void persist(snapshot.projectId, snapshot.chat)
      .then(() => {
        if (liveProject.current === snapshot.projectId) setHistoryError('');
      })
      .catch((cause: unknown) => {
        if (liveProject.current === snapshot.projectId)
          setHistoryError(cause instanceof Error ? cause.message : 'Could not save chat history.');
      });
  }, [sessionProject, resetKey, chatId, messages, loading, persist]);

  useEffect(() => {
    if (!historyOpen) return;
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !historyControl.current?.contains(event.target))
        setHistoryOpen(false);
    };
    document.addEventListener('mousedown', outside);
    if (!historyLoading)
      historyControl.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', outside);
  }, [historyOpen, historyLoading]);

  async function chooseChat(chat?: AIStoredChat) {
    if (sending.current || reviewActive || historyBusy) return;
    const generation = projectGeneration.current;
    const current = session.current;
    if (chat?.id === current.id) {
      setHistoryOpen(false);
      historyButton.current?.focus();
      return;
    }
    ++chatInteraction.current;
    setHistoryBusy(true);
    try {
      if (current.projectId && current.messages.length)
        await persist(current.projectId, storedChat(current.id, current.messages));
      if (generation !== projectGeneration.current) return;
      clearConversation();
      setChatId(chat?.id ?? crypto.randomUUID());
      setMessages(chat?.messages.map((message) => ({ ...message })) ?? []);
      setHistoryOpen(false);
      setHistoryError('');
      settled.current = null;
      historyButton.current?.focus();
    } catch (cause) {
      if (generation === projectGeneration.current)
        setHistoryError(
          cause instanceof Error ? cause.message : 'Could not save the current chat.',
        );
    } finally {
      if (generation === projectGeneration.current) setHistoryBusy(false);
    }
  }

  async function deleteSavedChat(chat: AIStoredChat) {
    if (!sessionProject || sending.current || reviewActive || historyBusy) return;
    const projectId = sessionProject;
    const current = session.current;
    const key = `${projectId}:${chat.id}`;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      await saves.current.get(key)?.catch(() => undefined);
      if (liveProject.current !== projectId) return;
      const result = await window.textra.deleteAIChat({ projectId, chatId: chat.id });
      if (!result.ok) throw new Error(result.error);
      if (!result.value) return;
      setSavedChats((items) => items.filter((item) => item.id !== chat.id));
      if (current.projectId === projectId && current.id === chat.id) {
        clearConversation();
        setChatId(crypto.randomUUID());
        setMessages([]);
        setInput('');
        projectSessions.current.delete(projectId);
        settled.current = null;
      }
    } catch (cause) {
      if (liveProject.current === projectId)
        setHistoryError(cause instanceof Error ? cause.message : 'Could not delete this chat.');
    } finally {
      if (liveProject.current === projectId) setHistoryBusy(false);
    }
  }

  useEffect(() => {
    if (previousContext.current === agentContext?.contextId) return;
    previousContext.current = agentContext?.contextId;
    if (mode !== 'agent') return;
    const currentId = ++requestId.current;
    streamRequestId.current = null;
    setPartialResponse('');
    setRetryMessages(null);
    setError('');
    setRateLimited(false);
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
  }, [agentContext?.contextId, mode]);

  useEffect(() => {
    const projectId = resetKey ?? null;
    if (previousResetKey.current === projectId) return;
    const old = session.current;
    if (previousResetKey.current !== undefined && old.projectId) {
      projectSessions.current.set(old.projectId, {
        id: old.id,
        messages: old.messages,
        input: old.input,
      });
      const snapshot = !old.loading
        ? { projectId: old.projectId, chat: storedChat(old.id, old.messages) }
        : settled.current;
      if (snapshot?.projectId === old.projectId)
        void persist(snapshot.projectId, snapshot.chat).catch(() =>
          setHistoryError(
            'The previous workspace chat could not be saved. It is still available in this session.',
          ),
        );
    }
    previousResetKey.current = projectId;
    setAgentNoticePhase('hidden');
    const generation = ++projectGeneration.current;
    const interaction = chatInteraction.current;
    const cached = projectId ? projectSessions.current.get(projectId) : undefined;
    const id = cached?.id ?? crypto.randomUUID();
    setSessionProject(projectId);
    setChatId(id);
    setMessages(cached?.messages ?? []);
    setInput(cached?.input ?? '');
    setSavedChats([]);
    setHistoryError('');
    setHistoryOpen(false);
    setHistoryBusy(false);
    settled.current = null;
    const currentId = ++requestId.current;
    streamRequestId.current = null;
    setPartialResponse('');
    followResponse.current = true;
    setError('');
    setRateLimited(false);
    setRetryMessages(null);
    setHistoryLoading(Boolean(projectId));
    if (projectId)
      void window.textra
        .listAIChats(projectId)
        .then((result) => {
          if (generation !== projectGeneration.current) return;
          if (!result.ok) {
            setHistoryError(result.error);
            return;
          }
          setSavedChats((current) => mergeChats(current, result.value));
          if (
            !cached &&
            chatInteraction.current === interaction &&
            !sending.current &&
            result.value.length
          ) {
            const latest = [...result.value].sort(
              (left, right) => right.updatedAt - left.updatedAt,
            )[0];
            setChatId(latest.id);
            setMessages(latest.messages.map((message) => ({ ...message })));
          }
        })
        .catch(() => {
          if (generation === projectGeneration.current)
            setHistoryError('Could not load workspace chat history.');
        })
        .finally(() => {
          if (generation === projectGeneration.current) setHistoryLoading(false);
        });
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
  }, [resetKey, persist]);

  useEffect(() => {
    return window.textra.onAIResponseChunk((event) => {
      if (event.requestId === streamRequestId.current) setPartialResponse(event.text);
    });
  }, []);

  useEffect(() => {
    const container = history.current;
    if (container && followResponse.current && active) container.scrollTop = container.scrollHeight;
  }, [messages, partialResponse, loading, active]);

  const send = useCallback(
    async (conversation: AIMessage[], override?: { mode: AIMode; preserveDraft?: boolean }) => {
      const requestMode = override?.mode ?? mode;
      const selection = getAIRoleSelection(resetKey, requestMode, settings);
      const requestModel = selection.model;
      if (sending.current || reviewActive || historyBusy || sessionProject !== liveProject.current)
        return;
      if (!requestModel || !selection.available) {
        if (!override?.preserveDraft) setInput(conversation.at(-1)?.text ?? '');
        setError(
          requestModel
            ? 'The selected model is unavailable. Choose another model.'
            : 'Choose a model first. Open AI settings to connect a provider.',
        );
        return;
      }
      if (requestMode === 'agent' && !agentContext) {
        if (!override?.preserveDraft) setInput(conversation.at(-1)?.text ?? '');
        setError('Open an active .tex file to use Agent.');
        return;
      }
      if (
        conversation.length > 79 ||
        conversation.reduce((size, message) => size + message.text.length, 0) > 96_000 ||
        (requestMode === 'chat' &&
          (providerMessages(conversation).length > 40 ||
            providerMessages(conversation).some((message) => message.text.length > 32_000) ||
            conversation.reduce((size, message) => size + message.text.length, 0) > 64_000)) ||
        (requestMode === 'agent' && (conversation.at(-1)?.text.length ?? 0) > 12_000)
      ) {
        if (!override?.preserveDraft) setInput(conversation.at(-1)?.text ?? '');
        setError(
          'This conversation has reached its size limit. Start a new chat or shorten the question. Your question is preserved below.',
        );
        return;
      }
      sending.current = true;
      ++chatInteraction.current;
      const currentId = ++requestId.current;
      const streamId = crypto.randomUUID();
      streamRequestId.current = requestMode === 'chat' ? streamId : null;
      setPartialResponse('');
      followResponse.current = true;
      setMessages(conversation);
      setLoading(true);
      setError('');
      setRateLimited(false);
      setRetryMessages(null);
      try {
        if (requestMode === 'agent' && agentContext) {
          const contextId = agentContext.contextId;
          const result = await window.textra.runAIAgent({
            contextId,
            prompt: conversation.at(-1)?.text ?? '',
            messages: providerMessages(conversation.slice(0, -1)),
            model: requestModel,
            requestId: streamId,
          });
          if (currentId !== requestId.current || latestContext.current !== contextId) return;
          if (result.ok) {
            setMessages([...conversation, { role: 'model', text: result.value.text }]);
            if (result.value.proposal) onReviewProposal?.(result.value.proposal);
          } else {
            const limited = result.code === 'AI_RATE_LIMIT' || result.code === 'AI_AGENT_LIMIT';
            setRateLimited(limited);
            setError(
              result.code === 'AI_AGENT_LIMIT'
                ? result.error
                : limited
                  ? 'The request reached a rate or Agent budget limit. Choose another available model or try again later.'
                  : result.error,
            );
            setRetryMessages(conversation);
          }
          return;
        }
        const result = await window.textra.sendAIMessage({
          messages: providerMessages(conversation),
          requestId: streamId,
          model: requestModel,
        });
        if (currentId !== requestId.current) return;
        if (result.ok) {
          setPartialResponse('');
          setMessages([...conversation, { role: 'model', text: result.value }]);
        } else {
          setRateLimited(result.code === 'AI_RATE_LIMIT' || result.code === 'AI_AGENT_LIMIT');
          setError(
            result.code === 'AI_RATE_LIMIT'
              ? 'The model reached a rate or quota limit. Choose another available model or try again later.'
              : result.error,
          );
          setRetryMessages(conversation);
        }
      } catch {
        if (currentId !== requestId.current) return;
        setError('Could not reach the model. Check your connection and try again.');
        setRetryMessages(conversation);
      } finally {
        if (currentId === requestId.current) {
          streamRequestId.current = null;
          sending.current = false;
          setLoading(false);
        }
      }
    },
    [
      mode,
      resetKey,
      settings,
      agentContext,
      onReviewProposal,
      reviewActive,
      historyBusy,
      sessionProject,
    ],
  );

  function implementSuggestedFix() {
    if (
      mode !== 'chat' ||
      sending.current ||
      reviewActive ||
      historyBusy ||
      !agentContext ||
      sessionProject !== liveProject.current
    )
      return;
    const latest = messages.at(-1);
    if (latest?.role !== 'model' || !hasSuggestedFix(latest.text)) return;
    changeMode('agent');
    void send([...messages, { role: 'user', text: 'Implement the suggested fix above.' }], {
      mode: 'agent',
      preserveDraft: true,
    });
  }

  useEffect(() => {
    if (sessionProject !== (resetKey ?? null)) return;
    if (!draft || consumedDraft.current === draft.id || loading || reviewActive || historyBusy)
      return;
    if (mode === 'agent') {
      changeMode('chat');
      return;
    }
    if (!settings?.configured) return;
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
          mode === 'chat' &&
          !reviewActive &&
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
  }, [
    draft,
    settings?.configured,
    loading,
    messages,
    onDraftConsumed,
    send,
    mode,
    reviewActive,
    sessionProject,
    resetKey,
    changeMode,
    historyBusy,
  ]);

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
          <strong>{mode === 'chat' ? 'Chat' : 'Agent'}</strong>
        </div>
        <button
          type="button"
          disabled={loading || reviewActive || historyBusy || messages.length === 0}
          onClick={() => void chooseChat()}
        >
          New chat
        </button>
        <div
          className="ai-history-control"
          ref={historyControl}
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setHistoryOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setHistoryOpen(false);
              historyButton.current?.focus();
            }
          }}
        >
          <button
            ref={historyButton}
            type="button"
            className="ai-history-trigger"
            aria-label="Chat history"
            title="Latest 100 workspace chats"
            aria-haspopup="menu"
            aria-expanded={historyOpen}
            disabled={!sessionProject || loading || reviewActive || historyBusy}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History size={14} aria-hidden="true" />
          </button>
          {historyOpen && (
            <div
              className="ai-history-menu"
              role="menu"
              aria-label="Workspace chat history"
              onKeyDown={navigateMenu}
            >
              {historyLoading && <p role="status">Loading history…</p>}
              {!historyLoading && savedChats.length === 0 && <p>No saved chats yet.</p>}
              {savedChats.map((chat) => (
                <div key={chat.id} className="ai-history-row" role="none">
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={historyBusy}
                    title={chat.title}
                    onClick={() => void chooseChat(chat)}
                  >
                    <span>{chat.title}</span>
                    <small>
                      {new Date(chat.updatedAt).toLocaleDateString()}
                      {chat.id === chatId ? ' · Current' : ''}
                    </small>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="ai-history-delete"
                    disabled={historyBusy}
                    aria-label={`Delete chat ${chat.title}`}
                    title="Delete saved chat"
                    onClick={() => void deleteSavedChat(chat)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          aria-haspopup="dialog"
          title="AI providers and models"
        >
          Settings
        </button>
      </header>
      <AISettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      {historyError && (
        <p className="ai-history-error" role="alert">
          {historyError}
        </p>
      )}
      {settingsError && (
        <div className="ai-settings-failure">
          <p role="alert">{settingsError}</p>
          <button type="button" onClick={() => void refreshSettings()}>
            Retry settings
          </button>
        </div>
      )}
      {!settings && !settingsError && <p role="status">Loading AI settings…</p>}
      {settings && !settings.configured ? (
        <div className="ai-chat-setup">
          <div className="ai-chat-setup-card">
            <strong>Set up AI</strong>
            <p>
              Connect Google, OpenAI, Anthropic, Ollama Cloud or a local Ollama server to chat about
              LaTeX errors and review focused edits.
            </p>
            <button
              type="button"
              className="ai-chat-setup-button"
              onClick={() => setShowSettings(true)}
            >
              Configure AI
            </button>
          </div>
        </div>
      ) : settings?.configured ? (
        <>
          {mode === 'agent' && agentNoticePhase !== 'hidden' && (
            <p
              className="ai-chat-privacy ai-agent-notice"
              data-state={agentNoticePhase}
              role="status"
            >
              The conversation and active .tex file{agentContext ? ` (${agentContext.path})` : ''}{' '}
              are sent. Edits require review; tools cannot access other files.
            </p>
          )}
          {mode === 'chat' && messages.length === 0 && (
            <p className="ai-chat-privacy">
              {model && AI_PROVIDERS[model.provider].local
                ? /cloud/i.test(model.model)
                  ? 'Messages go to Ollama Cloud through local Ollama.'
                  : 'Messages stay on this computer with local Ollama.'
                : `Messages and selected snippets are sent to ${model ? AI_PROVIDERS[model.provider].label : 'the provider'}.`}{' '}
              No file access or editing tools. Check suggestions before applying them.
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
                <strong>
                  {mode === 'chat' ? 'Let’s untangle that error.' : 'Review a focused edit.'}
                </strong>
                <p>
                  {mode === 'chat'
                    ? 'Ask a LaTeX question or choose Ask in Chat from Problems. Review any source snippet before sending.'
                    : 'Describe a correction to the active file. Your conversation stays with you; proposed changes open for review.'}
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
                  <>
                    <ResponseContent text={message.text} />
                    {mode === 'chat' &&
                      index === messages.length - 1 &&
                      hasSuggestedFix(message.text) && (
                        <button
                          type="button"
                          className="ai-implement-fix"
                          disabled={
                            loading ||
                            reviewActive ||
                            historyBusy ||
                            !agentContext ||
                            sessionProject !== liveProject.current
                          }
                          title={
                            !agentContext
                              ? 'Open an active .tex file to implement this fix'
                              : 'Run Agent on the active .tex file and review its proposed edits'
                          }
                          onClick={implementSuggestedFix}
                        >
                          Implement Suggested Fix
                        </button>
                      )}
                  </>
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
                {mode === 'chat' ? 'Thinking' : 'Preparing a proposal'}
                <span aria-hidden="true">…</span>
              </p>
            )}
          </div>
          {error && (
            <div className="ai-chat-failure">
              <p role="alert" className="ai-error">
                {error}
              </p>
              {rateLimited && model && AI_PROVIDERS[model.provider].links.limits && (
                <button
                  type="button"
                  className="ai-rate-limits-link"
                  onClick={() => {
                    void window.textra
                      .openAIProviderLink({ provider: model.provider, link: 'limits' })
                      .then((result) => {
                        if (!result.ok) setError(result.error);
                      })
                      .catch(() => setError('Could not open the provider’s usage page.'));
                  }}
                >
                  View {AI_PROVIDERS[model.provider].label} limits
                </button>
              )}
              {retryMessages && !loading && !reviewActive && (
                <button type="button" onClick={() => void send(retryMessages)}>
                  Retry response
                </button>
              )}
            </div>
          )}
          {reviewControls}
          {!modelAvailable && (
            <p className="ai-agent-context-hint" role="status">
              {model
                ? 'The selected model is unavailable. Choose another model.'
                : `Choose a ${mode === 'agent' ? 'Agent' : 'Chat'} model to continue.`}
            </p>
          )}
          {mode === 'agent' && !agentContext && (
            <p id="ai-agent-context-hint" className="ai-agent-context-hint">
              Open an active .tex file to use Agent.
            </p>
          )}
          <form
            className="ai-chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !input.trim() ||
                !modelAvailable ||
                sending.current ||
                reviewActive ||
                historyBusy ||
                (mode === 'agent' && !agentContext)
              )
                return;
              const text = input.trim();
              setInput('');
              void send(
                mode === 'chat'
                  ? appendQuestion(messages, text)
                  : [...messages, { role: 'user', text }],
              );
            }}
          >
            <textarea
              id="ai-chat-message"
              aria-label={mode === 'chat' ? 'Message AI' : 'Agent request'}
              rows={2}
              value={input}
              maxLength={30000}
              placeholder={
                mode === 'agent' && !agentContext
                  ? 'Open an active .tex file to use Agent'
                  : 'Ask about your LaTeX…'
              }
              aria-describedby={
                mode === 'agent' && !agentContext ? 'ai-agent-context-hint' : undefined
              }
              disabled={reviewActive || (mode === 'agent' && !agentContext)}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.ctrlKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="ai-chat-actions">
              <div className="ai-chat-controls">
                <ModelPicker
                  settings={settings}
                  role={mode}
                  value={model}
                  onChange={setModel}
                  variant="compact"
                  placement="up"
                  label="Model"
                  disabled={loading || reviewActive || historyBusy}
                />
                <div className="ai-mode-toggle" role="group" aria-label="AI mode">
                  <button
                    type="button"
                    aria-pressed={mode === 'chat'}
                    disabled={loading || reviewActive || historyBusy}
                    onClick={() => changeMode('chat')}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'agent'}
                    disabled={loading || reviewActive || historyBusy}
                    onClick={() => changeMode('agent')}
                  >
                    Agent
                  </button>
                </div>
              </div>
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
                  disabled={
                    !input.trim() ||
                    !modelAvailable ||
                    reviewActive ||
                    historyBusy ||
                    (mode === 'agent' && !agentContext)
                  }
                  aria-label="Send message"
                  title="Send message"
                >
                  <ArrowUp size={12} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
