import type {
  AIAgentContext,
  AIAgentDocument,
  AIAgentRequest,
  AIAgentResult,
  AIAgentReviewRequest,
  AIAgentReviewResult,
  AIEditProposal,
} from '../../shared/ai';
import { AGENT_SOURCE_LIMIT } from '../../shared/ai';
import type { ProjectService } from './projects';
import { AIError } from './gemini';
import type { BoundedAgentService } from './agent';

/** Binds the staging-only runner to the canonical, currently open editor snapshot. */
export class AgentWorkspaceService {
  private generation = 0;
  private document: AIAgentDocument | null = null;
  constructor(
    private readonly projects: Pick<ProjectService, 'resolvePath' | 'readFile'>,
    private readonly agent: Pick<
      BoundedAgentService,
      'syncDocument' | 'getDocument' | 'run' | 'accept' | 'reject' | 'review'
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
    if (
      !value ||
      typeof value !== 'object' ||
      !('projectId' in value) ||
      typeof value.projectId !== 'string' ||
      !('path' in value) ||
      typeof value.path !== 'string' ||
      !/\.tex$/i.test(value.path) ||
      !('content' in value) ||
      typeof value.content !== 'string' ||
      value.content.length > AGENT_SOURCE_LIMIT ||
      !('revision' in value) ||
      typeof value.revision !== 'string' ||
      !value.revision
    )
      throw new AIError(
        'AI_AGENT_SCOPE',
        'Agent mode needs an active .tex file under 64,000 characters.',
      );
    const document: AIAgentDocument = {
      projectId: value.projectId,
      path: value.path,
      content: value.content,
      revision: value.revision,
    };
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

  async run(request: AIAgentRequest): Promise<AIAgentResult> {
    await this.current(request?.contextId);
    return this.agent.run(request);
  }

  async accept(request: {
    id: string;
    contextId: string;
    hunkIds?: string[];
  }): Promise<AIEditProposal> {
    await this.current(request?.contextId);
    return this.agent.accept(request);
  }

  reject(id: unknown): void {
    this.agent.reject(id);
  }

  async review(request: AIAgentReviewRequest): Promise<AIAgentReviewResult> {
    await this.current(request?.contextId);
    const result = this.agent.review(request);
    this.document = this.agent.getDocument(result.context.contextId);
    return result;
  }
}
