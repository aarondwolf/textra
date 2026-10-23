import { lazy, Suspense, type ComponentProps } from 'react';
import { FileText, Folder, FolderOpen } from '../../icons';
import { useStartup } from '../../state/startup';

type Props = ComponentProps<typeof import('./fileIcons').FileIcon>;

function BasicIcon({ kind, expanded, size = 16 }: Props) {
  const Icon = kind === 'file' ? FileText : expanded ? FolderOpen : Folder;
  return <Icon size={size} className="file-icon" aria-hidden="true" />;
}

// Keep the complete filename manifest and 1,200 SVG URL mappings out of the shell.
const DetailedIcon = lazy(() =>
  import('./fileIcons')
    .then((module) => ({ default: module.FileIcon }))
    .catch(() => ({ default: BasicIcon })),
);

export function FileIcon(props: Props) {
  const ready = useStartup((state) => state.editorReady || state.restoration === 'settled');
  return ready ? (
    <Suspense fallback={<BasicIcon {...props} />}>
      <DetailedIcon {...props} />
    </Suspense>
  ) : (
    <BasicIcon {...props} />
  );
}
