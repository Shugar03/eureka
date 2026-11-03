// AC-113: Mi progreso shows the student model and lets the person correct it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ProgressScreen } from "./ProgressScreen";
import type { StudentModel } from "../types";

afterEach(() => clearMocks());

const model = (fixed: boolean): StudentModel => ({
  topics: [
    { key: "derivada", name: "Derivada", status: fixed ? "practicando" : "le_cuesta", evidence: [fixed ? "la confusión quedó reparada" : "confusión: es el área"], at: "", sources: ["confusión"], confusion: !fixed },
    { key: "plano", name: "el plano inclinado", status: "pendiente", evidence: ["quedó pendiente en «física»"], at: "", sources: ["memoria"], confusion: false },
    { key: "triangulos", name: "triángulos", status: "domina", evidence: ["terminaste la sesión del 28/10"], at: "", sources: ["sesión"], confusion: false },
  ],
  pending: [{ item: "el plano inclinado", session_id: "s1", session_title: "física", at: "" }],
  upcoming: [{ title: "Parcial de Análisis", date: "2026-11-02", days: 3, screen: "academic", id: "d1" }],
  preferences: [],
  cards_due: 4,
  minutes_7d: 95,
});

describe("ProgressScreen (AC-113)", () => {
  it("groups topics by state with their evidence, and every action goes where it should", async () => {
    let fixed = false;
    mockIPC((cmd) => {
      if (cmd === "student_model") return model(fixed);
      if (cmd === "student_mark_known") {
        fixed = true;
        return model(true);
      }
      if (cmd === "get_learner") return { misconceptions: [], preferences: [] };
      if (cmd === "session_memories") return [];
      throw `unexpected ${cmd}`;
    });
    const onOpenScreen = vi.fn();
    const onOpenSession = vi.fn();
    const onStudy = vi.fn();
    render(<ProgressScreen onOpenScreen={onOpenScreen} onOpenSession={onOpenSession} onStudy={onStudy} />);

    const hard = await screen.findByRole("region", { name: "Le cuesta" });
    expect(within(hard).getByText("Derivada")).toBeInTheDocument();
    expect(within(hard).getByText("confusión: es el área")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ya lo domina" })).getByText("triángulos")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Parcial de Análisis en 3 días" }));
    expect(onOpenScreen).toHaveBeenCalledWith("academic");
    await userEvent.click(within(hard).getByRole("button", { name: "Repasarlo" }));
    expect(onStudy).toHaveBeenCalledWith("Quiero repasar Derivada.");
    await userEvent.click(within(screen.getByRole("region", { name: "Quedó pendiente" })).getByRole("button", { name: "Retomar" }));
    expect(onOpenSession).toHaveBeenCalledWith("s1");

    await userEvent.click(within(hard).getByRole("button", { name: "Esto ya lo sé: Derivada" }));
    expect(await within(screen.getByRole("region", { name: "Practicando" })).findByText("Derivada")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Le cuesta" })).getByText("Nada por ahora.")).toBeInTheDocument();
  });
});
