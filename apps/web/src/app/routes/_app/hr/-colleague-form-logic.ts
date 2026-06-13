// Form state + mapping helpers for the colleague drawer panel. Kept in a
// non-component module so the panel file can stay component-only (react-refresh)
// and the list route can reuse the form→input mapping.

import type {
  HrColleagueProfileInput,
  HrColleagueRow,
  HrColleagueStatus,
  HrEmergencyContact,
  HrEmploymentType,
  HrGender,
  HrPaymentField,
} from "@/shared/lib/api/hr";

export interface AssignableUserOption {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly isVirtual: boolean;
}

// Local form mirror: every scalar is a string ("" = empty/unset), the two JSON
// columns are arrays of plain rows. Enums carry "" when unset.
export interface ColleagueForm {
  userId: string;
  code: string;
  title: string;
  department: string;
  notes: string;
  birthday: string;
  hireDate: string;
  probationEndDate: string;
  contractEndDate: string;
  gender: "" | HrGender;
  employmentType: "" | HrEmploymentType;
  nationality: string;
  personalPhone: string;
  personalEmail: string;
  address: string;
  workLocation: string;
  status: HrColleagueStatus;
  paymentInfo: HrPaymentField[];
  emergencyContacts: HrEmergencyContact[];
}

export const EMPTY_EMERGENCY_CONTACT: HrEmergencyContact = {
  name: "",
  relation: "",
  phone: "",
  email: "",
  address: "",
};

export const EMPTY_COLLEAGUE_FORM: ColleagueForm = {
  userId: "",
  code: "",
  title: "",
  department: "",
  notes: "",
  birthday: "",
  hireDate: "",
  probationEndDate: "",
  contractEndDate: "",
  gender: "",
  employmentType: "",
  nationality: "",
  personalPhone: "",
  personalEmail: "",
  address: "",
  workLocation: "",
  status: "active",
  paymentInfo: [],
  emergencyContacts: [],
};

export function colleagueFormFromRow(row: HrColleagueRow): ColleagueForm {
  return {
    userId: row.userId,
    code: row.code ?? "",
    title: row.title ?? "",
    department: row.department ?? "",
    notes: row.notes ?? "",
    birthday: row.birthday ?? "",
    hireDate: row.hireDate ?? "",
    probationEndDate: row.probationEndDate ?? "",
    contractEndDate: row.contractEndDate ?? "",
    gender: row.gender ?? "",
    employmentType: row.employmentType ?? "",
    nationality: row.nationality ?? "",
    personalPhone: row.personalPhone ?? "",
    personalEmail: row.personalEmail ?? "",
    address: row.address ?? "",
    workLocation: row.workLocation ?? "",
    status: row.status,
    paymentInfo: row.paymentInfo.map(p => ({ ...p })),
    emergencyContacts: row.emergencyContacts.map(e => ({ ...e })),
  };
}

// Map the form to the API profile input: trim scalars, normalise unset enums to
// null, and drop fully-empty repeater rows.
export function colleagueFormToProfileInput(form: ColleagueForm): HrColleagueProfileInput {
  return {
    code: form.code.trim(),
    title: form.title.trim(),
    department: form.department.trim(),
    notes: form.notes.trim(),
    birthday: form.birthday,
    hireDate: form.hireDate,
    probationEndDate: form.probationEndDate,
    contractEndDate: form.contractEndDate,
    gender: form.gender === "" ? null : form.gender,
    employmentType: form.employmentType === "" ? null : form.employmentType,
    nationality: form.nationality.trim(),
    personalPhone: form.personalPhone.trim(),
    personalEmail: form.personalEmail.trim(),
    address: form.address.trim(),
    workLocation: form.workLocation.trim(),
    paymentInfo: form.paymentInfo
      .map(p => ({ label: p.label.trim(), value: p.value.trim() }))
      .filter(p => p.label || p.value),
    emergencyContacts: form.emergencyContacts
      .map(e => ({
        name: e.name.trim(),
        relation: e.relation.trim(),
        phone: e.phone.trim(),
        email: e.email.trim(),
        address: e.address.trim(),
      }))
      .filter(e => e.name || e.relation || e.phone || e.email || e.address),
  };
}
