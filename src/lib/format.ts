/** Display sizes with 1 KB = 1,000 bytes, matching how the caps are stored. */
export function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)} MB`;
  if (n >= 1000) return `${trim(n / 1000)} KB`;
  return `${n} B`;
}

function trim(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2).replace(/\.?0+$/, "");
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "file";
}

export function isMobile(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}
