import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import { Car, CircleDollarSign, House, RotateCw, Route, Zap } from "lucide-react";
import { HomeScreen } from "@/components/home-screen";
import { TripsScreen } from "@/components/trips-screen";
import { ChargeScreen } from "@/components/charge-screen";
import { VehicleScreen } from "@/components/vehicle-screen";
import { ElprisScreen } from "@/components/elpris-screen";
import { type Tab, VEHICLE } from "@/lib/vehicle";
import { cn } from "@/lib/utils";
import { useChargeStore } from "@/store/charge-store";
import { useTripStore } from "@/store/trip-store";
import { useVehicleStore } from "@/store/vehicle-store";

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "trips", label: "Trips", icon: Route },
  { id: "costs", label: "Costs", icon: CircleDollarSign },
  { id: "elpris", label: "Elpris", icon: Zap },
  { id: "vehicle", label: "Juniper", icon: Car },
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

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("home");
  const wake = useVehicleStore((s) => s.wake);
  const waking = useVehicleStore((s) => s.waking);
  const tick = useVehicleStore((s) => s.tick);

  useEffect(() => {
    void useVehicleStore.persist.rehydrate();
    void useChargeStore.persist.rehydrate();
    void useTripStore.persist.rehydrate();
    const tesla = new URLSearchParams(window.location.search).get("tesla");
    if (!tesla) return;
    const messages: Record<string, string> = {
      ok: "Juniper linked to the owner Tesla account",
      not_owner: "That Tesla account does not own Juniper",
      driver: "Driver access is blocked — owner only",
      denied: "Tesla sign-in was cancelled",
      error: "Tesla owner sign-in failed",
      not_configured: "Tesla owner credentials are not on this app yet",
    };
    toast(messages[tesla] ?? "Tesla owner sign-in did not complete");
    window.history.replaceState({}, "", "/");
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => tick(), 1000);
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
          {tab === "trips" && <TripsScreen />}
          {tab === "costs" && <ChargeScreen />}
          {tab === "elpris" && <ElprisScreen />}
          {tab === "vehicle" && <VehicleScreen />}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-sm"
          aria-label="Primary"
        >
          <ul className="grid grid-cols-5">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                      "transition-[color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
                      active ? "text-foreground" : "text-muted",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                    {item.label}
                  </button>
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
