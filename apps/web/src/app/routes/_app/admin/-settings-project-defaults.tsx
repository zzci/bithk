// Body of the admin "Project Defaults" settings tab. Composes three admin-only
// sections: the global tag vocabulary, the project default fields (status +
// cover), and the global procurement category template set. Each section owns
// its own data hooks, mutations and toasts.

import { ProjectDefaultFieldsSection } from "./-settings-default-fields";
import { GlobalCategoriesSection } from "./-settings-global-categories";
import { TagAdminSection } from "./-settings-tag-admin";

export function ProjectDefaultsTab() {
  return (
    <div className="space-y-8 pt-4">
      <ProjectDefaultFieldsSection />
      <TagAdminSection />
      <GlobalCategoriesSection />
    </div>
  );
}
