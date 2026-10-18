import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { SetupLink } from '../../../../shared/api';
import { useUI } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';
import './setup.css';

export default function SetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tools, project, rootFile, engine, build } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [platform, setPlatform] = useState('');
  useEffect(() => {
    if (open)
      void window.textra.getAppInfo().then((result) => {
        if (result.ok) setPlatform(result.value.platform);
      });
  }, [open]);
  async function perform(action: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage((await action()) ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }
  async function setupLink(target: SetupLink) {
    const result = await window.textra.openSetupLink(target);
    if (!result.ok) throw new Error(result.error);
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="setup-dialog">
          <div className="setup-heading">
            <Dialog.Title>Settings & TeX setup</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close settings" disabled={busy}>
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            No account or API key is required. Editing works without a TeX installation.
          </Dialog.Description>
          <div className="setup-scroll">
            <h3>Local tools</h3>
            <div className="tool-list">
              {tools.map((tool) => (
                <div className="tool-row" key={tool.name}>
                  <strong>{tool.name}</strong>
                  <span>{tool.path ? (tool.version ?? 'Detected') : 'Not found'}</span>
                  {tool.path && <code title={tool.path}>{tool.path}</code>}
                </div>
              ))}
            </div>
            <div className="setup-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await window.textra.detectTools();
                    if (!result.ok) throw new Error(result.error);
                    useWorkspace.setState({ tools: result.value, toolsReady: true });
                    return 'Tool detection refreshed. Restart TeXtra after changing your system PATH.';
                  })
                }
              >
                Check tools again
              </button>
              <button
                disabled={
                  busy ||
                  build.running ||
                  !tools.some((tool) => tool.name === 'pdflatex' && tool.path)
                }
                onClick={() =>
                  void perform(async () => {
                    setTesting(true);
                    try {
                      const result = await window.textra.testDistribution();
                      if (!result.ok) throw new Error(result.error);
                      setLog(result.value.log);
                      return result.value.success
                        ? 'Test document compiled successfully.'
                        : 'The test compile failed. See its output below.';
                    } finally {
                      setTesting(false);
                    }
                  })
                }
              >
                Test TeX installation
              </button>
              {testing && (
                <button onClick={() => void window.textra.cancelBuild()}>Cancel test</button>
              )}
            </div>
            <p className="setup-hint">
              The test compiles a small temporary document with pdfLaTeX. It does not change your
              project or download missing packages.
            </p>
            <h3>Get a TeX distribution</h3>
            <p>
              Use an existing installation when available. These buttons open the official download
              pages in your browser.
            </p>
            <div className="setup-actions">
              <button disabled={busy} onClick={() => void perform(() => setupLink('miktex'))}>
                MiKTeX download
              </button>
              <button disabled={busy} onClick={() => void perform(() => setupLink('texlive'))}>
                TeX Live installer
              </button>
              {platform === 'darwin' && (
                <button disabled={busy} onClick={() => void perform(() => setupLink('mactex'))}>
                  MacTeX download
                </button>
              )}
            </div>
            <p className="setup-hint">
              Installation can require administrator permission and several gigabytes of disk space.
              On Linux, use your distribution’s package manager. After installation, restart TeXtra
              and test the detected tools.
            </p>
            <h3>Project build preferences</h3>
            <p>
              {project
                ? `Save ${rootFile || 'automatic root selection'} and ${engine} for ${project.name}.`
                : 'Open a project to save its compiler and root document.'}
            </p>
            <button
              disabled={!project || busy || build.running}
              onClick={() =>
                void perform(async () => {
                  if (!project) return;
                  const result = await window.textra.setProjectConfig({
                    projectId: project.id,
                    config: { schemaVersion: 1, rootFile: rootFile || null, engine },
                  });
                  if (!result.ok) throw new Error(result.error);
                  return 'Project preferences saved in .textra/project.json.';
                })
              }
            >
              Save project preferences
            </button>
            <h3>Portable app settings</h3>
            <p>
              Export your theme and pane layout. Imports are validated before you apply them. Recent
              folders and credentials are excluded.
            </p>
            <div className="setup-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await window.textra.exportSettings();
                    if (!result.ok) throw new Error(result.error);
                    return result.value ? 'Settings exported.' : 'Export cancelled.';
                  })
                }
              >
                Export settings
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await window.textra.importSettings();
                    if (!result.ok) throw new Error(result.error);
                    if (!result.value) return 'Import cancelled.';
                    useUI.setState({ preferences: result.value });
                    return 'Theme and layout imported. Project files and tool paths are unchanged.';
                  })
                }
              >
                Import settings
              </button>
            </div>
            {message && (
              <p role="status" className="setup-message">
                {message}
              </p>
            )}
            {log && (
              <details>
                <summary>Test compile output</summary>
                <pre className="setup-log">{log}</pre>
              </details>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
