import { useRef, useState } from "react";
import { useT } from "../i18n";
import type { Preset } from "../presets";
import { Squisher } from "./Squisher";

const MIME: Record<string, string> = {
  jpeg: "image/jpeg,.jpg,.jpeg",
  png: "image/png,.png",
  webp: "image/webp,.webp",
  heic: "image/heic,image/heif,.heic,.heif",
  pdf: "application/pdf,.pdf",
};

export function DropZone({ preset, onFiles }: { preset: Preset; onFiles: (f: File[]) => void }) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop${over ? " over" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
      }}
    >
      <Squisher mood="rest" size={120} />
      <strong>{over ? t("drop.over") : t("drop.title")}</strong>
      <span className="meta">{t("drop.accepts", { list: preset.accepts.map((a) => a.toUpperCase()).join(", ") })}</span>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={preset.accepts.map((a) => MIME[a]).join(",")}
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
