/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { PermissionChecker } from "./-policies-check";
import { ResourceGroupManager } from "./-policies-resource-groups";
import { TupleManager } from "./-policies-tuples";

export const Route = createLazyFileRoute("/_app/admin/policies")({
  component: PoliciesPage,
});

function PoliciesPage() {
  const { t } = useTranslation("policies");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
      </div>

      <Tabs defaultValue="tuples">
        <TabsList>
          <TabsTrigger value="tuples">{t("relationTuples")}</TabsTrigger>
          <TabsTrigger value="resource-groups">{t("resourceGroups")}</TabsTrigger>
          <TabsTrigger value="check">{t("permissionCheck")}</TabsTrigger>
        </TabsList>

        <TabsContent value="tuples" className="mt-4">
          <TupleManager />
        </TabsContent>

        <TabsContent value="resource-groups" className="mt-4">
          <ResourceGroupManager />
        </TabsContent>

        <TabsContent value="check" className="mt-4">
          <PermissionChecker />
        </TabsContent>
      </Tabs>
    </div>
  );
}
