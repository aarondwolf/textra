import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { AppTooltip } from './HelpTooltip';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'toolbar';
  busy?: boolean;
}

/** Native button with TeXtra's shared tooltip for compact icon and toolbar actions. */
export function TooltipButton({
  title,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const button = (
    <button {...props} disabled={disabled}>
      {children}
    </button>
  );
  if (!title) return button;
  if (disabled) return button;
  return <AppTooltip content={title}>{button}</AppTooltip>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', busy, className, type = 'button', disabled, title, ...props },
  ref,
) {
  const variantClass =
    variant === 'primary' ? 'primary-button' : variant === 'toolbar' ? 'toolbar-button' : '';
  const button = (
    <button
      ref={ref}
      type={type}
      className={[variantClass, className].filter(Boolean).join(' ') || undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={undefined}
      {...props}
    />
  );
  if (!title) return button;
  if (disabled || busy) return button;
  return <AppTooltip content={title}>{button}</AppTooltip>;
});

export const AddButton = forwardRef<HTMLButtonElement, ButtonProps>(function AddButton(
  { className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      className={['add-action-button', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { label: string; small?: boolean }
>(function IconButton({ label, small = true, className, ...props }, ref) {
  const { title, disabled, busy, ...buttonProps } = props;
  const visibleTitle = title ?? label;
  const button = (
    <Button
      ref={ref}
      aria-label={label}
      title={disabled || busy ? visibleTitle : undefined}
      className={['icon-button', small && 'small', className].filter(Boolean).join(' ')}
      disabled={disabled}
      busy={busy}
      {...buttonProps}
    />
  );
  return disabled || busy ? button : <AppTooltip content={visibleTitle}>{button}</AppTooltip>;
});
