import type { ZoomModule, ZoomRef } from "./file-preview-types";

export function ImagePreview({
  module: zoom,
  url,
  alt,
  rotation,
  transformRef,
}: {
  readonly module: ZoomModule;
  readonly url: string;
  readonly alt: string;
  readonly rotation: number;
  readonly transformRef: React.RefObject<ZoomRef | null>;
}) {
  const { TransformWrapper, TransformComponent } = zoom;
  return (
    <TransformWrapper
      ref={transformRef}
      initialScale={1}
      minScale={0.5}
      maxScale={6}
      centerOnInit
      limitToBounds={false}
      wheel={{ disabled: true }}
      pinch={{ disabled: true }}
      panning={{ disabled: false, velocityDisabled: true, excluded: ["button"] }}
    >
      <div className="h-full overflow-hidden rounded-md bg-muted/30">
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          <div className="flex h-full w-full touch-none items-center justify-center p-4">
            <img
              src={url}
              alt={alt}
              draggable={false}
              className="max-h-full max-w-full cursor-grab object-contain select-none active:cursor-grabbing"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          </div>
        </TransformComponent>
      </div>
    </TransformWrapper>
  );
}
