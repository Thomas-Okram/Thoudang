import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

export type ButtonVariant =
  'primary' | 'navy' | 'secondary' | 'ghost' | 'success' | 'attention' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  // teal-deep, not teal-accent: white text needs ≥4.5:1
  primary:
    'bg-teal-deep text-white shadow-sm hover:bg-teal-darker disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none',
  navy: 'bg-navy-900 text-white shadow-sm hover:bg-navy-700 disabled:bg-slate-300 disabled:text-slate-600',
  secondary:
    'border border-line-strong bg-white text-navy-900 shadow-sm hover:border-navy-300 hover:bg-navy-50 disabled:border-line disabled:bg-white disabled:text-slate-400 disabled:shadow-none',
  ghost:
    'text-ink-soft hover:bg-navy-50 hover:text-navy-900 disabled:bg-transparent disabled:text-slate-400',
  success:
    'bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none',
  attention:
    'border-2 border-warm-500 bg-white text-warm-900 hover:bg-warm-50 disabled:border-line disabled:bg-white disabled:text-slate-400',
  danger: 'bg-rose-700 text-white shadow-sm hover:bg-rose-800 disabled:bg-slate-300',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-[0.95rem]',
  lg: 'h-12 gap-2 px-5 text-base',
  xl: 'h-14 gap-2.5 px-7 text-lg',
};

export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') =>
  `inline-flex select-none items-center justify-center whitespace-nowrap rounded-control font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${VARIANT[variant]} ${SIZE[size]}`;

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20, xl: 22 };

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  loadingLabel,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  loadingLabel?: ReactNode;
}) {
  return (
    <button
      type={type}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass(variant, size)} ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner size={ICON_SIZE[size] - 2} />
      ) : (
        icon && <Icon name={icon} size={ICON_SIZE[size]} />
      )}
      {loading && loadingLabel ? loadingLabel : children}
      {iconRight && !loading && <Icon name={iconRight} size={ICON_SIZE[size]} />}
    </button>
  );
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  className = '',
  children,
  ...rest
}: LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
}) {
  return (
    <Link className={`${buttonClass(variant, size)} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {children}
      {iconRight && <Icon name={iconRight} size={ICON_SIZE[size]} />}
    </Link>
  );
}
