import { cn } from "@/lib/utils";

export function BatteryBar({
  soc,
  limit,
  charging,
}: {
  soc: number;
  limit: number;
  charging?: boolean;
}) {
  return (
    <div className="relative h-2 w-full rounded-full bg-surface-2">
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full bg-accent",
          charging && "animate-pulse",
        )}
        style={{ width: `${Math.min(100, Math.max(0, soc))}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `${limit}%` }}
        title={`Charge limit ${limit}%`}
      />
    </div>
  );
}
