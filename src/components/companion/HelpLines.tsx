import type { HelpResource } from "../../types";

/** AC-84: shown whenever the conversation shows signs of risk. */
export function HelpLines({ resources }: { resources: HelpResource[] }) {
  return (
    <section className="help-lines" role="region" aria-label="Líneas de ayuda">
      <h2>Hay personas que pueden escucharte ahora</h2>
      <p>Si pensás en hacerte daño, no estás obligado a atravesarlo solo. Llamar a una línea de ayuda o contarle a alguien de confianza puede aliviar, y vale la pena hacerlo hoy.</p>
      <ul>
        {resources.map((r) => (
          <li key={r.name}>
            <strong>{r.name}</strong>
            {r.detail && <span>{r.detail}</span>}
          </li>
        ))}
      </ul>
      <p className="help-lines-urgent">Si estás en peligro ahora mismo, llamá a emergencias.</p>
    </section>
  );
}
