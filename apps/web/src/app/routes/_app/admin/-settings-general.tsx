// Body of the admin "General" settings tab. Composes the workspace-wide
// categories that are not project-scoped: the currency list and the contact
// categories vocabulary (moved here from the former standalone Contact tab).

import { ContactCategoriesSection } from "./-settings-contact";
import { CurrencySettingsSection } from "./-settings-currency";

export function GeneralSettingsTab() {
  return (
    <div className="space-y-8 pt-4">
      <CurrencySettingsSection />
      <ContactCategoriesSection />
    </div>
  );
}
