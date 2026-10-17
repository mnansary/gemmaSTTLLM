/**
 * 81-tap Kaiser FIR decimator 48 kHz → 16 kHz (factor 3).
 * Ported from research-web-audio.
 */

const TAPS = 81;
const COEF = new Float32Array([
  -0.000396, -0.000448, -0.000155, 0.000448, 0.001266, 0.002174,
  0.002928, 0.003185, 0.002585, 0.000896, -0.001855, -0.005493,
  -0.009546, -0.013299, -0.015949, -0.016632, -0.014423, -0.008574,
  0.001155, 0.014423, 0.030457, 0.047455, 0.063405, 0.076149,
  0.083557, 0.083557, 0.076149, 0.063405, 0.047455, 0.030457,
  0.014423, 0.001155, -0.008574, -0.014423, -0.016632, -0.015949,
  -0.013299, -0.009546, -0.005493, -0.001855, 0.000896, 0.002585,
  0.003185, 0.002928, 0.002174, 0.001266, 0.000448, -0.000155,
  -0.000448, -0.000396,
]);

export class Decimator48to16 {
  private delay = new Float32Array(TAPS);
  private pos = 0;

  push(samples: Float32Array): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.delay[this.pos] = samples[i];
      this.pos = (this.pos + 1) % TAPS;
      // Output one sample for every 3 input samples
      if ((i + 1) % 3 === 0) {
        let sum = 0;
        for (let t = 0; t < TAPS; t++) {
          const idx = (this.pos + t) % TAPS;
          sum += this.delay[idx] * COEF[t];
        }
        out.push(sum);
      }
    }
    return new Float32Array(out);
  }

  reset(): void {
    this.delay.fill(0);
    this.pos = 0;
  }
}
