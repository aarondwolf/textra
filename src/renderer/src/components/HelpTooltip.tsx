import * as Tooltip from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ReactElement } from 'react';

type AppTooltipProps = {
  content: string;
  children: ReactElement;
} & Omit<ComponentPropsWithoutRef<typeof Tooltip.Trigger>, 'asChild' | 'children'>;

export const AppTooltip = forwardRef<HTMLButtonElement, AppTooltipProps>(function AppTooltip(
  { content, children, ...triggerProps },
  ref,
) {
  return (
    <Tooltip.Provider delayDuration={450}>
      <Tooltip.Root>
        <Tooltip.Trigger ref={ref} asChild {...triggerProps}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="help-tooltip-content"
            side="top"
            align="center"
            sideOffset={6}
            collisionPadding={8}
          >
            {content}
            <Tooltip.Arrow className="help-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
});

/** Compact, keyboard-accessible help using Radix Tooltip and TeXtra's shared surface style. */
export function HelpTooltip({ label, content }: { label: string; content: string }) {
  return (
    <AppTooltip content={content}>
      <button type="button" className="help-tooltip-trigger" aria-label={label}>
        <span aria-hidden="true">?</span>
      </button>
    </AppTooltip>
  );
}
