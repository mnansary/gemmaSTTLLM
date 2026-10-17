declare module '*sonora_aec3_wasm.js' {
  export default function init(): Promise<void>;
  export class SonoraAec3 {
    constructor(sampleRate: number);
    process_render(samples: Float32Array): void;
    process_capture(samples: Float32Array): Float32Array;
    free(): void;
  }
}

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const content: string;
  export default content;
}
