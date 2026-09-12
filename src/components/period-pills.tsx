import { PERIODS, type Period } from "@/lib/history";
import { cn } from "@/lib/utils";

const LABELS: Record<Period, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  total: "Total",
};

export function PeriodPills({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="relative z-20 flex rounded-full bg-surface-2 p-1" role="tablist" aria-label="Time range">
      {PERIODS.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              onChange(p);
            }}
            className={cn(
              "h-9 flex-1 touch-manipulation rounded-full px-1 text-xs font-medium",
              "transition-[background-color,color,scale] duration-150 ease-[var(--ease-out)]",
              "active:scale-[0.96]",
              active ? "bg-foreground text-background" : "text-muted",
            )}
          >
            {LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}