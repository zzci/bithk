import { FilePlus, FolderPlus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

interface FileToolbarProps {
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onUpload: () => void;
  readonly onNewFolder: () => void;
  readonly onNewTextFile: () => void;
}

export function FileToolbar({ canManage, busy, onUpload, onNewFolder, onNewTextFile }: FileToolbarProps) {
  const { t } = useTranslation("drive");

  if (!canManage)
    return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={onUpload}>
        <Upload />
        {t("browser.upload")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onNewFolder}>
        <FolderPlus />
        {t("browser.newFolder")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onNewTextFile}>
        <FilePlus />
        {t("browser.newTextFile")}
      </Button>
    </div>
  );
}
