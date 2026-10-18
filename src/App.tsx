import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CUSTOM_ID, PRESETS, PRESETS_VERSION, defaultCustom, outputFor, type Preset } from "./presets";
import { I18n, LANGS, makeT, type Lang } from "./i18n";
import { PresetPicker, normaliseCustom } from "./components/PresetPicker";
import { DropZone } from "./components/DropZone";
import { JobCard } from "./components/JobCard";
import { Privacy } from "./components/Privacy";
import { defaultCrop } from "./components/CropBox";
import { newId, type Job } from "./jobs";
import { engine, resetEngine } from "./lib/engine";
import { sniffFile } from "./lib/sniff";
import { baseName, fmtBytes, isMobile } from "./lib/format";
import { download, revoke, revokeAll } from "./lib/urls";
import { imageToJpeg, imagesToPdf, pdfLossless, pdfPageCount, pdfRerender, PdfError, variantPasses, type Variant } from "./lib/pipeline";
import { APP_NAME, SOURCE_URL } from "./config";
import { Squisher, Wordmark } from "./components/Squisher";

// Per-viewer conveniences only. Files are never written to storage.
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

const COMBINED = "combined";
const pdfBytes = new Map<string, Uint8Array>();

function initialLang(): Lang {
  const saved = store.get<Lang | null>("lang", null);
  if (saved) return saved;
  const nav = navigator.language.slice(0, 2);
  return nav === "hi" || nav === "kn" ? nav : "en";
}

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [view, setView] = useState(location.hash === "#/privacy" ? "privacy" : "tool");
  const [presetId, setPresetId] = useState<string>(() => store.get("preset", PRESETS[0].id));
  const [custom, setCustom] = useState<Preset>(() => ({ ...defaultCustom(), ...store.get<Partial<Preset>>("custom", {}) }));
  const [combine, setCombine] = useState(true);
  const [forceRerender, setForceRerender] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [combined, setCombined] = useState<Job | null>(null);

  const preset: Preset = useMemo(
    () => (presetId === CUSTOM_ID ? normaliseCustom(custom) : PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]),
    [presetId, custom],
  );

  // Refs give async job runners the latest state without re-subscribing.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const optsRef = useRef({ combine, forceRerender });
  optsRef.current = { combine, forceRerender };
  const tokens = useRef(new Map<string, number>());
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => store.set("lang", lang), [lang]);
  useEffect(() => store.set("preset", presetId), [presetId]);
  useEffect(() => store.set("custom", { ...custom, id: CUSTOM_ID }), [custom]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    const onHash = () => setView(location.hash === "#/privacy" ? "privacy" : "tool");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const patch = useCallback((id: string, p: Partial<Job> | ((j: Job) => Partial<Job>)) => {
    if (id === COMBINED) {
      setCombined((c) => (c ? { ...c, ...(typeof p === "function" ? p(c) : p) } : c));
      return;
    }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...(typeof p === "function" ? p(j) : p) } : j)));
  }, []);

  const dropVariants = (vs: Variant[]) => vs.forEach((v) => v.parts.forEach((p) => (revoke(p.url), revoke(p.previewUrl))));

  const usesCombined = (p: Preset) => optsRef.current.combine && p.output === "pdf";

  // ---------- runners ----------

  const runCombined = useCallback(async () => {
    const p = presetRef.current;
    const imgs = jobsRef.current.filter((j) => j.decoded && j.format !== "pdf" && j.status !== "error");
    const token = (tokens.current.get(COMBINED) ?? 0) + 1;
    tokens.current.set(COMBINED, token);
    if (!usesCombined(p) || imgs.length < 2) {
      setCombined((c) => (c && dropVariants(c.variants), null));
      return;
    }
    setCombined((c) => {
      if (c) dropVariants(c.variants);
      return {
        id: COMBINED, name: `${imgs.length} images → PDF`, base: "combined", size: imgs.reduce((s, j) => s + j.size, 0),
        format: null, status: "working", ink: false, variants: [], chosen: 0, warnings: [],
      };
    });
    try {
      const v = await imagesToPdf(imgs.map((j) => ({ id: j.id, crop: j.crop })), p, `${baseName(imgs[0].name)}_combined`, p.colour);
      if (tokens.current.get(COMBINED) !== token) return dropVariants([v]);
      patch(COMBINED, { status: "done", variants: [v], chosen: 0, pages: imgs.length });
    } catch (e) {
      if (tokens.current.get(COMBINED) === token) patch(COMBINED, { status: "error", error: t("job.error", { msg: String((e as Error)?.message ?? e) }) });
    }
  }, [patch, t]);

  const run = useCallback(
    async (id: string) => {
      const token = (tokens.current.get(id) ?? 0) + 1;
      tokens.current.set(id, token);
      const stale = () => tokens.current.get(id) !== token;
      const job = jobsRef.current.find((j) => j.id === id);
      if (!job?.file) return;
      const p = presetRef.current;
      const set = (x: Partial<Job>) => !stale() && patch(id, x);
      setJobs((js) => js.map((j) => (j.id === id ? (dropVariants(j.variants), { ...j, variants: [], warnings: [], error: undefined, progress: undefined }) : j)));

      try {
        const format = job.format ?? (await sniffFile(job.file));
        if (!format) return set({ status: "error", error: t("job.unknownType"), format });
        if (!p.accepts.includes(format)) return set({ status: "error", error: t("job.unsupported"), format });
        set({ format });

        if (format !== "pdf") {
          let { dims, bitmap, decoded, crop } = job;
          if (!decoded) {
            set({ status: "decoding" });
            const d = await engine().decode(id, job.file, format);
            dims = { w: d.width, h: d.height };
            bitmap = d.preview;
            decoded = true;
            if (stale()) return;
            set({ dims, bitmap, decoded });
          }
          if (p.pixels) {
            const aspect = p.pixels.w / p.pixels.h;
            if (!crop || Math.abs(crop.w / crop.h - aspect) > 0.01) crop = defaultCrop(dims!.w, dims!.h, aspect);
          } else crop = undefined;
          set({ crop });
          const colour = job.ink ? "bw" : p.colour;
          const out = outputFor(p, format);
          if (out === "pdf" && usesCombined(p) && jobsRef.current.filter((j) => j.format !== "pdf").length > 1) {
            set({ status: "done" });
            queue.current = queue.current.then(runCombined);
            return;
          }
          set({ status: "working" });
          const v = out === "jpeg"
            ? await imageToJpeg(id, p, job.base, { crop, colour })
            : await imagesToPdf([{ id, crop }], p, job.base, colour);
          if (stale()) return dropVariants([v]);
          set({ status: "done", variants: [v], chosen: 0 });
          if (usesCombined(p)) queue.current = queue.current.then(runCombined);
          return;
        }

        // PDF
        let bytes = pdfBytes.get(id);
        if (!bytes) {
          bytes = new Uint8Array(await job.file.arrayBuffer());
          pdfBytes.set(id, bytes);
        }
        set({ status: "working", phase: "optimising" });
        const pages = await pdfPageCount(bytes);
        const warnings = pages > 50 && isMobile() ? [{ key: "job.bigScan", vars: { n: pages } }] : [];
        set({ pages, warnings });

        const variants: Variant[] = [];
        const force = job.forceRerender || optsRef.current.forceRerender;
        if (!force || job.forceRerender) {
          try {
            variants.push(await pdfLossless(bytes, p, job.base));
          } catch (e) {
            if (e instanceof PdfError && e.code === "password") throw e;
            console.warn("[lossless] falling back to re-render:", e);
            // qpdf couldn't read it; PDF.js is more forgiving, so fall through to re-render.
          }
        }
        if (stale()) return dropVariants(variants);
        if (force || !variants.length || !variantPasses(variants[0])) {
          set({ phase: "rendering", progress: { done: 0, total: pages } });
          const colour = job.ink ? "bw" : p.colour;
          const v = await pdfRerender(bytes, p, job.base, colour, (done, total) => set({ progress: { done, total } }));
          if (stale()) return dropVariants([...variants, v]);
          variants.push(v);
        }
        const firstPass = variants.findIndex(variantPasses);
        set({ status: "done", phase: undefined, progress: undefined, variants, chosen: Math.max(0, firstPass) });
      } catch (e) {
        if (stale()) return;
        const msg = e instanceof PdfError ? t(`err.${e.code}`) : t("job.error", { msg: String((e as Error)?.message ?? e) });
        set({ status: "error", error: msg, phase: undefined, progress: undefined });
      }
    },
    [patch, t, runCombined],
  );

  const enqueue = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        patch(id, { status: "queued" });
        queue.current = queue.current.then(async () => { await run(id); }).catch(() => {});
      }
    },
    [run, patch],
  );

  // Re-fit everything when the target slot or global options change.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    enqueue(jobsRef.current.map((j) => j.id));
    queue.current = queue.current.then(runCombined);
  }, [preset, combine, forceRerender]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- actions ----------

  const addFiles = (files: File[]) => {
    const added: Job[] = files.map((f) => ({
      id: newId(), file: f, name: f.name, base: baseName(f.name), size: f.size, format: null,
      status: "queued", ink: false, variants: [], chosen: 0, warnings: [],
    }));
    jobsRef.current = [...jobsRef.current, ...added];
    setJobs(jobsRef.current);
    enqueue(added.map((j) => j.id));
  };

  const removeJob = (id: string) => {
    tokens.current.set(id, (tokens.current.get(id) ?? 0) + 1);
    const j = jobsRef.current.find((x) => x.id === id);
    if (j) {
      dropVariants(j.variants);
      j.bitmap?.close();
    }
    pdfBytes.delete(id);
    engine().release(id);
    jobsRef.current = jobsRef.current.filter((x) => x.id !== id);
    setJobs(jobsRef.current);
    queue.current = queue.current.then(runCombined);
  };

  const clearAll = () => {
    for (const k of tokens.current.keys()) tokens.current.set(k, (tokens.current.get(k) ?? 0) + 1);
    jobsRef.current.forEach((j) => j.bitmap?.close());
    pdfBytes.clear();
    revokeAll();
    resetEngine(); // terminating the worker frees every buffer it held
    queue.current = Promise.resolve();
    jobsRef.current = [];
    setJobs([]);
    setCombined(null);
  };

  const outputs = useMemo(() => {
    const list: { name: string; data: Uint8Array }[] = [];
    const src = [...(combined ? [combined] : []), ...jobs];
    for (const j of src) {
      const v = j.variants[j.chosen];
      if (j.status === "done" && v && variantPasses(v)) for (const p of v.parts) list.push({ name: p.name, data: p.bytes });
    }
    const seen = new Map<string, number>();
    return list.map((o) => {
      const n = seen.get(o.name) ?? 0;
      seen.set(o.name, n + 1);
      return n ? { ...o, name: o.name.replace(/(\.[^.]+)$/, `-${n + 1}$1`) } : o;
    });
  }, [jobs, combined]);

  const totalOut = outputs.reduce((s, o) => s + o.data.length, 0);

  const zipAll = async () => {
    const zip = await engine().zip(outputs.map((o) => ({ name: o.name, data: o.data.slice() })));
    download(zip as BlobPart, `${APP_NAME.toLowerCase()}-${preset.id}.zip`, "application/zip");
  };

  const imageCount = jobs.filter((j) => j.format && j.format !== "pdf").length;
  const busy = jobs.some((j) => j.status !== "done" && j.status !== "error") || combined?.status === "working";

  return (
    <I18n.Provider value={{ t, lang }}>
      <header className="top">
        <a className="brand" href="#/" aria-label={APP_NAME}>
          <Squisher mood="squished" size={64} />
          <Wordmark />
        </a>
        <nav>
          <a href={view === "privacy" ? "#/" : "#/privacy"}>{view === "privacy" ? t("nav.tool") : t("nav.privacy")}</a>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </nav>
      </header>

      <main>
        {view === "privacy" ? (
          <Privacy />
        ) : (
          <>
            <div className="hero">
              <h1>
                {t("hero.before")}<em>{t("hero.word")}</em>
              </h1>
              <p>{t("app.tagline")}</p>
            </div>
            <PresetPicker presetId={presetId} onPreset={setPresetId} preset={preset} custom={custom} onCustom={setCustom} />

            <section className="panel" aria-labelledby="step2">
              <h2 id="step2"><span className="step pink">2</span>{t("step.files")}</h2>
              <DropZone preset={preset} onFiles={addFiles} />
              <div className="options">
                {preset.output === "pdf" && (
                  <label className="check">
                    <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} /> {t("drop.combine")}
                  </label>
                )}
                {preset.accepts.includes("pdf") && (
                  <label className="check">
                    <input type="checkbox" checked={forceRerender} onChange={(e) => setForceRerender(e.target.checked)} /> {t("drop.forceRerender")}
                  </label>
                )}
              </div>
            </section>

            {(jobs.length > 0 || combined) && (
              <section className="panel" aria-labelledby="step3">
                <div className="row spread">
                  <h2 id="step3"><span className="step teal">3</span>{t("batch.title")}</h2>
                  <div className="row">
                    {outputs.length > 1 && (
                      <button className="btn primary" disabled={busy} onClick={zipAll}>{t("batch.zip")}</button>
                    )}
                    <button className="btn hot" onClick={clearAll}>{t("batch.clear")}</button>
                  </div>
                </div>
                {preset.maxFiles && outputs.length > preset.maxFiles && <p className="warn">{t("batch.tooMany", { n: preset.maxFiles })}</p>}
                {preset.totalBytes && totalOut > preset.totalBytes && (
                  <p className="warn">{t("batch.total", { bytes: fmtBytes(totalOut), max: fmtBytes(preset.totalBytes) })}</p>
                )}
                {combined && (
                  <JobCard
                    job={combined}
                    inkOption={false}
                    onRemove={() => setCombine(false)}
                    onChoose={(i) => patch(COMBINED, { chosen: i })}
                    onCrop={() => {}}
                    onInk={() => {}}
                    onRerender={() => {}}
                  />
                )}
                {jobs.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    aspect={preset.pixels ? preset.pixels.w / preset.pixels.h : undefined}
                    inkOption={!!preset.ink || preset.colour !== "bw"}
                    combined={usesCombined(preset) && imageCount > 1 && j.format !== "pdf"}
                    onRemove={() => removeJob(j.id)}
                    onChoose={(i) => patch(j.id, { chosen: i })}
                    onCrop={(open, crop) => {
                      patch(j.id, crop ? { cropping: false, crop } : { cropping: open });
                      if (crop) {
                        jobsRef.current = jobsRef.current.map((x) => (x.id === j.id ? { ...x, crop, cropping: false } : x));
                        enqueue([j.id]);
                      }
                    }}
                    onInk={(on) => {
                      jobsRef.current = jobsRef.current.map((x) => (x.id === j.id ? { ...x, ink: on } : x));
                      patch(j.id, { ink: on });
                      enqueue([j.id]);
                    }}
                    onRerender={() => {
                      jobsRef.current = jobsRef.current.map((x) => (x.id === j.id ? { ...x, forceRerender: true } : x));
                      patch(j.id, { forceRerender: true });
                      enqueue([j.id]);
                    }}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </main>

      <footer>
        <p className="promise">
          <Squisher mood="happy" size={56} />
          <span>{t("footer.offline")}</span>
        </p>
        <p className="meta">
          {t("footer.presets", { date: PRESETS_VERSION })} · <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{t("footer.source")}</a> ·{" "}
          <a href="#/privacy">{t("nav.privacy")}</a>
        </p>
      </footer>
    </I18n.Provider>
  );
}
