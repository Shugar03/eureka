import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "./Sidebar";
import type { SessionSummary } from "../types";

const s = (id: string, title: string): SessionSummary => ({
  id,
  title,
  goal: title,
  phase: "teach",
  updated_at: "2026-10-26T00:00:00Z",
  plan_total: 3,
  plan_done: 1,
});

function setup(sessions: SessionSummary[] = [s("1", "Derivadas"), s("2", "Entropía")]) {
  const props = {
    sessions,
    activeId: "2",
    view: "session" as const,
    onHome: vi.fn(),
    onOpen: vi.fn(),
    onSettings: vi.fn(),
    onGraph: vi.fn(),
    onPractice: vi.fn(),
    onExams: vi.fn(),
    onCards: vi.fn(),
    onAgenda: vi.fn(),
    onAcademic: vi.fn(),
    onClasses: vi.fn(),
    onProgress: vi.fn(),
    onCode: vi.fn(),
    onLibrary: vi.fn(),
    onLanguage: vi.fn(),
    onCompanion: vi.fn(),
    onCommand: vi.fn(),
    theme: "dark" as const,
    onTheme: vi.fn(),
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("lists sessions and marks the active one", () => {
    setup();
    expect(screen.getByRole("button", { name: "Entropía" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Derivadas" })).not.toHaveAttribute("aria-current");
  });

  it("navigates", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Derivadas" }));
    expect(p.onOpen).toHaveBeenCalledWith("1");
    await userEvent.click(screen.getByRole("button", { name: "Nueva sesión" }));
    await userEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    await userEvent.click(screen.getByRole("button", { name: /Buscar o ejecutar/ }));
    expect([p.onHome, p.onSettings, p.onCommand].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it("shows the empty state", () => {
    setup([]);
    expect(screen.getByText("Todavía no hay sesiones.")).toBeInTheDocument();
  });

  it("switches theme from the radio group", async () => {
    const p = setup();
    expect(screen.getByRole("radio", { name: "Tema oscuro" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Tema claro" }));
    expect(p.onTheme).toHaveBeenCalledWith("light");
  });
});
