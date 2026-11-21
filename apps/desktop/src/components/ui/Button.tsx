import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** gr8r-studio control heights: 26 / 30 / 36px. */
  size?: "sm" | "md" | "lg";
  /** Stretch to the full width of the parent (gr8r .btn-block). */
  block?: boolean;
}

const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-[26px] px-2 text-xs",
  md: "h-[30px] px-[11px] text-sm",
  lg: "h-[36px] px-3.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  block,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        // gr8r-studio .btn: 6px gap, 6px radius, 500 weight,
        // 140ms transitions and a 0.97 press.
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
        "active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]",
        sizes[size],
        block && "w-full",
        variant === "primary" &&
          "bg-[var(--color-accent)] text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] hover:bg-[#6a4aef]",
        variant === "secondary" &&
          "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm hover:bg-[var(--color-surface-2)]",
        variant === "ghost" &&
          "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] active:bg-[var(--color-surface-2)]",
        variant === "danger" &&
          "bg-[var(--color-danger)] text-white hover:brightness-110",
        className
      )}
      {...props}
    />
  );
}
