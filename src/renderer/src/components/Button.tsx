import { forwardRef, type ButtonHTMLAttributes } from 'react';

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
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      className={['icon-button', small && 'small', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
});
