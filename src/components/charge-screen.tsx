import { useMemo, useState } from "react";
import { PeriodPills } from "@/components/period-pills";
import { formatUsd, laDayString, periodCaption, tripTotals, type Period } from "@/lib/history";
import { formatNumber } from "@/lib/vehicle";
import { totalsFor, useChargeStore } from "@/store/charge-store";

export function ChargeScreen() {
  const locations = useChargeStore((st) => st.locations);
  const logged = useChargeStore((st) => st.logged);
  const [period, setPeriod] = useState<Period>("month");
  const today = useMemo(() => laDayString(), []);
  const totals = useMemo(() => totalsFor(locations, logged, period, today), [locations, logged, period, today]);
  const driven = useMemo(() => tripTotals(period, today), [period, today]);
  return (
    <div className="space-y-5 px-4 pb-6">
      <PeriodPills value={period} onChange={setPeriod} />
      <p className="text-sm text-muted">Charging cost · {periodCaption(period, today)}</p>
      <p className="text-4xl font-medium tabular-nums">{formatUsd(totals.usd)}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-xs text-muted">Home</p>
          <p className="mt-1 text-lg font-medium tabular-nums">{formatUsd(totals.homeUsd)}</p>
          <p className="mt-1 text-xs text-subtle">{formatNumber(totals.homeKwh, 0)} kWh</p>
        </div>
        <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-xs text-muted">Supercharger</p>
          <p className="mt-1 text-lg font-medium tabular-nums">{formatUsd(totals.scUsd)}</p>
          <p className="mt-1 text-xs text-subtle">{formatNumber(totals.scKwh, 0)} kWh</p>
        </div>
        <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-xs text-muted">Custom</p>
          <p className="mt-1 text-lg font-medium tabular-nums">{formatUsd(totals.otherUsd)}</p>
          <p className="mt-1 text-xs text-subtle">{formatNumber(totals.otherKwh, 0)} kWh</p>
        </div>
        <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-xs text-muted">Per mile</p>
          <p className="mt-1 text-lg font-medium tabular-nums">{driven.mi > 0 ? formatUsd(totals.usd / driven.mi, 3) : "—"}</p>
          <p className="mt-1 text-xs text-subtle">cost to drive</p>
        </div>
      </div>
    </div>
  );
}
