import type { ComponentProps, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '../icons';
import { IconButton } from './Button';

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  className = 'setup-dialog',
  children,
  footer,
  contentProps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  contentProps?: Omit<ComponentProps<typeof Dialog.Content>, 'children' | 'className'>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={className} {...contentProps}>
          <div className="dialog-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X size={14} />
              </IconButton>
            </Dialog.Close>
          </div>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
          {footer}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
