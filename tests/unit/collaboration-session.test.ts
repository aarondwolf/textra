import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CollaborationSession,
  mergeUpdateIntoDocument,
} from '../../src/renderer/src/state/collaboration-session';

describe('Yjs collaboration sessions', () => {
  it('merges concurrent edits and tolerates duplicate or reordered updates', () => {
    const seed = new Y.Doc();
    seed.getText('source').insert(0, 'ab');
    const initial = Y.encodeStateAsUpdate(seed);
    const left = new CollaborationSession('ab', [initial]);
    const right = new CollaborationSession('ab', [initial]);
    left.localText.insert(1, 'L');
    right.localText.insert(1, 'R');
    const leftCapture = left.captureForSave();
    const rightCapture = right.captureForSave();
    const leftUpdate = leftCapture.update;
    const rightUpdate = rightCapture.update;
    left.acknowledgeSaved(leftCapture.state);
    right.acknowledgeSaved(rightCapture.state);

    left.applyIncoming(rightUpdate);
    left.applyIncoming(rightUpdate);
    right.applyIncoming(leftUpdate);
    expect(left.localText.toString()).toBe(right.localText.toString());
    expect(left.sharedText.toString()).toBe(right.sharedText.toString());
    expect(left.localText.toString()).toContain('a');
    expect(left.localText.toString()).toContain('b');

    const merged = mergeUpdateIntoDocument(
      Y.encodeStateAsUpdate(seed),
      mergeUpdateIntoDocument(leftUpdate, rightUpdate),
    );
    const verify = new Y.Doc();
    Y.applyUpdate(verify, merged);
    expect(verify.getText('source').toString()).toBe(left.sharedText.toString());
    verify.destroy();
    left.destroy();
    right.destroy();
    seed.destroy();
  });

  it('keeps accepted incoming updates out of local undo history', () => {
    const session = new CollaborationSession('abc');
    session.localText.insert(3, '!');
    const firstUpdate = session.captureForSave().update;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(session.shared));
    peer.getText('source').insert(0, 'remote ');
    session.applyIncoming(Y.encodeStateAsUpdate(peer));
    expect(session.localText.toString()).toBe('remote abc!');
    session.undoManager.undo();
    expect(session.localText.toString()).toBe('remote abc');
    session.undoManager.redo();
    expect(session.localText.toString()).toBe('remote abc!');
    expect(firstUpdate.length).toBeGreaterThan(0);
    session.destroy();
    peer.destroy();
  });

  it('captures matching text and state and discards only unpublished local work', () => {
    const session = new CollaborationSession('base');
    session.localText.insert(4, ' local');
    const captured = session.captureForSave();
    session.localText.insert(10, ' later');
    expect(captured.text).toBe('base local');
    expect(session.sharedText.toString()).toBe('base');
    session.acknowledgeSaved(captured.state);
    expect(session.sharedText.toString()).toBe('base local');
    session.discardLocal();
    expect(session.localText.toString()).toBe('base local');
    session.destroy();
  });
});
