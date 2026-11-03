import { useEffect, useState } from "react";
import { ExamsHome } from "./exam/ExamsHome";
import { ExamView } from "./exam/ExamView";
import type { CodeSeed } from "./code/CodeScreen";
import type { RoutePrefill } from "../types";

interface Props {
  initialId: string | null;
  onOpenSession: (id: string) => void;
  /** A study session was created: the sidebar should refresh. */
  onChanged: () => void;
  onOpenDeck: (id: string) => void;
  onOpenCode: (seed: CodeSeed) => void;
  /** AC-150: a new route for a course of Mi cursada. */
  prefill?: RoutePrefill | null;
}

export function ExamScreen({ initialId, onOpenSession, onChanged, onOpenDeck, onOpenCode, prefill = null }: Props) {
  const [openId, setOpenId] = useState<string | null>(initialId);
  useEffect(() => setOpenId(initialId), [initialId]);
  return openId ? (
    <ExamView id={openId} onBack={() => setOpenId(null)} onOpenSession={onOpenSession} onChanged={onChanged} onOpenDeck={onOpenDeck} onOpenCode={onOpenCode} />
  ) : (
    <ExamsHome onOpen={setOpenId} prefill={prefill} />
  );
}
