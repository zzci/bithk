/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute } from "@tanstack/react-router";
import { DatabaseBackup, FolderCog, HardDrive, Info, Mail, Shield, Ship, SlidersHorizontal, Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { AboutSettingsTab } from "./-settings-about";
import { AuthSettingsTab } from "./-settings-auth";
import { BackupSettingsTab } from "./-settings-backup";
import { GeneralSettingsTab } from "./-settings-general";
import { ProjectDefaultsTab } from "./-settings-project-defaults";
import { ShipSettingsTab } from "./-settings-ship";
import { SmtpSettingsTab } from "./-settings-smtp";
import { StorageSettingsTab } from "./-settings-storage";
import { WebhookSettingsTab } from "./-settings-webhook";

export const Route = createLazyFileRoute("/_app/admin/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("page.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("page.description")}</p>
      </div>

      <Tabs defaultValue="auth">
        <TabsList variant="line">
          <TabsTrigger value="auth">
            <Shield className="mr-1.5 size-4" />
            {t("tabs.auth")}
          </TabsTrigger>
          <TabsTrigger value="smtp">
            <Mail className="mr-1.5 size-4" />
            {t("tabs.smtp")}
          </TabsTrigger>
          <TabsTrigger value="webhook">
            <Webhook className="mr-1.5 size-4" />
            {t("tabs.webhook")}
          </TabsTrigger>
          <TabsTrigger value="projectDefaults">
            <FolderCog className="mr-1.5 size-4" />
            {t("tabs.projectDefaults")}
          </TabsTrigger>
          <TabsTrigger value="general">
            <SlidersHorizontal className="mr-1.5 size-4" />
            {t("tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="ship">
            <Ship className="mr-1.5 size-4" />
            {t("tabs.ship")}
          </TabsTrigger>
          <TabsTrigger value="backup">
            <DatabaseBackup className="mr-1.5 size-4" />
            {t("tabs.backup")}
          </TabsTrigger>
          <TabsTrigger value="storage">
            <HardDrive className="mr-1.5 size-4" />
            {t("tabs.storage")}
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="mr-1.5 size-4" />
            {t("tabs.about")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth">
          <AuthSettingsTab />
        </TabsContent>
        <TabsContent value="smtp">
          <SmtpSettingsTab />
        </TabsContent>
        <TabsContent value="webhook">
          <WebhookSettingsTab />
        </TabsContent>
        <TabsContent value="projectDefaults">
          <ProjectDefaultsTab />
        </TabsContent>
        <TabsContent value="general">
          <GeneralSettingsTab />
        </TabsContent>
        <TabsContent value="ship">
          <ShipSettingsTab />
        </TabsContent>
        <TabsContent value="backup">
          <BackupSettingsTab />
        </TabsContent>
        <TabsContent value="storage">
          <StorageSettingsTab />
        </TabsContent>
        <TabsContent value="about">
          <AboutSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
