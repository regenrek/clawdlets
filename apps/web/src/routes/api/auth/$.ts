import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handler } = await import("~/server/better-auth");
        return handler(request);
      },
      POST: async ({ request }) => {
        const { handler } = await import("~/server/better-auth");
        return handler(request);
      },
    },
  },
});

