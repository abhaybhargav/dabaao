import * as Comlink from "comlink";
import type { EngineApi } from "../worker/engine";

let worker: Worker | null = null;
let remote: Comlink.Remote<EngineApi> | null = null;

export function engine(): Comlink.Remote<EngineApi> {
  if (!remote) {
    worker = new Worker(new URL("../worker/engine.ts", import.meta.url), { type: "module" });
    remote = Comlink.wrap<EngineApi>(worker);
  }
  return remote;
}

/** Kill the worker outright: the surest way to drop every buffer it holds. */
export function resetEngine() {
  worker?.terminate();
  worker = null;
  remote = null;
}
