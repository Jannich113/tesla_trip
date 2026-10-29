import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/shell";
import { type Tab } from "@/lib/vehicle";

const TABS: Tab[] = ["plan", "elpris"];

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  return <Dashboard startTab={search.tab ?? "plan"} />;
}
