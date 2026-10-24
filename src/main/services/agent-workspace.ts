import type {
  AIAgentContext,
  AIAgentDocument,
  AIAssistantEvent,
  AIAssistantResult,
  AIAgentReviewRequest,
  AIAgentReviewResult,
  AIEditProposal,
} from '../../shared/ai';
import { AGENT_SOURCE_LIMIT } from '../../shared/ai';
import type { ProjectService } from './projects';
import { AIError } from './ai-service';
import type { BoundedAgentService } from './agent';
import { z } from 'zod';

export const agentDocumentSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().regex(/\.tex$/i),
  content: z.string().max(AGENT_SOURCE_LIMIT),
  revision: z.string().min(1),
});

export const agentAcceptRequestSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().min(1),
  hunkIds: z.array(z.string()).optional(),
});

export const agentReviewRequestSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().min(1),
  approveHunkIds: z.array(z.string()),
  rejectHunkIds: z.array(z.string()),
});

/** Binds the staging-only runner to the canonical, currently open editor snapshot. */
export class AgentWorkspaceService {
  private generation = 0;
  private document: AIAgentDocument | null = null;
  constructor(
    private readonly projects: Pick<ProjectService, 'resolvePath' | 'readFile'>,
    private readonly agent: Pick<
      BoundedAgentService,
      'syncDocument' | 'getDocument' | 'run' | 'accept' | 'reject' | 'review' | 'cancelRequest'
    >,
  ) {}

  async sync(value: unknown): Promise<AIAgentContext | null> {
    if (
      this.document &&
      value &&
      typeof value === 'object' &&
      'projectId' in value &&
      value.projectId === this.document.projectId &&
      'path' in value &&
      value.path === this.document.path &&
      'content' in value &&
      value.content === this.document.content &&
      'revision' in value &&
      value.revision === this.document.revision
    )
      return this.agent.syncDocument(this.document);
    const generation = ++this.generation;
    this.document = null;
    this.agent.syncDocument(null);
    if (value === null) return null;
    const parsed = agentDocumentSchema.safeParse(value);
    if (!parsed.success) {
      throw new AIError(
        'AI_AGENT_SCOPE',
        'The assistant can use only an active .tex file under 64,000 characters.',
      );
    }
    const document: AIAgentDocument = parsed.data;
    await this.projects.resolvePath({ projectId: document.projectId, path: document.path });
    if (generation !== this.generation) return null;
    const context = this.agent.syncDocument(document);
    this.document = document;
    return context;
  }

  private async current(contextId: string): Promise<AIAgentDocument> {
    const document = this.agent.getDocument(contextId);
    // readFile rechecks root token, canonical path, symlinks, file type and revision.
    const snapshot = await this.projects.readFile({
      projectId: document.projectId,
      path: document.path,
    });
    if (snapshot.revision !== document.revision)
      throw new AIError(
        'AI_AGENT_STALE',
        'The file changed on disk. Review the current file and ask again.',
      );
    this.agent.getDocument(contextId);
    return document;
  }

  /** Runs one assistant request. A document is touched only when Manual Send attached it. */
  async run(
    request: unknown,
    emit?: (event: AIAssistantEvent) => void,
  ): Promise<AIAssistantResult> {
    const generation = this.generation;
    const contextId =
      request && typeof request === 'object' && 'contextId' in request
        ? request.contextId
        : undefined;
    if (contextId !== undefined) {
      if (typeof contextId !== 'string')
        throw new AIError('INVALID_ARGUMENT', 'Provide a valid document context.');
      await this.current(contextId);
    }
    if (generation !== this.generation)
      throw new AIError(
        'AI_AGENT_STALE',
        'The active document changed. Ask again in the current workspace.',
      );
    return this.agent.run(request, emit);
  }

  cancel(request: unknown): void {
    this.agent.cancelRequest(request);
  }

  async accept(request: {
    id: string;
    contextId: string;
    hunkIds?: string[];
  }): Promise<AIEditProposal> {
    const parsed = agentAcceptRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new AIError('INVALID_ARGUMENT', 'Invalid accept request.');
    }
    await this.current(parsed.data.contextId);
    return this.agent.accept(parsed.data);
  }

  reject(id: unknown): void {
    this.agent.reject(id);
  }

  async review(request: AIAgentReviewRequest): Promise<AIAgentReviewResult> {
    const parsed = agentReviewRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new AIError('INVALID_ARGUMENT', 'Invalid review request.');
    }
    await this.current(parsed.data.contextId);
    const result = this.agent.review(parsed.data);
    this.document = this.agent.getDocument(result.context.contextId);
    return result;
  }
}
