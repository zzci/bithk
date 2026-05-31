/* eslint-disable react-refresh/only-export-components */
// Drawer route for a project procurement. Nested under the project detail page
// so that page stays mounted underneath; the panel renders inside a resizable
// right-side drawer (ported from the work-order issue drawer) portaled to
// <body> so the overlay always covers the full viewport. "Maximize" navigates to
// the standalone fullscreen route at `…/procurements/$procurementId/full`.

import type { CSSProperties, PointerEvent } from "react";
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useVisibleUsers } from "@/shared/components/share/share-helpers";
import { useProject, useProjectMembers } from "@/shared/lib/api/projects";
import { ProjectProcurementPanel } from "./-project-procurement-panel";
import { useProjectCapabilities } from "./-use-project-role";

export const Route = createLazyFileRoute("/_app/projects/$projectId/procurements/$procurementId")({
  component: ProjectProcurementDrawer,
});

const DEFAULT_DRAWER_WIDTH = 672;
const MIN_DRAWER_WIDTH = 360;
const MAX_DRAWER_VIEWPORT_RATIO = 0.92;

function clampDrawerWidth(width: number): number {
  if (typeof window === "undefined")
    return width;
  const maxWidth = Math.max(MIN_DRAWER_WIDTH, Math.floor(window.innerWidth * MAX_DRAWER_VIEWPORT_RATIO));
  return Math.min(Math.max(width, MIN_DRAWER_WIDTH), maxWidth);
}

function ProjectProcurementDrawer() {
  const { projectId, procurementId } = useParams({ from: "/_app/projects/$projectId/procurements/$procurementId" });
  const navigate = useNavigate();
  const { t } = useTranslation("projects");

  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);
  const usersQuery = useVisibleUsers();

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const caps = useProjectCapabilities(projectQuery.data);
  const userNames = useMemo(
    () => new Map((usersQuery.data ?? []).map(u => [u.id, u.name])),
    [usersQuery.data],
  );

  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_WIDTH);

  useEffect(() => {
    const handleResize = () => setDrawerWidth(width => clampDrawerWidth(width));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleDrawerResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0)
      return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = drawerWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setDrawerWidth(clampDrawerWidth(startWidth + startX - moveEvent.clientX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [drawerWidth]);

  const close = () => {
    // Return to the procurement tab route, not the default overview.
    void navigate({ to: "/projects/$projectId/procurements", params: { projectId } });
  };

  const drawerStyle = {
    "--procurement-drawer-width": `${drawerWidth}px`,
  } as CSSProperties;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("procurement.detail.title")}
        className="fixed inset-y-0 right-0 z-50 w-full border-l bg-background shadow-xl sm:w-[min(var(--procurement-drawer-width),92vw)]"
        style={drawerStyle}
      >
        {/* Resize handle: a full-height grab strip pinned to the drawer's left
            edge. Sits above the panel (z-20) with a wide hit area so it is easy
            to grab; a centred pill makes the affordance discoverable. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("procurement.detail.resizeDrawer")}
          className="group absolute inset-y-0 left-0 z-20 hidden w-2.5 cursor-col-resize touch-none items-center justify-center transition-colors hover:bg-primary/5 sm:flex"
          onPointerDown={handleDrawerResizeStart}
        >
          <div className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary group-active:bg-primary" />
        </div>
        <ProjectProcurementPanel
          projectId={projectId}
          procurementId={procurementId}
          members={members}
          userNames={userNames}
          canManage={caps.canManageProcurement}
          canComment={caps.canCommentProcurement}
          variant="drawer"
          onClose={close}
          onMaximize={() => void navigate({
            to: "/projects/$projectId/procurements/$procurementId/full",
            params: { projectId, procurementId },
          })}
        />
      </div>
    </>,
    document.body,
  );
}
