import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';

export interface DropdownMenuItem<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DropdownMenuGroup<T extends string = string> {
  group: string;
  items: DropdownMenuItem<T>[];
}

export type DropdownItemOrGroup<T extends string = string> =
  DropdownMenuItem<T> | DropdownMenuGroup<T>;

export interface DropdownMenuProps<T extends string = string> {
  value?: T | null;
  items: DropdownItemOrGroup<T>[];
  onChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  menuStyle?: CSSProperties;
  triggerStyle?: CSSProperties;
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
  fullWidth?: boolean;
  title?: string;
  preventFocusSteal?: boolean;
  customTrigger?: ReactNode | ((open: boolean) => ReactNode);
  footer?: ReactNode;
}

function isGroup<T extends string>(item: DropdownItemOrGroup<T>): item is DropdownMenuGroup<T> {
  return 'group' in item && Array.isArray((item as DropdownMenuGroup<T>).items);
}

/**
 * DropdownMenu (also exported as SelectMenu)
 *
 * Unified dropdown and select component matching the styling of the formatting toolbar
 * and setup dialogs. Provides pill-styled trigger, floating shadow menu, checkmarks on active
 * items, keyboard escape handling, and outside-click dismissal.
 */
export function DropdownMenu<T extends string = string>({
  value,
  items,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  ariaLabel,
  className = '',
  style,
  menuStyle,
  triggerStyle,
  align = 'left',
  direction = 'down',
  fullWidth = false,
  title,
  preventFocusSteal = false,
  customTrigger,
  footer,
}: DropdownMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Flatten items to locate selected item label
  const flatItems: DropdownMenuItem<T>[] = [];
  for (const item of items) {
    if (isGroup(item)) {
      flatItems.push(...item.items);
    } else {
      flatItems.push(item);
    }
  }

  const selectedItem = flatItems.find((item) => item.value === value);
  const displayLabel = selectedItem ? selectedItem.label : placeholder;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const renderItem = (item: DropdownMenuItem<T>) => {
    const isSelected = item.value === value;
    return (
      <button
        key={item.value}
        type="button"
        role="menuitem"
        className={['dropdown-menu-item', isSelected ? 'selected' : ''].filter(Boolean).join(' ')}
        disabled={item.disabled}
        onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
        onClick={() => {
          if (item.onClick) {
            item.onClick();
          }
          if (onChange) {
            onChange(item.value);
          }
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <span className="dropdown-menu-item-content">
          {item.icon}
          <span>{item.label}</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {item.description && (
            <span className="dropdown-menu-item-description">{item.description}</span>
          )}
          {isSelected && (
            <Check
              size={12}
              weight="bold"
              className="dropdown-menu-item-check"
              aria-hidden="true"
            />
          )}
        </div>
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      className={[
        'dropdown-menu-container',
        'editor-format-heading',
        fullWidth ? 'full-width' : '',
        open ? 'open' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {!fullWidth && !customTrigger && (
        <div className="dropdown-menu-sizer" aria-hidden="true">
          <div className="dropdown-menu-sizer-item">
            <span>{displayLabel}</span>
            <span className="dropdown-menu-sizer-caret" />
          </div>
          {flatItems.map((item) => (
            <div key={item.value} className="dropdown-menu-sizer-item">
              <span className="dropdown-menu-item-content">
                {item.icon}
                <span>{item.label}</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {item.description && (
                  <span className="dropdown-menu-item-description">{item.description}</span>
                )}
                <span className="dropdown-menu-sizer-check" />
              </div>
            </div>
          ))}
        </div>
      )}

      {customTrigger ? (
        <div
          ref={triggerRef as React.RefObject<HTMLDivElement>}
          role="button"
          tabIndex={disabled || items.length === 0 ? -1 : 0}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={ariaLabel}
          title={title}
          className="dropdown-menu-custom-trigger"
          onClick={() => {
            if (!disabled && items.length > 0) setOpen((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (!disabled && items.length > 0 && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
          onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
          style={triggerStyle}
        >
          {typeof customTrigger === 'function' ? customTrigger(open) : customTrigger}
        </div>
      ) : (
        <button
          ref={triggerRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className="dropdown-menu-trigger editor-format-heading-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={ariaLabel}
          title={title}
          disabled={disabled || items.length === 0}
          onClick={() => setOpen((prev) => !prev)}
          onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
          style={triggerStyle}
        >
          <span className="dropdown-menu-trigger-text">{displayLabel}</span>
          <CaretDown size={11} aria-hidden="true" className="dropdown-menu-trigger-caret" />
        </button>
      )}

      {open && (
        <div
          className={[
            'dropdown-menu-popup',
            'editor-format-heading-menu',
            direction === 'up' ? 'direction-up' : '',
            align === 'right' ? 'align-right' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="menu"
          aria-label={ariaLabel}
          style={menuStyle}
        >
          {items.map((itemOrGroup, idx) => {
            if (isGroup(itemOrGroup)) {
              return (
                <div key={`group-${itemOrGroup.group}-${idx}`}>
                  <div className="dropdown-menu-group-header">{itemOrGroup.group}</div>
                  {itemOrGroup.items.map((item) => renderItem(item))}
                </div>
              );
            }
            return renderItem(itemOrGroup);
          })}
          {footer && <div className="dropdown-menu-footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}

// Export SelectMenu as an alias for intuitive semantic reuse
export const SelectMenu = DropdownMenu;
