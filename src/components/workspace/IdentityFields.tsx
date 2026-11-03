import type { Identity } from "../../types";

type Patch = (p: Partial<Identity>) => void;
interface Props {
  identity: Identity;
  onChange: Patch;
}

/** AC-92: first and last name. */
export function NameFields({ identity, onChange }: Props) {
  return (
    <div className="id-grid">
      <label className="field">
        <span>Nombre</span>
        <input value={identity.first_name} maxLength={40} autoComplete="given-name" aria-label="Tu nombre" onChange={(e) => onChange({ first_name: e.target.value })} />
      </label>
      <label className="field">
        <span>Apellido</span>
        <input value={identity.last_name} maxLength={60} autoComplete="family-name" aria-label="Tu apellido" onChange={(e) => onChange({ last_name: e.target.value })} />
      </label>
    </div>
  );
}

/** AC-92: where and what they study, and their age. */
export function AboutFields({ identity, onChange }: Props) {
  return (
    <div className="id-grid">
      <label className="field">
        <span>Dónde estudiás</span>
        <input value={identity.school} maxLength={80} placeholder="Universidad, colegio, instituto…" aria-label="Dónde estudiás" onChange={(e) => onChange({ school: e.target.value })} />
      </label>
      <label className="field">
        <span>Qué estudiás</span>
        <input value={identity.career} maxLength={80} placeholder="Tu carrera, curso o materia" aria-label="Qué estudiás" onChange={(e) => onChange({ career: e.target.value })} />
      </label>
      <label className="field">
        <span>Edad (opcional)</span>
        <input type="number" min={5} max={110} value={identity.age ?? ""} aria-label="Tu edad" onChange={(e) => onChange({ age: e.target.value === "" ? null : Number(e.target.value) })} />
      </label>
    </div>
  );
}

const TREATMENTS: { id: Identity["treatment"]; label: string; hint: string }[] = [
  { id: "el", label: "Él", hint: "Te hablamos en masculino" },
  { id: "ella", label: "Ella", hint: "Te hablamos en femenino" },
  { id: "elle", label: "Elle", hint: "Lenguaje neutro, sin marcas de género" },
  { id: "", label: "Como sea", hint: "Sin preferencia: evitamos marcar" },
];

/** AC-92: how they prefer to be addressed. Inclusive on purpose, and always optional. */
export function TreatmentFields({ identity, onChange }: Props) {
  return (
    <div className="field">
      <div className="treatments" role="radiogroup" aria-label="Cómo preferís que te hablemos">
        {TREATMENTS.map((t) => (
          <button key={t.label} type="button" role="radio" aria-checked={identity.treatment === t.id} className={`treatment ${identity.treatment === t.id ? "is-selected" : ""}`} onClick={() => onChange({ treatment: t.id })}>
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>¿Preferís otra forma? (opcional)</span>
        <input value={identity.treatment_other} maxLength={80} placeholder="Escribila con tus palabras" aria-label="Otra forma de tratarte" onChange={(e) => onChange({ treatment_other: e.target.value })} />
      </label>
    </div>
  );
}
