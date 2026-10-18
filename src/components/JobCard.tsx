import { useEffect, useRef } from "react";
import type { Job } from "../jobs";
import type { Part, Variant } from "../lib/pipeline";
import type { Problem } from "../lib/check";
import { fmtBytes } from "../lib/format";
import { download } from "../lib/urls";
import { useT, type T } from "../i18n";
import { CropBox } from "./CropBox";

type Props = {
  job: Job;
  aspect?: number;
  inkOption: boolean;
  onRemove: () => void;
  onChoose: (i: number) => void;
  onCrop: (open: boolean, crop?: Job["crop"]) => void;
  onInk: (on: boolean) => void;
  onRerender: () => void;
  combined?: boolean;
};

export function JobCard({ job, aspect, inkOption, onRemove, onChoose, onCrop, onInk, onRerender, combined }: Props) {
  const { t } = useT();
  const busy = job.status === "decoding" || job.status === "working";
  const isImage = job.format && job.format !== "pdf";
  const canCrop = !!(aspect && isImage && job.bitmap && job.dims && !combined);
  const showRerender =
    job.status === "done" && job.format === "pdf" && job.variants.length === 1 && job.variants[0].method === "lossless";

  return (
    <article className="card" aria-busy={busy}>
      <header className="card-head">
        <div className="card-title">
          {job.bitmap && <Thumb bitmap={job.bitmap} />}
          <div>
            <strong className="name">{job.name}</strong>
            <span className="meta">
              {fmtBytes(job.size)}
              {job.format ? ` · ${job.format.toUpperCase()}` : ""}
              {job.dims ? ` · ${job.dims.w} × ${job.dims.h}` : ""}
              {job.pages ? ` · ${job.pages} pages` : ""}
            </span>
          </div>
        </div>
        <button className="btn ghost" onClick={onRemove} aria-label={t("job.remove")}>✕</button>
      </header>

      {busy && <Progress job={job} t={t} />}
      {job.status === "error" && <p className="fail">{job.error}</p>}
      {job.warnings.map((w, i) => (
        <p key={i} className="warn">{t(w.key, w.vars)}</p>
      ))}

      {(canCrop || (inkOption && isImage)) && !job.cropping && (
        <div className="row tools">
          {canCrop && <button className="btn" disabled={busy} onClick={() => onCrop(true)}>{t("job.adjustCrop")}</button>}
          {inkOption && isImage && (
            <label className="check">
              <input type="checkbox" checked={job.ink} disabled={busy} onChange={(e) => onInk(e.target.checked)} /> {t("job.ink")}
            </label>
          )}
        </div>
      )}
      {job.cropping && canCrop && (
        <CropBox
          bitmap={job.bitmap!}
          full={job.dims!}
          aspect={aspect!}
          value={job.crop!}
          onApply={(c) => onCrop(false, c)}
          onCancel={() => onCrop(false)}
        />
      )}

      {job.variants.length > 0 && (
        <div className={`variants n${job.variants.length}`}>
          {job.variants.map((v, i) => (
            <VariantView key={i} v={v} chosen={i === job.chosen} multi={job.variants.length > 1} onChoose={() => onChoose(i)} />
          ))}
        </div>
      )}
      {showRerender && (
        <button className="btn" onClick={onRerender}>{t("job.tryRerender")}</button>
      )}
    </article>
  );
}

function Progress({ job, t }: { job: Job; t: T }) {
  const p = job.progress;
  const label =
    job.status === "decoding" ? t("job.decoding")
    : job.phase === "optimising" ? t("job.optimising")
    : p ? t("job.page", { done: Math.min(p.done + 1, p.total), total: p.total })
    : t("job.working");
  return (
    <div className="progress" role="status">
      <span>{label}</span>
      <progress value={p ? p.done : undefined} max={p ? p.total : undefined} />
    </div>
  );
}

function Thumb({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const s = 96 / Math.max(bitmap.width, bitmap.height);
    c.width = Math.round(bitmap.width * s);
    c.height = Math.round(bitmap.height * s);
    c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  }, [bitmap]);
  return <canvas ref={ref} className="thumb" />;
}

function VariantView({ v, chosen, multi, onChoose }: { v: Variant; chosen: boolean; multi: boolean; onChoose: () => void }) {
  const { t } = useT();
  const pass = v.parts.every((p) => p.check.pass);
  const total = v.parts.reduce((s, p) => s + p.bytes.length, 0);
  const title = v.method === "lossless" ? t("job.lossless") : v.method === "rerender" ? t("job.rerender") : null;
  return (
    <section className={`variant${chosen && multi ? " chosen" : ""}`}>
      {title && (
        <h4>
          {title} <span className="meta">{fmtBytes(total)}</span>
        </h4>
      )}
      {v.parts[0]?.previewUrl && <img className="preview" src={v.parts[0].previewUrl} alt="" />}
      <p className={pass ? "pass" : "fail"}>{pass ? "✓ " + t("job.pass") : "✕ " + t("job.fail")}</p>
      {v.parts.map((p) => (
        <PartRow key={p.name} p={p} />
      ))}
      {v.parts[0]?.kind === "pdf" && <p className="meta">{v.textSelectable ? t("job.textSelectable") : t("job.noText")}</p>}
      <ul className="notes">
        {v.notes.map((n, i) => (
          <li key={i}>{t(n.key, fmtVars(n.vars))}</li>
        ))}
      </ul>
      {v.parts.length > 1 && pass && (
        <button className="btn primary" onClick={() => v.parts.forEach((p) => download(p.bytes as BlobPart, p.name, mime(p)))}>
          {t("job.downloadAll")}
        </button>
      )}
      {multi && (
        <button className={`btn${chosen ? " selected" : ""}`} onClick={onChoose} aria-pressed={chosen} disabled={!pass && !chosen}>
          {chosen ? t("job.chosen") : t("job.use")}
        </button>
      )}
    </section>
  );
}

function PartRow({ p }: { p: Part }) {
  const { t } = useT();
  return (
    <div className="part">
      <div>
        <code className="summary">{p.check.summary}</code>
        {[...p.check.problems, ...p.check.warnings].map((pr, i) => (
          <div key={i} className={p.check.problems.includes(pr) ? "fail small" : "meta small"}>{problemText(t, pr)}</div>
        ))}
      </div>
      <button className="btn primary" disabled={!p.check.pass} onClick={() => download(p.bytes as BlobPart, p.name, mime(p))}>
        {t("job.download")} {p.name.match(/_\d+\.pdf$/) ? p.name.match(/_\d+/)![0] : ""}
      </button>
    </div>
  );
}

function mime(p: Part) {
  return p.kind === "pdf" ? "application/pdf" : "image/jpeg";
}

function fmtVars(vars?: Record<string, string | number>) {
  if (!vars) return vars;
  const out: Record<string, string | number> = { ...vars };
  for (const k of ["from", "to"]) if (typeof out[k] === "number") out[k] = fmtBytes(out[k] as number);
  return out;
}

export function problemText(t: T, p: Problem): string {
  const v: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(p)) {
    if (k === "code") continue;
    v[k] = typeof val === "number" && ["bytes", "max", "min"].includes(k) ? fmtBytes(val) : (val as string | number);
  }
  return t(`prob.${p.code}`, v);
}
