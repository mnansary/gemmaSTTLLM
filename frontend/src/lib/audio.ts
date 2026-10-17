export interface AudioCallbacks {
  onPcm16: (pcm16: ArrayBuffer) => void;
  onVadScore?: (rms: number) => void;
}

export class AudioPipeline {
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private callbacks: AudioCallbacks;

  constructor(callbacks: AudioCallbacks) {
    this.callbacks = callbacks;
  }

  async start(mediaStream: MediaStream): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: 48000 });

    // AudioWorklet processor:
    // 1. Computes RMS energy for VAD visualisation
    // 2. Resamples 48kHz → 16kHz (3:1 decimation)
    // 3. Emits ~100 ms chunks (1600 samples @ 16kHz)
    const workletCode = `
      class PcmProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.accumulator = new Float32Array(0);
        }

        _rms(samples) {
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
          }
          return Math.sqrt(sum / samples.length);
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (!input || input.length === 0 || input[0].length === 0) return true;

          const mic = input[0];

          // --- RMS VAD (runs on raw 48kHz audio) ---
          const rms = this._rms(mic);
          const normalized = Math.min(1.0, rms * 4.0);
          this.port.postMessage({ type: 'vad', rms: normalized });

          // --- Accumulate for 48→16kHz decimation ---
          const newAcc = new Float32Array(this.accumulator.length + mic.length);
          newAcc.set(this.accumulator);
          newAcc.set(mic, this.accumulator.length);
          this.accumulator = newAcc;

          // Decimate by factor 3: 4800 samples @ 48kHz → 1600 samples @ 16kHz (~100 ms)
          while (this.accumulator.length >= 4800) {
            const pcm16 = new Int16Array(1600);
            for (let i = 0; i < 1600; i++) {
              const idx = i * 3;
              const s = (this.accumulator[idx] + this.accumulator[idx + 1] + this.accumulator[idx + 2]) / 3;
              pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
            }
            this.port.postMessage({ type: 'pcm', data: pcm16.buffer }, [pcm16.buffer]);
            this.accumulator = this.accumulator.slice(4800);
          }

          return true;
        }
      }
      registerProcessor('pcm-processor', PcmProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    this.worklet = new AudioWorkletNode(this.ctx, 'pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });

    this.worklet.port.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.type === 'vad') {
        this.callbacks.onVadScore?.(msg.rms);
      } else if (msg.type === 'pcm') {
        this.callbacks.onPcm16(msg.data);
      }
    };

    this.micSource = this.ctx.createMediaStreamSource(mediaStream);
    this.micSource.connect(this.worklet);

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  stop(): void {
    this.micSource?.disconnect();
    this.worklet?.disconnect();
    this.ctx?.close();
    this.micSource = null;
    this.worklet = null;
    this.ctx = null;
  }
}
