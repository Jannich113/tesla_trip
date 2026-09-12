import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/shell";
import { type Tab } from "@/lib/vehicle";

const TABS: Tab[] = ["home", "trips", "costs", "elpris", "vehicle"];

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; tesla?: string } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
    tesla: typeof search.tesla === "string" ? search.tesla : undefined,
  }),
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  return <Dashboard startTab={search.tab ?? "home"} />;
}
