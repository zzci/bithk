/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute } from "@tanstack/react-router";
import { Contact, FolderCog, Mail, Shield, Ship, Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { AuthSettingsTab } from "./-settings-auth";
import { ContactSettingsTab } from "./-settings-contact";
import { ProjectDefaultsTab } from "./-settings-project-defaults";
import { ShipSettingsTab } from "./-settings-ship";
import { SmtpSettingsTab } from "./-settings-smtp";
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
          <TabsTrigger value="contact">
            <Contact className="mr-1.5 size-4" />
            {t("tabs.contact")}
          </TabsTrigger>
          <TabsTrigger value="ship">
            <Ship className="mr-1.5 size-4" />
            {t("tabs.ship")}
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
        <TabsContent value="contact">
          <ContactSettingsTab />
        </TabsContent>
        <TabsContent value="ship">
          <ShipSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
