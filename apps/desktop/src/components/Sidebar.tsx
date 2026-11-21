import { NavLink, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { authClient } from "../lib/authClient";

const navItems = [
  { to: "/app", label: "Conversation", exact: true },
  { to: "/app/automations", label: "Automations" },
  { to: "/app/integrations", label: "Connected apps" },
  { to: "/app/settings", label: "Settings" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const userName = session?.user.name;

  return (
    // gr8r-studio shell: 252px rail, 8px gutters, 30px rows on a 6px radius.
    <aside className="flex h-screen w-[252px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2">
      <div className="mb-3 flex items-center gap-2 px-1.5 py-1">
        <div className="h-[22px] w-[22px] shrink-0 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)]" />
        <span className="font-semibold tracking-[-0.01em]">Assistant</span>
      </div>

      <nav className="flex-1 space-y-1 px-1.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) =>
              clsx(
                "flex h-[30px] items-center gap-[9px] rounded-md px-2 transition-colors duration-[140ms]",
                isActive
                  ? "bg-[var(--color-accent)]/15 font-medium text-[var(--color-text)]"
                  : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--color-border)] px-1.5 pb-0.5 pt-1.5">
        <div className="mb-1 px-2 text-xs text-[var(--color-text-dim)]">
          Signed in as {userName || "you"}
        </div>
        <button
          onClick={async () => {
            await authClient.signOut();
            navigate("/sign-in");
          }}
          className="flex h-[30px] w-full items-center gap-[9px] rounded-md px-2 text-left text-[var(--color-text-dim)] transition-colors duration-[140ms] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
