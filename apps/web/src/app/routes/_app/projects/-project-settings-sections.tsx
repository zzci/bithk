// Sections settings panel: which sections the project mounts (PLAN-108).
//
// A project is a core record plus a set of MOUNTED SECTIONS, so this panel is
// the only place the shape of a project is edited. Mounting also PROVISIONS
// the section server-side (it may copy a global template), and unmounting is
// REFUSED with 409 `SECTION_NOT_EMPTY` while the section still holds data —
// that refusal is a deliberate no-data-loss rule, so it is surfaced inline
// rather than swallowed into a generic failure toast.

import type { ProjectSectionKey, ProjectView } from "@/shared/lib/api/projects";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import {
  useMountProjectSection,
  useUnmountProjectSection,
} from "@/shared/lib/api/projects";
import { HttpError } from "@/shared/lib/http";
import { mountableProjectSections, projectSectionLabelKey } from "./-project-sections";

interface ProjectSettingsSectionsProps {
  readonly project: ProjectView;
  readonly canManage: boolean;
}

export function ProjectSettingsSections({ project, canManage }: ProjectSettingsSectionsProps) {
  const { t } = useTranslation(["projects", "ships", "common"]);
  const mountSection = useMountProjectSection();
  const unmountSection = useUnmountProjectSection();
  // The failure is per-section, so the message is keyed by section rather than
  // held as one banner: refusing to unmount Equipment must not blank out an
  // unrelated error on Files.
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const setError = (key: string, message: string | null) =>
    setErrors(({ [key]: _dropped, ...rest }) => (message === null ? rest : { ...rest, [key]: message }));

  const pending = mountSection.isPending || unmountSection.isPending;

  const toggle = (key: ProjectSectionKey, label: string, mount: boolean) => {
    setError(key, null);
    const options = {
      onSuccess: () => toast.success(t(mount ? "sections.toastMounted" : "sections.toastUnmounted")),
      onError: (err: unknown) => {
        // 409 SECTION_NOT_EMPTY is the documented refusal, not a fault: name
        // the section and say what has to happen before it can be removed.
        const refused = err instanceof HttpError && err.code === "SECTION_NOT_EMPTY";
        setError(key, refused
          ? t("sections.unmountRefused", { name: label })
          : t(mount ? "sections.mountFailed" : "sections.unmountFailed"));
      },
    };
    if (mount)
      mountSection.mutate({ projectId: project.id, key }, options);
    else
      unmountSection.mutate({ projectId: project.id, key }, options);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("sections.description")}</p>

      <ul className="divide-y rounded-md border">
        {mountableProjectSections().map((entry) => {
          const key = entry.key as ProjectSectionKey;
          const label = t(projectSectionLabelKey(entry));
          const mounted = project.sections.includes(key);
          const error = errors[key];
          return (
            <li key={key} className="space-y-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`section-${key}`} className="font-normal">{label}</Label>
                <Switch
                  id={`section-${key}`}
                  checked={mounted}
                  disabled={!canManage || pending}
                  onCheckedChange={() => toggle(key, label, !mounted)}
                />
              </div>
              {error && <ErrorBanner message={error} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
