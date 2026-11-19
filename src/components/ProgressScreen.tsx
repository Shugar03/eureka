import { Fragment, useEffect, useState } from "react";
import { activityApi, api, errorText, identityApi, routeApi, studentApi } from "../api";
import type { ActionScreen, RouteView, Session, StudentModel, TopicState, TopicStatus } from "../types";
import { addDays } from "../lib/cards";
import { localDate } from "../lib/exam";
import { streak } from "../lib/streak";
import { activeUnit, coach, counts, evidence, firstTab, looseTopics, STATUSES, statusMeta, todayPlan, unitOf, type TodayItem, type Unit } from "../lib/progress";
import { MemorySection } from "./MemorySection";
import { SessionMemories } from "./Settings";
import { Icon } from "./Icon";

export const daysText = (days: number) => (days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`);

/** Days of activity shown under the streak. */
const STRIP_DAYS = 14;
/** As the home panel (AC-141), so both screens count the same streak. */
const HISTORY_DAYS = 120;
/** Sessions turned into paths (newest first). */
const UNITS = 6;
/** Topics shown in a tab until «Ver todos». */
const FIRST = 8;

type Go = { onOpenScreen: (s: ActionScreen) => void; onOpenSession: (id: string) => void; onStudy: (message: string) => void };

interface Data {
  m: StudentModel;
  days: string[];
  units: Unit[];
  /** The sessions behind the units, to redraw them when the model changes. */
  sessions: Session[];
  name: string;
  finished7: number;
  /** AC-217: learning routes, shown as courses (their classes are not repeated as paths). */
  routes: RouteView[];
}

async function load(today: string): Promise<Data> {
  const [m, days, sessions, who, routes] = await Promise.all([
    studentApi.model(),
    activityApi
      .days(addDays(today, -HISTORY_DAYS))
      .then((d) => d.map((x) => x.day))
      .catch(() => [] as string[]),
    api.listSessions().catch(() => []),
    identityApi.get().catch(() => null),
    routeApi.list().catch(() => [] as RouteView[]),
  ]);
  const withPlan = sessions
    .filter((s) => s.phase !== "chat" && s.plan_total > 0 && !s.archived && !s.route)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, UNITS);
  const full = await Promise.all(withPlan.map((s) => api.getSession(s.id).catch(() => null)));
  const loaded = full.filter((s) => s !== null);
  const units = loaded.map((s) => unitOf(s, m));
  const weekAgo = addDays(today, -6);
  const finished7 = sessions.filter((s) => s.phase === "done" && s.updated_at.slice(0, 10) >= weekAgo).length;
  return { m, days, units, sessions: loaded, name: who?.first_name.trim() ?? "", finished7, routes };
}

/**
 * AC-113/AC-210: what Eureka learned about the person, as a coach would say it:
 * how the week went and what to do today, a few numbers, each session as a
 * path of ideas, everything else by state, and the memory to correct it.
 */
export function ProgressScreen(go: Go) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = localDate(new Date());

  useEffect(() => {
    load(today)
      .then(setD)
      .catch((e) => setError(errorText(e)));
  }, [today]);

  const markKnown = async (t: TopicState) => {
    try {
      const m = await studentApi.markKnown(t.name);
      setD((x) => x && { ...x, m, units: x.sessions.map((s) => unitOf(s, m)) });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="practice-screen progress-screen">
      <header className="chat-head">
        <h1 className="chat-title">Mi progreso</h1>
      </header>
      <div className="practice-body pg">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!d ? (
          !error && <p className="muted">Cargando…</p>
        ) : (
          <>
            <CoachCard d={d} today={today} go={go} />
            <Numbers d={d} today={today} onOpenScreen={go.onOpenScreen} />
            {d.m.upcoming.length > 0 && <Upcoming m={d.m} onOpenScreen={go.onOpenScreen} />}
            {d.routes.length > 0 && <Routes routes={d.routes} onOpen={() => go.onOpenScreen("routes")} />}
            {d.units.length > 0 && <Paths units={d.units} onOpenSession={go.onOpenSession} />}
            <OtherTopics d={d} go={go} markKnown={markKnown} />
            <details className="pg-memory">
              <summary>
                <span>Corregir lo que Eureka anotó</span>
                <Icon name="arrow" size={14} />
              </summary>
              <p className="muted small">De acá sale todo lo de arriba. Si algo no es así, corregilo o borralo: lo que corregís vos queda así y no se pisa.</p>
              <MemorySection />
              <SessionMemories />
            </details>
          </>
        )}
      </div>
    </div>
  );
}

/** «**x**» → <strong>x</strong>. */
function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function CoachCard({ d, today, go }: { d: Data; today: string; go: Go }) {
  const s = streak(d.days, today);
  const active = new Set(d.days);
  const studied7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter((x) => active.has(x)).length;
  const c = coach({ name: d.name, m: d.m, streak: s.current, activeToday: s.activeToday, studied7, studiedEver: d.days.length > 0 || d.m.topics.length > 0, today });
  const plan = todayPlan(d.m, d.units);
  const run = (t: TodayItem) => (t.action.kind === "cards" ? go.onOpenScreen("cards") : t.action.kind === "session" ? go.onOpenSession(t.action.id) : go.onStudy(t.action.message));
  return (
    <section className={`card pg-coach ${plan.length ? "" : "is-solo"}`} aria-label="Cómo venís">
      <div className="pg-coach-text">
        <h2>{c.title}</h2>
        {c.text.map((t, i) => (
          <p key={i}>
            <Bold text={t} />
          </p>
        ))}
        {!plan.length && (
          <button className="btn primary" onClick={() => go.onStudy("Quiero empezar a estudiar. ¿Por dónde arrancamos?")}>
            Empezar a estudiar
          </button>
        )}
      </div>
      {plan.length > 0 && (
        <div className="pg-today" role="group" aria-label="Hoy te conviene">
          <span className="pg-kicker">Hoy te conviene</span>
          <ol>
            {plan.map((t, i) => (
              <li key={t.title}>
                <span className="pg-num" aria-hidden>
                  {i + 1}
                </span>
                <span className="pg-today-text">
                  <strong>{t.title}</strong>
                  <small>{t.why}</small>
                </span>
                <button className={`btn small ${i === 0 ? "primary" : ""}`} onClick={() => run(t)} aria-label={`${t.button}: ${t.title}`}>
                  {t.button}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function Numbers({ d, today, onOpenScreen }: { d: Data; today: string; onOpenScreen: (s: ActionScreen) => void }) {
  const s = streak(d.days, today);
  const active = new Set(d.days);
  const strip = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - STRIP_DAYS + 1));
  const studied = strip.filter((x) => active.has(x)).length;
  const c = counts(d.m.topics);
  const total = d.m.topics.length;
  const minutes = Math.round(d.m.minutes_7d);
  return (
    <section className="card pg-numbers" aria-label="Resumen">
      <div className="pg-cell">
        <span className="pg-kicker">Tu racha</span>
        <p className="pg-big">
          <strong>{s.current}</strong> {s.current === 1 ? "día" : "días"}
        </p>
        <ol className="pg-strip" aria-label={`Estudiaste ${studied} de los últimos ${STRIP_DAYS} días`}>
          {strip.map((x) => (
            <li key={x} className={`${active.has(x) ? "is-done" : ""} ${x === today ? "is-today" : ""}`} title={new Date(`${x}T00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} />
          ))}
        </ol>
      </div>
      <div className="pg-cell">
        <span className="pg-kicker">Tus temas</span>
        <p className="pg-big">
          <strong>{c.domina}</strong> {c.domina === 1 ? "dominado" : "dominados"} <span className="pg-of">de {total}</span>
        </p>
        {total > 0 ? (
          <>
            <div className="pg-bar" aria-hidden>
              {STATUSES.filter((x) => c[x.status] > 0).map((x) => (
                <span key={x.status} className={`is-${x.status}`} style={{ flexGrow: c[x.status] }} />
              ))}
            </div>
            <ul className="pg-legend" aria-label="Temas por estado">
              {STATUSES.map((x) => (
                <li key={x.status}>
                  <span className={`pg-dot is-${x.status}`} aria-hidden />
                  {x.title}
                  <strong>{c[x.status]}</strong>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="pg-note">Aparecen cuando estudiás.</p>
        )}
      </div>
      <div className="pg-cell pg-facts">
        <span className="pg-kicker">Esta semana</span>
        <p className="pg-fact">
          <Icon name="target" size={16} />
          {minutes > 0 ? (
            <span>
              <strong>{minutes}</strong> min de foco
            </span>
          ) : (
            <span className="muted">Sin bloques de foco</span>
          )}
        </p>
        {d.m.cards_due > 0 ? (
          <button type="button" className="pg-fact is-link" onClick={() => onOpenScreen("cards")}>
            <Icon name="cards" size={16} />
            <span>
              <strong>{d.m.cards_due}</strong> {d.m.cards_due === 1 ? "tarjeta" : "tarjetas"} para hoy
            </span>
            <Icon name="arrow" size={14} />
          </button>
        ) : (
          <p className="pg-fact">
            <Icon name="cards" size={16} />
            <span className="muted">Tarjetas al día</span>
          </p>
        )}
        <p className="pg-fact">
          <Icon name="cap" size={16} />
          {d.finished7 > 0 ? (
            <span>
              <strong>{d.finished7}</strong> {d.finished7 === 1 ? "sesión terminada" : "sesiones terminadas"}
            </span>
          ) : (
            <span className="muted">Ninguna sesión terminada</span>
          )}
        </p>
      </div>
    </section>
  );
}

function Upcoming({ m, onOpenScreen }: { m: StudentModel; onOpenScreen: (s: ActionScreen) => void }) {
  return (
    <section className="pg-section" aria-label="Se viene">
      <h2 className="pg-heading">Se viene</h2>
      <div className="pg-dates">
        {m.upcoming.slice(0, 4).map((u) => {
          const day = new Date(`${u.date}T00:00`);
          return (
            <button key={u.id} type="button" className="pg-date" onClick={() => onOpenScreen(u.screen as ActionScreen)}>
              <span className="pg-cal" aria-hidden>
                <small>{day.toLocaleDateString(undefined, { month: "short" }).replace(".", "")}</small>
                <strong>{day.getDate()}</strong>
              </span>
              <span className="pg-date-text">
                <strong>{u.title}</strong>{" "}
                <small className={u.days <= 7 ? "is-soon" : ""}>{daysText(u.days)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** AC-217: each route as a course with its progress; the classes live in «Mis rutas». */
function Routes({ routes, onOpen }: { routes: RouteView[]; onOpen: () => void }) {
  return (
    <section className="pg-section" aria-label="Tus rutas">
      <div className="pg-section-head">
        <h2 className="pg-heading">Tus rutas</h2>
        <span className="muted small">Cursos de varias clases</span>
      </div>
      <div className="pg-routes">
        {routes.map((r) => (
          <button key={r.id} type="button" className="card pg-route" onClick={onOpen}>
            <strong>{r.title}</strong>
            <span className="pg-route-bar" aria-hidden>
              <span style={{ width: `${r.total ? (100 * r.done) / r.total : 0}%` }} />
            </span>
            <small>
              {r.done} de {r.total} clases{r.done === r.total ? " · completa" : ""}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function Paths({ units, onOpenSession }: { units: Unit[]; onOpenSession: (id: string) => void }) {
  const first = activeUnit(units);
  const [open, setOpen] = useState<string | null>(first?.session_id ?? null);
  return (
    <section className="pg-section" aria-label="Tus caminos">
      <div className="pg-section-head">
        <h2 className="pg-heading">Tus caminos</h2>
        <span className="muted small">Cada sesión con objetivo es un camino de ideas</span>
      </div>
      {units.map((u) => (
        <UnitCard key={u.session_id} u={u} open={open === u.session_id} onToggle={() => setOpen(open === u.session_id ? null : u.session_id)} onOpenSession={onOpenSession} />
      ))}
    </section>
  );
}

const NODE_MARK: Record<string, string> = { ok: "✓", prac: "◐", bad: "!", todo: "○" };

function UnitCard({ u, open, onToggle, onOpenSession }: { u: Unit; open: boolean; onToggle: () => void; onOpenSession: (id: string) => void }) {
  const pct = u.nodes.length ? Math.round((100 * u.ready) / u.nodes.length) : 0;
  const when = new Date(u.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "numeric" });
  const bodyId = `pg-unit-${u.session_id}`;
  return (
    <article className={`card pg-unit ${open ? "is-open" : ""} ${u.done ? "is-done" : ""}`} aria-label={u.title}>
      <button type="button" className="pg-unit-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="pg-ring" style={{ "--pct": `${pct}%` } as React.CSSProperties} aria-hidden>
          <span>{u.done ? "✓" : `${u.ready}/${u.nodes.length}`}</span>
        </span>
        <span className="pg-unit-title">
          <strong>{u.title}</strong>
          <small>
            {u.done ? `Terminada el ${when}` : `${u.ready} de ${u.nodes.length} ideas · ${when}`}
          </small>
        </span>
        {u.exam && <span className="pg-soon">{`${u.exam.name} ${daysText(u.exam.days)}`}</span>}
        <span className="pg-chev" aria-hidden>
          <Icon name="arrow" size={14} />
        </span>
      </button>
      {open && (
        <ol className="pg-path" id={bodyId} aria-label={`Ideas de ${u.title}`}>
          {u.nodes.map((n, i) => (
            <li key={n.id} className={`pg-step ${i % 4 === 1 ? "is-left" : i % 4 === 3 ? "is-right" : ""} ${n.now ? "is-now" : ""}`}>
              <span className={`pg-node is-${n.look}`} aria-hidden>
                {NODE_MARK[n.look]}
              </span>
              <span className="pg-step-text">
                <strong>{n.title}</strong>
                <small>{n.note}</small>
                {n.now && (
                  <button className="btn small primary" onClick={() => onOpenSession(u.session_id)} aria-label={`Seguir desde acá: ${n.title}`}>
                    Seguir desde acá
                  </button>
                )}
              </span>
            </li>
          ))}
          {u.done && (
            <li className="pg-step is-end">
              <span className="pg-node is-goal" aria-hidden>
                ★
              </span>
              <span className="pg-step-text">
                <strong>Camino completo</strong>
                <button className="btn small ghost" onClick={() => onOpenSession(u.session_id)}>
                  Ver la sesión
                </button>
              </span>
            </li>
          )}
        </ol>
      )}
    </article>
  );
}

function OtherTopics({ d, go, markKnown }: { d: Data; go: Go; markKnown: (t: TopicState) => void }) {
  const topics = d.units.length ? looseTopics(d.m, d.units) : d.m.topics;
  // The first tab is chosen once: «Ya lo sé» empties a tab without jumping to another.
  const [current, setTab] = useState<TopicStatus>(() => firstTab(topics));
  const [all, setAll] = useState(false);
  if (!topics.length) return null;
  const c = counts(topics);
  const meta = statusMeta(current);
  const list = topics.filter((t) => t.status === current);
  const shown = all ? list : list.slice(0, FIRST);
  const pick = (s: TopicStatus) => {
    setTab(s);
    setAll(false);
  };
  return (
    <section className="card pg-others" aria-label={d.units.length ? "Fuera de tus caminos" : "Tus temas"}>
      <div className="pg-section-head">
        <div>
          <h2 className="pg-heading">{d.units.length ? "Fuera de tus caminos" : "Tus temas"}</h2>
          {d.units.length > 0 && <p className="muted small">De prácticas, tarjetas, simulacros y notas de tus sesiones.</p>}
        </div>
        <div className="pg-tabs" role="tablist" aria-label="Estado">
          {STATUSES.map((x) => (
            <button
              key={x.status}
              type="button"
              role="tab"
              id={`pg-tab-${x.status}`}
              aria-selected={x.status === current}
              aria-controls="pg-panel"
              tabIndex={x.status === current ? 0 : -1}
              className="pg-tab"
              onClick={() => pick(x.status)}
              onKeyDown={(e) => {
                const i = STATUSES.findIndex((s) => s.status === current);
                const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
                if (next === null) return;
                e.preventDefault();
                const s = STATUSES[(next + STATUSES.length) % STATUSES.length].status;
                pick(s);
                document.getElementById(`pg-tab-${s}`)?.focus();
              }}
            >
              <span className={`pg-dot is-${x.status}`} aria-hidden />
              {x.title}
              <span className="pg-count">{c[x.status]}</span>
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id="pg-panel" aria-label={meta.title}>
        {list.length === 0 ? (
          <p className="muted small pg-none">{meta.empty}</p>
        ) : (
          <ul className="pg-list">
            {shown.map((t) => (
              <TopicRow key={t.key} t={t} go={go} m={d.m} markKnown={markKnown} />
            ))}
          </ul>
        )}
        {!all && list.length > FIRST && (
          <button type="button" className="btn ghost small" onClick={() => setAll(true)}>
            Ver los {list.length}
          </button>
        )}
      </div>
    </section>
  );
}

function TopicRow({ t, go, m, markKnown }: { t: TopicState; go: Go; m: StudentModel; markKnown: (t: TopicState) => void }) {
  const [open, setOpen] = useState(false);
  const ev = t.evidence.map(evidence);
  const long = t.name.length > 90;
  return (
    <li className={`pg-topic ${open ? "is-open" : ""}`}>
      <span className={`pg-dot is-${t.status}`} aria-hidden />
      <div className="pg-topic-main">
        <h3 className="pg-topic-name">{t.name}</h3>
        <ul className="pg-ev">
          {(open ? ev : ev.slice(0, 1)).map((e, i) => (
            <li key={i}>
              {e.tag && <span className="pg-ev-tag">{e.tag}</span>}
              <span>{e.text}</span>
              {e.when && <time>{e.when}</time>}
            </li>
          ))}
        </ul>
        {(ev.length > 1 || long) && (
          <button type="button" className="pg-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Ver menos" : ev.length > 1 ? `Ver por qué (${ev.length})` : "Ver completo"}
          </button>
        )}
      </div>
      <span className="pg-actions">
        {t.status === "le_cuesta" && (
          <button className="btn small" onClick={() => go.onStudy(`Quiero repasar ${t.name}.`)}>
            Repasarlo
          </button>
        )}
        {t.confusion && t.status === "le_cuesta" && (
          <button className="btn ghost small" onClick={() => markKnown(t)} aria-label={`Esto ya lo sé: ${t.name}`}>
            Ya lo sé
          </button>
        )}
        {t.status === "pendiente" && (
          <button
            className="btn small"
            onClick={() => {
              const p = m.pending.find((x) => x.item === t.name);
              if (p) go.onOpenSession(p.session_id);
              else go.onStudy(`Quiero retomar: ${t.name}.`);
            }}
          >
            Retomar
          </button>
        )}
      </span>
    </li>
  );
}
