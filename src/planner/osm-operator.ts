const RULES: { id: string; test: RegExp }[] = [
  { id: "tesla", test: /\btesla\b|supercharger/i },
  { id: "ionity", test: /ionity/i },
  { id: "fastned", test: /fastned/i },
  { id: "allego", test: /allego/i },
  { id: "electra", test: /\belectra\b/i },
  { id: "enbw", test: /enbw|hypernetz/i },
  { id: "clever", test: /\bclever\b/i },
  { id: "eon", test: /\be\.?on\b|eon drive/i },
  { id: "spirii", test: /spirii/i },
  { id: "mer", test: /(^|\b)mer(\b| )|grønn kontakt|gronn kontakt/i },
  { id: "recharge", test: /recharge|fortum charge/i },
  { id: "kople", test: /kople/i },
  { id: "eviny", test: /eviny|\bbkk\b/i },
  { id: "circlek", test: /circle\s*k/i },
  { id: "unox", test: /uno-?x/i },
  { id: "shell", test: /shell recharge|shell/i },
  { id: "aral", test: /aral/i },
  { id: "total", test: /totalenergies|total ener/i },
];

export function networkFromOperator(text: string) {
  const blob = text.trim();
  if (!blob) return null;
  for (const rule of RULES) {
    if (rule.test.test(blob)) return rule.id;
  }
  return null;
}

export function networkFromOsmTags(tags: Record<string, string>) {
  const blob = [tags.operator, tags.brand, tags.network, tags.name, tags["operator:en"]].filter(Boolean).join(" ");
  if (tags.tesla === "yes" || tags["tesla:supercharger"] || /supercharger/i.test(tags.socket ?? "")) return "tesla";
  return networkFromOperator(blob);
}

export function isDcStation(tags: Record<string, string>) {
  const blob = Object.entries(tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (/socket:(ccs|type2_combo|tesla|nacs)/i.test(blob)) return true;
  if (/supercharger|ionity|fastned|hypernetz/i.test(blob)) return true;
  const kw = Number(String(tags["charging_station:output"] ?? tags.maxpower ?? "").replace(/[^\d.]/g, ""));
  return kw >= 50;
}