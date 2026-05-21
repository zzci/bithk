// Drive file versioning over the live API: upload v1, push v2, list,
// switch the current pointer back to v1, and download the current bytes.
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";

interface Entry { id: string; type: string; file: { size: number } | null }
interface Version { id: string; versionNo: number; size: number; isCurrent: boolean }

function uploadForm(name: string, body: string): FormData {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type: "text/plain" }));
  return fd;
}

describe("/api/drive/entries/:id/versions", () => {
  it("v1 upload → v2 upload → list → switch current → download", async () => {
    const user = await getClient("user@example.com", "admin");

    // v1 via file upload.
    const created = await user.raw("/api/drive/files/upload", {
      method: "POST",
      formData: uploadForm(`versioned-${Date.now()}.txt`, "version one"),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json() as { data: Entry }).data;
    const entryId = entry.id;

    // List shows a single current v1.
    const v1List = await user.json<{ data: Version[] }>(`/api/drive/entries/${entryId}/versions`);
    expect(v1List.data).toHaveLength(1);
    expect(v1List.data[0]!.versionNo).toBe(1);
    expect(v1List.data[0]!.isCurrent).toBe(true);

    // Push v2.
    const v2Res = await user.raw(`/api/drive/entries/${entryId}/versions`, {
      method: "POST",
      formData: uploadForm("v2.txt", "version two is longer"),
    });
    expect(v2Res.status).toBe(201);
    const afterV2 = (await v2Res.json() as { data: Version[] }).data;
    expect(afterV2.map(v => v.versionNo)).toEqual([2, 1]);
    expect(afterV2[0]!.isCurrent).toBe(true);

    // The current download is now v2.
    const dlV2 = await user.raw(`/api/drive/entries/${entryId}/content`);
    expect(await dlV2.text()).toBe("version two is longer");

    // Switch the current pointer back to v1.
    const v1 = afterV2.find(v => v.versionNo === 1)!;
    const switched = await user.json<{ data: Version[] }>(`/api/drive/entries/${entryId}/versions/${v1.id}/current`, {
      method: "POST",
    });
    expect(switched.data.find(v => v.isCurrent)!.versionNo).toBe(1);

    // The current download is v1 again.
    const dlV1 = await user.raw(`/api/drive/entries/${entryId}/content`);
    expect(await dlV1.text()).toBe("version one");

    // Cleanup.
    await user.raw(`/api/drive/entries/${entryId}/permanent`, { method: "DELETE" });
  });
});
