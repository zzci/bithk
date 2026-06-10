// Aggregated schema. Module schemas live next to their owners.
// Allowed change here: a single `export *` line per module.
export * from "@/modules/account/auth/schema";
export * from "@/modules/account/groups/schema";
export * from "@/modules/account/users/schema";
export * from "@/modules/audit/schema";
export { contactCategories, contacts } from "@/modules/contact/schema";
export * from "@/modules/cron/schema";
export * from "@/modules/document/schema";
export * from "@/modules/drive/schema";
export * from "@/modules/file/schema";
export * from "@/modules/hr/schema";
export * from "@/modules/issue/schema";
export * from "@/modules/item/schema";
export * from "@/modules/policy/schema";
export * from "@/modules/procurement/schema";
export * from "@/modules/project/schema";
export * from "@/modules/settings/schema";
export * from "@/modules/share/schema";
export * from "@/modules/ship/schema";
export * from "@/modules/tag/schema";
