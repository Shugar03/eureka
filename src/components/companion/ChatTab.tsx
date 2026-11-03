import { useEffect, useId, useRef, useState } from "react";
import { companionApi, errorText } from "../../api";
import type { CompanionView, EntryDraft } from "../../types";
import { STARTERS } from "../../lib/companion";
import { ReadAloud } from "../a11y/ReadAloud";
import { Dictate } from "../a11y/Dictate";
import { DraftEditor } from "./DraftEditor";
import { HelpLines } from "./HelpLines";

/** AC-82: the conversation. No teaching, no plan — just listening. */
export function ChatTab({ view, onView }: { view: CompanionView; onView: (v: CompanionView) => void }) {
  const turns = view.conversation.turns;
  const userTurns = turns.filter((t) => t.role === "user").length;
  const proposeHint = useId();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState<"proposing" | "saving" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length, pending]);

  const send = async (text = draft) => {
    const t = text.trim();
    if (!t || pending) return;
    setPending(t);
    setError(null);
    setNotice(null);
    try {
      onView(await companionApi.send(t));
      setDraft("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };

  const propose = async () => {
    setBusy("proposing");
    setError(null);
    try {
      setProposal(await companionApi.proposeEntry());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async (d: EntryDraft) => {
    setBusy("saving");
    setError(null);
    try {
      await companionApi.saveEntry(d);
      onView(await companionApi.newConversation());
      setProposal(null);
      setNotice("Guardado en tu diario. Cuando quieras, empezamos una charla nueva.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const fresh = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    try {
      onView(await companionApi.newConversation());
      setNotice(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="companion-chat">
      <div className="companion-transcript" role="log" aria-live="polite" aria-label="Conversación">
        {turns.length === 0 && !pending && (
          <div className="companion-empty">
            <h2>Contame cómo estás</h2>
            <p>Acá no se estudia. Podés hablar de lo que quieras, a tu ritmo, o no decir nada por un rato.</p>
            <div className="examples">
              {STARTERS.map((s) => (
                <button key={s} className="chip" onClick={() => setDraft(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`companion-bubble ${t.role}`}>
            <p>{t.text}</p>
            {t.role === "assistant" && <ReadAloud markdown={t.text} />}
          </div>
        ))}
        {pending && (
          <>
            <div className="companion-bubble user">
              <p>{pending}</p>
            </div>
            <p className="muted small" role="status">
              Escuchando…
            </p>
          </>
        )}
        <div ref={end} />
      </div>

      {view.conversation.risk && <HelpLines resources={view.resources} />}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {proposal ? (
        <DraftEditor draft={proposal} heading="Así quedaría tu entrada" busy={busy === "saving"} onSave={save} onCancel={() => setProposal(null)} />
      ) : (
        <footer className="companion-composer">
          <div className="composer-row">
            <textarea
              value={draft}
              rows={2}
              placeholder="Escribí lo que quieras… (Enter para enviar)"
              aria-label="Mensaje"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Dictate onText={(t) => setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t))} />
            <button className="btn primary" onClick={() => send()} disabled={!draft.trim() || !!pending}>
              Enviar
            </button>
          </div>
          <div className="row">
            <button className="btn small" onClick={propose} disabled={userTurns < 2 || busy !== null || !!pending} title={userTurns < 2 ? "Charlemos un poco más primero" : undefined} aria-describedby={userTurns < 2 ? proposeHint : undefined}>
              {busy === "proposing" ? "Preparando la entrada…" : "Guardar esta charla en mi diario"}
            </button>
            {userTurns < 2 && (
              <span id={proposeHint} className="muted small touch-hint">
                Charlemos un poco más primero
              </span>
            )}
            <button className={`btn small ${armed ? "danger" : "ghost"}`} onClick={fresh} onBlur={() => setArmed(false)} disabled={turns.length === 0 || !!pending}>
              {armed ? "¿Seguro? Empezar de nuevo" : "Nueva charla"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
