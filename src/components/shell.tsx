import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Route, Zap } from "lucide-react";
import { ElprisScreen } from "@/components/elpris-screen";
import { type Tab } from "@/lib/vehicle";
import { cn } from "@/lib/utils";
import { useVehicleStore } from "@/store/vehicle-store";
import { useChargeStore } from "@/store/charge-store";
import { useTripStore } from "@/store/trip-store";

const PlanScreen = lazy(() =>
  import("@/planner/plan-screen").then((m) => ({ default: m.PlanScreen })),
);

const TABS: { id: Tab; label: string; icon: typeof Route }[] = [
  { id: "plan", label: "Planner", icon: Route },
  { id: "elpris", label: "Elpris", icon: Zap },
];

const TAB_IDS: Tab[] = TABS.map((t) => t.id);

function LightBar() {
  return (
    <svg viewBox="0 0 52 14" className="h-3 w-11 text-foreground" aria-hidden="true">
      <rect x="1" y="3" width="50" height="2.2" rx="1.1" fill="currentColor" />
      <rect x="3" y="8" width="9" height="3" rx="0.7" fill="currentColor" />
      <rect x="40" y="8" width="9" height="3" rx="0.7" fill="currentColor" />
    </svg>
  );
}

function PlanFallback() {
  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="h-10 rounded-full bg-surface-2" />
      <div className="h-44 rounded-xl bg-surface shadow-[var(--shadow-border)]" />
      <div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />
      <div className="h-40 rounded-xl bg-surface shadow-[var(--shadow-border)]" />
    </div>
  );
}

function readTabFromLocation(): Tab {
  if (typeof window === "undefined") return "plan";
  const raw = new URLSearchParams(window.location.search).get("tab");
  if (raw && (TAB_IDS as string[]).includes(raw)) return raw as Tab;
  return "plan";
}

function writeTabToLocation(next: Tab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (next === "plan") url.searchParams.delete("tab");
  else url.searchParams.set("tab", next);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function tabHref(id: Tab) {
  return id === "plan" ? "/" : `/?tab=${id}`;
}

const SUBTITLE: Record<Tab, string> = {
  plan: "Per-leg eco / fast / cheap · live spot",
  elpris: "Danish spot prices · DK1 / DK2",
};

export function Dashboard({ startTab = "plan" }: { startTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(startTab);
  const [opened, setOpened] = useState<Tab[]>([startTab]);

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setOpened((cur) => (cur.includes(next) ? cur : [...cur, next]));
    writeTabToLocation(next);
  };

  useEffect(() => {
    const initial = readTabFromLocation();
    if (initial !== startTab) {
      setTab(initial);
      setOpened((cur) => (cur.includes(initial) ? cur : [...cur, initial]));
    }
    const onPop = () => setTab(readTabFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [startTab]);

  useEffect(() => {
    // The planner reads the car profile and charge places, and files saved plans as trips.
    void Promise.resolve(useVehicleStore.persist.rehydrate()).catch(() => {});
    void Promise.resolve(useChargeStore.persist.rehydrate()).catch(() => {});
    void Promise.resolve(useTripStore.persist.rehydrate()).catch(() => {});
  }, []);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="flex items-center gap-3 px-5 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <LightBar />
          <div>
            <p className="text-sm font-medium leading-none">
              {tab === "plan" ? "Trip planner" : "Elpris"}
            </p>
            <p className="mt-1 text-[11px] text-muted">{SUBTITLE[tab]}</p>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-32">
          {opened.includes("plan") && (
            <div className={tab === "plan" ? undefined : "pointer-events-none hidden"} aria-hidden={tab !== "plan"}>
              <Suspense fallback={<PlanFallback />}>
                <PlanScreen />
              </Suspense>
            </div>
          )}
          {opened.includes("elpris") && (
            <div className={tab === "elpris" ? undefined : "pointer-events-none hidden"} aria-hidden={tab !== "elpris"}>
              <ElprisScreen />
            </div>
          )}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-[100] mx-auto max-w-lg border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-sm"
          aria-label="Primary"
        >
          <ul className="grid grid-cols-2">
            {TABS.map((item) => {
              const Icon = item.icon;
              const current = tab === item.id;
              return (
                <li key={item.id}>
                  <a
                    href={tabHref(item.id)}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      selectTab(item.id);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      selectTab(item.id);
                    }}
                    className={cn(
                      "flex h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 text-[10px] font-medium no-underline",
                      "transition-[color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
                      current ? "text-foreground" : "text-muted",
                    )}
                    aria-current={current ? "page" : undefined}
                    aria-label={item.label}
                  >
                    <Icon className="size-5" strokeWidth={current ? 2.2 : 1.8} />
                    <span className="max-w-full truncate px-0.5">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--color-surface)",
            color: "var(--color-foreground)",
            border: "1px solid var(--color-border)",
          },
        }}
      />
    </div>
  );
}
