// Settings-API write helpers for the admin settings tabs. The generic building
// blocks (`useSettingsByPrefix`, `SettingsCard`, the `SettingRow` shape) now live
// in the shared layer; only these thin `/settings/:key` mutations stay here, used
// directly by the SMTP toggle and webhook CRUD outside the card.
import { http } from "@/shared/lib/http";

export async function saveSetting(key: string, value: string) {
  await http(`/settings/${key}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export async function deleteSetting(key: string) {
  await http(`/settings/${key}`, { method: "DELETE" });
}
