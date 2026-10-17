/**
 * AudioWorkletProcessor — downsample from context sample rate to 16 kHz mono PCM16.
 * Emits ArrayBuffer chunks of ~100 ms (1600 samples at 16 kHz) to the main thread.
 *
 * Carries a fractional input cursor across process() calls so we don't drop or
 * duplicate samples at block boundaries.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._targetRate = (options?.processorOptions?.targetSampleRate) ?? 16000;
    this._ratio = sampleRate / this._targetRate;
    this._buf = [];
    this._chunkSamples = this._targetRate / 10; // 100 ms
    this._cursor = 0; // fractional position into the *current* input block
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    while (this._cursor < channel.length) {
      const lo = Math.floor(this._cursor);
      const hi = Math.min(lo + 1, channel.length - 1);
      const t = this._cursor - lo;
      const sample = channel[lo] * (1 - t) + channel[hi] * t;
      this._buf.push(Math.max(-1, Math.min(1, sample)));
      this._cursor += this._ratio;

      if (this._buf.length >= this._chunkSamples) {
        const pcm = new Int16Array(this._buf.length);
        for (let j = 0; j < this._buf.length; j++) {
          pcm[j] = Math.round(this._buf[j] * 32767);
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this._buf = [];
      }
    }
    this._cursor -= channel.length; // carry fractional remainder
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
