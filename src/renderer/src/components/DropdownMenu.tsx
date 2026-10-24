import {
  useEffect,
  useMemo,
  useId,
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
 * items, keyboard arrow navigation, roving tabIndex/aria-activedescendant, and outside-click dismissal.
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
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

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

  // Flatten items to locate selected item label and index navigation
  const flatItems = useMemo(() => {
    const list: DropdownMenuItem<T>[] = [];
    for (const item of items) {
      if (isGroup(item)) {
        list.push(...item.items);
      } else {
        list.push(item);
      }
    }
    return list;
  }, [items]);

  const selectedIndex = flatItems.findIndex((item) => item.value === value);
  const selectedItem = selectedIndex >= 0 ? flatItems[selectedIndex] : undefined;
  const displayLabel = selectedItem ? selectedItem.label : placeholder;

  // Initialize or reset highlightedIndex when open changes
  useEffect(() => {
    if (open) {
      if (selectedIndex >= 0 && !flatItems[selectedIndex]?.disabled) {
        setHighlightedIndex(selectedIndex);
      } else {
        const firstEnabled = flatItems.findIndex((item) => !item.disabled);
        setHighlightedIndex(firstEnabled);
      }
    } else {
      setHighlightedIndex(-1);
    }
  }, [open, selectedIndex, flatItems]);

  // Auto-scroll highlighted item into view
  useEffect(() => {
    if (open && highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  const selectItemAt = (index: number) => {
    const item = flatItems[index];
    if (!item || item.disabled) return;
    if (item.onClick) {
      item.onClick();
    }
    if (onChange) {
      onChange(item.value);
    }
    setOpen(false);
    triggerRef.current?.focus();
  };

  const findNextEnabledIndex = (fromIndex: number, direction: 1 | -1): number => {
    const total = flatItems.length;
    if (total === 0) return -1;
    for (let step = 1; step <= total; step++) {
      const idx = (fromIndex + direction * step + total) % total;
      if (!flatItems[idx]?.disabled) return idx;
    }
    return fromIndex;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || items.length === 0) return;

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => findNextEnabledIndex(prev, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => findNextEnabledIndex(prev, -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      const first = flatItems.findIndex((item) => !item.disabled);
      if (first >= 0) setHighlightedIndex(first);
    } else if (e.key === 'End') {
      e.preventDefault();
      for (let i = flatItems.length - 1; i >= 0; i--) {
        if (!flatItems[i]?.disabled) {
          setHighlightedIndex(i);
          break;
        }
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (highlightedIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        selectItemAt(highlightedIndex);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const renderItem = (item: DropdownMenuItem<T>, flatIndex: number) => {
    const isSelected = item.value === value;
    const isHighlighted = flatIndex === highlightedIndex;
    const itemId = `${menuId}-item-${flatIndex}`;

    return (
      <button
        key={item.value}
        id={itemId}
        ref={(el) => {
          itemRefs.current[flatIndex] = el;
        }}
        type="button"
        role="menuitem"
        aria-selected={isSelected}
        tabIndex={isHighlighted ? 0 : -1}
        className={[
          'dropdown-menu-item',
          isSelected ? 'selected' : '',
          isHighlighted ? 'highlighted' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={item.disabled}
        onMouseEnter={() => {
          if (!item.disabled) setHighlightedIndex(flatIndex);
        }}
        onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
        onClick={() => selectItemAt(flatIndex)}
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

  let flatIndexCounter = 0;

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
          aria-controls={open ? `${menuId}-popup` : undefined}
          aria-activedescendant={
            open && highlightedIndex >= 0 ? `${menuId}-item-${highlightedIndex}` : undefined
          }
          aria-label={ariaLabel}
          title={title}
          className="dropdown-menu-custom-trigger"
          onClick={() => {
            if (!disabled && items.length > 0) setOpen((prev) => !prev);
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
          aria-controls={open ? `${menuId}-popup` : undefined}
          aria-activedescendant={
            open && highlightedIndex >= 0 ? `${menuId}-item-${highlightedIndex}` : undefined
          }
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
          id={`${menuId}-popup`}
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
          aria-activedescendant={
            highlightedIndex >= 0 ? `${menuId}-item-${highlightedIndex}` : undefined
          }
          style={menuStyle}
        >
          {items.map((itemOrGroup, idx) => {
            if (isGroup(itemOrGroup)) {
              return (
                <div key={`group-${itemOrGroup.group}-${idx}`}>
                  <div className="dropdown-menu-group-header">{itemOrGroup.group}</div>
                  {itemOrGroup.items.map((item) => {
                    const currentIdx = flatIndexCounter++;
                    return renderItem(item, currentIdx);
                  })}
                </div>
              );
            }
            const currentIdx = flatIndexCounter++;
            return renderItem(itemOrGroup, currentIdx);
          })}
          {footer && <div className="dropdown-menu-footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}

// Export SelectMenu as an alias for intuitive semantic reuse
export const SelectMenu = DropdownMenu;
