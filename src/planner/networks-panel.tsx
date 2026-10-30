import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatKrValue } from "@/lib/elpris";
import { NETWORK_NATIVE, scaleCatalogKr, type FxTable } from "./charge-fx";
import { COUNTRY_PROFILES, countryProfile } from "./country-profiles";
import {
  breakEvenKwh,
  EU_BLOCS,
  EU_NETWORKS,
  regionalInDkk,
  regionalOwn,
  regionalRoam,
  type ChargeNetwork,
  type EuRegion,
} from "./networks";
import { useChargePrices } from "./use-charge-prices";

const LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted";
const CARD = "rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]";

const GROUPS: { id: string; label: string; ids: string[] }[] = [
  { id: "car", label: "Tesla", ids: ["tesla"] },
  { id: "highway", label: "Highway fast charging", ids: ["ionity", "fastned", "electra", "allego"] },
  { id: "nordic", label: "Nordic networks", ids: ["clever", "eon", "spirii", "mer", "recharge", "kople", "eviny", "circlek", "unox"] },
  { id: "card", label: "Fuel brands and cards", ids: ["shell", "enbw", "aral", "total"] },
];

/** Regional catalog prices are in DKK at catalog FX; follow the live rate like the network rates do. */
function scaleKr(networkId: string, kr: number | null, fx: FxTable | null, fixedDkk = false) {
  if (kr == null || !fx || fixedDkk) return kr;
  const native = NETWORK_NATIVE[networkId];
  return native ? scaleCatalogKr(kr, native.ccy, fx) : kr;
}

const kr = (n: number) => `${formatKrValue(n, 2)} kr`;

function monthLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Prices = {
  /** Ad hoc at the network's own chargers. */
  adHoc: number;
  /** With the membership; 0 for unlimited plans. */
  member: number;
  /** True when the prices are this country's; false = the network's typical price. */
  local: boolean;
  /** This network's card at other operators' chargers, with or without the membership. */
  roam: number | null;
};

function pricesIn(n: ChargeNetwork, region: EuRegion, on: boolean, fx: FxTable | null): Prices {
  const dkk = regionalInDkk(n, region);
  const own = scaleKr(n.id, regionalOwn(n, region, false), fx, dkk);
  const ownMember = scaleKr(n.id, regionalOwn(n, region, true), fx, dkk);
  return {
    adHoc: own ?? n.spotKr,
    member: n.unlimited ? 0 : (ownMember ?? n.aboKr),
    local: own != null,
    roam: scaleKr(n.id, regionalRoam(n, region, on), fx),
  };
}

function Checked({ n }: { n: ChargeNetwork }) {
  if (!n.checked) {
    return <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-subtle">Estimate</span>;
  }
  return (
    <a
      href={n.checked.source}
      target="_blank"
      rel="noopener noreferrer"
      title={`Checked ${monthLabel(n.checked.on)}: ${n.checked.scope}`}
      className="inline-flex items-center gap-0.5 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
    >
      Checked {monthLabel(n.checked.on)}
      <ExternalLink className="size-2.5" aria-hidden />
    </a>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-emerald-400" : "bg-surface-2")}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-background shadow transition-[left]",
          on ? "left-6" : "left-1 bg-muted",
        )}
      />
    </button>
  );
}

/** Price per kWh at each network's own chargers in one country, cheapest you'd pay first. */
function PriceChart({
  networks,
  region,
  abo,
  fx,
}: {
  networks: ChargeNetwork[];
  region: EuRegion;
  abo: Record<string, boolean>;
  fx: FxTable | null;
}) {
  const rows = networks
    .map((n) => {
      const own = scaleKr(n.id, regionalOwn(n, region, false), fx);
      if (own == null) return null;
      const on = Boolean(abo[n.id]);
      const p = pricesIn(n, region, on, fx);
      return { n, on, p, pay: on ? p.member : p.adHoc };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.pay - b.pay);
  const viaApps = networks
    .filter((n) => scaleKr(n.id, regionalOwn(n, region, false), fx) == null)
    .map((n) => ({ n, roam: scaleKr(n.id, regionalRoam(n, region, Boolean(abo[n.id])), fx) }))
    .filter((r): r is { n: ChargeNetwork; roam: number } => r.roam != null)
    .sort((a, b) => a.roam - b.roam);
  const max = Math.max(1, ...rows.map((r) => r.p.adHoc), ...viaApps.map((r) => r.roam));

  if (!rows.length && !viaApps.length) {
    return <p className="mt-3 text-xs text-muted">No catalog prices for this country yet.</p>;
  }
  return (
    <div className="mt-3">
      {rows.length ? (
        <ul className="space-y-2.5">
          {rows.map(({ n, on, p }) => {
            const hasMember = !n.unlimited ? p.member < p.adHoc - 0.01 : true;
            return (
              <li key={n.id}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={cn("truncate", on ? "font-medium text-foreground" : "text-muted")}>
                    {n.name}
                    {on ? <span className="ml-1.5 text-[10px] text-emerald-300">yours</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground">
                    {on ? kr(p.member) : kr(p.adHoc)}
                    {on && hasMember ? <span className="ml-1 text-subtle line-through">{kr(p.adHoc)}</span> : null}
                  </span>
                </div>
                <div className="relative mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-muted/40" style={{ width: `${(p.adHoc / max) * 100}%` }} />
                  {hasMember ? (
                    <div
                      className={cn("absolute inset-y-0 left-0 rounded-full", on ? "bg-emerald-400" : "bg-emerald-400/35")}
                      style={{ width: `${Math.max(1.5, (p.member / max) * 100)}%` }}
                    />
                  ) : null}
                </div>
                {!on && hasMember ? (
                  <p className="mt-0.5 text-[10px] text-subtle">
                    {n.aboName} {n.unlimited ? "unlimited" : kr(p.member)}
                    {n.aboMonthlyKr > 0 ? ` + ${formatKrValue(n.aboMonthlyKr, 0)} kr/month` : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {viaApps.length ? (
        <>
          <p className="mt-4 text-[11px] text-muted">With an app or card at other operators' chargers</p>
          <ul className="mt-1.5 space-y-1">
            {viaApps.map(({ n, roam }) => (
              <li key={n.id} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate text-muted">{n.name}</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-surface-2" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-sky-400/50" style={{ width: `${(roam / max) * 100}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-foreground">{roam === 0 ? "included" : kr(roam)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-subtle">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-muted/40" />ad hoc</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-emerald-400" />with membership</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-sky-400/50" />through an app</span>
      </p>
    </div>
  );
}

export function NetworksPanel({
  abo,
  onToggle,
  preferSlot,
}: {
  abo: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
  /** The "prefer a network" picker, owned by the plan screen. */
  preferSlot: ReactNode;
}) {
  const [region, setRegion] = useState<EuRegion>("DK");
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({ car: true, highway: true, nordic: true });
  const [openNet, setOpenNet] = useState<string | null>(null);
  const prices = useChargePrices();
  const networks = prices.data?.networks ?? EU_NETWORKS;
  const fx = prices.data?.fx ?? null;
  const country = countryProfile(region);
  const byId = new Map(networks.map((n) => [n.id, n]));
  const active = networks.filter((n) => abo[n.id]);
  const monthly = active.reduce((sum, n) => sum + n.aboMonthlyKr, 0);
  const grouped = new Set(GROUPS.flatMap((g) => g.ids));
  const groups = [...GROUPS, { id: "other", label: "Other", ids: networks.map((n) => n.id).filter((id) => !grouped.has(id)) }].filter((g) =>
    g.ids.some((id) => byId.has(id)),
  );

  return (
    <section className="space-y-3">
      <div className={CARD}>
        <p className={LABEL}>Your memberships</p>
        {active.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {active.map((n) => (
              <span key={n.id} className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs text-emerald-200">
                {n.aboName}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">None yet: trips use ad-hoc prices.</p>
        )}
        {monthly > 0 ? (
          <p className="mt-2 text-xs text-muted">
            <span className="tabular-nums text-foreground">{formatKrValue(monthly, 0)} kr</span> a month in fees, kept out of trip prices.
          </p>
        ) : null}
        {preferSlot}
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <p className={LABEL}>Fast-charging prices</p>
          <label className="relative">
            <span className="sr-only">Country</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as EuRegion)}
              className="h-8 appearance-none rounded-full bg-surface-2 pl-3 pr-8 text-xs font-medium text-foreground outline-none [color-scheme:dark]"
            >
              {EU_BLOCS.map((b) => (
                <optgroup key={b.id} label={b.label} className="bg-background text-muted">
                  {b.ids.map((id) => (
                    <option key={id} value={id} className="bg-background text-foreground">
                      {COUNTRY_PROFILES.find((c) => c.id === id)?.name ?? id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
          </label>
        </div>
        <PriceChart networks={networks} region={region} abo={abo} fx={fx} />
        {country?.note ? <p className="mt-3 text-[11px] text-subtle">{country.note}</p> : null}
        <p className="mt-2 text-[10px] text-subtle">
          Per kWh in DKK, at the cheapest listed rate; many networks charge more at busy times.
          {prices.data ? ` Exchange rates: ${prices.data.fxSource}.` : ""}{" "}
          <button type="button" onClick={() => prices.refresh()} className="text-muted underline">
            {prices.refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </p>
      </div>

      {groups.map((group) => {
        const open = openGroup[group.id] ?? false;
        const onCount = group.ids.filter((id) => abo[id]).length;
        return (
          <div key={group.id} className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenGroup((s) => ({ ...s, [group.id]: !open }))}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-medium">
                {group.label}
                {onCount ? <span className="ml-2 text-[11px] font-normal text-emerald-400">{onCount} on</span> : null}
              </span>
              <ChevronDown className={cn("size-4 text-muted transition", open && "rotate-180")} aria-hidden />
            </button>
            {open ? (
              <ul className="border-t border-border">
                {group.ids.map((id) => {
                  const n = byId.get(id);
                  if (!n) return null;
                  const on = Boolean(abo[n.id]);
                  const p = pricesIn(n, region, on, fx);
                  const even = n.unlimited ? null : breakEvenKwh(n.aboMonthlyKr, p.adHoc, p.member);
                  const details = openNet === n.id;
                  return (
                    <li key={n.id} className="border-t border-border first:border-0">
                      <div className="flex items-start gap-3 px-4 py-3">
                        <button
                          type="button"
                          aria-expanded={details}
                          onClick={() => setOpenNet(details ? null : n.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm text-foreground">{n.name}</span>
                            <Checked n={n} />
                          </span>
                          <span className="mt-0.5 block text-[11px] tabular-nums text-muted">
                            Ad hoc {kr(p.adHoc)}
                            {" · "}
                            {n.aboName} {n.unlimited ? "unlimited" : kr(p.member)}
                            {n.aboMonthlyKr > 0 ? ` + ${formatKrValue(n.aboMonthlyKr, 0)} kr/month` : ""}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-subtle">
                            {p.local ? `${country?.name ?? region} prices` : `Typical price · ${n.region}`}
                            {even ? ` · worth it above ${even} kWh a month` : ""}
                          </span>
                        </button>
                        <Switch on={on} onChange={(v) => onToggle(n.id, v)} label={`${n.aboName} membership`} />
                      </div>
                      {details ? (
                        <div className="space-y-1 px-4 pb-3 text-[11px] text-subtle">
                          <p>{n.note}</p>
                          <p>
                            {p.roam == null
                              ? "Only at its own chargers."
                              : `At other operators: ${p.roam === 0 ? "included" : kr(p.roam)}. `}
                            {n.roamNote}
                          </p>
                          {n.checked ? <p>Checked {monthLabel(n.checked.on)} for {n.checked.scope}.</p> : <p>Not checked against the operator; treat as an estimate.</p>}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
