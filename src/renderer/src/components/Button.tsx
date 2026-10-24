import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { AppTooltip } from './HelpTooltip';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'toolbar';
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', busy, className, type = 'button', disabled, ...props },
  ref,
) {
  const variantClass =
    variant === 'primary' ? 'primary-button' : variant === 'toolbar' ? 'toolbar-button' : '';
  return (
    <button
      ref={ref}
      type={type}
      className={[variantClass, className].filter(Boolean).join(' ') || undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
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
