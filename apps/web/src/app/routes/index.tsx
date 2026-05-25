/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

export function IndexRedirect() {
  return <Navigate to="/overview" />;
}
