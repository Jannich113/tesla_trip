import { createFileRoute, redirect } from "@tanstack/react-router";

// The planner is now the start tab; keep old /plan links and installs working.
export const Route = createFileRoute("/plan")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
