import { useEffect, useRef, useState } from "react";
import { pickVoice } from "./language";

/**
 * Reads text aloud with the system's voices (Web Speech API). `word` is the
 * character index of the word being read, from `boundary` events; many
 * online voices never send them, so callers must work without it (-1).
 */
export function useSpeech(code: string) {
  const [speaking, setSpeaking] = useState(false);
  const [word, setWord] = useState(-1);
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const available = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(
    () => () => {
      if (available && current.current) window.speechSynthesis.cancel();
    },
    [],
  );
  const speak = (text: string, rate: number) => {
    if (!available) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(window.speechSynthesis.getVoices(), code);
    if (v) u.voice = v;
    u.lang = v?.lang ?? code;
    u.rate = rate;
    const done = () => {
      if (current.current !== u) return;
      current.current = null;
      setSpeaking(false);
      setWord(-1);
    };
    u.onend = done;
    u.onerror = done;
    u.onboundary = (e) => {
      if (current.current === u && (e.name === "word" || e.name === undefined)) setWord(e.charIndex);
    };
    current.current = u;
    setWord(-1);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  const stop = () => {
    if (available) window.speechSynthesis.cancel();
    current.current = null;
    setSpeaking(false);
    setWord(-1);
  };
  return { available, speaking, word, speak, stop };
}
