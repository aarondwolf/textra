import { AI_MODEL_ID_PATTERN, type AIModelInfo, type AIProviderId } from '../../shared/ai';

const SPECIALIST =
  /embed|rerank|moderation|transcrib|whisper|tts|audio|realtime|image|imagen|veo|sora|lyria|robotics|computer-use|deep-research|\bocr\b/i;
const OPENAI_SPECIALIST = /davinci|babbage|search|codex|instruct|(?:^|-)pro(?:-|$)/i;

/** Fallback for catalogues/caches without capability metadata. Vision input is OK. */
export function isTextModelId(provider: AIProviderId, id: string): boolean {
  if (!AI_MODEL_ID_PATTERN.test(id) || SPECIALIST.test(id)) return false;
  switch (provider) {
    case 'google':
      return /^(gemini|gemma)[-\d]/i.test(id) && !/live|aqa/i.test(id);
    case 'openai':
      return (
        /^(?:gpt-|chatgpt-|o\d(?:-|$)|ft:(?:gpt-|o\d))/i.test(id) && !OPENAI_SPECIALIST.test(id)
      );
    case 'anthropic':
      return /^claude-/i.test(id);
    case 'mistral':
      return true; // Discovery checks completion_chat explicitly.
    case 'deepseek':
      return /^deepseek-/i.test(id);
    default:
      return !/(?:^|\/)(?:bge|all-minilm|mxbai|snowflake-arctic)(?:[-:/]|$)/i.test(id);
  }
}

/** Missing modality metadata uses the provider's model family fallback. */
export function hasTextOutput(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && item.toLowerCase() === 'text'))
  );
}

export function cleanModelList(provider: AIProviderId, models: AIModelInfo[]): AIModelInfo[] {
  const seen = new Set<string>();
  return models
    .filter(
      ({ id, label }) =>
        isTextModelId(provider, id) && label.length <= 200 && !seen.has(id) && seen.add(id),
    )
    .slice(0, 500);
}
