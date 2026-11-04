import { describe, expect, it } from "vitest";
import { looksLikeTranscription, speechModelWarning } from "./speechModel";

describe("speechModelWarning", () => {
  it("accepts the transcription models people actually use", () => {
    for (const m of ["whisper-1", "whisper-large-v3", "whisper-large-v3-turbo", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "voxtral-mini", "nvidia/parakeet-tdt", "scribe_v1"]) {
      expect(looksLikeTranscription(m), m).toBe(true);
      expect(speechModelWarning(m, "openai"), m).toBeNull();
    }
  });

  it("says nothing for an empty role (no speaking is a valid choice)", () => {
    expect(speechModelWarning("", "opencode-go")).toBeNull();
    expect(speechModelWarning("   ", "openai")).toBeNull();
  });

  it("warns about a text model and names what to use instead", () => {
    const w = speechModelWarning("deepseek-v4.1-flash", "openrouter")!;
    expect(w).toContain("«deepseek-v4.1-flash» parece un modelo de texto");
    expect(w).toContain("whisper-1 (OpenAI)");
    expect(w).toContain("«En esta PC» para usar Parakeet v3");
    expect(w).not.toContain("OpenCode Go");
  });

  it("says why OpenCode Go can't do it", () => {
    expect(speechModelWarning("deepseek-v4.1-flash", "opencode-go")).toContain("OpenCode Go no lista modelos de transcripción");
  });
});
