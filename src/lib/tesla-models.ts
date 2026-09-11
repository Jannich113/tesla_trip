/** Selectable Tesla profiles — one entry per model; heroes + paints are local. */

export type TeslaModelId =
  | "juniper"
  | "highland"
  | "model-y"
  | "model-3"
  | "model-s"
  | "model-x"
  | "cybertruck";

export type TeslaPaint = {
  id: string;
  name: string;
  /** Hex for UI swatch */
  swatch: string;
};

export type TeslaModelProfile = {
  id: TeslaModelId;
  name: string;
  year: number;
  model: string;
  trim: string;
  /** Default paint id from `paints` */
  defaultPaintId: string;
  paints: TeslaPaint[];
  vin: string;
  isDemo: true;
  epaRangeMi: number;
  usableKwh: number;
  acKw: number;
  software: string;
  fsd: string;
  plant: string;
  delivered: string;
  motors: string;
  powerHp: number;
  accel: string;
  seats: number;
  batteryHealth: number;
  home: { label: string; address: string; detail: string };
};

const DEMO_HOME = {
  label: "Demo home",
  address: "Los Altos, CA (sample)",
  detail: "Demo · Wall Connector · 48 A",
} as const;

/** Factory paint options Tesla currently lists for passenger cars (US). */
const P = {
  stealthGrey: { id: "stealth-grey", name: "Stealth Grey", swatch: "#5C5E62" },
  pearlWhite: {
    id: "pearl-white",
    name: "Pearl White Multi-Coat",
    swatch: "#F2F2F0",
  },
  solidBlack: { id: "solid-black", name: "Solid Black", swatch: "#111111" },
  deepBlue: {
    id: "deep-blue",
    name: "Deep Blue Metallic",
    swatch: "#1A3A6E",
  },
  quicksilver: { id: "quicksilver", name: "Quicksilver", swatch: "#A7ADB4" },
  ultraRed: { id: "ultra-red", name: "Ultra Red", swatch: "#8E1B1B" },
  midnightSilver: {
    id: "midnight-silver",
    name: "Midnight Silver Metallic",
    swatch: "#6B7075",
  },
  redMulti: {
    id: "red-multi-coat",
    name: "Red Multi-Coat",
    swatch: "#A51C23",
  },
  stainless: {
    id: "stainless",
    name: "Stainless Steel",
    swatch: "#C8CACD",
  },
} as const;

/** Juniper / Highland refresh palette */
const REFRESH_PAINTS: TeslaPaint[] = [
  P.stealthGrey,
  P.pearlWhite,
  P.solidBlack,
  P.deepBlue,
  P.quicksilver,
  P.ultraRed,
];

/** Pre-refresh Model 3 / Y palette */
const CLASSIC_PAINTS: TeslaPaint[] = [
  P.pearlWhite,
  P.solidBlack,
  P.midnightSilver,
  P.deepBlue,
  P.redMulti,
];

/** Model S / X current palette */
const SX_PAINTS: TeslaPaint[] = [
  P.pearlWhite,
  P.solidBlack,
  P.deepBlue,
  P.stealthGrey,
  P.ultraRed,
  P.quicksilver,
];

export const DEFAULT_MODEL_ID: TeslaModelId = "juniper";

export const TESLA_MODELS: TeslaModelProfile[] = [
  {
    id: "juniper",
    name: "Juniper",
    year: 2025,
    model: "Model Y",
    trim: "Long Range AWD",
    defaultPaintId: P.stealthGrey.id,
    paints: REFRESH_PAINTS,
    vin: "DEMOYTEST0JUNIPER",
    isDemo: true,
    epaRangeMi: 327,
    usableKwh: 75,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Giga Texas",
    delivered: "March 18, 2025",
    motors: "Dual Motor AWD",
    powerHp: 397,
    accel: "4.6 s 0–60 mph",
    seats: 5,
    batteryHealth: 0.986,
    home: { ...DEMO_HOME },
  },
  {
    id: "highland",
    name: "Highlander",
    year: 2024,
    model: "Model 3",
    trim: "Long Range RWD",
    defaultPaintId: P.stealthGrey.id,
    paints: REFRESH_PAINTS,
    vin: "DEMO3HIGH0LANDER",
    isDemo: true,
    epaRangeMi: 341,
    usableKwh: 60,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Fremont",
    delivered: "February 14, 2024",
    motors: "Single Motor RWD",
    powerHp: 295,
    accel: "4.9 s 0–60 mph",
    seats: 5,
    batteryHealth: 0.987,
    home: { ...DEMO_HOME },
  },
  {
    id: "model-y",
    name: "Model Y",
    year: 2024,
    model: "Model Y",
    trim: "Long Range AWD",
    defaultPaintId: P.pearlWhite.id,
    paints: CLASSIC_PAINTS,
    vin: "DEMOYTEST0MODELY",
    isDemo: true,
    epaRangeMi: 320,
    usableKwh: 75,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Giga Berlin",
    delivered: "June 2, 2024",
    motors: "Dual Motor AWD",
    powerHp: 384,
    accel: "4.8 s 0–60 mph",
    seats: 5,
    batteryHealth: 0.986,
    home: { ...DEMO_HOME },
  },
  {
    id: "model-3",
    name: "Model 3",
    year: 2024,
    model: "Model 3",
    trim: "Long Range RWD",
    defaultPaintId: P.midnightSilver.id,
    paints: CLASSIC_PAINTS,
    vin: "DEMO3TEST0MODEL3",
    isDemo: true,
    epaRangeMi: 341,
    usableKwh: 60,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Fremont",
    delivered: "January 12, 2024",
    motors: "Single Motor RWD",
    powerHp: 295,
    accel: "4.9 s 0–60 mph",
    seats: 5,
    batteryHealth: 0.986,
    home: { ...DEMO_HOME },
  },
  {
    id: "model-s",
    name: "Model S",
    year: 2024,
    model: "Model S",
    trim: "Plaid",
    defaultPaintId: P.solidBlack.id,
    paints: SX_PAINTS,
    vin: "DEMOSPLAT0MODELS",
    isDemo: true,
    epaRangeMi: 359,
    usableKwh: 95,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Fremont",
    delivered: "September 3, 2024",
    motors: "Tri Motor AWD",
    powerHp: 1020,
    accel: "1.99 s 0–60 mph",
    seats: 5,
    batteryHealth: 0.986,
    home: { ...DEMO_HOME },
  },
  {
    id: "model-x",
    name: "Model X",
    year: 2024,
    model: "Model X",
    trim: "Long Range",
    defaultPaintId: P.deepBlue.id,
    paints: SX_PAINTS,
    vin: "DEMOXTEST0MODELX",
    isDemo: true,
    epaRangeMi: 335,
    usableKwh: 95,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Fremont",
    delivered: "April 20, 2024",
    motors: "Dual Motor AWD",
    powerHp: 670,
    accel: "3.8 s 0–60 mph",
    seats: 6,
    batteryHealth: 0.986,
    home: { ...DEMO_HOME },
  },
  {
    id: "cybertruck",
    name: "Cybertruck",
    year: 2024,
    model: "Cybertruck",
    trim: "AWD",
    defaultPaintId: P.stainless.id,
    paints: [P.stainless],
    vin: "DEMOCTEST0CYBER",
    isDemo: true,
    epaRangeMi: 340,
    usableKwh: 123,
    acKw: 11.5,
    software: "2026.36.8",
    fsd: "FSD Supervised",
    plant: "Giga Texas",
    delivered: "November 8, 2024",
    motors: "Dual Motor AWD",
    powerHp: 600,
    accel: "4.1 s 0–60 mph",
    seats: 5,
    batteryHealth: 0.986,
    home: { ...DEMO_HOME },
  },
];

export function modelById(id: string | undefined | null) {
  return TESLA_MODELS.find((m) => m.id === id) ?? TESLA_MODELS[0];
}

export function isTeslaModelId(id: string): id is TeslaModelId {
  return TESLA_MODELS.some((m) => m.id === id);
}

export function paintById(model: TeslaModelProfile, paintId: string | undefined | null) {
  return model.paints.find((p) => p.id === paintId) ?? model.paints[0];
}

export function isPaintForModel(model: TeslaModelProfile, paintId: string) {
  return model.paints.some((p) => p.id === paintId);
}

/** Local heroes: /vehicles/{modelId}-{paintId}-front.jpg (+ rear). */
export function heroPath(modelId: string, paintId: string, view: "front" | "rear") {
  return `/vehicles/${modelId}-${paintId}-${view}.jpg`;
}

export function heroesFor(modelId: string | undefined | null, paintId?: string | null) {
  const m = modelById(modelId);
  const paint = paintById(m, paintId);
  return {
    front: heroPath(m.id, paint.id, "front"),
    rear: heroPath(m.id, paint.id, "rear"),
  };
}
