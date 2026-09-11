import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  type ElprisData,
  type HourPrice,
  fetchElpris,
  formatKrValue,
  formatOrePerKwh,
  formatOreValue,
} from "@/lib/elpris";
import { cn } from "@/lib/utils";

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

function HourList({
  hours,
  currentHour,
  emptyNote,
}: {
  hours: HourPrice[];
  currentHour?: string | null;
  emptyNote?: string;
}) {
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

  if (hours.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-muted">
        {emptyNote ?? "Ingen priser endnu"}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {hours.map((h) => {
        const active = currentHour != null && h.hour === currentHour;
        const tint = priceTint(h.krPerKwh, min, max);
        return (
          <li
            key={h.timeDk}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2",
              active ? "bg-surface-2 shadow-[var(--shadow-border)]" : "bg-transparent",
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
              <p className={cn("text-sm font-medium tabular-nums", tint)}>
                {formatKrValue(h.krPerKwh)} <span className="text-xs font-normal text-muted">kr</span>
              </p>
              <p className="text-[11px] tabular-nums text-subtle">
                {formatOreValue(h.orePerKwh)} øre
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ElprisScreen() {
  const [data, setData] = useState<ElprisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = await fetchElpris();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente elpris");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const current = data?.current ?? null;
  const currentHour = current?.hour ?? null;

  return (
    <div className="flex flex-col px-4 pb-4 pt-2">
      <div className="mb-4 flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Elpris</p>
          <p className="mt-1 text-xs text-subtle">DK1 · Energi Data Service (Energi Fyn)</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
          className="flex size-10 items-center justify-center rounded-full bg-surface text-foreground shadow-[var(--shadow-border)] transition-[scale,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.96] disabled:opacity-50"
          aria-label="Opdater elpris"
        >
          <RotateCw className={cn("size-4", (loading || refreshing) && "animate-spin")} />
        </button>
      </div>

      {loading && !data ? (
        <section className="rounded-xl bg-surface px-5 py-10 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">Henter spotpris…</p>
        </section>
      ) : error && !data ? (
        <section className="rounded-xl bg-surface px-5 py-8 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
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
            <HourList hours={data?.today ?? []} currentHour={currentHour} />
          </section>

          <section className="mt-4 rounded-xl bg-surface px-3 py-4 shadow-[var(--shadow-border)]">
            <div className="mb-2 flex items-baseline justify-between px-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">I morgen</p>
              <p className="text-[11px] text-subtle">
                {(data?.tomorrow.length ?? 0) > 0
                  ? `${data?.tomorrow.length} timer`
                  : "Afventer"}
              </p>
            </div>
            <HourList
              hours={data?.tomorrow ?? []}
              emptyNote="Morgendagens priser er endnu ikke offentliggjort (typisk ~13:00)."
            />
          </section>

          <p className="mt-4 px-1 text-[11px] leading-relaxed text-subtle">
            Nord Pool day-ahead spot for DK1 (Vestdanmark / Fyn). Samme grundlag som Energi Fyn
            viser. Priser er ekskl. tariffer og afgifter. Opdateret{" "}
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
