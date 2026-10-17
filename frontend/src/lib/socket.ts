export type MessageListener = (msg: unknown) => void;
export type StateListener = (state: 'open' | 'closed' | 'error', detail?: string) => void;

const AUDIO_TYPE = 0x01;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export class SttSocket {
  private ws: WebSocket | null = null;
  private msgListeners: MessageListener[] = [];
  private stateListeners: StateListener[] = [];
  private attempt = 0;
  private closed = false;
  private readonly url: string;

  constructor(url?: string) {
    this.url = url ?? `wss://${location.host}/ws/stt`;
  }

  connect(): void {
    this.closed = false;
    this._open();
  }

  private _open(): void {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.attempt = 0;
      this._emitState('open');
    };

    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          this.msgListeners.forEach((l) => l(msg));
        } catch {
          /* ignore */
        }
      }
    };

    this.ws.onclose = () => {
      if (!this.closed && this.attempt < BACKOFF_MS.length) {
        const delay = BACKOFF_MS[this.attempt++];
        this._emitState('closed', `Reconnecting in ${delay / 1000}s…`);
        setTimeout(() => this._open(), delay);
      } else if (!this.closed) {
        this._emitState('error', 'Connection failed after retries');
      }
    };

    this.ws.onerror = () => {
      this._emitState('error');
    };
  }

  sendAudio(pcm16: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = new ArrayBuffer(1 + pcm16.byteLength);
    const view = new Uint8Array(buf);
    view[0] = AUDIO_TYPE;
    view.set(new Uint8Array(pcm16), 1);
    this.ws.send(buf);
  }

  onMessage(listener: MessageListener): () => void {
    this.msgListeners.push(listener);
    return () => {
      this.msgListeners = this.msgListeners.filter((l) => l !== listener);
    };
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  private _emitState(state: 'open' | 'closed' | 'error', detail?: string) {
    this.stateListeners.forEach((l) => l(state, detail));
  }

  disconnect(): void {
    this.closed = true;
    this.ws?.close();
  }
}
