import { type CountryProfile } from "./country-profiles";
import { type FxTable } from "./charge-fx";
import { type ChargeNetwork } from "./networks";

export type ChargePricesResponse = {
  source: string;
  updatedAt: string;
  ttlSec: number;
  fx: FxTable;
  fxSource: string;
  networks: ChargeNetwork[];
  countries: CountryProfile[];
};