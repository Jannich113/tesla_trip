import { useEffect, useState } from "react";
import { toast } from "sonner";
import { VEHICLE, formatNumber, formatVin } from "@/lib/vehicle";
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

const SPECS: { label: string; value: string }[] = [
  { label: "Vehicle", value: `${VEHICLE.year} ${VEHICLE.model}` },
  { label: "Trim", value: VEHICLE.trim },
  { label: "Paint", value: VEHICLE.color },
  { label: "Interior", value: VEHICLE.interior },
  { label: "Wheels", value: VEHICLE.wheels },
  { label: "Drivetrain", value: VEHICLE.motors },
  { label: "Peak power", value: `${VEHICLE.powerHp} hp` },
  { label: "Acceleration", value: VEHICLE.accel },
  { label: "EPA range", value: `${VEHICLE.epaRangeMi} mi` },
  { label: "Usable battery", value: `${VEHICLE.usableKwh} kWh` },
  { label: "DC charge", value: `${VEHICLE.peakDcKw} kW` },
  { label: "AC charge", value: `${VEHICLE.acKw} kW` },
  { label: "Architecture", value: VEHICLE.architecture },
  { label: "Connector", value: VEHICLE.connector },
  { label: "Drag", value: `Cd ${VEHICLE.dragCd}` },
  { label: "Seats", value: String(VEHICLE.seats) },
];

export function VehicleScreen() {
  const s = useVehicleStore();
  const [owner, setOwner] = useState<TeslaOwnerStatus | null>(null);
  const [busy, setBusy] = useState(false);

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
          src="/vehicles/juniper-front.jpg"
          alt="Juniper in Stealth Grey"
          className="h-44 w-full object-cover object-[center_60%]"
        />
        <div className="space-y-1 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Named in the Tesla app
          </p>
          <h2 className="text-2xl font-medium tracking-tight">{VEHICLE.name}</h2>
          <p className="text-sm text-muted">
            {VEHICLE.year} {VEHICLE.model} {VEHICLE.trim}
          </p>
        </div>
      </section>

      <OwnerAccess owner={owner} busy={busy} onConnect={connect} onDisconnect={disconnect} />

      <PrivacyCard />

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Vehicle state</p>
        <p className="mt-1 text-xs text-muted">Read from Juniper · not controlled here</p>
        <p className="mt-4 text-sm">
          {s.mode === "charging"
            ? `Charging · ${formatNumber(s.chargeKw, 1)} kW`
            : s.mode === "driving"
              ? "Driving"
              : "Parked"}
          <span className="text-subtle"> · </span>
          {s.locked ? "Locked" : "Unlocked"}
          <span className="text-subtle"> · </span>
          {s.pluggedIn ? "Plugged in" : "Unplugged"}
        </p>
      </section>

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
        <p className="text-sm font-medium">Identity</p>
        <dl className="mt-3 space-y-3">
          <Row label="VIN" value={formatVin(VEHICLE.vin, s.maskVin)} mono />
          <Row label="Access" value="Owner only" />
          <Row label="Software" value={VEHICLE.software} />
          <Row label="Autopilot" value={VEHICLE.fsd} />
          <Row label="Factory" value={VEHICLE.plant} />
          <Row label="Delivered" value={VEHICLE.delivered} />
          <Row
            label="Battery health"
            value={`${formatNumber(VEHICLE.batteryHealth * 100, 1)}%`}
          />
        </dl>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Juniper specs</p>
        <dl className="mt-3 divide-y divide-border">
          {SPECS.map((row) => (
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
  onConnect,
  onDisconnect,
}: {
  owner: TeslaOwnerStatus | null;
  busy: boolean;
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
        <span className="tabular-nums tracking-wide">{VEHICLE.vin}</span>
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

function PrivacyCard() {
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
        Tesla does not keep a linked history of where Juniper drives. This app is the controller
        for data it holds: you, the owner, on this device. Lawful basis is consent (GDPR Art. 6(1)(a))
        for location, charge geofences, and optional address lookup. Data is not sold, not profiled,
        and not sent to our servers. Address Find queries OpenStreetMap Nominatim only when you tap
        it; the query is not stored. You can export a copy (Art. 20) or erase it (Art. 17) below.
        Revoke Tesla access in your Tesla account at any time.
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
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void wipe()}
            className="h-11 flex-1 rounded-full bg-foreground text-sm font-medium text-background"
          >
            Clear now
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="h-11 flex-1 rounded-full bg-surface-2 text-sm font-medium"
          >
            Keep
          </button>
        </div>
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
