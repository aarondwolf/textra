import type { CSSProperties, ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, ChevronRight } from '../icons';

export interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  detail?: ReactNode;
  count?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  headerRowClassName?: string;
  bodyClassName?: string;
  headerActions?: ReactNode;
  style?: CSSProperties;
  headerStyle?: CSSProperties;
  bodyStyle?: CSSProperties;
  id?: string;
}

/** Shared accessible Radix disclosure used by compact workspace sections. */
export function CollapsibleSection({
  title,
  icon,
  detail,
  count,
  open,
  onOpenChange,
  children,
  className,
  headerClassName,
  headerRowClassName,
  bodyClassName,
  headerActions,
  style,
  headerStyle,
  bodyStyle,
  id,
}: CollapsibleSectionProps) {
  return (
    <Collapsible.Root
      asChild
      open={open}
      onOpenChange={onOpenChange}
      className={[className, open ? 'expanded' : 'collapsed'].filter(Boolean).join(' ')}
    >
      <section style={style}>
        <div className={headerRowClassName}>
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className={headerClassName}
              aria-label={title}
              style={headerStyle}
            >
              {open ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
              <span id={id} className="writing-section-title-text">
                {icon}
                <span>{title}</span>
              </span>
              {detail}
              {count !== undefined && <span className="writing-count">{count}</span>}
            </button>
          </Collapsible.Trigger>
          {headerActions}
        </div>
        <Collapsible.Content className={bodyClassName} style={bodyStyle}>
          {children}
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}
