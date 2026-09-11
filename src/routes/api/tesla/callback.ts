import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/tesla/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { completeOwnerLink } = await import("@/lib/tesla-owner.server");
        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const result = code && state ? await completeOwnerLink(code, state) : "denied";
        const dest = new URL("/", url.origin);
        dest.searchParams.set("tesla", result ?? "error");
        return Response.redirect(dest.toString(), 302);
      },
    },
  },
});
