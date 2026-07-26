class Pcm16Encoder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.pendingLength = 0;
    this.outputRate = 16000;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const ratio = sampleRate / this.outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const pcm = new Int16Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = Math.min(
        input.length - 1,
        Math.floor(index * ratio),
      );
      const sample = Math.max(-1, Math.min(1, input[sourceIndex] ?? 0));
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("pcm16-encoder", Pcm16Encoder);
