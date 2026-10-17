import { Decimator48to16 } from './resample';

const FVAD_FRAME = 480; // 30 ms @ 16 kHz
const FVAD_RATE = 16000;

interface FvadExports {
  fvad_new: () => number;
  fvad_free: (ptr: number) => void;
  fvad_reset: (ptr: number) => void;
  fvad_set_mode: (ptr: number, mode: number) => number;
  fvad_set_sample_rate: (ptr: number, rate: number) => number;
  fvad_process: (ptr: number, framePtr: number, len: number) => number;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  memory: WebAssembly.Memory;
}

export type FvadMode = 0 | 1 | 2 | 3;

export class VadEngine {
  readonly frameOutSamples = FVAD_FRAME;
  readonly frameOutHz = FVAD_RATE;
  readonly frameInputSamples = FVAD_FRAME * 3;

  private exports: FvadExports | null = null;
  private inst = 0;
  private framePtr = 0;
  private decimator = new Decimator48to16();
  private acc = new Float32Array(FVAD_FRAME);
  private accLen = 0;
  private int16Frame = new Int16Array(FVAD_FRAME);
  private currentMode: FvadMode = 2;

  get ready(): boolean {
    return this.exports !== null && this.inst !== 0 && this.framePtr !== 0;
  }

  async init(url = '/wasm/fvad.wasm'): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fvad.wasm fetch failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const { instance } = await WebAssembly.instantiate(bytes);
    const exp = instance.exports as unknown as FvadExports;
    for (const sym of [
      'fvad_new', 'fvad_free', 'fvad_set_mode', 'fvad_set_sample_rate',
      'fvad_process', 'malloc', 'memory',
    ]) {
      if (!(sym in exp)) throw new Error(`fvad.wasm missing export: ${sym}`);
    }
    const inst = exp.fvad_new();
    if (!inst) throw new Error('fvad_new returned 0');
    if (exp.fvad_set_sample_rate(inst, FVAD_RATE) !== 0) {
      throw new Error(`fvad_set_sample_rate(${FVAD_RATE}) failed`);
    }
    if (exp.fvad_set_mode(inst, this.currentMode) !== 0) {
      throw new Error(`fvad_set_mode(${this.currentMode}) failed`);
    }
    const framePtr = exp.malloc(FVAD_FRAME * 2);
    if (!framePtr) throw new Error('malloc returned 0');
    this.exports = exp;
    this.inst = inst;
    this.framePtr = framePtr;
  }

  setMode(mode: FvadMode): void {
    this.currentMode = mode;
    if (!this.ready) return;
    const rv = this.exports!.fvad_set_mode(this.inst, mode);
    if (rv !== 0) throw new Error(`fvad_set_mode(${mode}) failed: ${rv}`);
  }

  push(samples: Float32Array): number | null {
    if (!this.ready) return null;
    const decimated = this.decimator.push(samples);
    if (decimated.length === 0) return null;

    let latest: number | null = null;
    let cursor = 0;
    while (cursor < decimated.length) {
      const room = FVAD_FRAME - this.accLen;
      const take = Math.min(room, decimated.length - cursor);
      this.acc.set(decimated.subarray(cursor, cursor + take), this.accLen);
      this.accLen += take;
      cursor += take;
      if (this.accLen < FVAD_FRAME) continue;

      const i16 = this.int16Frame;
      for (let k = 0; k < FVAD_FRAME; k++) {
        const v = this.acc[k]!;
        const clamped = v > 1 ? 1 : v < -1 ? -1 : v;
        i16[k] = Math.round(clamped * 32767);
      }
      const heap16 = new Int16Array(this.exports!.memory.buffer);
      heap16.set(i16, this.framePtr >> 1);
      const rv = this.exports!.fvad_process(this.inst, this.framePtr, FVAD_FRAME);
      if (rv < 0) {
        throw new Error(`fvad_process returned ${rv}`);
      }
      latest = rv;
      this.accLen = 0;
    }
    return latest;
  }

  reset(): void {
    this.decimator.reset();
    this.acc.fill(0);
    this.accLen = 0;
    this.int16Frame.fill(0);
    if (this.exports && this.inst) {
      this.exports.fvad_reset(this.inst);
      this.exports.fvad_set_sample_rate(this.inst, FVAD_RATE);
      this.exports.fvad_set_mode(this.inst, this.currentMode);
    }
  }

  dispose(): void {
    if (this.exports && this.inst) {
      this.exports.fvad_free(this.inst);
    }
    this.exports = null;
    this.inst = 0;
    this.framePtr = 0;
  }
}
