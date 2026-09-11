/** Deterministic content hash for stable trip/charge IDs across midnights. */
export function contentHash(parts: Array<string | number>) {
  const raw = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function tripContentId(t: { day: string; hour: number; minute: number; from: string; to: string }) {
  return `t_${contentHash([t.day, t.hour, t.minute, t.from, t.to])}`;
}

export function chargeContentId(c: {
  day: string;
  hour: number;
  minute: number;
  where: string;
  kind: string;
}) {
  return `c_${contentHash([c.day, c.hour, c.minute, c.where, c.kind])}`;
}
