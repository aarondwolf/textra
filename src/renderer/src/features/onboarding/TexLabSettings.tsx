import { AppTooltip } from '../../components/HelpTooltip';
import { Check, Package, Play, RefreshCw, Wrench } from '../../icons';
import { SettingSwitch } from '../../components/SettingsControls';

export type TexLabInstallState = 'managed' | 'external' | 'missing' | 'checking' | 'error';

export interface TexLabSettingsProps {
  /** TexLab is opt-out: TeXtra uses it whenever a healthy installation is available. */
  enabled: boolean;
  installation: TexLabInstallState;
  version?: string | null;
  path?: string | null;
  detail?: string | null;
  busy?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onInstall?: () => void | Promise<void>;
  onCheck?: () => void | Promise<void>;
  onUpdate?: () => void | Promise<void>;
}

const STATE_COPY: Record<TexLabInstallState, { label: string; tone: string }> = {
  managed: { label: 'Included with TeXtra', tone: 'ready' },
  external: { label: 'External installation found', tone: 'ready' },
  missing: { label: 'Not installed', tone: 'missing' },
  checking: { label: 'Checking installation', tone: 'checking' },
  error: { label: 'Needs attention', tone: 'error' },
};

/**
 * Settings UI for the optional TexLab executable. Process management remains in
 * Electron main; this component deliberately receives only serializable status
 * and intent callbacks.
 */
export function TexLabSettings({
  enabled,
  installation,
  version,
  path,
  detail,
  busy = false,
  onEnabledChange,
  onInstall,
  onCheck,
  onUpdate,
}: TexLabSettingsProps) {
  const state = STATE_COPY[installation];
  const isAvailable = installation === 'managed' || installation === 'external';

  return (
    <section className="texlab-settings" aria-labelledby="texlab-settings-title">
      <div className="texlab-settings-heading">
        <div>
          <h3 id="texlab-settings-title">TexLab language intelligence</h3>
          <p className="setup-hint">
            Completions, definitions, references, hover details, and editor diagnostics for LaTeX
            projects. TexLab runs locally.
          </p>
        </div>
        <div className="texlab-toggle">
          <span>Enabled</span>
          <SettingSwitch
            label="TexLab enabled"
            checked={enabled}
            disabled={busy || !isAvailable || !onEnabledChange}
            onCheckedChange={(checked) => onEnabledChange?.(checked)}
          />
        </div>
      </div>

      <div className="texlab-status" aria-live="polite">
        <span className={`texlab-status-dot ${state.tone}`} aria-hidden="true" />
        <div>
          <strong>{state.label}</strong>
          {version && <span className="texlab-version">TexLab {version}</span>}
          {path && (
            <AppTooltip content={path}>
              <code>{path}</code>
            </AppTooltip>
          )}
          {detail && <p>{detail}</p>}
        </div>
      </div>

      <div className="setup-actions texlab-actions">
        {!isAvailable && (
          <button disabled={busy || !onInstall} onClick={() => void onInstall?.()}>
            <Package size={14} aria-hidden="true" />
            Install TexLab
          </button>
        )}
        {isAvailable && (
          <>
            <button disabled={busy || !onCheck} onClick={() => void onCheck?.()}>
              <Play size={14} aria-hidden="true" />
              Run checks
            </button>
            {installation === 'managed' && (
              <button disabled={busy || !onUpdate} onClick={() => void onUpdate?.()}>
                <RefreshCw size={14} aria-hidden="true" />
                Check for update
              </button>
            )}
          </>
        )}
      </div>
      {installation === 'missing' && (
        <p className="setup-hint texlab-license-note">
          TexLab is an optional GPL-3.0 language server. Installation downloads TeXtra&apos;s pinned
          release after you choose Install.
        </p>
      )}
      {isAvailable && !enabled && (
        <p className="setup-hint texlab-disabled-note">
          TeXtra will continue using its local reference suggestions and writing analysis.
        </p>
      )}
      {installation === 'error' && (
        <p className="setup-hint texlab-error-note">
          <Wrench size={13} aria-hidden="true" /> Run checks to see whether TexLab can start.
        </p>
      )}
      {installation === 'managed' && (
        <p className="setup-hint texlab-license-note">
          <Check size={13} aria-hidden="true" /> Bundled tools are stored outside your projects.
        </p>
      )}
    </section>
  );
}
