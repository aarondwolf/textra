import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { useChat } from '@ai-sdk/react';
import type { AIMessage } from '../../../../shared/api';
import {
  AI_PROVIDERS,
  sameModel,
  type AIAgentContext,
  type AIDocumentAccess,
  type AIEditProposal,
  type AIModelRef,
  type AIReviewOutcome,
  type AIStoredChat,
} from '../../../../shared/ai';
import { ModelPicker } from './ModelPicker';
import { modelGroups, useAISettings } from './useAISettings';
import { getAIRoleSelection, useAIRoleSelection } from '../../state/ai-role-selections';
import { MarkdownPreview } from '../markdown/MarkdownPreview';
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  History,
  Plus,
  Settings,
  Square,
  Trash2,
  X,
} from '../../icons';
import {
  AssistantRequestError,
  AssistantTransport,
  fromUIMessages,
  toUIMessages,
  type AssistantUIMessage,
} from './assistant-transport';
import { appendUserTurn, coalesceProviderMessages } from './conversation';
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
      {text.trim() && <MarkdownPreview source={text} className="ai-message-markdown" copyCode />}
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

const REVIEW_LABELS: Record<AIReviewOutcome, string> = {
  applied: 'Changes applied',
  partial: 'Some changes applied',
  rejected: 'Changes rejected',
};

type AssistantMode = 'chat' | 'agent';

export interface ChatDraft {
  id: number;
  text: string;
  /** Keep this draft in the composer for review even when Problems auto-send is enabled. */
  autoSend?: boolean;
}
/** Emitted by the workspace when a proposal from the latest reply is fully reviewed. */
export interface ReviewOutcomeEvent {
  id: number;
  outcome: AIReviewOutcome;
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

function messageText(message: AssistantUIMessage | undefined): string {
  return message?.parts.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
}

function messageReasoning(message: AssistantUIMessage | undefined): string {
  return message?.parts.map((part) => (part.type === 'reasoning' ? part.text : '')).join('') ?? '';
}

function ReasoningContent({ text, active = false }: { text: string; active?: boolean }) {
  if (!text) return null;
  return (
    <details className="ai-reasoning">
      <summary>
        Thinking
        {active && (
          <span className="ai-chat-thinking-dots" aria-hidden="true">
            .....
          </span>
        )}
      </summary>
      <div className="ai-reasoning-text">{text}</div>
    </details>
  );
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
  reviewOutcome = null,
  onAgentWorkingChange,
}: {
  draft: ChatDraft | null;
  onDraftConsumed?: () => void;
  active?: boolean;
  /** Changing projects clears the conversation so source context never crosses projects. */
  resetKey?: string | null;
  /** The captured active .tex document. Its contents are read only after Manual Send. */
  agentContext?: AIAgentContext | null;
  onReviewProposal?: (proposal: AIEditProposal) => void;
  reviewActive?: boolean;
  reviewControls?: ReactNode;
  reviewOutcome?: ReviewOutcomeEvent | null;
  onAgentWorkingChange?: (working: boolean) => void;
}) {
  const { settings, error: settingsLoadError, refresh: refreshSettings } = useAISettings(active);
  const [settingsWarning, setSettingsError] = useState('');
  const settingsError = settingsLoadError || settingsWarning;
  const hasConnections = Boolean(settings?.providers.some((provider) => provider.configured));
  const transport = useMemo(() => new AssistantTransport(), []);
  const [toolStatus, setToolStatus] = useState('');
  const chat = useChat<AssistantUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === 'data-status') setToolStatus(part.data.message);
    },
  });
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [activeRequest, setActiveRequest] = useState<string | null>(null);
  const visibleUIMessages = useMemo(
    () => chat.messages.filter((message) => message.id !== activeRequest),
    [chat.messages, activeRequest],
  );
  const messages = useMemo(() => fromUIMessages(visibleUIMessages), [visibleUIMessages]);
  const streamingText = useMemo(
    () =>
      activeRequest
        ? messageText(chat.messages.find((message) => message.id === activeRequest))
        : '',
    [chat.messages, activeRequest],
  );
  const streamingReasoning = useMemo(
    () =>
      activeRequest
        ? messageReasoning(chat.messages.find((message) => message.id === activeRequest))
        : '',
    [chat.messages, activeRequest],
  );
  const setChatMessages = chat.setMessages;
  const setMessages = useCallback(
    (next: AIMessage[]) => setChatMessages(toUIMessages(next)),
    [setChatMessages],
  );
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<AssistantMode>('chat');
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [completedReasoning, setCompletedReasoning] = useState('');
  const [retry, setRetryState] = useState<{
    messages: AIMessage[];
    authorizeDocument: boolean;
    mode: AssistantMode;
  } | null>(null);
  const retryMessages = retry?.messages ?? null;
  const lastAuthorization = useRef(false);
  const lastMode = useRef<AssistantMode>('chat');
  const setRetryMessages = useCallback((messages: AIMessage[] | null) => {
    setRetryState(
      messages
        ? {
            messages,
            authorizeDocument: lastAuthorization.current,
            mode: lastMode.current,
          }
        : null,
    );
  }, []);
  const openAISettings = () =>
    window.dispatchEvent(new CustomEvent('textra:open-settings', { detail: { section: 'ai' } }));
  const [partialResponse, setPartialResponse] = useState('');
  const [lastAccess, setLastAccess] = useState<AIDocumentAccess | null>(null);
  const [privacyDismissed, setPrivacyDismissed] = useState(false);
  const lastModelKey = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    model,
    available: modelAvailable,
    selectModel: setModel,
  } = useAIRoleSelection(resetKey, 'assistant', settings);

  const currentModelKey = model ? `${model.provider}:${model.model}` : null;
  useEffect(() => {
    if (lastModelKey.current && lastModelKey.current !== currentModelKey) {
      setPrivacyDismissed(false);
    }
    lastModelKey.current = currentModelKey;
  }, [currentModelKey]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 180);
    el.style.height = `${Math.max(nextHeight, 44)}px`;
  }, [input]);

  const assistantModels = useMemo<AIModelRef[]>(() => {
    return modelGroups(settings, undefined, 'assistant').flatMap((group) =>
      group.models.map((m) => ({ provider: group.provider, model: m.id })),
    );
  }, [settings]);

  const cycleModel = useCallback(() => {
    if (assistantModels.length === 0) return;
    const currentIndex = assistantModels.findIndex((m) => sameModel(m, model));
    const nextIndex = (currentIndex + 1) % assistantModels.length;
    const next = assistantModels[nextIndex];
    setModel(next);
  }, [assistantModels, model, setModel]);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault();
        cycleModel();
      }
    };
    const handleSwitchModel = () => cycleModel();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('textra:switch-model', handleSwitchModel);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('textra:switch-model', handleSwitchModel);
    };
  }, [cycleModel]);
  const toolsSupported =
    !model ||
    settings?.providers.find((item) => item.id === model.provider)?.supportsTools !== false;
  const [rateLimited, setRateLimited] = useState(false);
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
  const inflight = useRef<{
    requestId: string;
    contextId?: string;
    conversation: AIMessage[];
  } | null>(null);
  const streamingRef = useRef('');
  streamingRef.current = streamingText;
  const proposalTurn = useRef<{ chatId: string; index: number } | null>(null);
  const appliedOutcome = useRef<number | null>(null);
  const consumedDraft = useRef<number | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const previousResetKey = useRef<string | null | undefined>(undefined);
  const previousContext = useRef(agentContext?.contextId);

  const agentWorking =
    loading && mode === 'agent' && Boolean(activeRequest) && Boolean(inflight.current?.contextId);
  useEffect(() => {
    onAgentWorkingChange?.(agentWorking);
  }, [agentWorking, onAgentWorkingChange]);
  useEffect(() => () => onAgentWorkingChange?.(false), [onAgentWorkingChange]);

  const draftId = draft?.id;
  useEffect(() => {
    if (draftId) setMode('chat');
  }, [draftId]);

  const clearConversation = useCallback(() => {
    ++requestId.current;
    inflight.current = null;
    setActiveRequest(null);
    setMessages([]);
    setCompletedReasoning('');
    setPartialResponse('');
    setToolStatus('');
    setRetryMessages(null);
    setError('');
    setRateLimited(false);
    setLastAccess(null);
    proposalTurn.current = null;
    followResponse.current = true;
  }, [setMessages, setRetryMessages]);

  /** Stops the request in flight (if any) and keeps its partial text out of future context. */
  const abandonRequest = useCallback(async (currentId: number) => {
    const running = inflight.current;
    inflight.current = null;
    if (!running) return;
    setCancelling(true);
    const partial = streamingRef.current;
    try {
      await chatRef.current.stop();
      const result = await window.textra.cancelAIAssistant({ requestId: running.requestId });
      if (currentId !== requestId.current) return;
      if (!result.ok) setError(result.error);
    } catch {
      if (currentId === requestId.current)
        setError('Could not confirm cancellation of the previous response.');
    } finally {
      if (currentId === requestId.current) {
        setActiveRequest(null);
        setPartialResponse(partial);
        setToolStatus('');
        sending.current = false;
        setLoading(false);
        setCancelling(false);
      }
    }
    return running;
  }, []);

  // Unmounting cancels the request in flight; its listener is removed by the transport.
  useEffect(
    () => () => {
      const running = inflight.current;
      inflight.current = null;
      if (!running) return;
      void chatRef.current.stop();
      void window.textra.cancelAIAssistant({ requestId: running.requestId }).catch(() => undefined);
    },
    [],
  );

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

  // An application-owned review outcome annotates the reply that produced the proposal, so
  // later requests do not treat rejected changes as applied.
  useEffect(() => {
    if (!reviewOutcome || appliedOutcome.current === reviewOutcome.id) return;
    appliedOutcome.current = reviewOutcome.id;
    const turn = proposalTurn.current;
    proposalTurn.current = null;
    const current = session.current;
    if (!turn || turn.chatId !== current.id || current.messages[turn.index]?.role !== 'model')
      return;
    setMessages(
      current.messages.map((message, index) =>
        index === turn.index ? { ...message, review: reviewOutcome.outcome } : message,
      ),
    );
  }, [reviewOutcome, setMessages]);

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

  // A request that was authorized for one captured document stops when that document changes.
  useEffect(() => {
    if (previousContext.current === agentContext?.contextId) return;
    previousContext.current = agentContext?.contextId;
    const running = inflight.current;
    if (!running?.contextId || running.contextId === agentContext?.contextId) return;
    const currentId = ++requestId.current;
    setRetryMessages(running.conversation);
    setError('The active file changed, so the request stopped. Retry to use the current file.');
    setRateLimited(false);
    void abandonRequest(currentId).then(() => {
      if (currentId === requestId.current) setMessages(running.conversation);
    });
  }, [agentContext?.contextId, abandonRequest, setMessages, setRetryMessages]);

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
    const generation = ++projectGeneration.current;
    const interaction = chatInteraction.current;
    const cached = projectId ? projectSessions.current.get(projectId) : undefined;
    const id = cached?.id ?? crypto.randomUUID();
    const currentId = ++requestId.current;
    // Leaving a workspace cancels its request; its partial reply never enters context.
    void abandonRequest(currentId).then(() => {
      if (currentId === requestId.current) setPartialResponse('');
    });
    setSessionProject(projectId);
    setChatId(id);
    setMessages(cached?.messages ?? []);
    setInput(cached?.input ?? '');
    setSavedChats([]);
    setHistoryError('');
    setHistoryOpen(false);
    setHistoryBusy(false);
    settled.current = null;
    proposalTurn.current = null;
    setActiveRequest(null);
    setPartialResponse('');
    setToolStatus('');
    followResponse.current = true;
    setError('');
    setRateLimited(false);
    setRetryMessages(null);
    setLastAccess(null);
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
  }, [resetKey, persist, abandonRequest, setMessages, setRetryMessages]);

  useEffect(() => {
    const container = history.current;
    if (container && followResponse.current && active) container.scrollTop = container.scrollHeight;
  }, [messages, streamingText, partialResponse, loading, active]);

  const send = useCallback(
    async (
      conversation: AIMessage[],
      options: { authorizeDocument: boolean; preserveDraft?: boolean; mode?: AssistantMode },
    ) => {
      const requestMode = options.mode ?? mode;
      const selection = getAIRoleSelection(resetKey, 'assistant', settings);
      const requestModel = selection.model;
      if (sending.current || reviewActive || historyBusy || sessionProject !== liveProject.current)
        return;
      if (!requestModel || !selection.available) {
        if (!options.preserveDraft) setInput(conversation.at(-1)?.text ?? '');
        setError(
          requestModel
            ? 'The selected model is unavailable. Choose another model.'
            : 'Choose a model first. Open AI settings to connect a provider.',
        );
        return;
      }
      const providerConversation = coalesceProviderMessages(conversation);
      if (
        providerConversation.length > 40 ||
        providerConversation.some((message) => message.text.length > 32_000) ||
        providerConversation.reduce((size, message) => size + message.text.length, 0) > 64_000
      ) {
        if (!options.preserveDraft) setInput(conversation.at(-1)?.text ?? '');
        setError(
          'This conversation has reached its size limit. Start a new chat or shorten the question. Your question is preserved below.',
        );
        return;
      }
      // Manual Send authorizes on-demand access to the captured document. Nothing is read
      // unless the assistant asks for it, and automatic Problems prompts never authorize it.
      const contextId =
        requestMode === 'agent' && options.authorizeDocument ? agentContext?.contextId : undefined;
      lastAuthorization.current = options.authorizeDocument;
      lastMode.current = requestMode;
      sending.current = true;
      ++chatInteraction.current;
      const currentId = ++requestId.current;
      const streamId = crypto.randomUUID();
      const turnChat = chatId;
      inflight.current = { requestId: streamId, contextId, conversation };
      setActiveRequest(streamId);
      setCompletedReasoning('');
      setPartialResponse('');
      setToolStatus('');
      followResponse.current = true;
      setMessages(conversation);
      setLoading(true);
      setError('');
      setRateLimited(false);
      setRetryMessages(null);
      let failure: unknown;
      try {
        await chatRef.current.regenerate({
          body: { requestId: streamId, model: requestModel, ...(contextId ? { contextId } : {}) },
        });
      } catch (cause) {
        failure = cause;
      }
      if (currentId !== requestId.current) return;
      inflight.current = null;
      const partial = streamingRef.current;
      const result = transport.takeResult(streamId);
      const reasoning = transport.takeReasoning(streamId);
      setActiveRequest(null);
      setToolStatus('');
      sending.current = false;
      setLoading(false);
      if (contextId && latestContext.current !== contextId) {
        setMessages(conversation);
        return;
      }
      if (result?.ok) {
        const reply: AIMessage = { role: 'model', text: result.value.text };
        setMessages([...conversation, reply]);
        setCompletedReasoning(reasoning);
        setLastAccess(result.value.documentAccess);
        if (result.value.proposal) {
          proposalTurn.current = { chatId: turnChat, index: conversation.length };
          onReviewProposal?.(result.value.proposal);
        }
        return;
      }
      // Interrupted replies stay visible as incomplete but never enter future context.
      setMessages(conversation);
      setPartialResponse(partial);
      const code =
        (!result?.ok ? result?.code : undefined) ??
        (failure instanceof AssistantRequestError ? failure.code : undefined) ??
        (chatRef.current.error instanceof AssistantRequestError
          ? chatRef.current.error.code
          : undefined);
      const message =
        (!result?.ok ? result?.error : undefined) ??
        (chatRef.current.error?.message ||
          'Could not reach the model. Check your connection and try again.');
      const limited = code === 'AI_RATE_LIMIT' || code === 'AI_AGENT_LIMIT';
      setRateLimited(limited);
      setError(
        code === 'AI_RATE_LIMIT'
          ? 'The model reached a rate or quota limit. Choose another available model or try again later.'
          : message,
      );
      setRetryMessages(conversation);
    },
    [
      resetKey,
      mode,
      settings,
      agentContext,
      onReviewProposal,
      reviewActive,
      historyBusy,
      sessionProject,
      chatId,
      transport,
      setMessages,
      setRetryMessages,
    ],
  );

  useEffect(() => {
    if (sessionProject !== (resetKey ?? null)) return;
    if (!draft || consumedDraft.current === draft.id || loading || reviewActive || historyBusy)
      return;
    if (!settings?.configured) return;
    if (draft.autoSend === false) {
      consumedDraft.current = draft.id;
      onDraftConsumed?.();
      setInput((previous) => (previous ? `${previous}\n\n${draft.text}` : draft.text));
      return;
    }
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
          !reviewActive &&
          !sending.current
        ) {
          // Automatic Problems prompts stay tool-free: only their own snippet is sent.
          void send(appendUserTurn(messages, draft.text), {
            authorizeDocument: false,
            mode: 'chat',
          });
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
    reviewActive,
    sessionProject,
    resetKey,
    historyBusy,
  ]);

  async function cancel() {
    if (cancelling) return;
    const running = inflight.current;
    const currentId = ++requestId.current;
    await abandonRequest(currentId);
    if (currentId !== requestId.current) return;
    if (running) {
      setMessages(running.conversation);
      setRetryMessages(running.conversation);
    }
    setError('Response cancelled. You can retry when ready.');
  }

  const documentName = agentContext?.path.split('/').at(-1) ?? null;
  const destination = model
    ? AI_PROVIDERS[model.provider].local
      ? /cloud/i.test(model.model)
        ? 'Ollama Cloud through local Ollama'
        : 'local Ollama on this computer'
      : AI_PROVIDERS[model.provider].label
    : 'the provider';

  return (
    <section className="ai-chat" aria-label="AI assistant">
      <header className="ai-chat-header">
        <div>
          <strong>Assistant</strong>
        </div>
        <button
          type="button"
          className="ai-header-icon-button"
          disabled={loading || reviewActive || historyBusy || messages.length === 0}
          onClick={() => void chooseChat()}
          aria-label="New chat"
          title="New chat"
        >
          <Plus size={14} aria-hidden="true" />
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
            className="ai-header-icon-button ai-history-trigger"
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
          className="ai-header-icon-button"
          onClick={openAISettings}
          aria-haspopup="dialog"
          aria-label="Settings"
          title="AI providers and models"
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </header>
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
      {settings && !hasConnections ? (
        <div className="ai-chat-setup">
          <div className="ai-chat-setup-card">
            <strong>Set up AI</strong>
            <p>
              Connect Google, OpenAI, Anthropic, Ollama Cloud or a local Ollama server to ask about
              LaTeX errors and review focused edits.
            </p>
            <button type="button" className="ai-chat-setup-button" onClick={openAISettings}>
              Configure AI
            </button>
          </div>
        </div>
      ) : hasConnections ? (
        <>
          {messages.length === 0 && !privacyDismissed && (
            <div className="ai-chat-privacy">
              <p>
                Messages go to {destination}. Chat sends only your conversation. Agent includes the
                active .tex file when you press Send, and proposed edits always wait for your
                review.
              </p>
              <button
                type="button"
                className="ai-chat-privacy-dismiss"
                aria-label="Dismiss notice"
                title="Dismiss notice"
                onClick={() => setPrivacyDismissed(true)}
              >
                <X size={12} />
              </button>
            </div>
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
                <p>Ask a question or describe a change to the open file.</p>
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
                    {index === messages.length - 1 && (
                      <ReasoningContent text={completedReasoning} />
                    )}
                    <ResponseContent text={message.text} />
                    {message.review && (
                      <small className="ai-review-outcome" data-outcome={message.review}>
                        {REVIEW_LABELS[message.review]}
                      </small>
                    )}
                  </>
                ) : (
                  <>
                    <strong>You</strong>
                    <MarkdownPreview
                      source={message.text}
                      className="ai-message-markdown"
                      copyCode
                    />
                  </>
                )}
              </article>
            ))}
            {(loading ? streamingText || streamingReasoning : partialResponse) && (
              <article
                className="ai-message ai-message-model"
                aria-label={loading ? 'Response in progress' : 'Incomplete response'}
              >
                {loading && <ReasoningContent text={streamingReasoning} active={!streamingText} />}
                {(loading ? streamingText : partialResponse).trim() && (
                  <ResponseContent
                    text={loading ? streamingText : partialResponse}
                    incomplete={!loading}
                  />
                )}
              </article>
            )}
            {loading && (toolStatus || (!streamingText && !streamingReasoning)) && (
              <p className="ai-chat-typing" role="status">
                <span>{toolStatus || 'Thinking'}</span>
                {!toolStatus && (
                  <span className="ai-chat-thinking-dots" aria-hidden="true">
                    .....
                  </span>
                )}
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
                <button
                  type="button"
                  onClick={() =>
                    retry &&
                    void send(retry.messages, {
                      authorizeDocument: retry.authorizeDocument,
                      mode: retry.mode,
                    })
                  }
                >
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
                : 'Choose an Assistant model to continue.'}
              <button type="button" onClick={openAISettings}>
                Edit providers
              </button>
            </p>
          )}
          {mode === 'agent' && (
            <div className="ai-chat-active-file-corner">
              <span
                id="ai-chat-context"
                className="ai-context-chip"
                data-state={!documentName ? 'none' : toolsSupported ? 'available' : 'unsupported'}
                title={
                  !documentName
                    ? 'Open a .tex file to let Agent read it and propose edits.'
                    : toolsSupported
                      ? `Available on Send: Agent may read ${agentContext?.path} and propose edits for review.`
                      : 'This connection has tool calls turned off, so it answers in text only.'
                }
              >
                <FileText size={12} aria-hidden="true" />
                <span>
                  {!documentName
                    ? 'No document'
                    : toolsSupported
                      ? documentName
                      : `${documentName} · text only`}
                </span>
              </span>
            </div>
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
                historyBusy
              )
                return;
              const text = input.trim();
              setInput('');
              void send(appendUserTurn(messages, text), { authorizeDocument: true });
            }}
          >
            <textarea
              ref={textareaRef}
              id="ai-chat-message"
              aria-label="Message the assistant"
              aria-describedby={mode === 'agent' ? 'ai-chat-context' : undefined}
              rows={2}
              value={input}
              maxLength={30000}
              placeholder={
                mode === 'chat' ? 'Ask a question…' : 'Describe a change to the active file…'
              }
              disabled={reviewActive}
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
                <div className="ai-mode-switch" role="group" aria-label="Assistant mode">
                  <button
                    type="button"
                    aria-pressed={mode === 'chat'}
                    disabled={loading || reviewActive || historyBusy}
                    onClick={() => setMode('chat')}
                    title="Chat answers without reading the active document."
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'agent'}
                    disabled={loading || reviewActive || historyBusy || !agentContext}
                    onClick={() => setMode('agent')}
                    title={
                      agentContext
                        ? 'Agent can read the active document and stage edits for review.'
                        : 'Open an eligible .tex document to use Agent mode.'
                    }
                  >
                    Agent
                  </button>
                </div>
                <ModelPicker
                  settings={settings}
                  role="assistant"
                  value={model}
                  onChange={setModel}
                  variant="compact"
                  placement="up"
                  label="Model"
                  disabled={loading || reviewActive || historyBusy}
                />
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
                  disabled={!input.trim() || !modelAvailable || reviewActive || historyBusy}
                  aria-label="Send message"
                  title="Send message"
                >
                  <ArrowUp size={12} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
            {lastAccess === 'unsupported' && (
              <p className="ai-agent-context-hint" role="status">
                The last reply was text only because this connection does not use tool calls.
              </p>
            )}
          </form>
        </>
      ) : null}
    </section>
  );
}
