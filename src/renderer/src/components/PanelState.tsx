import type { ReactNode } from 'react';
import './panel-state.css';

export function PanelState({
  title,
  description,
  icon,
  action,
  mode = 'empty',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  mode?: 'empty' | 'loading' | 'error';
  className?: string;
}) {
  return (
    <div
      className={['panel-state', `panel-state-${mode}`, className].filter(Boolean).join(' ')}
      role={mode === 'loading' ? 'status' : mode === 'error' ? 'alert' : undefined}
      aria-live={mode === 'loading' ? 'polite' : mode === 'error' ? 'assertive' : undefined}
    >
      {icon && (
        <span className="panel-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {mode === 'loading' && !icon && <span className="panel-state-spinner" aria-hidden="true" />}
      <div className="panel-state-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
        {action && <div className="panel-state-action">{action}</div>}
      </div>
    </div>
  );
}
