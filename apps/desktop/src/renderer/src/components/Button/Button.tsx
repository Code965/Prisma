import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary`: fondo scuro (Salva, Genera); `secondary`: bordo e fondo pannello. */
  variant?: 'primary' | 'secondary';
  /** Altezza del mockup: 32 (azioni nelle righe), 36 (default), 40 (azioni principali delle card). */
  size?: 32 | 36 | 40;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 36,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${styles[`size${size}`]} ${className ?? ''}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
