import { VEHICLE } from "@/lib/vehicle";
import { useChargeStore } from "@/store/charge-store";
import { useTripStore } from "@/store/trip-store";
import { useVehicleStore } from "@/store/vehicle-store";

export function downloadOwnerExport() {
  const vehicle = useVehicleStore.getState();
  const charge = useChargeStore.getState();
  const trips = useTripStore.getState();
  const payload = {
    format: "juniper-owner-export",
    lawfulBasis: "consent (GDPR Art. 6(1)(a))",
    controller: "the vehicle owner on this device",
    exportedAt: new Date().toISOString(),
    vehicle: {
      name: VEHICLE.name,
      vin: VEHICLE.vin,
      model: `${VEHICLE.year} ${VEHICLE.model} ${VEHICLE.trim}`,
    },
    privacy: {
      maskVin: vehicle.maskVin,
      shareLocation: vehicle.shareLocation,
    },
    chargeLocations: charge.locations.map((l) => ({
      id: l.id,
      name: l.name,
      lat: l.lat,
      lng: l.lng,
      radiusM: l.radiusM,
      usdPerKwh: l.usdPerKwh,
      kind: l.kind,
    })),
    chargeSessions: charge.logged,
    tripGroups: trips.albums,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "juniper-owner-data.json";
  a.click();
  URL.revokeObjectURL(url);
}
