import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIAgentDocument, AIAssistantRequest } from '../../src/shared/ai';
import { AgentWorkspaceService } from '../../src/main/services/agent-workspace';
import { BoundedAgentService, type AssistantModelFactory } from '../../src/main/services/agent';
import { AIService, type KeyCipher } from '../../src/main/services/ai-service';
import { scripted, type Step } from '../helpers/scripted-model';
import { ProjectService } from '../../src/main/services/projects';
import { agentEditHunks } from '../../src/shared/ai-edits';

// Fixture-only identity encryption and provider: these tests never contact Google.
const cipher: KeyCipher = {
  available: () => true,
  encrypt: (key) => Buffer.from(key),
  decrypt: (key) => key.toString(),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('canonical active-file agent workspace boundary', () => {
  let directory: string;
  let root: string;
  let projects: ProjectService;
  let agent: BoundedAgentService;
  let workspace: AgentWorkspaceService;
  let document: AIAgentDocument;
  let provider: ReturnType<typeof vi.fn<AssistantModelFactory>>;
  let steps: Step[];
  const request = (contextId: string): AIAssistantRequest => ({
    contextId,
    model: { provider: 'google', model: 'gemma-4-26b-a4b-it' },
    messages: [{ role: 'user', text: 'Fix the greeting.' }],
    requestId: 'workspace-request',
  });

  beforeEach(async () => {
    const parent = join(process.cwd(), 'test-results', 'agent-workspace');
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'case-'));
    root = join(directory, 'project');
    await mkdir(root);
    await writeFile(join(root, 'main.tex'), 'Hello world.');
    projects = new ProjectService(join(directory, 'settings'));
    const project = await projects.openRoot(root);
    document = await projects.readFile({ projectId: project.id, path: 'main.tex' });
    const gemini = new AIService(join(directory, 'ai'), cipher, {
      list: async () => [{ id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' }],
    });
    await gemini.saveProvider({ provider: 'google', apiKey: 'fixture-key' });
    steps = [];
    // Each provider call plays queued steps, then finishes with a plain answer.
    provider = vi.fn<AssistantModelFactory>(async () =>
      scripted([...steps.splice(0), { text: 'Done.' }]),
    );
    agent = new BoundedAgentService(gemini, undefined, provider);
    workspace = new AgentWorkspaceService(projects, agent);
  });
  afterEach(async () => {
    agent.cancel();
    vi.restoreAllMocks();
    await projects.flush();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each(['../outside.tex', 'chapters/../../outside.tex', 'C:/outside.tex'])(
    'revokes the previous context before rejecting canonical path %s',
    async (path) => {
      const previous = (await workspace.sync(document))!;
      await expect(workspace.sync({ ...document, path })).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
      expect(() => agent.getDocument(previous.contextId)).toThrow();
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it('rejects a junction escaping the project using the real canonical resolver', async ({
    skip,
  }) => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'main.tex'), 'Private outside text');
    try {
      await symlink(
        outside,
        join(root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'code' in cause &&
        (cause.code === 'EPERM' || cause.code === 'EACCES')
      ) {
        skip('This environment does not permit creating symbolic links or junctions.');
        return;
      }
      throw cause;
    }
    await expect(workspace.sync({ ...document, path: 'linked/main.tex' })).rejects.toMatchObject({
      code: 'UNSAFE_PATH',
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it('rejects a forged project token before establishing agent context', async () => {
    await expect(
      workspace.sync({ ...document, projectId: 'another-project' }),
    ).rejects.toMatchObject({ code: 'STALE_PROJECT' });
    expect(provider).not.toHaveBeenCalled();
  });
  it('reuses the same snapshot context and retains its pending proposal', async () => {
    steps.push(
      { calls: [{ name: 'read_current_file', input: {} }] },
      { calls: [{ name: 'insert_text', input: { offset: 12, text: '\n' } }] },
    );
    const resolve = vi.spyOn(projects, 'resolvePath');
    const context = (await workspace.sync(document))!;
    const result = await workspace.run(request(context.contextId));
    expect(result.proposal).not.toBeNull();
    resolve.mockClear();
    expect(await workspace.sync({ ...document })).toEqual(context);
    expect(resolve).not.toHaveBeenCalled();
    expect(
      await workspace.accept({ id: result.proposal!.id, contextId: context.contextId }),
    ).toEqual(result.proposal);
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(document.content);
  });
  it.each(['run', 'accept', 'review'] as const)(
    'checks the disk revision before %s',
    async (operation) => {
      const context = (await workspace.sync(document))!;
      const invoke = vi.spyOn(agent, operation);
      await writeFile(join(root, 'main.tex'), 'Externally modified');
      const result =
        operation === 'run'
          ? workspace.run(request(context.contextId))
          : operation === 'accept'
            ? workspace.accept({ id: 'proposal', contextId: context.contextId })
            : workspace.review({
                id: 'proposal',
                contextId: context.contextId,
                approveHunkIds: ['hunk-1'],
                rejectHunkIds: [],
              });
      await expect(result).rejects.toMatchObject({ code: 'AI_AGENT_STALE' });
      expect(invoke).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it('rechecks the project token before running an old active document', async () => {
    const context = (await workspace.sync(document))!;
    await projects.openRoot(root);
    const run = vi.spyOn(agent, 'run');
    await expect(workspace.run(request(context.contextId))).rejects.toMatchObject({
      code: 'STALE_PROJECT',
    });
    expect(run).not.toHaveBeenCalled();
  });
  it('an older awaited sync cannot overwrite a newer active snapshot', async () => {
    const entered = deferred<void>();
    const release = deferred<string>();
    vi.spyOn(projects, 'resolvePath').mockImplementationOnce(() => {
      entered.resolve();
      return release.promise;
    });
    const old = workspace.sync(document);
    await entered.promise;
    const newer = { ...document, content: 'Unsaved newer content' };
    const current = (await workspace.sync(newer))!;
    release.resolve(join(root, 'main.tex'));
    expect(await old).toBeNull();
    expect(agent.getDocument(current.contextId)).toEqual(newer);
  });
  it('clearing the active file invalidates a pending sync before it resolves', async () => {
    const entered = deferred<void>();
    const release = deferred<string>();
    vi.spyOn(projects, 'resolvePath').mockImplementationOnce(() => {
      entered.resolve();
      return release.promise;
    });
    const pending = workspace.sync(document);
    await entered.promise;
    expect(await workspace.sync(null)).toBeNull();
    release.resolve(join(root, 'main.tex'));
    expect(await pending).toBeNull();
    expect(() => agent.getDocument('any-context')).toThrow();
  });
  it.each(['run', 'accept', 'review'] as const)(
    'rechecks context after the awaited disk read before %s',
    async (operation) => {
      const context = (await workspace.sync(document))!;
      const entered = deferred<void>();
      const release = deferred<AIAgentDocument>();
      vi.spyOn(projects, 'readFile').mockImplementationOnce(() => {
        entered.resolve();
        return release.promise;
      });
      const invoke = vi.spyOn(agent, operation);
      const pending =
        operation === 'run'
          ? workspace.run(request(context.contextId))
          : operation === 'accept'
            ? workspace.accept({ id: 'proposal', contextId: context.contextId })
            : workspace.review({
                id: 'proposal',
                contextId: context.contextId,
                approveHunkIds: ['hunk-1'],
                rejectHunkIds: [],
              });
      // Attach rejection handling before advancing the controlled async race.
      const rejected = expect(pending).rejects.toMatchObject({ code: 'AI_AGENT_STALE' });
      await entered.promise;
      await workspace.sync({ ...document, content: 'Changed in the editor' });
      release.resolve(document);
      await rejected;
      expect(invoke).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it.each(['approve', 'reject'] as const)(
    'retains a rebased pending proposal after renderer echo, then %ss the last hunk',
    async (decision) => {
      const content = 'one\nunchanged\ntwo\n';
      await writeFile(join(root, 'main.tex'), content);
      document = await projects.readFile({ projectId: document.projectId, path: document.path });
      steps.push({
        calls: [
          { name: 'read_current_file', input: {} },
          { name: 'replace_range', input: { expected: 'one', text: 'ONE' } },
          { name: 'replace_range', input: { expected: 'two', text: 'TWO' } },
        ],
      });
      const context = (await workspace.sync(document))!;
      const proposal = (await workspace.run(request(context.contextId))).proposal!;
      const initialIds = agentEditHunks(proposal.content, proposal.modified).map(({ id }) => id);
      const first = await workspace.review({
        id: proposal.id,
        contextId: context.contextId,
        approveHunkIds: [initialIds[0]],
        rejectHunkIds: [],
      });
      expect(first.applied?.modified).toBe('ONE\nunchanged\ntwo\n');
      const acceptedDocument = { ...document, content: first.applied!.modified };
      const resolve = vi.spyOn(projects, 'resolvePath');
      resolve.mockClear();
      expect(await workspace.sync(acceptedDocument)).toEqual(first.context);
      expect(resolve).not.toHaveBeenCalled();
      await expect(
        workspace.review({
          id: proposal.id,
          contextId: context.contextId,
          approveHunkIds: [initialIds[0]],
          rejectHunkIds: [],
        }),
      ).rejects.toMatchObject({ code: 'AI_AGENT_STALE' });
      const remaining = first.remaining!;
      const lastIds = agentEditHunks(remaining.content, remaining.modified).map(({ id }) => id);
      const last = await workspace.review({
        id: remaining.id,
        contextId: remaining.contextId,
        approveHunkIds: decision === 'approve' ? lastIds : [],
        rejectHunkIds: decision === 'reject' ? lastIds : [],
      });
      expect(last.remaining).toBeNull();
      expect(agent.getDocument(last.context.contextId).content).toBe(
        decision === 'approve' ? 'ONE\nunchanged\nTWO\n' : 'ONE\nunchanged\ntwo\n',
      );
      expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(content);
      await expect(
        workspace.review({
          id: remaining.id,
          contextId: last.context.contextId,
          approveHunkIds: lastIds,
          rejectHunkIds: [],
        }),
      ).rejects.toMatchObject({ code: 'AI_AGENT_STALE' });
    },
  );
  it('revokes a rebased pending review when the editor changes beyond the approved echo', async () => {
    const content = 'one\nunchanged\ntwo\n';
    await writeFile(join(root, 'main.tex'), content);
    document = await projects.readFile({ projectId: document.projectId, path: document.path });
    steps.push({
      calls: [
        { name: 'read_current_file', input: {} },
        { name: 'replace_range', input: { expected: 'one', text: 'ONE' } },
        { name: 'replace_range', input: { expected: 'two', text: 'TWO' } },
      ],
    });
    const context = (await workspace.sync(document))!;
    const proposal = (await workspace.run(request(context.contextId))).proposal!;
    const firstId = agentEditHunks(proposal.content, proposal.modified)[0].id;
    const reviewed = await workspace.review({
      id: proposal.id,
      contextId: context.contextId,
      approveHunkIds: [firstId],
      rejectHunkIds: [],
    });
    await workspace.sync({ ...document, content: `${reviewed.applied!.modified}User edit` });
    await expect(
      workspace.review({
        id: reviewed.remaining!.id,
        contextId: reviewed.context.contextId,
        approveHunkIds: ['hunk-1'],
        rejectHunkIds: [],
      }),
    ).rejects.toMatchObject({ code: 'AI_AGENT_STALE' });
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(content);
  });
});
