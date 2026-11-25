// Companion (AC-82..88, AC-93..96) mock IPC handlers.
import type { EntryDraft, HelpResource, ThoughtRecord } from "../../types";
import { DELAY, UNHANDLED, clone, freshCompanion, nid, sleep, store } from "./state";

const CRISIS_REPLY = "Gracias por contármelo. Lo que decís me importa y quiero tomarlo en serio.\n\n¿Estás pensando en hacerte daño o en quitarte la vida? Si es así, no tenés que atravesar esto sin compañía: abajo te dejé líneas donde te atiende una persona, y si estás en peligro ahora, llamá a emergencias.";
const COMPANION_REPLIES = ["Suena a que venís cargado. ¿Qué fue lo más pesado de hoy?", "Tiene sentido que te sientas así. ¿Y qué te ayudó, aunque sea un poco?", "Gracias por contármelo. Acá sigo, sin apuro."];

/** Same text the app writes for a thought record. */
function thoughtText(r: ThoughtRecord): string {
  const out = [`Situación: ${r.situation}`, `Pensé: ${r.thought} (${r.before}/100)`];
  if (r.for_it) out.push(`Lo que lo apoya: ${r.for_it}`);
  if (r.against) out.push(`Lo que no encaja: ${r.against}`);
  if (r.alternative) out.push(`Otra mirada: ${r.alternative}`);
  if (r.after !== null && r.after !== undefined) out.push(`Después, la intensidad: ${r.after}/100`);
  return out.join("\n");
}

function companionGuard() {
  if (store.companion.pin !== null && !store.companion.unlocked) throw "El diario está bloqueado. Ingresá tu PIN.";
}

function companionView() {
  const c = store.companion;
  const locked = c.pin !== null && !c.unlocked;
  return clone({ locked, has_pin: c.pin !== null, privacy_ack: c.ack, resources: c.resources, conversation: locked ? { turns: [], risk: false } : { turns: c.turns, risk: c.risk }, entries: locked ? [] : c.entries, insights: locked ? {} : c.insights });
}

export async function handleCompanion(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "companion_state":
      return companionView();
    case "companion_ack_privacy":
      store.companion.ack = true;
      return companionView();
    case "companion_send": {
      companionGuard();
      const text = String(args.text ?? "").trim();
      if (!text) throw "Escribí algo para empezar.";
      if (text.includes("FALLA")) throw "el proveedor respondió 500 Internal Server Error: boom";
      const c = store.companion;
      const risky = /quitarme la vida|suicid|no quiero vivir|quiero morirme/i.test(text);
      const asked = c.turns.filter((t) => t.role === "user").length;
      const reply = risky ? CRISIS_REPLY : COMPANION_REPLIES[Math.min(asked, COMPANION_REPLIES.length - 1)];
      await sleep(DELAY * 4);
      c.turns.push({ role: "user", text, at: new Date().toISOString() }, { role: "assistant", text: reply, at: new Date().toISOString() });
      c.risk ||= risky;
      return companionView();
    }
    case "companion_new_conversation":
      companionGuard();
      store.companion.turns = [];
      store.companion.risk = false;
      return companionView();
    case "companion_propose_entry": {
      companionGuard();
      if (store.companion.turns.filter((t) => t.role === "user").length < 2) throw "Todavía no hay mucho para guardar. Charlemos un poco más.";
      return { title: "Una semana de parciales", text: "Estuve muy cansado con los parciales. Salir a caminar me ayudó.", mood: 2, emotions: ["cansancio"], helped: ["salir a caminar"] };
    }
    case "companion_save_entry": {
      companionGuard();
      const i = args.input as EntryDraft;
      const rec = i.record ?? null;
      if (rec && (!rec.situation.trim() || !rec.thought.trim())) throw "Contá qué pasó y qué pensaste.";
      if (rec && (rec.before > 100 || (rec.after ?? 0) > 100)) throw "La intensidad va de 0 a 100.";
      const text = rec ? thoughtText(rec) : i.text.trim();
      if (!text) throw "Escribí algo para guardar.";
      const found = i.id ? store.companion.entries.find((e) => e.id === i.id) : undefined;
      if (found) Object.assign(found, { title: i.title || found.title, text, mood: i.mood ?? null, emotions: i.emotions, helped: i.helped, ...(rec ? { record: rec } : {}) });
      else store.companion.entries.unshift({ id: nid(), at: new Date().toISOString(), kind: rec ? "thought" : "entry", title: i.title || (rec ? "Registro de pensamientos" : "Mi día"), text, mood: i.mood ?? null, emotions: i.emotions, helped: i.helped, record: rec });
      return companionView();
    }
    case "companion_delete_entry":
      companionGuard();
      store.companion.entries = store.companion.entries.filter((e) => e.id !== args.id);
      return companionView();
    case "companion_checkin":
      companionGuard();
      store.companion.entries.unshift({ id: nid(), at: new Date().toISOString(), kind: "checkin", title: "Check-in", text: String(args.note ?? "").trim(), mood: args.mood as number, emotions: args.emotions as string[], helped: [] });
      return companionView();
    case "companion_set_insight": {
      companionGuard();
      const key = String(args.key ?? "");
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(key)) throw "Esa observación no es válida.";
      if (args.verdict === null || args.verdict === undefined) delete store.companion.insights[key];
      else store.companion.insights[key] = args.verdict as "confirmed" | "rejected";
      return companionView();
    }
    case "companion_unlock":
      if (store.companion.pin !== String(args.pin ?? "").trim()) throw "PIN incorrecto.";
      store.companion.unlocked = true;
      return companionView();
    case "companion_lock":
      store.companion.unlocked = false;
      return companionView();
    case "companion_set_pin": {
      const c = store.companion;
      if (c.pin !== null && c.pin !== (args.current ?? "")) throw "El PIN actual no es correcto.";
      const next = args.newPin as string | null;
      if (next !== null && (next.trim().length < 4 || next.trim().length > 12)) throw "El PIN debe tener entre 4 y 12 caracteres.";
      c.pin = next === null ? null : next.trim();
      c.unlocked = true;
      return companionView();
    }
    case "companion_save_resources":
      store.companion.resources = (args.resources as HelpResource[]).filter((r) => r.name.trim());
      return companionView();
    case "companion_export":
      companionGuard();
      return JSON.stringify({ entradas: store.companion.entries, conversacion: { turns: store.companion.turns, risk: store.companion.risk } }, null, 2);
    case "companion_erase":
      // Like the app: erasing takes back the privacy acknowledgement too.
      store.companion = { ...freshCompanion(), ack: false };
      return companionView();
    default:
      return UNHANDLED;
  }
}
