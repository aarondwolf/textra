import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  type ComponentProps,
  type ReactNode,
} from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useWindowChrome } from '../state/window-chrome';

const OverlayDepth = createContext(0);

/** Adds one stacking level for a dialog, including dialogs nested inside dialogs. */
function OverlayScope({ children }: { children: ReactNode }) {
  const parentDepth = useContext(OverlayDepth);
  return <OverlayDepth.Provider value={parentDepth + 1}>{children}</OverlayDepth.Provider>;
}

export function useOverlayZIndex(kind: 'backdrop' | 'dialog' | 'floating' = 'floating'): number {
  const depth = useContext(OverlayDepth);
  const offset = kind === 'backdrop' ? 0 : kind === 'dialog' ? 1 : 2;
  return 100 + depth * 20 + offset;
}

export const useOverlayLayer = useOverlayZIndex;

type RootProps = ComponentProps<typeof RadixDialog.Root>;
function LayeredRoot({ children, ...props }: RootProps) {
  return (
    <OverlayScope>
      <RadixDialog.Root {...props}>{children}</RadixDialog.Root>
    </OverlayScope>
  );
}

type OverlayProps = ComponentProps<typeof RadixDialog.Overlay>;
const LayeredOverlay = forwardRef<HTMLDivElement, OverlayProps>(function LayeredOverlay(
  { style, ...props },
  ref,
) {
  useEffect(() => {
    useWindowChrome.getState().changeModalCount(1);
    return () => {
      useWindowChrome.getState().changeModalCount(-1);
    };
  }, []);
  return (
    <RadixDialog.Overlay
      ref={ref}
      {...props}
      style={{ ...style, zIndex: useOverlayZIndex('backdrop') }}
    />
  );
});

type ContentProps = ComponentProps<typeof RadixDialog.Content>;
const LayeredContent = forwardRef<HTMLDivElement, ContentProps>(function LayeredContent(
  { style, onPointerDownOutside, ...props },
  ref,
) {
  return (
    <RadixDialog.Content
      ref={ref}
      {...props}
      style={{ ...style, zIndex: useOverlayZIndex('dialog') }}
      onPointerDownOutside={(event) => {
        const target = event.detail.originalEvent.target;
        if (target instanceof Element && target.closest('[data-window-controls]'))
          event.preventDefault();
        else onPointerDownOutside?.(event);
      }}
    />
  );
});

/** Drop-in Radix Dialog parts with one shared, nested-overlay stacking policy. */
export const LayeredDialog = {
  Root: LayeredRoot,
  Portal: RadixDialog.Portal,
  Overlay: LayeredOverlay,
  Content: LayeredContent,
  Title: RadixDialog.Title,
  Description: RadixDialog.Description,
  Close: RadixDialog.Close,
  Trigger: RadixDialog.Trigger,
};
