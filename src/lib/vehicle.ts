export type Units = "mi" | "km";
export type DriveMode = "parked" | "driving" | "charging";
export type Tab = "home" | "trips" | "costs" | "elpris" | "vehicle";

export const VEHICLE = {
  name: "Juniper",
  year: 2025,
  model: "Model Y",
  trim: "Long Range AWD",
  color: "Stealth Grey",
  interior: "All Black",
  wheels: '19" Crossflow',
  vin: "DEMOYTEST0JUNIPER",
  isDemo: true,
  software: "2026.36.8",
  fsd: "FSD Supervised",
  plant: "Giga Texas",
  delivered: "March 18, 2025",
  epaRangeMi: 327,
  usableKwh: 75,
  nominalKwh: 79,
  peakDcKw: 250,
  acKw: 11.5,
  motors: "Dual Motor AWD",
  powerHp: 397,
  accel: "4.6 s 0–60 mph",
  topSpeedMph: 135,
  dragCd: 0.22,
  seats: 5,
  roof: "Panoramic glass",
  connector: "NACS",
  architecture: "400 V",
  heatPump: true,
  batteryHealth: 0.986,
  home: {
    label: "Demo home",
    address: "Los Altos, CA (sample)",
    detail: "Demo · Wall Connector · 48 A",
  },
} as const;

export const MI_TO_KM = 1.60934;

export function formatVin(vin: string, mask = false) {
  if (!mask || vin.length < 10) return vin;
  return `${vin.slice(0, 5)}••••••${vin.slice(-4)}`;
}

export function ratedRangeMi(soc: number) {
  return VEHICLE.epaRangeMi * (soc / 100) * VEHICLE.batteryHealth;
}

export function energyKwh(soc: number) {
  return VEHICLE.usableKwh * (soc / 100);
}

export function formatNumber(value: number, digits = 0) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDistance(miles: number, units: Units, digits = 0) {
  if (units === "km") return `${formatNumber(miles * MI_TO_KM, digits)} km`;
  return `${formatNumber(miles, digits)} mi`;
}

export function formatDistanceValue(miles: number, units: Units, digits = 0) {
  return formatNumber(units === "km" ? miles * MI_TO_KM : miles, digits);
}

export function distanceSuffix(units: Units) {
  return units === "km" ? "km" : "mi";
}

export function formatEfficiency(whPerMi: number, units: Units) {
  if (units === "km") return `${formatNumber(whPerMi / MI_TO_KM, 0)} Wh/km`;
  return `${formatNumber(whPerMi, 0)} Wh/mi`;
}

export function formatSpeed(mph: number, units: Units) {
  if (units === "km") return `${formatNumber(mph * MI_TO_KM, 0)} km/h`;
  return `${formatNumber(mph, 0)} mph`;
}

export function formatClock(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function todayKey(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function relativeTime(from: number, now = Date.now()) {
  if (!from) return "just now";
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 4) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function minutesToHm(total: number) {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

export function timeToLimitMin(soc: number, limit: number, kw: number) {
  if (soc >= limit || kw <= 0) return 0;
  const kwh = VEHICLE.usableKwh * ((limit - soc) / 100);
  return (kwh / kw) * 60;
}

