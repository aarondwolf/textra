import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CaretDown, Check } from '@phosphor-icons/react';
import { useOverlayZIndex } from './overlay-layers';
import { AppTooltip } from './HelpTooltip';

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
  customTrigger?: ReactElement | ((open: boolean) => ReactElement);
  footer?: ReactNode;
  mode?: 'actions' | 'single';
}

function isGroup<T extends string>(item: DropdownItemOrGroup<T>): item is DropdownMenuGroup<T> {
  return 'group' in item && Array.isArray((item as DropdownMenuGroup<T>).items);
}

/**
 * DropdownMenu (also exported as SelectMenu)
 *
 * Accessible dropdown and select component built on Radix UI primitives.
 * Automatically handles collision detection, portal positioning, roving keyboard focus,
 * and WAI-ARIA menuitem semantics while preserving TeXtra's pill-button visual design.
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
  mode,
}: DropdownMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const floatingZIndex = useOverlayZIndex();
  const menuMode = mode ?? (onChange ? 'single' : 'actions');

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

  const handleActionSelect = (item: DropdownMenuItem<T>) => {
    item.onClick?.();
    onChange?.(item.value);
  };

  const renderItem = (item: DropdownMenuItem<T>) => {
    const isSelected = item.value === value;
    const content = (
      <>
        <span className="dropdown-menu-item-content">
          {item.icon}
          <span>{item.label}</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {item.description && (
            <span className="dropdown-menu-item-description">{item.description}</span>
          )}
          {menuMode === 'single' ? (
            <DropdownMenuPrimitive.ItemIndicator>
              <Check
                size={12}
                weight="bold"
                className="dropdown-menu-item-check"
                aria-hidden="true"
              />
            </DropdownMenuPrimitive.ItemIndicator>
          ) : isSelected ? (
            <Check
              size={12}
              weight="bold"
              className="dropdown-menu-item-check"
              aria-hidden="true"
            />
          ) : null}
        </div>
      </>
    );
    const itemClass = ['dropdown-menu-item', isSelected ? 'selected' : '']
      .filter(Boolean)
      .join(' ');
    return menuMode === 'single' ? (
      <DropdownMenuPrimitive.RadioItem
        key={item.value}
        value={item.value}
        disabled={item.disabled}
        className={itemClass}
        onSelect={() => item.onClick?.()}
      >
        {content}
      </DropdownMenuPrimitive.RadioItem>
    ) : (
      <DropdownMenuPrimitive.Item
        key={item.value}
        disabled={item.disabled}
        className={itemClass}
        onSelect={() => handleActionSelect(item)}
      >
        {content}
      </DropdownMenuPrimitive.Item>
    );
  };

  const defaultTrigger = (
    <button
      type="button"
      className="dropdown-menu-trigger editor-format-heading-trigger"
      aria-label={ariaLabel}
      title={disabled || items.length === 0 ? title : undefined}
      disabled={disabled || items.length === 0}
      onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
      style={triggerStyle}
    >
      <span className="dropdown-menu-trigger-text">{displayLabel}</span>
      <CaretDown size={11} aria-hidden="true" className="dropdown-menu-trigger-caret" />
    </button>
  );

  return (
    <div
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
    >
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
        <DropdownMenuPrimitive.Trigger asChild disabled={disabled || items.length === 0}>
          {customTrigger ? (
            typeof customTrigger === 'function' ? (
              customTrigger(open)
            ) : (
              customTrigger
            )
          ) : title && !disabled && items.length > 0 ? (
            <AppTooltip content={title}>{defaultTrigger}</AppTooltip>
          ) : (
            defaultTrigger
          )}
        </DropdownMenuPrimitive.Trigger>

        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            sideOffset={4}
            collisionPadding={8}
            align={align === 'right' ? 'end' : 'start'}
            side={direction === 'up' ? 'top' : 'bottom'}
            className={[
              'dropdown-menu-popup',
              'editor-format-heading-menu',
              direction === 'up' ? 'direction-up' : '',
              align === 'right' ? 'align-right' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              ...(fullWidth ? { minWidth: 'var(--radix-dropdown-menu-trigger-width)' } : {}),
              ...menuStyle,
              zIndex: floatingZIndex,
            }}
          >
            {menuMode === 'single' ? (
              <DropdownMenuPrimitive.RadioGroup
                value={value ?? undefined}
                onValueChange={(nextValue) => onChange?.(nextValue as T)}
              >
                {items.map((itemOrGroup, idx) => {
                  if (isGroup(itemOrGroup)) {
                    return (
                      <DropdownMenuPrimitive.Group key={`group-${itemOrGroup.group}-${idx}`}>
                        <DropdownMenuPrimitive.Label className="dropdown-menu-group-header">
                          {itemOrGroup.group}
                        </DropdownMenuPrimitive.Label>
                        {itemOrGroup.items.map((item) => renderItem(item))}
                      </DropdownMenuPrimitive.Group>
                    );
                  }
                  return renderItem(itemOrGroup);
                })}
              </DropdownMenuPrimitive.RadioGroup>
            ) : (
              items.map((itemOrGroup, idx) => {
                if (isGroup(itemOrGroup)) {
                  return (
                    <DropdownMenuPrimitive.Group key={`group-${itemOrGroup.group}-${idx}`}>
                      <DropdownMenuPrimitive.Label className="dropdown-menu-group-header">
                        {itemOrGroup.group}
                      </DropdownMenuPrimitive.Label>
                      {itemOrGroup.items.map((item) => renderItem(item))}
                    </DropdownMenuPrimitive.Group>
                  );
                }
                return renderItem(itemOrGroup);
              })
            )}
            {footer && <div className="dropdown-menu-footer">{footer}</div>}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    </div>
  );
}

// Export SelectMenu as an alias for intuitive semantic reuse
export const SelectMenu = DropdownMenu;
