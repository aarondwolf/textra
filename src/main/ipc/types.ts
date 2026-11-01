import type { BrowserWindow } from 'electron';
import type { TextraAPI } from '../../shared/api';
import type { ApplicationTasks, RendererCloseBarrier, WorkspaceSession } from '../lifecycle';
import type { PreferencesStore } from '../services/preferences';
import type { ProjectService } from '../services/projects';
import type { ProjectConflictPolicyService } from '../services/project-conflict-policy';
import type { CollaborationStorage } from '../services/collaboration-storage';
import type { AIService } from '../services/ai-service';
import type { AIInlineEditService } from '../services/ai-inline-edit';
import type { AgentWorkspaceService } from '../services/agent-workspace';
import type { AIChatStore } from '../services/ai-chats';
import type { ExternalEditorService } from '../services/external-editor';
import type { HistoryService } from '../services/history';
import type { BuildService } from '../services/latex';
import type { ConfigService } from '../services/settings';
import type { LanguageService } from '../services/language';
import type { TexlabManager } from '../services/texlab-manager';

export interface RuntimeState {
  dirty: boolean;
  stopping: boolean;
  healthBuild: BuildService | null;
  healthCheckStarting: boolean;
}

export interface IpcServices {
  preferences: PreferencesStore;
  projects: ProjectService;
  conflictPolicy: ProjectConflictPolicyService;
  collaboration: CollaborationStorage;
  ai: AIService;
  inlineEdits: AIInlineEditService;
  agentWorkspace: AgentWorkspaceService;
  aiChats: AIChatStore;
  externalEditor: ExternalEditorService;
  history: HistoryService;
  builds: BuildService;
  config: ConfigService;
  language: LanguageService;
  texlab: TexlabManager;
  state: RuntimeState;
  workspace: WorkspaceSession;
  applicationTasks: ApplicationTasks;
  closeBarrier: RendererCloseBarrier;
  rendererUrl: string;
  requireWindow: () => BrowserWindow;
  requireIdleProject: () => void;
}

export interface IpcHandlers {
  handle<T>(
    channel: string,
    argumentCount: number,
    action: (...args: unknown[]) => Promise<T> | T,
  ): void;
  handleRequest<K extends keyof TextraAPI>(
    channel: string,
    action: (...args: Parameters<TextraAPI[K]>) => unknown,
  ): void;
}
