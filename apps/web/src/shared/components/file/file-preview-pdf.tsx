import type { WheelEvent as ReactWheelEvent } from "react";
import type { PdfModule } from "./file-preview-types";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/button";

export function PdfPreview({
  module: pdf,
  fileUrl,
  width,
  zoom,
  sidebarOpen,
  scrollRef,
  pageRefs,
  onWheel,
  onLoadSuccess,
  errorLabel,
}: {
  readonly module: PdfModule;
  readonly fileUrl: string;
  readonly width: number;
  readonly zoom: number;
  readonly sidebarOpen: boolean;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  readonly pageRefs: React.RefObject<Array<HTMLDivElement | null>>;
  readonly onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  readonly onLoadSuccess: (numPages: number) => void;
  readonly errorLabel: string;
}) {
  const { Document, Page } = pdf;
  const [numPages, setNumPages] = useState<number | null>(null);
  const pageNumbers = useMemo(
    () => Array.from({ length: numPages ?? 0 }, (_, index) => index + 1),
    [numPages],
  );

  const scrollToPage = useCallback((page: number) => {
    pageRefs.current[page - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageRefs]);

  return (
    <Document
      file={fileUrl}
      loading={null}
      error={<p className="p-4 text-sm text-destructive">{errorLabel}</p>}
      onLoadSuccess={({ numPages: n }) => {
        setNumPages(n);
        onLoadSuccess(n);
      }}
      className="h-full min-h-0"
    >
      <div className="flex h-full min-h-0 overflow-hidden rounded-md bg-muted/30">
        {sidebarOpen && (
          <aside className="w-36 shrink-0 overflow-auto overscroll-contain bg-background p-2">
            <div className="space-y-2">
              {pageNumbers.map(page => (
                <Button
                  key={page}
                  type="button"
                  variant="ghost"
                  className="flex h-auto w-full flex-col items-center gap-1 rounded-md bg-muted/30 p-1 text-xs font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => scrollToPage(page)}
                >
                  <Page
                    pageNumber={page}
                    width={96}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                  <span>{page}</span>
                </Button>
              ))}
            </div>
          </aside>
        )}

        <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain" onWheel={onWheel}>
          <div className="flex min-h-full w-full flex-col items-center gap-4 px-6 py-4 pb-10">
            {pageNumbers.map(page => (
              <div
                key={page}
                ref={(node) => {
                  pageRefs.current[page - 1] = node;
                }}
                className="scroll-mt-4"
              >
                <Page pageNumber={page} width={Math.round(width * zoom)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Document>
  );
}
