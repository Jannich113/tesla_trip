export type HourPrice = {
  hour: string;
  timeDk: string;
  krPerKwh: number;
  orePerKwh: number;
};

export type ElprisData = {
  area: "DK1";
  source: "Energi Data Service";
  updatedAt: string;
  current: HourPrice | null;
  today: HourPrice[];
  tomorrow: HourPrice[];
};

export async function fetchElpris(signal?: AbortSignal): Promise<ElprisData> {
  const res = await fetch("/api/elpris", { signal, headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as ElprisData;
}

export function formatKrPerKwh(kr: number, digits = 3) {
  return `${kr.toLocaleString("da-DK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} kr/kWh`;
}

export function formatOrePerKwh(ore: number, digits = 1) {
  return `${ore.toLocaleString("da-DK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} øre/kWh`;
}

export function formatKrValue(kr: number, digits = 3) {
  return kr.toLocaleString("da-DK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatOreValue(ore: number, digits = 1) {
  return ore.toLocaleString("da-DK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
