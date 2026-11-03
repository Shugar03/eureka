// AC-106: recordings go to the transcriber as 16 kHz mono 16-bit WAV. The local
// Whisper needs exactly that (it can't decode webm/opus), and the online services
// accept it too, so every path sends the same thing.

export const TARGET_RATE = 16000;

/** Samples in [-1, 1] → a WAV file (PCM, 16-bit, mono). */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const c = Math.max(-1, Math.min(1, s));
    out.setInt16(44 + i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  });
  return new Uint8Array(out.buffer);
}

/** Decodes the recording and resamples it to 16 kHz mono with the browser's own audio engine. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_RATE), TARGET_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void ctx.close();
  }
}

/** What `languageApi.transcribe` receives: WAV when the browser can convert, else the original. */
export async function recordingForTranscription(blob: Blob): Promise<{ bytes: number[]; mime: string }> {
  try {
    if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") throw new Error("no audio");
    return { bytes: [...encodeWav(await toSamples(blob))], mime: "audio/wav" };
  } catch {
    return { bytes: [...new Uint8Array(await blob.arrayBuffer())], mime: blob.type || "audio/webm" };
  }
}
