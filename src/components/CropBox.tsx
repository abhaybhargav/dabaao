import { useEffect, useRef, useState } from "react";
import type { Crop } from "../lib/pipeline";
import { useT } from "../i18n";

/** Largest centred rectangle of the given aspect (w/h) inside the image. */
export function defaultCrop(w: number, h: number, aspect: number): Crop {
  let cw = w, ch = w / aspect;
  if (ch > h) { ch = h; cw = h * aspect; }
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

type Props = {
  bitmap: ImageBitmap;
  full: { w: number; h: number };
  aspect: number;
  value: Crop;
  onApply: (c: Crop) => void;
  onCancel: () => void;
};

/** Fixed-aspect crop: drag the frame to move it, use the slider to resize it. */
export function CropBox({ bitmap, full, aspect, value, onApply, onCancel }: Props) {
  const { t } = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [crop, setCrop] = useState<Crop>(value);
  const drag = useRef<{ px: number; py: number; c: Crop } | null>(null);
  const max = defaultCrop(full.w, full.h, aspect);
  const scale = crop.w / max.w;

  useEffect(() => {
    const c = canvas.current!;
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d")!;
    const k = bitmap.width / full.w;
    ctx.drawImage(bitmap, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    ctx.rect(crop.x * k, crop.y * k, crop.w * k, crop.h * k);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, c.width / 300);
    ctx.strokeRect(crop.x * k, crop.y * k, crop.w * k, crop.h * k);
  }, [bitmap, crop, full.w]);

  const clamp = (c: Crop): Crop => ({
    ...c,
    x: Math.max(0, Math.min(full.w - c.w, c.x)),
    y: Math.max(0, Math.min(full.h - c.h, c.y)),
  });

  const resize = (s: number) => {
    const w = max.w * s, h = max.h * s;
    const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    setCrop(clamp({ x: cx - w / 2, y: cy - h / 2, w, h }));
  };

  return (
    <div className="crop">
      <canvas
        ref={canvas}
        className="crop-canvas"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, c: crop };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const k = full.w / (e.target as HTMLCanvasElement).getBoundingClientRect().width;
          setCrop(clamp({ ...d.c, x: d.c.x + (e.clientX - d.px) * k, y: d.c.y + (e.clientY - d.py) * k }));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => resize(Math.max(0.15, Math.min(1, scale * (e.deltaY > 0 ? 1.05 : 0.95))))}
      />
      <input type="range" min="0.15" max="1" step="0.01" value={scale} onChange={(e) => resize(Number(e.target.value))} aria-label="Crop size" />
      <div className="row">
        <button className="btn primary" onClick={() => onApply(crop)}>{t("job.applyCrop")}</button>
        <button className="btn" onClick={onCancel}>{t("job.cancel")}</button>
      </div>
    </div>
  );
}
