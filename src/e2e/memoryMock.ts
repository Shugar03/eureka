// AC-199/AC-200 in the web e2e: «Lo que Eureka sabe de vos» over an in-memory
// list that starts from the mock learner profile (and, with ?withMemory, a few
// more observations, one of them in conflict). Same rules as src-tauri/src/memdb.rs
// for what the screen can see: edits become verified and the student's.

import type { LearnerProfile, MemoryKind, MemoryObservation } from "../types";

const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function obs(id: number, kind: MemoryKind, title: string, content: string, label: string, extra: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id,
    topic: `${kind === "idea" ? "idea" : kind === "preferencia" ? "preferencia" : "concepto"}:${title.toLowerCase()}`,
    kind,
    title,
    content,
    evidence: [{ source: "session:mock", label, at: at(2) }],
    confidence: 0.5,
    created_at: at(2),
    updated_at: at(2),
    verified: false,
    by_student: false,
    due: null,
    state: "activa",
    conflict: false,
    ...extra,
  };
}

export class MemoryMock {
  private list: MemoryObservation[] | null = null;
  private next = 1;

  constructor(
    private learner: () => LearnerProfile,
    private withMemory: boolean,
  ) {}

  private all(): MemoryObservation[] {
    if (!this.list) {
      const p = this.learner();
      this.list = [
        ...p.misconceptions.map((m) => obs(this.next++, "confusion", m.concept, m.wrong_idea, m.source, { state: m.fixed ? "reparada" : "activa" })),
        ...p.preferences.map((x) => obs(this.next++, "preferencia", x.text, x.text, x.source)),
      ];
      if (this.withMemory) {
        this.list.push(
          obs(this.next++, "idea", "La derivada es la pendiente de la recta tangente", "La derivada es la pendiente de la recta tangente", "Sesión: derivadas"),
          obs(this.next++, "domina", "Regla de la cadena", "la respondió bien en una práctica", "Práctica: Derivadas", { verified: true, conflict: true, updated_at: at(6) }),
          obs(this.next++, "le_cuesta", "Regla de la cadena", "se trabó al derivar sen(x²)", "Sesión: repaso", { conflict: true }),
          obs(this.next++, "pendiente", "La demostración de la regla del producto", "La demostración de la regla del producto", "Sesión: derivadas", { due: "2026-01-01" }),
        );
      }
    }
    return this.list;
  }

  view(): MemoryObservation[] {
    return structuredClone(this.all().filter((o) => o.state === "activa" || o.state === "reparada"));
  }

  edit(id: number, title: string, content: string, kind: MemoryKind): MemoryObservation[] {
    if (!title.trim()) throw "El título no puede quedar vacío.";
    const o = this.all().find((x) => x.id === id);
    if (!o) throw "Eso ya no está en la memoria.";
    Object.assign(o, { title: title.trim(), content: content.trim(), kind, verified: true, by_student: true, conflict: false, state: "activa", updated_at: new Date().toISOString() });
    o.evidence = [{ source: "student", label: "Lo corregiste vos", at: o.updated_at }, ...o.evidence.filter((e) => e.source !== "student")];
    // The student's word settles a contradiction on the same topic.
    for (const other of this.all()) {
      if (other.id !== id && other.topic === o.topic && other.conflict) {
        other.conflict = false;
        other.state = "reemplazada";
      }
    }
    return this.view();
  }

  remove(id: number): MemoryObservation[] {
    const o = this.all().find((x) => x.id === id);
    if (o) {
      const p = this.learner();
      if (o.kind === "confusion") p.misconceptions = p.misconceptions.filter((m) => m.concept !== o.title);
      if (o.kind === "preferencia") p.preferences = p.preferences.filter((x) => x.text !== o.title);
      o.state = "borrada";
    }
    return this.view();
  }

  forgetAll(): MemoryObservation[] {
    this.all().forEach((o) => (o.state = "borrada"));
    const p = this.learner();
    p.misconceptions = [];
    p.preferences = [];
    return this.view();
  }

  exportPath(): string {
    return "C:\\Users\\vos\\Downloads\\Eureka - lo que sabe de vos 2026-11-05";
  }
}
