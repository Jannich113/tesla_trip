import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Toaster } from "sonner";
import { PlanScreen } from "@/planner/plan-screen";

export const Route = createFileRoute("/plan")({ component: PlanPage });

function PlanPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="flex items-center gap-3 px-5 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link
            to="/"
            className="flex size-11 items-center justify-center rounded-full bg-surface text-foreground shadow-[var(--shadow-border)]"
            aria-label="Back to app"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <p className="text-sm font-medium leading-none">Trip planner</p>
            <p className="mt-1 text-[11px] text-muted">Per-leg eco / fast / cheap · live spot</p>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto pb-8">
          <PlanScreen />
        </main>
      </div>
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--color-surface)",
            color: "var(--color-foreground)",
            border: "none",
          },
        }}
      />
    </div>
  );
}
