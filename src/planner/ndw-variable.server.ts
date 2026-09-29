import { gunzipSync } from "node:zlib";
import {
  NDW_LOCATION_URL,
  NDW_TARIFF_URL,
  teslaSitesFromOcpi,
  type VariableSite,
} from "./variable-rates";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/gzip, application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`NDW ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text =
    buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
      ? gunzipSync(buf).toString("utf8")
      : buf.toString("utf8");
  return JSON.parse(text) as unknown;
}

/** Public Dutch OCPI dump. Tesla party US/TSL is the only variable kWh schedule we apply. */
export async function loadNdwTeslaSites(): Promise<{ sites: VariableSite[]; source: string }> {
  const [tariffs, locations] = await Promise.all([
    getJson(NDW_TARIFF_URL),
    getJson(NDW_LOCATION_URL),
  ]);
  return { sites: teslaSitesFromOcpi(tariffs, locations), source: NDW_TARIFF_URL };
}
