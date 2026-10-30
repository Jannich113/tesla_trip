import { useState } from "react";
import { Car, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, type Units } from "@/lib/vehicle";
import { TESLA_MODELS, type TeslaModelId } from "@/lib/tesla-models";
import {
  CAR_VARIANTS,
  CONDITIONS,
  DRIVE_STYLES,
  sessionDcKw,
  useCarSettings,
  type BatteryLimits,
  type CarVariant,
} from "./car-settings";
import { DEFAULT_DETOUR_KM, DETOUR_KM, SPEED_KMH, type SpeedEff } from "./modes";
import { formatDetour } from "./engine";

const LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted";
const CARD = "rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]";
const STYLE_LABEL = { calm: "Calm", normal: "Normal", brisk: "Brisk" } as const;

function Chip({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-0 items-center justify-center rounded-full border px-3 text-xs transition-colors",
        on ? "border-foreground bg-foreground text-background" : "border-border bg-surface-2 text-muted hover:text-foreground",
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}

/** A number field that saves on blur or Enter, so a half-typed value is never clamped. */
function DraftNumber({
  value,
  min,
  max,
  onCommit,
  label,
  className,
  allowEmpty = false,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number | null) => void;
  label: string;
  className?: string;
  allowEmpty?: boolean;
}) {
  const shown = String(Math.round(value * 10) / 10);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft.replace(",", "."));
    if (!draft.trim() && allowEmpty) onCommit(null);
    else if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? shown}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className={className}
    />
  );
}

/** A car figure the user can override; shows the version's figure until then. */
function Figure({
  label,
  unit,
  value,
  overridden,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  overridden: boolean;
  min: number;
  max: number;
  onChange: (n: number | null) => void;
}) {
  return (
    <label className={cn("block rounded-lg bg-surface-2 px-2 py-1.5 text-center", overridden && "ring-1 ring-foreground/40")}>
      <DraftNumber
        label={label}
        value={value}
        min={min}
        max={max}
        allowEmpty
        onCommit={onChange}
        className="w-full bg-transparent text-center text-sm font-medium tabular-nums text-foreground outline-none"
      />
      <span className="block text-[11px] text-muted">{unit}</span>
    </label>
  );
}

function LimitRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-foreground">{label}</span>
      <span className="flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1">
        <DraftNumber
          label={label}
          value={value}
          min={min}
          max={max}
          onCommit={(n) => n != null && onChange(Math.round(n))}
          className="w-9 bg-transparent text-right text-sm font-medium tabular-nums text-foreground outline-none"
        />
        <span className="text-xs text-muted">%</span>
      </span>
    </label>
  );
}

export function CarPanel({
  modelId,
  modelName,
  modelYear,
  onModel,
  variant,
  packKwh,
  packOverridden,
  onPackKwh,
  peakDcKw,
  acKw,
  baseSpeedEff,
  speedEff,
  effOverridden,
  onSpeedEff,
  detours,
  onDetour,
  units,
  onUnits,
}: {
  modelId: TeslaModelId;
  modelName: string;
  modelYear: number;
  onModel: (id: TeslaModelId) => void;
  variant: CarVariant;
  packKwh: number;
  packOverridden: boolean;
  onPackKwh: (kwh: number | null) => void;
  peakDcKw: number;
  acKw: number;
  /** The car's own kWh/100 km per speed. */
  baseSpeedEff: SpeedEff;
  /** After driving style and conditions: what the planner uses. */
  speedEff: SpeedEff;
  effOverridden: boolean;
  onSpeedEff: (eff: SpeedEff | null) => void;
  detours: number[];
  onDetour: (km: number) => void;
  units: Units;
  onUnits: (u: Units) => void;
}) {
  const car = useCarSettings();
  const [ownEff, setOwnEff] = useState(effOverridden);
  const limits: BatteryLimits = car.limits;
  const detour = detours.length ? detours[0] : DEFAULT_DETOUR_KM;
  const mixedDetour = detours.length > 0 && !detours.every((d) => d === detour);

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <p className={LABEL}>Your car</p>
        <label className="relative mt-3 flex items-center gap-3 rounded-xl bg-surface-2 p-2 pr-9">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-background text-muted">
            <Car className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{modelName}</span>
            <span className="block truncate text-xs text-muted">
              {variant.label} · {modelYear}
            </span>
          </span>
          <select
            value={modelId}
            onChange={(e) => onModel(e.target.value as TeslaModelId)}
            aria-label="Tesla model"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {TESLA_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.model} {m.name !== m.model ? `(${m.name})` : ""} · {m.year}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Version">
          {(CAR_VARIANTS[modelId] ?? []).map((x) => (
            <Chip key={x.id} on={x.id === variant.id} onClick={() => car.setVariant(x.id)}>
              {x.label}
            </Chip>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <Figure label="Usable battery, kWh" unit="kWh usable" value={packKwh} overridden={packOverridden} min={20} max={200} onChange={onPackKwh} />
          <Figure label="Peak DC charging, kW" unit="kW peak DC" value={peakDcKw} overridden={car.peakDcKw != null} min={40} max={400} onChange={car.setPeakDcKw} />
          <Figure label="Home AC charging, kW" unit="kW home AC" value={acKw} overridden={car.acKw != null} min={2} max={22} onChange={car.setAcKw} />
        </div>
        <p className="mt-2 text-[11px] text-subtle">
          Typical figures for this version; edit one to match your car. Superchargers average about{" "}
          {sessionDcKw(peakDcKw)} kW over a session.
          {packOverridden || car.peakDcKw != null || car.acKw != null ? (
            <>
              {" "}
              <button
                type="button"
                className="text-muted underline"
                onClick={() => {
                  onPackKwh(null);
                  car.setPeakDcKw(null);
                  car.setAcKw(null);
                }}
              >
                Reset
              </button>
            </>
          ) : null}
        </p>
      </section>

      <section className={CARD}>
        <p className={LABEL}>Battery</p>
        <label className="mt-3 block">
          <span className="flex items-center justify-between text-sm">
            <span>Battery when leaving</span>
            <span className="font-medium tabular-nums">{car.startSoc}%</span>
          </span>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={car.startSoc}
            onChange={(e) => car.setStartSoc(Number(e.target.value))}
            className="mt-2 w-full accent-emerald-400"
          />
        </label>
        <div className="mt-2 divide-y divide-border">
          <LimitRow label="Arrive at chargers with at least" value={limits.floorSoc} min={5} max={30} onChange={(n) => car.setLimits({ floorSoc: n })} />
          <LimitRow label="Charge up to" value={limits.targetSoc} min={50} max={100} onChange={(n) => car.setLimits({ targetSoc: n })} />
          <LimitRow label="Arrive at destination with" value={limits.destSoc} min={limits.floorSoc} max={90} onChange={(n) => car.setLimits({ destSoc: n })} />
        </div>
        <p className="mt-2 text-[11px] text-subtle">A long gap between chargers can still charge above your limit; the plan says when.</p>
      </section>

      <section className={CARD}>
        <p className={LABEL}>Driving</p>
        <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Driving style">
          {DRIVE_STYLES.map((st) => (
            <Chip key={st} on={car.style === st} onClick={() => car.setStyle(st)}>
              {STYLE_LABEL[st]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Conditions">
          {CONDITIONS.map((c) => (
            <Chip key={c.id} on={Boolean(car.conditions[c.id])} onClick={() => car.toggleCondition(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          ≈ <span className="font-medium tabular-nums text-foreground">{formatNumber(speedEff[110], 1)}</span> kWh/100 km at 110 km/t
          {speedEff[110] !== baseSpeedEff[110] ? (
            <span className="text-subtle"> (car alone {formatNumber(baseSpeedEff[110], 1)})</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => setOwnEff((v) => !v)}
          aria-expanded={ownEff}
          className="mt-3 flex w-full items-center justify-between border-t border-border pt-3 text-xs text-muted"
        >
          Your own kWh per speed
          <ChevronDown className={cn("size-4 transition", ownEff && "rotate-180")} aria-hidden />
        </button>
        {ownEff ? (
          <>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {SPEED_KMH.map((kmh) => (
                <label key={kmh} className="text-center text-[11px] text-muted">
                  {kmh}
                  <span className="text-subtle"> km/t</span>
                  <DraftNumber
                    label={`kWh per 100 km at ${kmh} km/t`}
                    value={baseSpeedEff[kmh]}
                    min={5}
                    max={60}
                    onCommit={(n) => n != null && onSpeedEff({ ...baseSpeedEff, [kmh]: n })}
                    className="mt-1 h-10 w-full rounded-lg bg-surface-2 text-center text-sm tabular-nums text-foreground outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-subtle">
              kWh per 100 km in mild weather at a steady speed; style and conditions are added on top.
              {effOverridden ? (
                <>
                  {" "}
                  <button type="button" className="text-muted underline" onClick={() => onSpeedEff(null)}>
                    Reset
                  </button>
                </>
              ) : null}
            </p>
          </>
        ) : null}
      </section>

      <section className={CARD}>
        <p className={LABEL}>Charger search</p>
        <p className="mt-1 text-xs text-muted">How far off the road to look for chargers</p>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {DETOUR_KM.map((km) => (
            <Chip key={km} on={!mixedDetour && detour === km} onClick={() => onDetour(km)}>
              {formatDetour(km, units)}
            </Chip>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between">
          <p className={LABEL}>Units</p>
          <div className="flex gap-1.5">
            {(["km", "mi"] as const).map((u) => (
              <Chip key={u} on={units === u} onClick={() => onUnits(u)} className="min-w-12">
                {u}
              </Chip>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
