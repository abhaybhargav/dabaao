import { useRef, useState } from "react";
import { useT } from "../i18n";
import type { Preset } from "../presets";

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
      <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 16V7.8l-2.6 2.6L7 9l5-5 5 5-1.4 1.4L13 7.8V16zm-5 4q-.8 0-1.4-.6T4 18v-3h2v3h12v-3h2v3q0 .8-.6 1.4T18 20z"/></svg>
      <strong>{t("drop.title")}</strong>
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
