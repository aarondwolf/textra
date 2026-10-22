import type { AIMessage } from '../../../../shared/api';

/** Keep every submitted prompt as its own visible transcript turn. */
export function appendUserTurn(messages: AIMessage[], text: string): AIMessage[] {
  return [...messages, { role: 'user', text }];
}

/** Providers expect alternating roles, so combine adjacent same-role bubbles only on send. */
export function coalesceProviderMessages(messages: AIMessage[]): AIMessage[] {
  const result: AIMessage[] = [];
  for (const message of messages) {
    const last = result.at(-1);
    if (last?.role === message.role) {
      last.text += `\n\n${message.text}`;
      if (message.role === 'model' && message.review) last.review = message.review;
    } else result.push({ ...message });
  }
  return result;
}
