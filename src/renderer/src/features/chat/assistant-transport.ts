import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { AIMessage, Result } from '../../../../shared/api';
import type { AIAssistantResult, AIModelRef, AIReviewOutcome } from '../../../../shared/ai';

/** Stored with each UI message; only application-owned review outcomes, never tool payloads. */
export interface AssistantMetadata {
  review?: AIReviewOutcome;
}
export type AssistantUIMessage = UIMessage<AssistantMetadata, { status: { message: string } }>;

export interface AssistantRequestBody {
  requestId: string;
  model: AIModelRef;
  /** Manual Send only: authorizes on-demand access to the captured document. */
  contextId?: string;
}

export class AssistantRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function isBody(value: unknown): value is AssistantRequestBody {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as AssistantRequestBody).requestId === 'string' &&
    Boolean((value as AssistantRequestBody).model)
  );
}

/** Converts visible UI bubbles to text turns; provider serialization can coalesce adjacent roles. */
export function fromUIMessages(
  messages: AssistantUIMessage[],
  coalesceSameRole = false,
): AIMessage[] {
  const result: AIMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim();
    if (!text) continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const last = result.at(-1);
    if (coalesceSameRole && last?.role === role) {
      last.text += `\n\n${text}`;
      if (role === 'model' && message.metadata?.review) last.review = message.metadata.review;
    } else
      result.push({
        role,
        text,
        ...(role === 'model' && message.metadata?.review
          ? { review: message.metadata.review }
          : {}),
      });
  }
  return result;
}

export function toUIMessages(messages: AIMessage[]): AssistantUIMessage[] {
  return messages.map((message) => ({
    id: crypto.randomUUID(),
    role: message.role === 'model' ? 'assistant' : 'user',
    ...(message.review ? { metadata: { review: message.review } } : {}),
    parts: [{ type: 'text', text: message.text }],
  }));
}

/**
 * useChat transport over the typed Electron bridge. Provider calls and credentials stay in
 * main; this stream carries only display text and transient tool status. The listener is
 * registered before the request starts and removed on completion, cancellation or failure.
 */
export class AssistantTransport implements ChatTransport<AssistantUIMessage> {
  private results = new Map<string, Result<AIAssistantResult>>();
  private reasoning = new Map<string, string>();

  /** The final result (including any proposal) of a completed request, read once. */
  takeResult(requestId: string) {
    const result = this.results.get(requestId);
    this.results.delete(requestId);
    return result;
  }

  /** Ephemeral display-only reasoning, never included in stored or future provider transcripts. */
  takeReasoning(requestId: string) {
    const reasoning = this.reasoning.get(requestId) ?? '';
    this.reasoning.delete(requestId);
    return reasoning;
  }

  async sendMessages({
    body,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<AssistantUIMessage>['sendMessages']>[0]) {
    if (!isBody(body)) throw new AssistantRequestError('Choose a model first.');
    const { requestId, model, contextId } = body;
    const conversation = fromUIMessages(messages, true);
    let cleanup = () => {};
    let settled = false;
    const cancel = () => void window.textra.cancelAIAssistant({ requestId }).catch(() => undefined);
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const textId = `${requestId}:text`;
        const reasoningId = `${requestId}:reasoning`;
        let text = '';
        let opened = false;
        let reasoning = '';
        let reasoningOpened = false;
        const finish = (action: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          action();
        };
        const update = (next: string) => {
          // Main emits cumulative text, whereas the SDK consumes deltas.
          if (!next.startsWith(text)) return;
          const delta = next.slice(text.length);
          text = next;
          if (!delta) return;
          if (!opened) {
            opened = true;
            controller.enqueue({ type: 'text-start', id: textId });
          }
          controller.enqueue({ type: 'text-delta', id: textId, delta });
        };
        const updateReasoning = (next: string) => {
          // Main emits cumulative reasoning; the SDK UI stream consumes deltas.
          if (!next.startsWith(reasoning)) return;
          const delta = next.slice(reasoning.length);
          reasoning = next;
          this.reasoning.set(requestId, reasoning);
          if (!delta) return;
          if (!reasoningOpened) {
            reasoningOpened = true;
            controller.enqueue({ type: 'reasoning-start', id: reasoningId });
          }
          controller.enqueue({ type: 'reasoning-delta', id: reasoningId, delta });
        };
        const unsubscribe = window.textra.onAIAssistantEvent((event) => {
          if (settled || event.requestId !== requestId) return;
          if (event.type === 'text') update(event.text);
          else if (event.type === 'reasoning') updateReasoning(event.text);
          else
            controller.enqueue({
              type: 'data-status',
              data: { message: event.message },
              transient: true,
            });
        });
        const abort = () =>
          finish(() => {
            this.reasoning.delete(requestId);
            cancel();
            controller.error(new DOMException('Response cancelled.', 'AbortError'));
          });
        cleanup = () => {
          unsubscribe();
          abortSignal?.removeEventListener('abort', abort);
        };
        abortSignal?.addEventListener('abort', abort, { once: true });
        if (abortSignal?.aborted) {
          abort();
          return;
        }
        controller.enqueue({ type: 'start', messageId: requestId });
        void window.textra
          .runAIAssistant({
            requestId,
            model,
            messages: conversation,
            ...(contextId ? { contextId } : {}),
          })
          .then(
            (result) =>
              finish(() => {
                this.results.set(requestId, result);
                if (!result.ok) {
                  controller.error(new AssistantRequestError(result.error, result.code));
                  return;
                }
                update(result.value.text);
                if (opened) controller.enqueue({ type: 'text-end', id: textId });
                if (reasoningOpened) controller.enqueue({ type: 'reasoning-end', id: reasoningId });
                controller.enqueue({ type: 'finish', finishReason: 'stop' });
                controller.close();
              }),
            () =>
              finish(() =>
                controller.error(
                  new AssistantRequestError(
                    'Could not reach the model. Check your connection and try again.',
                  ),
                ),
              ),
          );
      },
      cancel: () => {
        if (settled) return;
        settled = true;
        cleanup();
        cancel();
      },
    });
  }

  async reconnectToStream() {
    return null;
  }
}
