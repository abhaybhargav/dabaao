// Public source; the footer, privacy page and "Rules changed?" links point here.
export const APP_NAME = "Dabaao";
export const SOURCE_URL = "https://github.com/abhaybhargav/dabaao";
export const REPORT_URL = (presetId: string) =>
  `${SOURCE_URL}/issues/new?title=${encodeURIComponent(`Preset changed: ${presetId}`)}&labels=preset`;
