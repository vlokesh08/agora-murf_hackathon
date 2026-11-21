import type { HTMLAttributes } from "react";
import clsx from "clsx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className
      )}
      {...props}
    />
  );
}
