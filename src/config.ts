// Set these once the repository is public (see README "Before launch").
export const APP_NAME = "Dabaao";
export const SOURCE_URL = "https://github.com/dabaao/dabaao";
export const REPORT_URL = (presetId: string) =>
  `${SOURCE_URL}/issues/new?title=${encodeURIComponent(`Preset changed: ${presetId}`)}&labels=preset`;
