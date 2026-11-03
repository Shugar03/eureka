import { useEffect, useRef, useState } from "react";
import { academicApi, api, cardsApi } from "../api";
import { localDate } from "../lib/exam";
import { NEW_PER_DAY } from "../lib/cards";
import { DEFAULT_REMINDERS, dueReminders, healthDue, notificationId, upcomingReminders, validReminders, type HealthClock, type Reminder, type ReminderSettings, type Scheduled } from "../lib/reminders";
import { onPhone } from "../lib/platform";
import { soft } from "../lib/sounds";
import { usePomodoro } from "./pomodoro/PomodoroContext";

const SETTINGS_KEY = "la.reminders";
const SENT_KEY = "la.reminders.sent";
// `?fastReminders` in the e2e build: check every second instead of every minute.
const FAST = import.meta.env.MODE === "e2e" && new URLSearchParams(location.search).has("fastReminders");
// In the e2e build reminders only run when a test asks for them (they depend on the clock).
const OFF = import.meta.env.MODE === "e2e" && !FAST;
const TOAST_MS = 15_000;
const SCHEDULE_DAYS = 7;
const SCHEDULE_MAX = 60;

export function loadReminderSettings(): ReminderSettings {
  try {
    return validReminders(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"));
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export function saveReminderSettings(s: ReminderSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function loadSent(today: string): Set<string> {
  try {
    const all: string[] = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]");
    return new Set(all.filter((id) => id.startsWith(today)));
  } catch {
    return new Set();
  }
}

/** A system notification when running as the app; silently skipped otherwise. */
async function notify(r: Reminder) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (ok) n.sendNotification({ title: r.title, body: r.body });
  } catch {
    /* not in the desktop app, or notifications unavailable: the in-app toast is enough */
  }
}

/**
 * On the phone: the next week of reminders goes to the system, which shows them
 * even while Android keeps Eureka frozen. Each time replaces the last list.
 */
async function schedule(items: Scheduled[]) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === "granted";
    if (!ok) return;
    const old = await n.pending();
    if (old.length) await n.cancel(old.map((p) => p.id));
    for (const { at, reminder } of items.slice(0, SCHEDULE_MAX)) {
      n.sendNotification({ id: notificationId(reminder.id), title: reminder.title, body: reminder.body, schedule: n.Schedule.at(at, false, true) });
    }
  } catch {
    /* notifications unavailable: the in-app toasts still work while it's open */
  }
}

/** AC-62: checks every minute and shows what's due (in the app and as a notification). */
export function Reminders() {
  const [shown, setShown] = useState<Reminder[]>([]);
  const busy = useRef(false);
  const pomo = usePomodoro();
  // What the health timer needs to read without restarting.
  const onBreak = useRef(false);
  onBreak.current = pomo.state.running && pomo.state.phase !== "focus";
  const soundOn = useRef(false);
  soundOn.current = pomo.sound.enabled;

  const show = (due: Reminder[], notified = false) => {
    setShown((s) => [...s, ...due].slice(-3));
    // Toasts go away on their own: they must never sit on top of the app's buttons.
    setTimeout(() => setShown((s) => s.filter((x) => !due.some((d) => d.id === x.id))), TOAST_MS);
    if (!notified) due.forEach(notify);
  };

  // AC-98: stand up / drink water. Each counts from its own clock; a pomodoro break counts as standing.
  useEffect(() => {
    if (OFF) return;
    const per = FAST ? 1000 : 60_000;
    let clock: HealthClock = { standAt: Date.now(), waterAt: Date.now() };
    const check = () => {
      const now = Date.now();
      if (onBreak.current) clock = { ...clock, standAt: now };
      const r = healthDue(now, clock, loadReminderSettings(), per);
      clock = r.clock;
      if (!r.due.length) return;
      if (soundOn.current) soft();
      show(r.due);
    };
    const every = setInterval(check, FAST ? 500 : 15_000);
    return () => clearInterval(every);
  }, []);

  useEffect(() => {
    const phone = onPhone();
    // `plan`: also hand the coming reminders to the phone's system (at start and when leaving the app).
    const check = async (plan = false) => {
      const settings = loadReminderSettings();
      if (OFF || busy.current) return;
      if (!settings.enabled) {
        if (plan) schedule([]);
        return;
      }
      busy.current = true;
      try {
        const now = new Date();
        const today = localDate(now);
        const [exams, decks, academic] = await Promise.all([api.listExams(), cardsApi.listDecks(today), academicApi.state().catch(() => null)]);
        const cardsDue = decks.reduce((s, d) => s + d.due + Math.min(d.new, NEW_PER_DAY), 0);
        const sent = loadSent(today);
        const due = dueReminders(now, exams, cardsDue, settings, sent, academic);
        due.forEach((r) => sent.add(r.id));
        if (due.length) {
          try {
            localStorage.setItem(SENT_KEY, JSON.stringify([...sent]));
          } catch {
            /* ignore */
          }
          // On the phone the system already shows these: they were scheduled.
          show(due, phone);
        }
        if (plan) schedule(upcomingReminders(now, SCHEDULE_DAYS, exams, { today: cardsDue, any: decks.some((d) => d.total > 0) }, settings, sent, academic));
      } catch {
        /* backend not ready yet: next tick */
      } finally {
        busy.current = false;
      }
    };
    const first = setTimeout(() => check(phone), FAST ? 500 : 3000);
    const every = setInterval(check, FAST ? 1000 : 60_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") check(true);
    };
    if (phone) document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  if (!shown.length) return null;
  return (
    <div className="toasts" role="region" aria-label="Recordatorios">
      {shown.map((r) => (
        <div key={r.id} className="toast" role="status">
          <div>
            <strong>{r.title}</strong>
            <p>{r.body}</p>
          </div>
          <button className="btn ghost small" onClick={() => setShown((s) => s.filter((x) => x.id !== r.id))} aria-label={`Cerrar recordatorio: ${r.title}`}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
