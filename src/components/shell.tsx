import { lazy, Suspense, useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import { Car, CircleDollarSign, House, RotateCw, Route, Zap } from "lucide-react";
import { HomeScreen } from "@/components/home-screen";
import { type Tab, VEHICLE } from "@/lib/vehicle";
import { cn } from "@/lib/utils";
import { useVehicleProfile } from "@/hooks/use-vehicle-profile";
import { useVehicleStore } from "@/store/vehicle-store";

const TripsScreen = lazy(() =>
  import("@/components/trips-screen").then((m) => ({ default: m.TripsScreen })),
);
const ChargeScreen = lazy(() =>
  import("@/components/charge-screen").then((m) => ({ default: m.ChargeScreen })),
);
const ElprisScreen = lazy(() =>
  import("@/components/elpris-screen").then((m) => ({ default: m.ElprisScreen })),
);
const VehicleScreen = lazy(() =>
  import("@/components/vehicle-screen").then((m) => ({ default: m.VehicleScreen })),
);

const TAB_LOADERS: Record<Exclude<Tab, "home">, () => Promise<unknown>> = {
  trips: () => import("@/components/trips-screen"),
  costs: () => import("@/components/charge-screen"),
  elpris: () => import("@/components/elpris-screen"),
  vehicle: () => import("@/components/vehicle-screen"),
};

const WARM_ORDER: Exclude<Tab, "home">[] = ["trips", "costs", "elpris", "vehicle"];
const warmed = new Set<string>();

function saveDataOn() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return Boolean(conn?.saveData) || conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g";
}

function warmTab(id: Tab) {
  if (id === "home") return Promise.resolve();
  if (warmed.has(id)) return Promise.resolve();
  warmed.add(id);
  return TAB_LOADERS[id]()
    .then(() => undefined)
    .catch(() => {
      warmed.delete(id);
    });
}

function warmTabsInIdle(first?: Tab) {
  if (typeof window === "undefined" || saveDataOn()) return () => {};
  const order = first && first !== "home" ? [first, ...WARM_ORDER.filter((id) => id !== first)] : [...WARM_ORDER];
  let i = 0;
  let idleId = 0;
  let timer = 0;
  let stopped = false;

  const step = (deadline?: { didTimeout: boolean; timeRemaining: () => number }) => {
    if (stopped || i >= order.length) return;
    const busy = deadline && !deadline.didTimeout && deadline.timeRemaining() < 12;
    if (busy) {
      schedule();
      return;
    }
    const id = order[i];
    i += 1;
    void warmTab(id).then(() => {
      if (!stopped) schedule();
    });
  };

  const schedule = () => {
    if (stopped || i >= order.length) return;
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback((d) => step(d), { timeout: 4000 });
    } else {
      timer = window.setTimeout(() => step(), 240);
    }
  };

  timer = window.setTimeout(schedule, 0);
  return () => {
    stopped = true;
    if (idleId && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
    if (timer) window.clearTimeout(timer);
  };
}

function TabFallback() {
  return <div className="mx-4 mt-4 h-72 rounded-xl bg-surface" />;
}

const TABS: { id: Tab; label?: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "trips", label: "Trips", icon: Route },
  { id: "costs", label: "Costs", icon: CircleDollarSign },
  { id: "elpris", label: "Elpris", icon: Zap },
  { id: "vehicle", icon: Car },
];

function LightBar() {
  return (
    <svg viewBox="0 0 52 14" className="h-3 w-11 text-foreground" aria-hidden="true">
      <rect x="1" y="3" width="50" height="2.2" rx="1.1" fill="currentColor" />
      <rect x="3" y="8" width="9" height="3" rx="0.7" fill="currentColor" />
      <rect x="40" y="8" width="9" height="3" rx="0.7" fill="currentColor" />
    </svg>
  );
}

const TAB_IDS: Tab[] = ["home", "trips", "costs", "elpris", "vehicle"];

function readTabFromLocation(): Tab {
  if (typeof window === "undefined") return "home";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("tab");
  if (raw && (TAB_IDS as string[]).includes(raw)) return raw as Tab;
  return "home";
}

function writeTabToLocation(next: Tab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (next === "home") url.searchParams.delete("tab");
  else url.searchParams.set("tab", next);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function tabHref(id: Tab) {
  return id === "home" ? "/" : `/?tab=${id}`;
}

export function Dashboard({ startTab = "home" }: { startTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(startTab);
  const wake = useVehicleStore((s) => s.wake);
  const waking = useVehicleStore((s) => s.waking);
  const tick = useVehicleStore((s) => s.tick);
  const { profile } = useVehicleProfile();

  const selectTab = (next: Tab) => {
    if (next !== "home") void warmTab(next);
    setTab(next);
    writeTabToLocation(next);
  };

  useEffect(() => {
    const initial = readTabFromLocation();
    if (initial !== "home") {
      setTab(initial);
      void warmTab(initial);
    }
    const onPop = () => setTab(readTabFromLocation());
    window.addEventListener("popstate", onPop);
    const stopWarm = warmTabsInIdle(initial);
    return () => {
      window.removeEventListener("popstate", onPop);
      stopWarm();
    };
  }, []);

  useEffect(() => {
    void Promise.resolve(useVehicleStore.persist.rehydrate()).catch(() => {});
    const later = window.setTimeout(() => {
      void import("@/store/charge-store")
        .then((m) => Promise.resolve(m.useChargeStore.persist.rehydrate()))
        .catch(() => {});
      void import("@/store/trip-store")
        .then((m) => Promise.resolve(m.useTripStore.persist.rehydrate()))
        .catch(() => {});
    }, 400);
    const params = new URLSearchParams(window.location.search);
    const tesla = params.get("tesla");
    if (tesla) {
      const messages: Record<string, string> = {
        ok: "Juniper linked to the owner Tesla account",
        not_owner: "That Tesla account does not own Juniper",
        driver: "Driver access is blocked — owner only",
        denied: "Tesla sign-in was cancelled",
        error: "Tesla owner sign-in failed",
        not_configured: "Tesla owner credentials are not on this app yet",
      };
      toast(messages[tesla] ?? "Tesla owner sign-in did not complete");
      params.delete("tesla");
      const qs = params.toString();
      window.history.replaceState({}, "", qs ? `/?${qs}` : "/");
    }
    return () => window.clearTimeout(later);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const mode = useVehicleStore.getState().mode;
      if (mode === "parked") return;
      tick();
    }, 1000);
    return () => window.clearInterval(id);
  }, [tick]);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="flex items-center justify-between px-5 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-3">
            <LightBar />
            <div>
              <p className="text-sm font-medium leading-none">{VEHICLE.name}</p>
              <p className="mt-1 text-[11px] text-muted">
                {VEHICLE.model} · {VEHICLE.trim}
                {VEHICLE.isDemo ? " · Demo" : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void wake()}
            disabled={waking}
            className="flex size-11 items-center justify-center rounded-full bg-surface text-foreground shadow-[var(--shadow-border)] transition-[scale,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.96] disabled:opacity-50"
            aria-label="Refresh vehicle"
          >
            <RotateCw className={cn("size-4", waking && "animate-spin")} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto pb-32">
          {tab === "home" && <HomeScreen />}
          {tab !== "home" ? (
            <Suspense fallback={<TabFallback />}>
              {tab === "trips" && <TripsScreen />}
              {tab === "costs" && <ChargeScreen />}
              {tab === "elpris" && <ElprisScreen />}
              {tab === "vehicle" && <VehicleScreen />}
            </Suspense>
          ) : null}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-[100] mx-auto max-w-lg border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-sm"
          aria-label="Primary"
        >
          <ul className="grid grid-cols-5">
            {TABS.map((item) => {
              const Icon = item.icon;
              const current = tab === item.id;
              const label = item.id === "vehicle" ? profile.name : item.label!;
              return (
                <li key={item.id}>
                  <a
                    href={tabHref(item.id)}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      if (item.id !== "home") void warmTab(item.id);
                      selectTab(item.id);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      selectTab(item.id);
                    }}
                    onPointerEnter={() => {
                      if (item.id !== "home") void warmTab(item.id);
                    }}
                    className={cn(
                      "flex h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 text-[10px] font-medium no-underline",
                      "transition-[color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
                      current ? "text-foreground" : "text-muted",
                    )}
                    aria-current={current ? "page" : undefined}
                    aria-label={label}
                  >
                    <Icon className="size-5" strokeWidth={current ? 2.2 : 1.8} />
                    <span className="max-w-full truncate px-0.5">{label}</span>
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
