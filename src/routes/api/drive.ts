import { createFileRoute } from "@tanstack/react-router";
import { handleDriveRequest } from "@/planner/drive";

export const Route = createFileRoute("/api/drive")({
  server: {
    handlers: {
      POST: async ({ request }) => handleDriveRequest(request),
    },
  },
});
