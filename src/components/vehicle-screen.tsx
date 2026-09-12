import { ConfirmStrip } from "@/components/confirm-strip";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatNumber, formatVin } from "@/lib/vehicle";
import { TESLA_MODELS, type TeslaModelId } from "@/lib/tesla-models";
import { useVehicleProfile } from "@/hooks/use-vehicle-profile";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  beginTeslaOwnerLink,
  disconnectTeslaOwner,
  getTeslaOwnerStatus,
  type TeslaOwnerStatus,
} from "@/lib/tesla-owner";
import { downloadOwnerExport } from "@/lib/owner-export";
import { useChargeStore } from "@/store/charge-store";
import { useTripStore } from "@/store/trip-store";
import { useVehicleStore } from "@/store/vehicle-store";

export function VehicleScreen() {
  const s = useVehicleStore();
  const setModelId = useVehicleStore((st) => st.setModelId);
  const setPaintId = useVehicleStore((st) => st.setPaintId);
  const { profile, heroes, paints } = useVehicleProfile();
  const [owner, setOwner] = useState<TeslaOwnerStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const specs: { label: string; value: string }[] = [
    { label: "Vehicle", value: `${profile.year} ${profile.model}` },
    { label: "Trim", value: profile.trim },
    { label: "Paint", value: profile.color },
    { label: "Drivetrain", value: profile.motors },
    { label: "Peak power", value: `${profile.powerHp} hp` },
    { label: "Acceleration", value: profile.accel },
    { label: "EPA range", value: `${profile.epaRangeMi} mi` },
    { label: "Usable battery", value: `${profile.usableKwh} kWh` },
    { label: "AC charge", value: `${profile.acKw} kW` },
    { label: "Seats", value: String(profile.seats) },
  ];

  useEffect(() => {
    let alive = true;
    void getTeslaOwnerStatus().then((status) => {
      if (alive) setOwner(status);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function connect() {
    setBusy(true);
    try {
      const result = await beginTeslaOwnerLink();
      if (!result.ok) {
        toast(
          result.reason === "not_configured"
            ? "Tesla owner credentials are not on this app yet"
            : "Could not start Tesla owner sign-in",
        );
        return;
      }
      window.location.assign(result.url);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const status = await disconnectTeslaOwner();
      setOwner(status);
      toast("Tesla owner account disconnected");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6">
      <section className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
        <img
          src={heroes.front}
          alt={`${profile.year} ${profile.model} in ${profile.color}`}
          className="h-44 w-full object-cover object-[center_60%]"
          loading="lazy"
          decoding="async"
        />
        <div className="space-y-1 px-5 py-4">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Your vehicle
            </p>
            {profile.isDemo ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                Demo data
              </span>
            ) : null}
          </div>
          <h2 className="text-2xl font-medium tracking-tight">{profile.name}</h2>
          <p className="text-sm text-muted">
            {profile.year} {profile.model} {profile.trim}
          </p>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Model</p>
        <p className="mt-1 text-xs text-muted">
          Sets the profile tab label, header, and Start hero to this model. Images are bundled in the app.
        </p>
        <label className="relative mt-3 block">
          <span className="sr-only">Tesla model</span>
          <select
            value={profile.id}
            onChange={(e) => setModelId(e.target.value as TeslaModelId)}
            className="h-11 w-full appearance-none rounded-xl bg-surface-2 py-2 pl-3 pr-9 text-sm font-medium outline-none shadow-[var(--shadow-border)]"
          >
            {TESLA_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
        </label>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Paint</p>
        <p className="mt-1 text-xs text-muted">
          Factory colors Tesla offers for this model. {profile.paint.name}
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="listbox" aria-label="Paint color">
          {paints.map((p) => {
            const selected = p.id === profile.paint.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={selected}
                title={p.name}
                onClick={() => setPaintId(p.id)}
                className={cn(
                  "flex size-11 items-center justify-center rounded-full transition-[scale,box-shadow] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
                  selected
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface"
                    : "shadow-[var(--shadow-border)]",
                )}
              >
                <span
                  className="size-9 rounded-full border border-border"
                  style={{ backgroundColor: p.swatch }}
                  aria-hidden
                />
                <span className="sr-only">{p.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <OwnerAccess owner={owner} busy={busy} vin={profile.vin} onConnect={connect} onDisconnect={disconnect} />

      <PrivacyCard vehicleName={profile.name} />


      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Units</p>
            <p className="text-xs text-muted">Distance and efficiency</p>
          </div>
          <div className="flex rounded-full bg-surface-2 p-1">
            {(["mi", "km"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => s.setUnits(u)}
                className={cn(
                  "h-9 min-w-12 rounded-full px-3 text-sm font-medium",
                  "transition-[background-color,color,scale] duration-150 ease-[var(--ease-out)]",
                  "active:scale-[0.96]",
                  s.units === u ? "bg-foreground text-background" : "text-muted",
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Identity</p>
          {profile.isDemo ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              Sample
            </span>
          ) : null}
        </div>
        <dl className="mt-3 space-y-3">
          <Row label="VIN" value={formatVin(profile.vin, s.maskVin)} mono />
          <Row label="Access" value="Owner only" />
          <Row label="Software" value={profile.software} />
          <Row label="Autopilot" value={profile.fsd} />
          <Row label="Factory" value={profile.plant} />
          <Row label="Delivered" value={profile.delivered} />
          <Row
            label="Battery health"
            value={`${formatNumber(profile.batteryHealth * 100, 1)}%`}
          />
        </dl>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">{profile.name} specs</p>
        <dl className="mt-3 divide-y divide-border">
          {specs.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
      </section>
    </div>
  );
}

function OwnerAccess({
  owner,
  busy,
  vin,
  onConnect,
  onDisconnect,
}: {
  owner: TeslaOwnerStatus | null;
  busy: boolean;
  vin: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const linked = owner?.linked;
  const configured = owner?.configured;
  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <p className="text-sm font-medium">Tesla owner access</p>
      <p className="mt-1 text-xs text-muted">
        Only the Tesla account that owns this VIN can link. Drivers, guests, and
        fleet tokens are refused. No remote commands.
      </p>
      <p className="mt-3 text-sm">
        {linked ? "Owner linked" : configured ? "Not linked" : "Waiting on Tesla app credentials"}
        <span className="text-subtle"> · </span>
        <span className="tabular-nums tracking-wide">{vin}</span>
      </p>
      <div className="mt-4">
        {linked ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="h-11 w-full rounded-full bg-surface-2 text-sm font-medium transition-[scale,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.96] disabled:opacity-50"
          >
            Disconnect owner account
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="h-11 w-full rounded-full bg-foreground text-sm font-medium text-background transition-[scale,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.96] disabled:opacity-50"
          >
            Sign in as owner
          </button>
        )}
      </div>
    </section>
  );
}

function PrivacyCard({ vehicleName }: { vehicleName: string }) {
  const maskVin = useVehicleStore((s) => s.maskVin);
  const shareLocation = useVehicleStore((s) => s.shareLocation);
  const setMaskVin = useVehicleStore((s) => s.setMaskVin);
  const setShareLocation = useVehicleStore((s) => s.setShareLocation);
  const clearVehicle = useVehicleStore((s) => s.clearOwnerData);
  const clearTrips = useTripStore((s) => s.clearOwnerData);
  const clearCharges = useChargeStore((s) => s.clearOwnerData);
  const [confirm, setConfirm] = useState(false);

  async function wipe() {
    clearTrips();
    clearCharges();
    clearVehicle();
    await disconnectTeslaOwner();
    setConfirm(false);
    toast("Local vehicle data cleared");
  }

  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <p className="text-sm font-medium">Vehicle data privacy</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Tesla does not keep a linked history of where {vehicleName} drives. This app is the
        controller for data it holds: you, the owner, on this device. Lawful basis is consent
        (GDPR Art. 6(1)(a)) for location, charge geofences, and optional address lookup. Data is
        not sold, not profiled, and not sent to our servers. Address Find queries OpenStreetMap
        Nominatim only when you tap it; the query is not stored. You can export a copy (Art. 20)
        or erase it (Art. 17) below. Revoke Tesla access in your Tesla account at any time.
      </p>
      <ul className="mt-3 space-y-1 text-xs text-subtle">
        <li>On this phone: trip groups, charge sites, catch radii, last known state</li>
        <li>Never requested: vehicle commands, cameras, other cars, advertising IDs</li>
        <li>Recipients: none, except Nominatim if you search an address</li>
      </ul>

      <div className="mt-4 space-y-3">
        <PrivacyToggle
          label="Precise location"
          hint="Maps and pins. Off hides coordinates."
          on={shareLocation}
          onChange={setShareLocation}
        />
        <PrivacyToggle
          label="Show full VIN"
          hint="Off masks the middle of the VIN."
          on={!maskVin}
          onChange={(on) => setMaskVin(!on)}
        />
      </div>

      {confirm ? (
        <ConfirmStrip
          className="mt-4"
          title="Clear all local data?"
          body="Trip groups, charge sites, and vehicle prefs on this device are erased. Tesla account access is disconnected."
          confirmLabel="Clear now"
          cancelLabel="Keep"
          onConfirm={() => void wipe()}
          onCancel={() => setConfirm(false)}
        />
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              downloadOwnerExport();
              toast("Owner data copy saved");
            }}
            className="h-11 flex-1 rounded-full bg-surface-2 text-sm font-medium"
          >
            Export my data
          </button>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="h-11 flex-1 rounded-full bg-surface-2 text-sm font-medium"
          >
            Clear local data
          </button>
        </div>
      )}
    </section>
  );
}

function PrivacyToggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn(
          "h-9 min-w-14 rounded-full px-3 text-xs font-medium",
          "transition-[background-color,color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
          on ? "bg-foreground text-background" : "bg-surface-2 text-muted",
        )}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("text-sm", mono && "tabular-nums tracking-wide")}>{value}</dd>
    </div>
  );
}
