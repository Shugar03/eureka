import { describe, expect, it } from "vitest";
import { encodeWav, recordingForTranscription } from "./audio";

describe("encodeWav (AC-106)", () => {
  it("writes a 16 kHz mono 16-bit PCM header and clamps the samples", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 2]));
    const v = new DataView(wav.buffer);
    const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 8)).toBe("WAVEfmt ");
    expect(text(36, 4)).toBe("data");
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 16000, 16]);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getUint32(4, true)).toBe(44);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 16383, -32768, 32767]);
  });
});

describe("recordingForTranscription", () => {
  it("sends the original recording when the browser can't convert it", async () => {
    const r = await recordingForTranscription(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
    expect(r).toEqual({ bytes: [1, 2, 3], mime: "audio/webm" });
  });
});
