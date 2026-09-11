import {
  heroesFor,
  modelById,
  paintById,
  type TeslaModelProfile,
  type TeslaPaint,
} from "@/lib/tesla-models";
import { useVehicleStore } from "@/store/vehicle-store";

export type VehicleProfileView = TeslaModelProfile & {
  color: string;
  paint: TeslaPaint;
};

export function useVehicleProfile(): {
  profile: VehicleProfileView;
  heroes: { front: string; rear: string };
  paints: TeslaPaint[];
} {
  const modelId = useVehicleStore((s) => s.modelId);
  const paintId = useVehicleStore((s) => s.paintId);
  const base = modelById(modelId);
  const paint = paintById(base, paintId);
  const profile: VehicleProfileView = {
    ...base,
    color: paint.name,
    paint,
  };
  return { profile, heroes: heroesFor(modelId, paintId), paints: base.paints };
}
