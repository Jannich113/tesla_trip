import { useEffect, useState } from "react";
import { MapPin, MapPinned } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { BatteryBar } from "@/components/battery-bar";
import {
  formatDistance,
  formatNumber,
  formatSpeed,
  ratedRangeMi,
  relativeTime,
} from "@/lib/vehicle";
import {
  estimateRegenKwh,
  formatUsd,
  homeStats,
  petrolSavings,
} from "@/lib/history";
import { cn } from "@/lib/utils";
import { useVehicleProfile } from "@/hooks/use-vehicle-profile";
import { useVehicleStore } from "@/store/vehicle-store";

function statusLine(mode: string, speedMph: number, chargeKw: number, units: "mi" | "km") {
  if (mode === "driving") return `Driving · ${formatSpeed(speedMph, units)}`;
  if (mode === "charging") return `Charging · ${formatNumber(chargeKw, 1)} kW`;
  return "Parked";
}

export function HomeScreen() {
  const s = useVehicleStore();
  const { profile, heroes } = useVehicleProfile();
  const range = ratedRangeMi(s.soc);
  const image = s.mode === "charging" ? heroes.rear || heroes.front : heroes.front;
  const [now, setNow] = useState(0);
  const stats = homeStats();
  const todayTrips = stats.todayTrips;
  const lifetimeTrips = stats.lifetimeTrips;
  const todayCost = stats.todayCharge;
  const lifetimeCharge = stats.lifetimeCharge;
  const regenKwh = estimateRegenKwh(lifetimeTrips.kwh);
  const savingsUsd = petrolSavings(lifetimeTrips.mi, lifetimeCharge.usd);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const updated = relativeTime(s.lastSync, now || 0);

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-2 text-center">
        <p className="text-sm text-muted">
          {s.waking ? "Waking vehicle…" : statusLine(s.mode, s.speedMph, s.chargeKw, s.units)}
        </p>
        <p className="mt-0.5 text-xs text-subtle">
          {s.waking ? `Connecting to ${profile.name}` : `Updated ${updated}`}
        </p>
      </div>

      <div className="relative mx-auto h-52 w-full max-w-lg overflow-hidden sm:h-60">
        <img
          src={image}
          loading="eager"
          decoding="async"
          alt={`${profile.year} ${profile.model} in ${profile.color}`}
          className={cn(
            "car-hero h-full w-full object-cover object-center transition-[opacity,filter] duration-500 ease-[var(--ease-out)]",
            s.waking && "opacity-60",
          )}
        />
      </div>

      <div className="-mt-6 space-y-3 px-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-5xl font-medium leading-none tracking-tight tabular-nums">
              {formatNumber(s.soc, 0)}
              <span className="ml-1 text-2xl text-muted">%</span>
            </p>
            <p className="mt-2 text-sm text-muted">Battery</p>
          </div>
          <div className="text-right">
            <p className="text-5xl font-medium leading-none tracking-tight tabular-nums">
              {formatNumber(s.units === "km" ? range * 1.60934 : range, 0)}
            </p>
            <p className="mt-2 text-sm text-muted">
              Rated {s.units === "km" ? "km" : "mi"}
            </p>
          </div>
        </div>
        <BatteryBar soc={s.soc} limit={s.chargeLimit} charging={s.mode === "charging"} />
        <p className="text-xs text-subtle">Limit {s.chargeLimit}%</p>
      </div>

      <div className="mt-6 space-y-3 px-4">
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Vehicle</p>
          <p className="mt-1 text-xl font-medium tracking-tight">{profile.name}</p>
          <p className="mt-0.5 text-xs text-subtle">
            {profile.year} {profile.model} · {profile.trim}
          </p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Odometer"
            value={formatDistance(s.odometerMi, s.units, s.odometerMi >= 100 ? 0 : 1)}
          />
          <StatTile
            label="Charged"
            value={`${formatNumber(lifetimeCharge.kwh, lifetimeCharge.kwh >= 100 ? 0 : 1)} kWh`}
            hint="Lifetime"
          />
          <StatTile
            label="Regen"
            value={`${formatNumber(regenKwh, regenKwh >= 100 ? 0 : 1)} kWh`}
            hint="Est. recovered"
          />
          <StatTile
            label="vs petrol"
            value={formatUsd(Math.max(0, savingsUsd), savingsUsd >= 100 ? 0 : 2)}
            hint="Benzin savings"
          />
        </div>

        <Link
          to="/plan"
          onPointerEnter={() => {
            void import("@/planner/plan-screen");
          }}
          onFocus={() => {
            void import("@/planner/plan-screen");
          }}
          className="flex items-center gap-3 rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]"
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <MapPinned className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Trip planner</p>
            <p className="truncate text-xs text-muted">Eco, fastest or cheapest per stop</p>
          </div>
        </Link>

        <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <span className="flex size-10 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <MapPin className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{s.locationLabel}</p>
            <p className="truncate text-xs text-muted">{profile.home.address}</p>
          </div>
          <p className="text-right text-xs text-subtle">
            <span className="block tabular-nums text-foreground">
              {formatDistance(todayTrips.mi, s.units, 1)}
            </span>
            {formatUsd(todayCost.usd)} today
          </p>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

