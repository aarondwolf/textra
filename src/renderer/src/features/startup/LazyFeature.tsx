import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { PanelState } from '../../components/PanelState';
import './startup.css';

class FeatureBoundary extends Component<
  { children: ReactNode; label: string; retry(): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <PanelState
        className="feature-loading"
        mode="error"
        title={`${this.props.label} could not be loaded`}
        action={<button onClick={this.props.retry}>Try again</button>}
      />
    ) : (
      this.props.children
    );
  }
}

/** Each pane suspends independently, so opening an optional feature never hides the editor. */
export function lazyFeature<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
): ComponentType<Props> & { preload(): Promise<void> } {
  let resolved: ComponentType<Props> | undefined;
  let pending: ReturnType<typeof load> | undefined;
  const loadOnce = () => {
    pending ??= load().then(
      (module) => {
        resolved = module.default;
        return module;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  let deferred = lazy(loadOnce);
  function DeferredFeature(props: Props) {
    const [attempt, setAttempt] = useState(0);
    const [component, setComponent] = useState(() => deferred);
    // The cast retains the loader's exact props across React's lazy exotic component wrapper.
    const Loaded = (resolved ?? component) as ComponentType<Props>;
    return (
      <FeatureBoundary
        key={attempt}
        label={label}
        retry={() => {
          pending = undefined;
          resolved = undefined;
          deferred = lazy(loadOnce);
          setComponent(() => deferred);
          setAttempt((value) => value + 1);
        }}
      >
        <Suspense
          fallback={
            <PanelState
              className="feature-loading"
              mode="loading"
              title={`Loading ${label.toLowerCase()}…`}
            />
          }
        >
          <Loaded {...props} />
        </Suspense>
      </FeatureBoundary>
    );
  }
  return Object.assign(DeferredFeature, {
    preload: async () => {
      await loadOnce();
    },
  });
}
