import { cn } from "@/lib/utils";
import { suggestRoadFeeApps } from "./road-fee-apps";

type RoadFeeSuggestionsProps = {
  path: [number, number][];
  className?: string;
};

/**
 * Suggestion list on the trip overview. Links leave the app.
 * Nothing here pays a toll or starts parking.
 */
export function RoadFeeSuggestions({ path, className }: RoadFeeSuggestionsProps) {
  const apps = suggestRoadFeeApps(path);
  if (apps.length === 0) return null;
  return (
    <section
      aria-label="Road fee and parking apps"
      className={cn("rounded-lg bg-surface-2 p-3 shadow-[var(--shadow-border)]", className)}
    >
      <h2 className="text-sm font-medium">Apps for this route</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Suggested because the route enters the region. Install or sign up with the operator. This
        does not pay the fee.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {apps.map((app) => (
          <li key={app.id}>
            <p className="text-sm font-medium">{app.name}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{app.reason}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{app.summary}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {app.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium underline"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
