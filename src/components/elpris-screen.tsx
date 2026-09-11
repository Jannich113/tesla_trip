import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, RotateCw } from "lucide-react";
import {
  PRICE_AREAS,
  applyTillægToHours,
  providerById,
  providersForArea,
  withTillæg,
  type ElProvider,
  type PriceArea,
} from "@/lib/el-providers";
import {
  type ElprisData,
  type HourPrice,
  fetchElpris,
  formatKrValue,
  formatOrePerKwh,
  formatOreValue,
} from "@/lib/elpris";
import { cn } from "@/lib/utils";
import { useElprisStore } from "@/store/elpris-store";

function priceTint(kr: number, min: number, max: number) {
  if (!Number.isFinite(kr) || max <= min) return "text-foreground";
  const t = (kr - min) / (max - min);
  if (t <= 0.33) return "text-accent";
  if (t >= 0.75) return "text-danger";
  return "text-foreground";
}

function barWidth(kr: number, min: number, max: number) {
  if (!Number.isFinite(kr) || max <= min) return 8;
  const t = (kr - min) / (max - min);
  return Math.round(8 + t * 92);
}

function dkHourNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === "hour")?.value ?? "00";
  const hour = raw === "24" ? "00" : raw;
  return hour.padStart(2, "0");
}

function HourList({
  hours,
  currentHour,
  dimPast,
  emptyNote,
}: {
  hours: HourPrice[];
  currentHour?: string | null;
  dimPast?: boolean;
  emptyNote?: string;
}) {
  const [pastOpen, setPastOpen] = useState(false);
  const { min, max } = useMemo(() => {
    if (hours.length === 0) return { min: 0, max: 0 };
    let lo = hours[0].krPerKwh;
    let hi = hours[0].krPerKwh;
    for (const h of hours) {
      if (h.krPerKwh < lo) lo = h.krPerKwh;
      if (h.krPerKwh > hi) hi = h.krPerKwh;
    }
    return { min: lo, max: hi };
  }, [hours]);

  const pastHours =
    dimPast && currentHour != null ? hours.filter((h) => h.hour < currentHour) : [];
  const rest =
    dimPast && currentHour != null ? hours.filter((h) => h.hour >= currentHour) : hours;

  if (hours.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-muted">{emptyNote ?? "Ingen priser endnu"}</p>
    );
  }

  function rows(list: HourPrice[], past: boolean) {
    return list.map((h) => {
      const active = !past && currentHour != null && h.hour === currentHour;
      const tint = priceTint(h.krPerKwh, min, max);
      return (
        <li
          key={h.timeDk}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 transition-opacity duration-300",
            active ? "bg-surface-2 shadow-[var(--shadow-border)]" : "bg-transparent",
            past && "opacity-45",
          )}
        >
          <span
            className={cn(
              "w-10 shrink-0 text-sm tabular-nums",
              active ? "font-medium text-foreground" : "text-muted",
            )}
          >
            {h.hour}:00
          </span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                tint === "text-accent" && "bg-accent",
                tint === "text-danger" && "bg-danger",
                tint === "text-foreground" && "bg-muted",
              )}
              style={{ width: `${barWidth(h.krPerKwh, min, max)}%` }}
            />
          </div>
          <div className="w-[5.5rem] shrink-0 text-right">
            <p className={cn("text-sm font-medium tabular-nums", past ? "text-muted" : tint)}>
              {formatKrValue(h.krPerKwh)} <span className="text-xs font-normal text-muted">kr</span>
            </p>
            <p className="text-[11px] tabular-nums text-subtle">
              {formatOreValue(h.orePerKwh)} øre
            </p>
          </div>
        </li>
      );
    });
  }

  return (
    <div>
      {pastHours.length ? (
        <button
          type="button"
          onClick={() => setPastOpen((open) => !open)}
          className="mb-1 flex w-full items-center gap-2 px-2 py-1 text-left"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted transition-transform duration-150 ease-[var(--ease-out)]",
              pastOpen ? "rotate-0" : "-rotate-90",
            )}
          />
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Tidligere</p>
          <p className="ml-auto text-[11px] text-subtle">
            {pastHours.length} {pastHours.length === 1 ? "time" : "timer"}
          </p>
        </button>
      ) : null}
      {pastOpen ? <ul className="mb-2 space-y-1">{rows(pastHours, true)}</ul> : null}
      <ul className="space-y-1">{rows(rest, false)}</ul>
    </div>
  );
}


function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="relative mt-1">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full appearance-none rounded-xl bg-surface-2 py-2 pl-3 pr-9 text-sm font-medium outline-none shadow-[var(--shadow-border)]"
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    </label>
  );
}

export function ElprisScreen() {
  const area = useElprisStore((s) => s.area);
  const providerId = useElprisStore((s) => s.providerId);
  const setArea = useElprisStore((s) => s.setArea);
  const setProviderId = useElprisStore((s) => s.setProviderId);

  const provider = useMemo(() => providerById(providerId), [providerId]);
  const providerOptions = useMemo(() => providersForArea(area), [area]);

  const [raw, setRaw] = useState<ElprisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tomorrowOpen, setTomorrowOpen] = useState(false);
  const [nowHour, setNowHour] = useState(dkHourNow);

  const load = useCallback(
    async (isRefresh = false, nextArea: PriceArea = area) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await fetchElpris(nextArea);
        setRaw(next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kunne ikke hente elpris");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [area],
  );

  useEffect(() => {
    void load(false, area);
    const id = window.setInterval(() => void load(true, area), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load, area]);

  useEffect(() => {
    setNowHour(dkHourNow());
    const id = window.setInterval(() => setNowHour(dkHourNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const data = useMemo(() => {
    if (!raw) return null;
    const t = provider.tillægOre;
    return {
      ...raw,
      current: raw.current
        ? {
            ...raw.current,
            krPerKwh: withTillæg(raw.current.krPerKwh, t),
            orePerKwh: withTillæg(raw.current.krPerKwh, t) * 100,
          }
        : null,
      today: applyTillægToHours(raw.today, t),
      tomorrow: applyTillægToHours(raw.tomorrow, t),
    };
  }, [raw, provider.tillægOre]);

  const current = data?.current ?? null;
  const areaMeta = PRICE_AREAS.find((a) => a.id === area);

  function onAreaChange(next: string) {
    const a = next === "DK2" ? "DK2" : "DK1";
    setArea(a);
  }

  function onProviderChange(id: string) {
    setProviderId(id);
  }

  return (
    <div className="flex flex-col px-4 pb-4 pt-2">
      <div className="mb-3 flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Elpris</p>
          <p className="mt-1 text-xs text-subtle">
            {areaMeta?.hint ?? area} · Energi Data Service
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true, area)}
          disabled={loading || refreshing}
          className="flex size-10 items-center justify-center rounded-full bg-surface text-foreground shadow-[var(--shadow-border)] transition-[scale,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.96] disabled:opacity-50"
          aria-label="Opdater elpris"
        >
          <RotateCw className={cn("size-4", (loading || refreshing) && "animate-spin")} />
        </button>
      </div>

      <section className="mb-4 rounded-xl bg-surface p-3 shadow-[var(--shadow-border)]">
        <div className="flex gap-2">
          <SelectField label="Område" value={area} onChange={onAreaChange}>
            {PRICE_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} — {a.hint}
              </option>
            ))}
          </SelectField>
          <SelectField label="Elselskab" value={provider.id} onChange={onProviderChange}>
            {providerOptions.map((p: ElProvider) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.product && p.id !== "spot" ? ` · ${p.product}` : ""}
                {p.tillægOre > 0
                  ? ` (+${p.tillægOre.toLocaleString("da-DK")} øre)`
                  : p.id === "spot"
                    ? ""
                    : " (0 øre)"}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-subtle">
          {provider.name}
          {provider.product ? ` · ${provider.product}` : ""}
          {provider.tillægOre > 0
            ? ` · ca. ${provider.tillægOre.toLocaleString("da-DK")} øre/kWh tillæg`
            : " · uden spottillæg"}
          {provider.aboKr > 0
            ? ` · abo. ca. ${provider.aboKr.toLocaleString("da-DK")} kr/md`
            : ""}
          {provider.note ? ` · ${provider.note}` : ""}
          . Tillæg er vejledende.
        </p>
      </section>

      {loading && !data ? (
        <section className="rounded-xl bg-surface px-5 py-10 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">Henter spotpris…</p>
        </section>
      ) : error && !data ? (
        <section className="rounded-xl bg-surface px-5 py-8 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={() => void load(false, area)}
            className="mt-4 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium shadow-[var(--shadow-border)]"
          >
            Prøv igen
          </button>
        </section>
      ) : (
        <>
          <section className="rounded-xl bg-surface px-5 py-6 shadow-[var(--shadow-border)]">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Nu</p>
            {current ? (
              <>
                <p className="mt-2 text-5xl font-medium leading-none tracking-tight tabular-nums">
                  {formatKrValue(current.krPerKwh)}
                  <span className="ml-1.5 text-xl text-muted">kr/kWh</span>
                </p>
                <p className="mt-3 text-sm tabular-nums text-muted">
                  {formatOrePerKwh(current.orePerKwh)} · time {current.hour}:00
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">Ingen pris for denne time</p>
            )}
            {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}
          </section>

          <section className="mt-4 rounded-xl bg-surface px-3 py-4 shadow-[var(--shadow-border)]">
            <div className="mb-2 flex items-baseline justify-between px-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">I dag</p>
              <p className="text-[11px] text-subtle">{data?.today.length ?? 0} timer</p>
            </div>
            <HourList hours={data?.today ?? []} currentHour={nowHour} dimPast />
          </section>

          <section className="mt-4 rounded-xl bg-surface px-3 py-4 shadow-[var(--shadow-border)]">
            <button
              type="button"
              onClick={() => setTomorrowOpen((open) => !open)}
              className="flex w-full items-center gap-2 px-2 py-1 text-left"
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted transition-transform duration-150 ease-[var(--ease-out)]",
                  tomorrowOpen ? "rotate-0" : "-rotate-90",
                )}
              />
              <p className="text-xs font-medium uppercase tracking-wide text-muted">I morgen</p>
              <p className="ml-auto text-[11px] text-subtle">
                {(data?.tomorrow.length ?? 0) > 0 ? `${data?.tomorrow.length} timer` : "Afventer"}
              </p>
            </button>
            {tomorrowOpen ? (
              <div className="mt-2">
                <HourList
                  hours={data?.tomorrow ?? []}
                  emptyNote="Morgendagens priser er endnu ikke offentliggjort (typisk ~13:00)."
                />
              </div>
            ) : null}
          </section>

          <p className="mt-4 px-1 text-[11px] leading-relaxed text-subtle">
            Spot (ekskl. moms) for {data?.area ?? area} + vejledende spottillæg. Ikke fuld
            forbrugerpris — mangler moms, nettarif, Energinet og elafgift. Spot via Energi Data
            Service. Opdateret{" "}
            {data?.updatedAt
              ? new Date(data.updatedAt).toLocaleTimeString("da-DK", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
            .
          </p>
        </>
      )}
    </div>
  );
}
