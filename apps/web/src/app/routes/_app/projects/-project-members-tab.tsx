import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { Users } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { useProjectMembers, useProjectRoles } from "@/shared/lib/api/projects";
import { formatDate } from "@/shared/lib/format";
import { memberLabel } from "./-member-helpers";

interface ProjectMembersTabProps {
  readonly projectId: string;
  readonly userNames: ReadonlyMap<string, string>;
}

export function ProjectMembersTab({ projectId, userNames }: ProjectMembersTabProps) {
  const { t } = useTranslation("projects");
  const membersQuery = useProjectMembers(projectId);
  const rolesQuery = useProjectRoles(projectId);

  const members = membersQuery.data ?? [];
  const roleNames = useMemo(
    () => new Map((rolesQuery.data ?? []).map(role => [role.id, role.name])),
    [rolesQuery.data],
  );

  if (membersQuery.isLoading || rolesQuery.isLoading)
    return <p className="text-sm text-muted-foreground">{t("members.loading")}</p>;

  if (members.length === 0)
    return <p className="text-sm text-muted-foreground">{t("members.empty")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Users aria-hidden="true" />
        <AlertDescription>{t("members.tabDescription")}</AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {members.map(member => (
          <MemberCard
            key={member.id}
            member={member}
            label={memberLabel(member, userNames)}
            roleName={roleNames.get(member.roleId)}
          />
        ))}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  label,
  roleName,
}: {
  readonly member: ProjectMemberView;
  readonly label: string;
  readonly roleName: string | undefined;
}) {
  const { t } = useTranslation("projects");
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{label}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge variant={member.userId ? "outline" : "secondary"} className="text-xs">
                {member.userId ? t("members.kind.real") : t("members.kind.virtual")}
              </Badge>
              {roleName && <Badge variant="secondary" className="text-xs">{roleName}</Badge>}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t("members.col.title")}</dt>
            <dd className="text-right">{member.title || t("overview.notSet")}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t("members.col.role")}</dt>
            <dd className="text-right">{roleName || t("members.noRole")}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t("members.joinedAt")}</dt>
            <dd className="text-right">{formatDate(member.createdAt)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
