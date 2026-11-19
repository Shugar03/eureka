// AC-113/AC-210: Mi progreso — the coach, the paths, the rest by state, and correcting it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ProgressScreen } from "./ProgressScreen";
import type { Session, StudentModel } from "../types";

afterEach(() => clearMocks());

const model = (fixed: boolean): StudentModel => ({
  topics: [
    { key: "derivada", name: "Derivada", status: fixed ? "practicando" : "le_cuesta", evidence: [fixed ? "la confusión «es el área» quedó reparada" : "confusión: es el área"], at: "2026-11-10T00:00:00Z", sources: ["confusión"], confusion: !fixed },
    { key: "plano", name: "el plano inclinado", status: "pendiente", evidence: ["quedó pendiente en «física»"], at: "2026-11-10T00:00:00Z", sources: ["memoria"], confusion: false },
    { key: "triangulos", name: "triángulos", status: "domina", evidence: ["terminaste la sesión del 28/10"], at: "2026-10-28T00:00:00Z", sources: ["sesión"], confusion: false },
  ],
  pending: [{ item: "el plano inclinado", session_id: "s1", session_title: "física", at: "" }],
  upcoming: [{ title: "Parcial de Análisis", date: "2026-11-02", days: 3, screen: "academic", id: "d1" }],
  preferences: [],
  cards_due: 4,
  minutes_7d: 95,
});

const física: Session = {
  id: "s1",
  title: "física",
  goal: "Fuerzas en el plano",
  phase: "teach",
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
  findings: [],
  plan: [
    { id: "n1", title: "Fuerza peso", summary: "", depends_on: [], status: "understood", note: "" },
    { id: "n2", title: "Descomponer fuerzas", summary: "", depends_on: [], status: "repair", note: "" },
    { id: "n3", title: "Rozamiento", summary: "", depends_on: [], status: "pending", note: "" },
  ],
  pending_question: null,
  messages: [],
};

function setup() {
  let fixed = false;
  mockIPC((cmd) => {
    if (cmd === "student_model") return model(fixed);
    if (cmd === "student_mark_known") {
      fixed = true;
      return model(true);
    }
    if (cmd === "activity_days") return [];
    if (cmd === "list_sessions") return [{ id: "s1", title: "física", goal: física.goal, phase: "teach", updated_at: física.updated_at, plan_total: 3, plan_done: 1 }];
    if (cmd === "get_session") return física;
    if (cmd === "get_identity") return { first_name: "Ana" };
    if (cmd === "memory_list") return [];
    if (cmd === "session_memories") return [];
    throw `unexpected ${cmd}`;
  });
  const go = { onOpenScreen: vi.fn(), onOpenSession: vi.fn(), onStudy: vi.fn() };
  render(<ProgressScreen {...go} />);
  return go;
}

describe("ProgressScreen (AC-113, AC-210)", () => {
  it("the coach says how it's going and what to do today, and each item goes where it should", async () => {
    const go = setup();
    const coach = await screen.findByRole("region", { name: "Cómo venís" });
    expect(within(coach).getByRole("heading", { level: 2 })).toHaveTextContent("Ana.");
    expect(coach).toHaveTextContent("Parcial de Análisis");
    const today = within(coach).getByRole("group", { name: "Hoy te conviene" });
    await userEvent.click(within(today).getByRole("button", { name: "Empezar: Repasar derivada" }));
    expect(go.onStudy).toHaveBeenCalledWith("Quiero repasar Derivada.");
    await userEvent.click(within(today).getByRole("button", { name: "Repasar: 4 tarjetas para hoy" }));
    expect(go.onOpenScreen).toHaveBeenCalledWith("cards");
    await userEvent.click(within(today).getByRole("button", { name: "Retomar: Retomar el plano inclinado" }));
    expect(go.onOpenSession).toHaveBeenCalledWith("s1");
  });

  it("shows the numbers and what is coming", async () => {
    const go = setup();
    const numbers = await screen.findByRole("region", { name: "Resumen" });
    expect(numbers).toHaveTextContent("95 min de foco");
    expect(numbers).toHaveTextContent("1 dominado de 3");
    await userEvent.click(screen.getByRole("button", { name: "Parcial de Análisis en 3 días" }));
    expect(go.onOpenScreen).toHaveBeenCalledWith("academic");
  });

  it("each session with a plan is a path, open on the one still going, with the next step", async () => {
    const go = setup();
    const ideas = await screen.findByRole("list", { name: "Ideas de Fuerzas en el plano" });
    expect(within(ideas).getByText("Fuerza peso")).toBeInTheDocument();
    await userEvent.click(within(ideas).getByRole("button", { name: "Seguir desde acá: Descomponer fuerzas" }));
    expect(go.onOpenSession).toHaveBeenCalledWith("s1");
    await userEvent.click(screen.getByRole("button", { name: /Fuerzas en el plano/ }));
    expect(screen.queryByRole("list", { name: "Ideas de Fuerzas en el plano" })).toBeNull();
  });

  it("the rest goes by state, with the evidence in your words, and «Ya lo sé» moves it", async () => {
    setup();
    const hard = await screen.findByRole("tabpanel", { name: "Te cuesta" });
    expect(within(hard).getByText("Derivada")).toBeInTheDocument();
    expect(within(hard).getByText("Confusión")).toBeInTheDocument();
    expect(within(hard).getByText("Es el área")).toBeInTheDocument();
    await userEvent.click(within(hard).getByRole("button", { name: "Esto ya lo sé: Derivada" }));
    expect(await screen.findByRole("tabpanel", { name: "Te cuesta" })).toHaveTextContent("Nada por ahora.");
    await userEvent.click(screen.getByRole("tab", { name: /Practicando/ }));
    expect(within(screen.getByRole("tabpanel", { name: "Practicando" })).getByText("Derivada")).toBeInTheDocument();
  });
});
