// `ship-profile` section tab: the vessel's registry and principal-specification
// fields, read-only with an edit dialog for managers.
//
// Name comes from the PROJECT payload; everything else from the section's own
// ship-profile view (`ships.code` became the mutable `hullNumber`).

import type { ReactNode } from "react";
import type { ShipProfileFormState } from "./-ship-profile-form-logic";
import type { ProjectView } from "@/shared/lib/api/projects";
import { Anchor, Calendar, Fingerprint, Pencil, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useShipProfile, useUpdateShipProfile } from "@/shared/lib/api/project-sections";
import { errorMessage } from "@/shared/lib/errors";
import { ShipProfileFormDialog } from "./-ship-profile-form-dialog";
import { EMPTY_SHIP_PROFILE_FORM, shipProfileFormFromView, shipProfileFormToUpdate } from "./-ship-profile-form-logic";
import { ShipStatusBadge } from "./-ship-status-badge";

interface ProjectShipProfileTabProps {
  readonly project: ProjectView;
  readonly canManage: boolean;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

export function ProjectShipProfileTab({ project, canManage }: ProjectShipProfileTabProps) {
  const { t } = useTranslation(["ships", "common"]);
  const [editOpen, setEditOpen] = useState(false);
  const profileQuery = useShipProfile(project.id);
  const updateProfile = useUpdateShipProfile();
  const profile = profileQuery.data;

  const initialForm = useMemo(
    () => (profile ? shipProfileFormFromView(profile) : EMPTY_SHIP_PROFILE_FORM),
    [profile],
  );

  const notSet = <span className="text-muted-foreground">{t("overview.notSet")}</span>;
  const text = (value: string | null | undefined): ReactNode => value || notSet;
  const num = (value: number | null | undefined): ReactNode =>
    value === null || value === undefined ? notSet : <span className="font-mono">{value}</span>;
  const age = profile?.buildYear == null ? null : Math.max(0, CURRENT_YEAR - profile.buildYear);

  const handleSubmit = (state: ShipProfileFormState) => {
    updateProfile.mutate(
      { projectId: project.id, ...shipProfileFormToUpdate(state) },
      { onSuccess: () => setEditOpen(false) },
    );
  };

  if (profileQuery.error)
    return <ErrorBanner message={errorMessage(profileQuery.error, t("common:common.error.loadFailed"))} />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card>
        <CardContent>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("profile.archive")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("profile.archiveDescription")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canManage && profile && (
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1 size-4" aria-hidden="true" />
                  {t("common:common.edit")}
                </Button>
              )}
              {profile && <ShipStatusBadge status={profile.shipStatus} />}
            </div>
          </div>

          <ProfileSection title={t("overview.section.identity")}>
            <ProfileField label={t("field.name")}>{text(project.name)}</ProfileField>
            <ProfileField label={t("field.hullNumber")} mono>{text(profile?.hullNumber)}</ProfileField>
            <ProfileField label={t("field.imoNumber")} mono>{text(profile?.imoNumber)}</ProfileField>
            <ProfileField label={t("field.mmsi")} mono>{text(profile?.mmsi)}</ProfileField>
            <ProfileField label={t("field.callSign")} mono>{text(profile?.callSign)}</ProfileField>
            <ProfileField label={t("field.flagState")}>{text(profile?.flagState)}</ProfileField>
          </ProfileSection>

          <ProfileSection title={t("overview.section.classification")}>
            <ProfileField label={t("field.builder")}>{text(profile?.builder)}</ProfileField>
            <ProfileField label={t("field.model")}>{text(profile?.model)}</ProfileField>
            <ProfileField label={t("field.buildYear")}>{num(profile?.buildYear)}</ProfileField>
            <ProfileField label={t("profile.age")}>{age === null ? notSet : t("profile.ageValue", { count: age })}</ProfileField>
            <ProfileField label={t("field.registryPort")}>{text(profile?.registryPort)}</ProfileField>
            <ProfileField label={t("field.ownerName")}>{text(profile?.ownerName)}</ProfileField>
          </ProfileSection>

          <ProfileSection title={t("overview.section.dimensions")}>
            <ProfileField label={t("field.lengthOverall")}>{num(profile?.lengthOverall)}</ProfileField>
            <ProfileField label={t("field.beam")}>{num(profile?.beam)}</ProfileField>
            <ProfileField label={t("field.draft")}>{num(profile?.draft)}</ProfileField>
            <ProfileField label={t("field.grossTonnage")}>{num(profile?.grossTonnage)}</ProfileField>
          </ProfileSection>
        </CardContent>
      </Card>

      <aside className="space-y-3">
        <ProfileSummary icon={<Fingerprint className="size-4" />} label={t("field.imoNumber")} value={profile?.imoNumber ?? t("overview.notSet")} />
        <ProfileSummary icon={<Ruler className="size-4" />} label={t("field.lengthOverall")} value={profile?.lengthOverall == null ? t("overview.notSet") : String(profile.lengthOverall)} />
        <ProfileSummary icon={<Calendar className="size-4" />} label={t("profile.age")} value={age === null ? t("overview.notSet") : t("profile.ageValue", { count: age })} />
        <ProfileSummary icon={<Anchor className="size-4" />} label={t("field.registryPort")} value={profile?.registryPort ?? t("overview.notSet")} />
      </aside>

      {canManage && (
        <ShipProfileFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={initialForm}
          pending={updateProfile.isPending}
          errorMessage={updateProfile.error ? errorMessage(updateProfile.error, t("common:common.error.saveFailed")) : null}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function ProfileSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="border-t border-dashed py-4 first:border-t-0 first:pt-0 last:pb-0">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </div>
  );
}

function ProfileField({ label, mono, children }: { readonly label: string; readonly mono?: boolean; readonly children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 truncate font-mono text-sm" : "mt-1 truncate text-sm"}>{children}</dd>
    </div>
  );
}

function ProfileSummary({ icon, label, value }: { readonly icon: ReactNode; readonly label: string; readonly value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <p className="mt-2 truncate font-mono text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}
