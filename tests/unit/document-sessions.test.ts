import { describe, expect, it, vi } from 'vitest';
import { DocumentSessionController } from '../../src/renderer/src/state/document-sessions';

const document = { projectId: 'project', path: 'main.tex', content: 'original', revision: 'disk' };

describe('document session ownership', () => {
  it('updates attached active models for approved store changes and preserves typing', () => {
    const sessions = new DocumentSessionController();
    sessions.observe([document]);
    let text = document.content;
    const replace = vi.fn((content: string) => {
      text = content;
    });
    sessions.attach(document.projectId, document.path, { read: () => text, replace });
    sessions.observe([{ ...document, content: 'formatted' }]);
    expect(text).toBe('formatted');
    text += ' new writing';
    sessions.observe([{ ...document, content: text }]);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('invalidates captures after an edit even if undo returns to identical content', () => {
    const sessions = new DocumentSessionController();
    sessions.observe([document]);
    const capture = sessions.capture(document.projectId, document.path)!;
    sessions.observe([{ ...document, content: 'changed' }]);
    sessions.observe([document]);
    expect(sessions.matches(capture)).toBe(false);
    expect(sessions.owns(capture)).toBe(true);
  });

  it('does not retain a model or ownership across close and reopen', () => {
    const sessions = new DocumentSessionController();
    sessions.observe([document]);
    const capture = sessions.capture(document.projectId, document.path)!;
    const replace = vi.fn();
    const detach = sessions.attach(document.projectId, document.path, {
      read: () => document.content,
      replace,
    });
    sessions.observe([]);
    sessions.observe([{ ...document, content: 'reopened' }]);
    detach();
    detach();
    expect(sessions.owns(capture)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
