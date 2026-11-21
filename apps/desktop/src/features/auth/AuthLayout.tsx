import type { ReactNode } from "react";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="orb-glow mb-4 h-14 w-14 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)]" />
          <h1 className="text-3xl font-semibold tracking-[-0.022em] text-[var(--color-text)]">
            {title}
          </h1>
          <p className="mt-1 text-base text-[var(--color-text-dim)]">
            {subtitle}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
