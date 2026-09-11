export const LEG_MODES = ["eco", "standard", "fastest", "cheapest"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export const DETOUR_KM = [0, 5, 10, 20] as const;
export type DetourKm = (typeof DETOUR_KM)[number];

export type AutoCosting = {
  shortest: boolean;
  use_highways: number;
  use_tolls: number;
  use_ferry: number;
  top_speed?: number;
};

export function modeLabel(mode: LegMode) {
  if (mode === "eco") return "Eco";
  if (mode === "fastest") return "Fastest";
  if (mode === "cheapest") return "Cheapest";
  return "Standard";
}

export function modeHint(mode: LegMode) {
  if (mode === "eco") return "Most efficient path — shorter roads, fewer highways and tolls";
  if (mode === "fastest") return "Highways and tolls for earliest arrival";
  if (mode === "cheapest") return "Looks farther along the route for cheaper charging";
  return "Recommended route";
}

export function modeColor(mode: LegMode) {
  if (mode === "eco") return "#1ecf8a";
  if (mode === "fastest") return "#6ea8ff";
  if (mode === "cheapest") return "#a8b4c0";
  return "#c8cdd4";
}

/** Cheapest searches 3× the detour, at least 30 km, so cheaper sites off-path still count. */
export function chargeSearchKm(mode: LegMode, detourKm: number) {
  if (mode === "cheapest") return Math.max(detourKm * 3, 30);
  return detourKm;
}

export function modeWhFactor(mode: LegMode) {
  if (mode === "eco") return 0.88;
  if (mode === "fastest") return 1.17;
  if (mode === "cheapest") return 0.98;
  return 1;
}

export function epaWhPerMi(usableKwh: number, epaRangeMi: number) {
  if (epaRangeMi <= 0) return 240;
  return (usableKwh / epaRangeMi) * 1000;
}

export function parseHhmm(hhmm: string) {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return ((h % 24) * 60 + (m % 60) + 24 * 60) % (24 * 60);
}

export function formatHhmm(totalMin: number) {
  const wrapped = ((Math.round(totalMin) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutesHhmm(hhmm: string, add: number) {
  return formatHhmm(parseHhmm(hhmm) + add);
}

export function hoursFrom<T extends { hour: string }>(hours: T[], hhmm: string) {
  if (!hours.length) return [];
  const hour = hhmm.slice(0, 2).padStart(2, "0");
  const exact = hours.findIndex((h) => h.hour === hour);
  if (exact >= 0) return hours.slice(exact);
  const next = hours.findIndex((h) => h.hour > hour);
  return next >= 0 ? hours.slice(next) : hours;
}

/** Eco = efficient distance. Standard/cheapest = recommended time. Fastest = time on highways. */
export function costingFor(mode: LegMode): AutoCosting {
  if (mode === "eco") {
    return {
      shortest: true,
      use_highways: 0.1,
      use_tolls: 0,
      use_ferry: 0.25,
    };
  }
  if (mode === "fastest") {
    return {
      shortest: false,
      use_highways: 1,
      use_tolls: 1,
      use_ferry: 0.15,
      top_speed: 140,
    };
  }
  return {
    shortest: false,
    use_highways: 0.55,
    use_tolls: 0.5,
    use_ferry: 0.5,
  };
}
