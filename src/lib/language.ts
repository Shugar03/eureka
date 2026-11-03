// AC-65: language exam practice helpers (pure): speaking tasks by level,
// picking a voice for the language, and the improved answer to listen to.

export const LANGUAGES = [
  { id: "inglés", code: "en", label: "Inglés" },
  { id: "portugués", code: "pt", label: "Portugués" },
  { id: "francés", code: "fr", label: "Francés" },
  { id: "alemán", code: "de", label: "Alemán" },
  { id: "italiano", code: "it", label: "Italiano" },
];

export const LEVELS = ["A2", "B1", "B2", "C1"];

/** Speaking prompts in English (IELTS/TOEFL style), easier to harder. */
const TASKS: Record<string, string[]> = {
  A2: ["Describe your home. What is your favourite room and why?", "Talk about a typical weekend for you.", "Describe a friend or family member you like spending time with."],
  B1: [
    "Describe a trip you enjoyed. Where did you go, who were you with and what did you do?",
    "Talk about a skill you would like to learn and explain why.",
    "Describe a book, film or series you liked recently and say why you would recommend it.",
  ],
  B2: [
    "Some people think working from home is better than working in an office. Discuss both views and give your opinion.",
    "Describe a time you had to solve a difficult problem. What did you do, and what did you learn?",
    "How has technology changed the way people learn? Give examples.",
  ],
  C1: [
    "To what extent should governments regulate artificial intelligence? Support your view with examples.",
    "Describe a decision that changed the direction of your life, and evaluate whether you would make it again.",
    "Is it more important for education to prepare people for work or for life? Justify your answer.",
  ],
};

export function speakingTask(level: string, n: number): string {
  const list = TASKS[level] ?? TASKS.B1;
  return list[((n % list.length) + list.length) % list.length];
}

/** The first installed voice for the language (prefers the exact locale's "Natural"/"Online" voices). */
export function pickVoice<V extends { lang: string; name: string }>(voices: V[], code: string): V | null {
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(code));
  return same.find((v) => /natural|online/i.test(v.name)) ?? same[0] ?? null;
}

/** The "> " block of the feedback: the improved answer, to read aloud. */
export function improvedText(markdown: string): string {
  return markdown
    .split("\n")
    .filter((l) => l.startsWith(">"))
    .map((l) => l.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/[*_`]/g, "")
    .trim();
}

/** 0:07 for a recording timer. */
export const seconds = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
