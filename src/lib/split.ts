/**
 * Group consecutive pages into parts whose estimated size stays under `cap`.
 * `overhead` is the PDF container cost per part, `perPage` the cost per page object.
 * Returns page index ranges [start, end). A page larger than the cap gets a part of its own.
 */
export function splitPages(sizes: number[], cap: number, overhead = 1200, perPage = 400): [number, number][] {
  const parts: [number, number][] = [];
  let start = 0;
  let sum = overhead;
  for (let i = 0; i < sizes.length; i++) {
    const cost = sizes[i] + perPage;
    if (i > start && sum + cost > cap) {
      parts.push([start, i]);
      start = i;
      sum = overhead;
    }
    sum += cost;
  }
  if (sizes.length) parts.push([start, sizes.length]);
  return parts;
}
