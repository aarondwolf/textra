import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
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
      <div className="feature-loading" role="alert">
        {this.props.label} could not be loaded.{' '}
        <button onClick={this.props.retry}>Try again</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

/** Each pane suspends independently, so opening an optional feature never hides the editor. */
export function lazyFeature<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
): ComponentType<Props> {
  return function DeferredFeature(props: Props) {
    const [attempt, setAttempt] = useState(0);
    const [component, setComponent] = useState(() => lazy(load));
    // The cast retains the loader's exact props across React's lazy exotic component wrapper.
    const Loaded = component as ComponentType<Props>;
    return (
      <FeatureBoundary
        key={attempt}
        label={label}
        retry={() => {
          setComponent(() => lazy(load));
          setAttempt((value) => value + 1);
        }}
      >
        <Suspense
          fallback={
            <div className="feature-loading" role="status">
              Loading {label.toLowerCase()}…
            </div>
          }
        >
          <Loaded {...props} />
        </Suspense>
      </FeatureBoundary>
    );
  };
}
