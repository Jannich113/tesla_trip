import { createServerFn } from "@tanstack/react-start";
import { VEHICLE } from "@/lib/vehicle";
import type { TeslaOwnerVehicleSnapshot } from "@/lib/tesla-owner-data";

export const OWNER_VIN = VEHICLE.vin;

export const TESLA_OWNER_SCOPES = [
  "openid",
  "offline_access",
  "vehicle_device_data",
  "vehicle_location",
] as const;

export const TESLA_DENIED_SCOPES = [
  "vehicle_cmds",
  "vehicle_charging_cmds",
] as const;

export type TeslaOwnerStatus = {
  configured: boolean;
  linked: boolean;
  vin: string;
  access: "owner";
  teslaVehicleId?: number;
  linkedAt?: number;
  reason?: "not_configured" | "not_owner" | "driver" | "denied" | "error";
};

export type { TeslaOwnerVehicleSnapshot };

export const getTeslaOwnerStatus = createServerFn({ method: "POST" }).handler(
  async (): Promise<TeslaOwnerStatus> => {
    const { readOwnerStatus } = await import("./tesla-owner.server.ts");
    return readOwnerStatus();
  },
);

export const beginTeslaOwnerLink = createServerFn({ method: "POST" }).handler(
  async (): Promise<
    { ok: true; url: string } | { ok: false; reason: TeslaOwnerStatus["reason"] }
  > => {
    const { startOwnerLink } = await import("./tesla-owner.server.ts");
    return startOwnerLink();
  },
);

export const disconnectTeslaOwner = createServerFn({ method: "POST" }).handler(
  async (): Promise<TeslaOwnerStatus> => {
    const { clearOwnerSession } = await import("./tesla-owner.server.ts");
    return clearOwnerSession();
  },
);

export const getTeslaOwnerVehicleData = createServerFn({ method: "POST" })
  .inputValidator((data: { includeLocation?: boolean }) => ({
    includeLocation: Boolean(data?.includeLocation),
  }))
  .handler(async ({ data }): Promise<TeslaOwnerVehicleSnapshot> => {
    const { fetchOwnerVehicleData } = await import("./tesla-owner.server.ts");
    return fetchOwnerVehicleData({ includeLocation: data.includeLocation });
  });
