import { boldParts, parseNotes, sectionKind } from "../lib/releaseNotes";
import { Icon, type IconName } from "./Icon";

const ICON: Record<ReturnType<typeof sectionKind>, IconName> = { new: "sparkle", better: "spark", fixed: "target", other: "spark" };

/** The «Novedades» of a version: by section, one change per row, its name first. */
export function ReleaseNotes({ text }: { text: string }) {
  const sections = parseNotes(text);
  if (!sections.length) return null;
  return (
    <div className="rn">
      {sections.map((s, i) => {
        const kind = sectionKind(s.title);
        return (
          <section key={i} className={`rn-section is-${kind}`} aria-label={s.title ?? "Cambios"}>
            {s.title && (
              <h3 className="rn-title">
                <span className="rn-icon" aria-hidden>
                  <Icon name={ICON[kind]} size={14} />
                </span>
                {s.title}
              </h3>
            )}
            <ul className="rn-list">
              {s.items.map((it, j) => (
                <li key={j}>
                  {it.head ? (
                    <>
                      <strong>{it.head}</strong>
                      {it.body && <span>{inline(it.body.charAt(0).toUpperCase() + it.body.slice(1))}</span>}
                    </>
                  ) : (
                    <span className="is-plain">{inline(it.body)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function inline(text: string) {
  return boldParts(text).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>));
}
