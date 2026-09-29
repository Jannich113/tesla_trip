import { type CountryProfile } from "./country-profiles";
import { type FxTable } from "./charge-fx";
import { type ChargeNetwork } from "./networks";
import { type VariableFeed } from "./variable-rates";

export type ChargePricesResponse = {
  source: string;
  updatedAt: string;
  ttlSec: number;
  fx: FxTable;
  fxSource: string;
  networks: ChargeNetwork[];
  countries: CountryProfile[];
  /** Per-stall time-of-day rates. Missing or empty sites means catalog fallback. */
  variable?: VariableFeed;
};
