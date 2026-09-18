import { minutesBetweenDateTime } from "./modes";

/** Leave→arrive trip minutes for saved cards / totals.min.
 *  Counts drive + on-route charge/wait once. Does not re-add pre-departure
 *  charge/wait when startAt is already first departAt (that was the ~2× bug). */
export function planTripMin(
  legs: {
    departAt?: string;
    arriveAt?: string;
    route: { seconds: number };
    chargeMin: number;
    waitMin: number;
  }[],
) {
  if (!legs.length) return 0;
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (first?.departAt && last?.arriveAt) {
    const wall = minutesBetweenDateTime(first.departAt, last.arriveAt);
    if (Number.isFinite(wall) && wall >= 0) return wall;
  }
  return legs.reduce((n, leg) => n + leg.route.seconds / 60 + leg.chargeMin + leg.waitMin, 0);
}
