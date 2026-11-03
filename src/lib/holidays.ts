// AC-145: Argentina's national holidays for any year, by Ley 27.399. They are
// computed, not listed, so they never run out: the fixed ones (inamovibles),
// Carnival and Good Friday from Easter, and the movable ones (trasladables),
// which move to Monday — from a Tuesday or Wednesday to the Monday before,
// from a Thursday or Friday to the Monday after (art. 6). The "días no
// laborables con fines turísticos" are set by decree each year: those are
// added by hand.
import { addDays } from "./cards";
import { isoWeekday } from "./plan";

export interface Holiday {
  date: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** Art. 6: Tuesday/Wednesday → the Monday before; Thursday/Friday → the Monday after. */
export function moved(date: string): string {
  const wd = isoWeekday(date);
  if (wd === 2 || wd === 3) return addDays(date, 1 - wd);
  if (wd === 4 || wd === 5) return addDays(date, 8 - wd);
  return date;
}

export function argentinaHolidays(year: number): Holiday[] {
  const e = easter(year);
  const fixed: Holiday[] = [
    { date: ymd(year, 1, 1), name: "Año Nuevo" },
    { date: addDays(e, -48), name: "Carnaval" },
    { date: addDays(e, -47), name: "Carnaval" },
    { date: ymd(year, 3, 24), name: "Día de la Memoria por la Verdad y la Justicia" },
    { date: ymd(year, 4, 2), name: "Día del Veterano y de los Caídos en Malvinas" },
    { date: addDays(e, -2), name: "Viernes Santo" },
    { date: ymd(year, 5, 1), name: "Día del Trabajador" },
    { date: ymd(year, 5, 25), name: "Revolución de Mayo" },
    { date: ymd(year, 6, 20), name: "Paso a la Inmortalidad de Belgrano" },
    { date: ymd(year, 7, 9), name: "Día de la Independencia" },
    { date: ymd(year, 12, 8), name: "Inmaculada Concepción de María" },
    { date: ymd(year, 12, 25), name: "Navidad" },
  ];
  const movable: Holiday[] = [
    { date: moved(ymd(year, 6, 17)), name: "Paso a la Inmortalidad de Güemes" },
    { date: moved(ymd(year, 8, 17)), name: "Paso a la Inmortalidad de San Martín" },
    { date: moved(ymd(year, 10, 12)), name: "Día del Respeto a la Diversidad Cultural" },
    { date: moved(ymd(year, 11, 20)), name: "Día de la Soberanía Nacional" },
  ];
  return [...fixed, ...movable].sort((a, b) => a.date.localeCompare(b.date));
}

/** The holidays between two days (inclusive), across years. */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const out: Holiday[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(...argentinaHolidays(y).filter((h) => h.date >= from && h.date <= to));
  return out;
}
