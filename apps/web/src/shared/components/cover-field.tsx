// Shared cover-image upload/replace/remove control. Presentational only: the
// caller owns the mutations (and any success/error toast), passing resolved
// `pending`/`error` state plus `onPick`/`onRemove` handlers.

import { Trash2, Upload } from "lucide-react";
import { CoverImage } from "@/shared/components/cover-image";
import { FileUploadButton } from "@/shared/components/file";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";

// Structurally identical to cover-image's internal CoverKind (kept local so this
// component adds no export to the existing file). Migrate to a shared export if a
// second kind appears.
type CoverKind = "project";

interface CoverFieldLabels {
  readonly field: string;
  readonly upload: string;
  readonly replace: string;
  readonly remove: string;
}

interface CoverFieldProps {
  readonly kind: CoverKind;
  readonly src: string | null | undefined;
  readonly pending: boolean;
  /** Already-resolved error message, or null/undefined when there is none. */
  readonly error?: string | null;
  readonly onPick: (file: File) => void;
  readonly onRemove: () => void;
  readonly labels: CoverFieldLabels;
}

export function CoverField({ kind, src, pending, error, onPick, onRemove, labels }: CoverFieldProps) {
  return (
    <div className="space-y-2">
      <Label>{labels.field}</Label>
      {error && <ErrorBanner message={error} />}
      <div className="flex items-center gap-4">
        <CoverImage src={src} kind={kind} className="h-24 w-40 shrink-0 rounded-lg border" />
        <div className="flex flex-col gap-2">
          <FileUploadButton
            accept="image"
            disabled={pending}
            onSelect={files => files[0] && onPick(files[0])}
          >
            <Button type="button" variant="outline" disabled={pending}>
              <Upload aria-hidden="true" />
              {src ? labels.replace : labels.upload}
            </Button>
          </FileUploadButton>
          {src && (
            <Button type="button" variant="outline" disabled={pending} onClick={onRemove}>
              <Trash2 className="text-destructive" aria-hidden="true" />
              {labels.remove}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
