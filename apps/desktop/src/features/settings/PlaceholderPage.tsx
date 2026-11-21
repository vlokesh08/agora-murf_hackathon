import { Sidebar } from "../../components/Sidebar";
import { Card } from "../../components/ui/Card";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-[-0.022em]">{title}</h1>
          <Card className="mt-5 p-8 text-center text-base text-[var(--color-text-dim)]">
            {description}
          </Card>
        </div>
      </main>
    </div>
  );
}
