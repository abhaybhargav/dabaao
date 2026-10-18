import { useMemo } from "react";
import { CUSTOM_ID, PRESETS, portals, type Preset } from "../presets";
import { fmtBytes } from "../lib/format";
import { useT } from "../i18n";
import { REPORT_URL } from "../config";

type Props = {
  presetId: string;
  onPreset: (id: string) => void;
  preset: Preset;
  custom: Preset;
  onCustom: (p: Preset) => void;
};

export function PresetPicker({ presetId, onPreset, preset, custom, onCustom }: Props) {
  const { t, lang } = useT();
  const portal = presetId === CUSTOM_ID ? CUSTOM_ID : preset.portal;
  const slots = useMemo(() => PRESETS.filter((p) => p.portal === portal), [portal]);

  return (
    <section className="panel" aria-labelledby="step1">
      <h2 id="step1">{t("step.portal")}</h2>
      <div className="row">
        <label className="field">
          <span>{t("portal.label")}</span>
          <select
            value={portal}
            onChange={(e) => {
              const v = e.target.value;
              onPreset(v === CUSTOM_ID ? CUSTOM_ID : PRESETS.find((p) => p.portal === v)!.id);
            }}
          >
            {portals().map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value={CUSTOM_ID}>{t("custom.label")}</option>
          </select>
        </label>
        {portal !== CUSTOM_ID && (
          <label className="field">
            <span>{t("slot.label")}</span>
            <select value={presetId} onChange={(e) => onPreset(e.target.value)}>
              {slots.map((p) => (
                <option key={p.id} value={p.id}>{p.slot}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {presetId === CUSTOM_ID && <CustomForm value={custom} onChange={onCustom} />}

      <div className="rules">
        <h3>{t("rules.title")}</h3>
        <dl>
          <dt>{t("rules.output")}</dt>
          <dd>{preset.output === "match" ? t("rules.match") : preset.output.toUpperCase()}</dd>
          {preset.maxBytes && (<><dt>{t("rules.cap")}</dt><dd>{fmtBytes(preset.maxBytes)}</dd></>)}
          {preset.minBytes && (<><dt>{t("rules.min")}</dt><dd>{fmtBytes(preset.minBytes)}</dd></>)}
          {preset.maxBytesPerPage && (<><dt>{t("rules.perPage")}</dt><dd>{fmtBytes(preset.maxBytesPerPage)}</dd></>)}
          {preset.totalBytes && (<><dt>{t("rules.total")}</dt><dd>{fmtBytes(preset.totalBytes)}</dd></>)}
          {preset.maxFiles && (<><dt>{t("rules.maxFiles")}</dt><dd>{preset.maxFiles}</dd></>)}
          {preset.pixels && (<><dt>{t("rules.pixels")}</dt><dd>{preset.pixels.w} × {preset.pixels.h}{preset.note ? ` (${preset.note})` : ""}</dd></>)}
          {preset.dpi && (<><dt>{t("rules.dpi")}</dt><dd>{preset.dpi}</dd></>)}
          <dt>{t("rules.colour")}</dt>
          <dd>{t(`colour.${preset.colour}`)}</dd>
        </dl>
        {preset.pdfA && <p className="warn">{t("rules.pdfa")}</p>}
        {preset.confidence === "secondary" && <p className="warn">{t("rules.secondary")}</p>}
        {preset.id !== CUSTOM_ID && (
          <p className="meta">
            {t("rules.verified", { date: new Date(preset.verified).toLocaleDateString(lang === "en" ? "en-IN" : `${lang}-IN`, { day: "numeric", month: "short", year: "numeric" }) })}
            {" · "}
            <a href={preset.source} target="_blank" rel="noopener noreferrer">{t("rules.source")}</a>
            {" · "}
            <a href={REPORT_URL(preset.id)} target="_blank" rel="noopener noreferrer">{t("rules.report")}</a>
          </p>
        )}
      </div>
    </section>
  );
}

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
}

function CustomForm({ value, onChange }: { value: Preset; onChange: (p: Preset) => void }) {
  const { t } = useT();
  const set = (patch: Partial<Preset>) => onChange({ ...value, ...patch });
  const pixels = value.pixels;
  return (
    <div className="custom grid">
      <label className="field">
        <span>{t("custom.output")}</span>
        <select value={value.output} onChange={(e) => set({ output: e.target.value as Preset["output"] })}>
          <option value="match">{t("out.match")}</option>
          <option value="jpeg">{t("out.jpeg")}</option>
          <option value="pdf">{t("out.pdf")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("custom.maxKB")}</span>
        <input type="number" min="1" inputMode="numeric" defaultValue={value.maxBytes ? value.maxBytes / 1000 : ""}
          onChange={(e) => { const n = num(e.target.value); if (n) set({ maxBytes: Math.round(n * 1000) }); }} />
      </label>
      <label className="field">
        <span>{t("custom.minKB")}</span>
        <input type="number" min="0" inputMode="numeric" defaultValue={value.minBytes ? value.minBytes / 1024 : ""}
          onChange={(e) => { const n = num(e.target.value); set({ minBytes: n ? Math.round(n * 1024) : undefined }); }} />
      </label>
      <label className="field">
        <span>{t("custom.width")}</span>
        <input type="number" min="1" inputMode="numeric" defaultValue={pixels?.w ?? ""}
          onChange={(e) => { const w = num(e.target.value); set({ pixels: w && pixels?.h ? { w, h: pixels.h } : w ? { w, h: 0 } : undefined }); }} />
      </label>
      <label className="field">
        <span>{t("custom.height")}</span>
        <input type="number" min="1" inputMode="numeric" defaultValue={pixels?.h ?? ""}
          onChange={(e) => { const h = num(e.target.value); set({ pixels: h && pixels?.w ? { w: pixels.w, h } : h ? { w: 0, h } : undefined }); }} />
      </label>
      <label className="field">
        <span>{t("custom.longEdge")}</span>
        <input type="number" min="16" inputMode="numeric" defaultValue={value.maxLongEdge ?? ""}
          onChange={(e) => set({ maxLongEdge: num(e.target.value) })} />
      </label>
      <label className="field">
        <span>{t("custom.dpi")}</span>
        <input type="number" min="50" max="600" inputMode="numeric" defaultValue={value.dpi ?? ""}
          onChange={(e) => set({ dpi: num(e.target.value) })} />
      </label>
      <label className="field">
        <span>{t("rules.colour")}</span>
        <select value={value.colour} onChange={(e) => set({ colour: e.target.value as Preset["colour"] })}>
          <option value="colour">{t("colour.colour")}</option>
          <option value="grey">{t("colour.grey")}</option>
          <option value="bw">{t("colour.bw")}</option>
        </select>
      </label>
    </div>
  );
}

/** Custom presets only count fixed pixels when both sides are set. */
export function normaliseCustom(p: Preset): Preset {
  const pixels = p.pixels && p.pixels.w > 0 && p.pixels.h > 0 ? p.pixels : undefined;
  return { ...p, pixels };
}
