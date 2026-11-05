// AC-199/AC-200: «Lo que Eureka sabe de vos»: by type, correct, delete, export.
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { MemorySection } from "./MemorySection";
import type { MemoryObservation } from "../types";

afterEach(() => clearMocks());

const o = (id: number, kind: MemoryObservation["kind"], title: string, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  topic: `concepto:${title}`,
  kind,
  title,
  content: "",
  evidence: [{ source: "session:a", label: "Sesión: derivadas", at: "2026-11-01T10:00:00Z" }],
  confidence: 0.5,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  verified: false,
  by_student: false,
  due: null,
  state: "activa",
  conflict: false,
  ...extra,
});

describe("MemorySection (AC-199, AC-200)", () => {
  it("groups by type, corrects (verified, the student's) and deletes", async () => {
    let list = [o(1, "le_cuesta", "Regla de la cadena", { conflict: true }), o(2, "domina", "Límites", { verified: true }), ...Array.from({ length: 10 }, (_, i) => o(10 + i, "idea", `Idea ${i}`))];
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      calls.push(cmd);
      const a = args as { id: number; title: string; content: string; kind: MemoryObservation["kind"] };
      if (cmd === "memory_list") return list;
      if (cmd === "memory_edit") {
        list = list.map((x) => (x.id === a.id ? { ...x, title: a.title, content: a.content, kind: a.kind, by_student: true, verified: true, conflict: false } : x));
        return list;
      }
      if (cmd === "memory_delete") return (list = list.filter((x) => x.id !== a.id));
      if (cmd === "memory_export") return "C:/Descargas/Eureka - lo que sabe de vos";
      throw `unexpected ${cmd}`;
    });
    render(<MemorySection />);
    const hard = await screen.findByRole("list", { name: "Le cuesta" });
    expect(within(hard).getByText("se contradice con otra")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Ya lo domina" })).getByText("verificada")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Ideas que entendiste" })).getAllByRole("listitem")).toHaveLength(8);
    await userEvent.click(screen.getByRole("button", { name: "Ver todas (10)" }));
    expect(within(screen.getByRole("list", { name: "Ideas que entendiste" })).getAllByRole("listitem")).toHaveLength(10);

    await userEvent.click(screen.getByRole("button", { name: "Corregir: Regla de la cadena" }));
    const form = screen.getByRole("form", { name: "Corregir: Regla de la cadena" });
    await userEvent.selectOptions(within(form).getByLabelText("Qué es"), "domina");
    await userEvent.type(within(form).getByLabelText("Detalle"), "ya la saco");
    await userEvent.click(within(form).getByRole("button", { name: "Guardar" }));
    const mastered = await screen.findByRole("list", { name: "Ya lo domina" });
    expect(within(mastered).getByText("lo corregiste vos")).toBeInTheDocument();
    expect(within(mastered).getByText("ya la saco")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Le cuesta" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Borrar: Límites" }));
    expect(screen.queryByText("Límites")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Exportar para Obsidian" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Eureka - lo que sabe de vos");
    expect(calls).toContain("memory_export");
  });

  it("an empty title can't be saved and an empty memory says so", async () => {
    mockIPC((cmd) => (cmd === "memory_list" ? [o(1, "pendiente", "La demostración")] : []));
    render(<MemorySection />);
    await userEvent.click(await screen.findByRole("button", { name: "Corregir: La demostración" }));
    await userEvent.clear(screen.getByLabelText("Título"));
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(screen.getByRole("button", { name: "Borrar: La demostración" }));
    expect(await screen.findByText(/Todavía nada/)).toBeInTheDocument();
  });
});
