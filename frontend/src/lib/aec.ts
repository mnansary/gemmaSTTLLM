/**
 * Sonora-AEC3 engine — Rust port of WebRTC AEC3, compiled to WASM.
 * Bridges Sonora's 480-sample frame size (10 ms @ 48 kHz) to 256-sample hops.
 */

const SONORA_FRAME = 480;
const HOP = 256;
const RING_FRAMES = 4;
const RING_SIZE = SONORA_FRAME * RING_FRAMES;
const SAMPLE_RATE = 48000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;

export class AecEngine {
  private aec: any = null;
  private micRing = new Float32Array(RING_SIZE);
  private micCount = 0;
  private refRing = new Float32Array(RING_SIZE);
  private refCount = 0;
  private outRing = new Float32Array(RING_SIZE);
  private outRead = 0;
  private outWrite = 0;

  get ready(): boolean {
    return this.aec !== null;
  }

  async init(): Promise<void> {
    if (!wasmModule) {
      wasmModule = await import('../../public/wasm/sonora_aec3_wasm.js');
    }
    await wasmModule.default();
    const ctor = wasmModule.SonoraAec3;
    this.aec = new ctor(SAMPLE_RATE);
  }

  reset(): void {
    if (this.aec) {
      this.aec.free();
      this.aec = null;
    }
    this.micCount = 0;
    this.refCount = 0;
    this.outRead = 0;
    this.outWrite = 0;
    this.micRing.fill(0);
    this.refRing.fill(0);
    this.outRing.fill(0);
  }

  processHop(mic: Float32Array, ref: Float32Array): Float32Array {
    if (!this.aec) return new Float32Array(HOP);

    this.micRing.set(mic, this.micCount);
    this.micCount += mic.length;
    this.refRing.set(ref, this.refCount);
    this.refCount += ref.length;

    while (this.micCount >= SONORA_FRAME && this.refCount >= SONORA_FRAME) {
      const micFrame = this.micRing.slice(0, SONORA_FRAME);
      const refFrame = this.refRing.slice(0, SONORA_FRAME);

      this.aec.process_render(refFrame);
      const cleaned = this.aec.process_capture(micFrame);

      if (this.outWrite + cleaned.length > RING_SIZE) {
        this.outRing.copyWithin(0, this.outRead, this.outWrite);
        this.outWrite -= this.outRead;
        this.outRead = 0;
      }
      this.outRing.set(cleaned, this.outWrite);
      this.outWrite += cleaned.length;

      this.micRing.copyWithin(0, SONORA_FRAME, this.micCount);
      this.micCount -= SONORA_FRAME;
      this.refRing.copyWithin(0, SONORA_FRAME, this.refCount);
      this.refCount -= SONORA_FRAME;
    }

    const out = new Float32Array(HOP);
    const avail = this.outWrite - this.outRead;
    const copy = Math.min(HOP, avail);
    if (copy > 0) {
      out.set(this.outRing.subarray(this.outRead, this.outRead + copy), 0);
      this.outRead += copy;
    }
    if (this.outRead === this.outWrite) {
      this.outRead = 0;
      this.outWrite = 0;
    }
    return out;
  }
}
