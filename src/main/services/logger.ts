type LogLevel = 'info' | 'warn' | 'error';
const sensitiveKey = /secret|password|passwd|token|authorization|credential|api[-_ ]?key/i;

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)[-_][a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(
      /\b(api[-_ ]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );
}

/** Defense in depth; callers should log event codes, never source or credentials. */
export function redact(value: unknown): unknown {
  const seen = new WeakSet<object>();
  function visit(item: unknown, depth: number): unknown {
    if (typeof item === 'string') return redactString(item);
    if (item === null || typeof item !== 'object') return item;
    if (depth > 10) return '[TRUNCATED]';
    if (seen.has(item)) return '[CIRCULAR]';
    seen.add(item);
    if (item instanceof Error) return { name: item.name, message: redactString(item.message) };
    if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : visit(entry, depth + 1),
      ]),
    );
  }
  return visit(value, 0);
}

export function formatLog(level: LogLevel, event: string, details?: unknown): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: redactString(event),
    ...(details === undefined ? {} : { details: redact(details) }),
  });
}

export function log(level: LogLevel, event: string, details?: unknown): void {
  const line = formatLog(level, event, details);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
