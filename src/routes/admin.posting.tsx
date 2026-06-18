import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/posting")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { tab: "posting" } as never });
  },
  component: () => null,
});