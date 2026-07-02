// Static label-key maps for the HR colleague enums. Exhaustive `Record<Enum,
// string>` maps (instead of dynamic `t(`...${v}`)` template keys) keep every
// locale key visible to the i18n static analyzer (check-i18n), so unused-key
// detection stays trustworthy.

import type { HrEmploymentType, HrGender } from "@/shared/lib/api/hr";

export const HR_GENDER_LABEL_KEY: Record<HrGender, string> = {
  male: "hr:colleagues.genderOption.male",
  female: "hr:colleagues.genderOption.female",
  other: "hr:colleagues.genderOption.other",
  undisclosed: "hr:colleagues.genderOption.undisclosed",
};

export const HR_EMPLOYMENT_LABEL_KEY: Record<HrEmploymentType, string> = {
  full_time: "hr:colleagues.employmentOption.full_time",
  part_time: "hr:colleagues.employmentOption.part_time",
  contract: "hr:colleagues.employmentOption.contract",
  intern: "hr:colleagues.employmentOption.intern",
};
