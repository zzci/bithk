import type { NavArea, NavItem } from "./types";
import { documentsNav } from "@/app/routes/_app/-documents.nav";
import { driveNav } from "@/app/routes/_app/-drive.nav";
import { hrNav } from "@/app/routes/_app/-hr.nav";
import { overviewNav } from "@/app/routes/_app/-overview.nav";
import { projectsNav } from "@/app/routes/_app/-projects.nav";
import { auditNav } from "@/app/routes/_app/admin/-audit.nav";
import { cronNav } from "@/app/routes/_app/admin/-cron.nav";
import { policiesNav } from "@/app/routes/_app/admin/-policies.nav";
import { settingsNav } from "@/app/routes/_app/admin/-settings.nav";
import { storageNav } from "@/app/routes/_app/admin/-storage.nav";
import { usersNav } from "@/app/routes/_app/admin/-users.nav";
import { contactsNav } from "@/app/routes/_app/contacts/-contacts.nav";
import { shipsNav } from "@/app/routes/_app/ships/-ships.nav";

const NAV_ITEMS: readonly NavItem[] = [
  overviewNav,
  documentsNav,
  driveNav,
  projectsNav,
  shipsNav,
  contactsNav,
  hrNav,
  usersNav,
  policiesNav,
  auditNav,
  cronNav,
  storageNav,
  settingsNav,
];

export function getNavItems(area: NavArea): NavItem[] {
  return NAV_ITEMS
    .filter(item => item.area === area)
    .toSorted((a, b) => a.order - b.order);
}
