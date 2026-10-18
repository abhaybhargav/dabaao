// Every object URL the app creates is tracked so "Clear all" and downloads can revoke them.
const live = new Set<string>();

export function blobUrl(data: BlobPart, type: string): string {
  const url = URL.createObjectURL(new Blob([data], { type }));
  live.add(url);
  return url;
}

export function revoke(url?: string) {
  if (url && live.delete(url)) URL.revokeObjectURL(url);
}

export function revokeAll() {
  for (const u of live) URL.revokeObjectURL(u);
  live.clear();
}

export function download(data: BlobPart, name: string, type: string) {
  const url = blobUrl(data, type);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => revoke(url), 10_000);
}
