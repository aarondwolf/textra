import type { HTMLAttributes, ReactNode } from 'react';

export function PaneHeader({
  title,
  actions,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className={['sidebar-title', className].filter(Boolean).join(' ')} {...props}>
      <span className="sidebar-heading">{title}</span>
      {children}
      {actions}
    </div>
  );
}

export function SettingRow({
  label,
  children,
  description,
  className,
  ...props
}: HTMLAttributes<HTMLLabelElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={['field-label', className].filter(Boolean).join(' ')} {...props}>
      {label}
      {children}
      {description && <span className="setup-hint">{description}</span>}
    </label>
  );
}

export function Section({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  return collapsible ? (
    <details open={defaultOpen || undefined}>
      <summary>{title}</summary>
      {children}
    </details>
  ) : (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function StatusMessage({
  children,
  kind = 'status',
  className = 'setup-hint',
}: {
  children: ReactNode;
  kind?: 'status' | 'error';
  className?: string;
}) {
  return (
    <p className={className} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
