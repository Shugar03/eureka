import { useEffect, useState } from "react";
import { api, cardsApi, studyApi } from "../api";
import type { DeckSummary, Exam, SessionSummary, StudyEntry } from "../types";
import { daysUntil, localDate } from "../lib/exam";
import { NEW_PER_DAY } from "../lib/cards";
import { isoWeekday, monday, slotsOn, studyPlan, type AgendaSlot } from "../lib/plan";
import { usePomodoro } from "./pomodoro/PomodoroContext";

interface Props {
  sessions: SessionSummary[];
  onOpenSession: (id: string) => void;
  onOpenExam: (id: string) => void;
  onOpenDeck: (id: string) => void;
  onOpenAgenda: () => void;
}

interface ExamToday {
  exam: Exam;
  days: number | null;
  topic: { id: string; title: string; started: boolean } | null;
}

const KIND_LABEL = { class: "Clase", study: "Estudio" } as const;

/** AC-56: everything due today, from every screen, in one place. */
export function TodayPanel({ sessions, onOpenSession, onOpenExam, onOpenDeck, onOpenAgenda }: Props) {
  const p = usePomodoro();
  const today = localDate(new Date());
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [exams, setExams] = useState<ExamToday[]>([]);
  const [slots, setSlots] = useState<AgendaSlot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cardsApi.listDecks(today).then(setDecks).catch(() => {});
    (async () => {
      const summaries = await api.listExams();
      setSlots(slotsOn(summaries, isoWeekday(today)));
      const entries: StudyEntry[] = await studyApi.since(monday(today)).catch(() => []);
      const map = new Map(sessions.map((s) => [s.id, s]));
      const full = await Promise.all(summaries.filter((s) => (s.exam_date && s.exam_date >= today) || s.to_review > 0).map((s) => api.getExam(s.id)));
      setExams(
        full
          .map((exam) => {
            const plan = studyPlan(exam, map, today, entries, new Date());
            return {
              exam,
              days: exam.goal.exam_date ? daysUntil(exam.goal.exam_date, new Date()) : null,
              topic: plan?.today ? { id: plan.today.topicId, title: plan.today.title, started: plan.today.started } : null,
            };
          })
          .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)),
      );
    })().catch(() => setError("No pude cargar lo de hoy."));
  }, [today, sessions.length]);

  const cards = decks.map((d) => ({ d, n: d.due + Math.min(d.new, NEW_PER_DAY) })).filter((x) => x.n > 0);
  const totalCards = cards.reduce((s, x) => s + x.n, 0);
  const study = async (examId: string, topicId: string) => {
    try {
      const s = await api.studyTopic(examId, topicId);
      onOpenSession(s.id);
    } catch {
      setError("No pude abrir la sesión de ese tema.");
    }
  };
  const empty = !cards.length && !exams.length && !slots.length;
  if (empty && !error) return null;

  return (
    <section className="card today" aria-label="Hoy">
      <div className="row-between">
        <h2>Hoy</h2>
        {!p.state.running && (
          <button className="btn small" onClick={p.start}>
            Arrancar un pomodoro ({p.settings.focus} min)
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      <ul className="today-list">
        {slots.map((s, i) => (
          <li key={`s${i}`}>
            <span className={`slot-kind slot-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
            <span className="today-what">
              {s.start}–{s.end} · {s.name}
              {s.place && <span className="muted"> · {s.place}</span>}
            </span>
            <button className="btn ghost small" onClick={onOpenAgenda}>
              Agenda
            </button>
          </li>
        ))}
        {cards.length > 0 && (
          <li>
            <span className="slot-kind slot-cards">Tarjetas</span>
            <span className="today-what">
              {totalCards} para repasar{cards.length > 1 ? ` en ${cards.length} mazos` : ` · ${cards[0].d.name}`}
            </span>
            <button className="btn ghost small" onClick={() => onOpenDeck([...cards].sort((a, b) => b.n - a.n)[0].d.id)}>
              Repasar
            </button>
          </li>
        )}
        {exams.map(({ exam, days, topic }) => (
          <li key={exam.id}>
            <span className={`slot-kind ${days != null && days <= 7 ? "slot-soon" : "slot-exam"}`}>{days == null ? "Repaso" : days === 0 ? "¡Hoy!" : `${days} d`}</span>
            <span className="today-what">
              <button className="link" onClick={() => onOpenExam(exam.id)}>
                {exam.name}
              </button>
              {topic ? <> · {topic.started ? "seguí con" : "estudiá"} {topic.title}</> : days != null ? " · simulacro y repaso" : ""}
              {exam.review.length > 0 && <span className="muted"> · {exam.review.length} falladas para repasar</span>}
            </span>
            {topic && (
              <button className="btn ghost small" onClick={() => study(exam.id, topic.id)} aria-label={`${topic.started ? "Continuar" : "Estudiar"} ${topic.title}`}>
                {topic.started ? "Continuar" : "Estudiar"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
