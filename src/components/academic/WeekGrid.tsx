import type { Course } from "../../types";
import { blocksOn, daysShown, gridRange, hourMarks, WEEKDAYS, WEEKDAYS_SHORT } from "../../lib/academic";
import { isoWeekday } from "../../lib/plan";

/** Pixels per hour in the grid. */
const HOUR = 52;

/** AC-99: the week as a time grid, one coloured block per class. */
export function WeekGrid({ courses, today, onOpenCourse }: { courses: Course[]; today: string; onOpenCourse: (id: string) => void }) {
  const days = daysShown(courses);
  const range = gridRange(courses);
  const hours = (range.to - range.from) / 60;
  const todayWd = isoWeekday(today);
  return (
    <div className="week-time" role="group" aria-label="Horario semanal" style={{ ["--days" as string]: days.length }}>
      <div className="wt-hours" aria-hidden>
        <span className="wt-corner" />
        <div style={{ height: hours * HOUR }}>
          {hourMarks(range).map((h, i) => (
            <span key={h} className="wt-hour" style={{ top: i * HOUR }}>
              {h}
            </span>
          ))}
        </div>
      </div>
      {days.map((d) => (
        <div key={d} className={`wt-col ${d === todayWd ? "is-today" : ""}`} role="group" aria-label={WEEKDAYS[d - 1]}>
          <h3>{WEEKDAYS_SHORT[d - 1]}</h3>
          <div className="wt-body" style={{ height: hours * HOUR }}>
            {Array.from({ length: hours }, (_, i) => (
              <span key={i} className="wt-line" style={{ top: i * HOUR }} aria-hidden />
            ))}
            {blocksOn(courses, d, range).map((b, i) => {
              const room = b.slot.room || b.course.room;
              return (
                <button
                  key={i}
                  className={`wt-block cc-${b.course.color}`}
                  style={{ top: `${b.top}%`, height: `${b.height}%` }}
                  onClick={() => onOpenCourse(b.course.id)}
                  aria-label={`${b.course.name}, ${WEEKDAYS[d - 1]} de ${b.slot.start} a ${b.slot.end}${room ? `, ${room}` : ""}`}
                >
                  <span className="wt-name">{b.course.name}</span>
                  <span className="wt-meta">
                    {b.slot.start}–{b.slot.end}
                    {room ? ` · ${room}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
