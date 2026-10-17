declare module '../../public/wasm/sonora_aec3_wasm.js' {
  export default function init(): Promise<void>;
  export class SonoraAec3 {
    constructor(sampleRate: number);
    process_render(samples: Float32Array): void;
    process_capture(samples: Float32Array): Float32Array;
    free(): void;
  }
}
