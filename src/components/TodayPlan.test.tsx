// AC-112: the plan for today and "since last time" on Home.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { sinceLastVisit, TodayPlan } from "./TodayPlan";
import type { RememberedSession, Suggestion } from "../types";

const mem = (title: string, at: string, pending: string[] = []): RememberedSession => ({ id: title, title, updated_at: at, archived: false, memory: { summary: "x", pending, struggled: [], messages: 4, at } });

beforeEach(() => localStorage.removeItem("la.lastVisit"));
afterEach(() => clearMocks());

describe("TodayPlan (AC-112)", () => {
  it("says only what was noted after the last visit", () => {
    const list = [mem("nueva", "2026-10-28T12:00:00Z"), mem("vieja", "2026-10-20T12:00:00Z")];
    expect(sinceLastVisit(list, "2026-10-25T00:00:00Z").map((r) => r.title)).toEqual(["nueva"]);
    expect(sinceLastVisit(list, null)).toEqual([]);
  });

  it("shows each suggestion with its reason and sends each one to its place", async () => {
    localStorage.setItem("la.lastVisit", "2026-10-25T00:00:00Z");
    const plan: Suggestion[] = [
      { title: "Prepará Parcial de Análisis", reason: "Parcial de Análisis en 3 días; te cuesta derivadas.", screen: "academic", target_id: "d1", prompt: null },
      { title: "Retomá: la demostración", reason: "Quedó pendiente en «geometría».", screen: "session", target_id: "s9", prompt: null },
      { title: "Repasá derivadas", reason: "confusión: es el área", screen: "chat", target_id: null, prompt: "Quiero repasar derivadas." },
    ];
    mockIPC((cmd) => {
      if (cmd === "student_today") return plan;
      if (cmd === "session_memories") return [mem("triángulos", "2026-10-28T12:00:00Z", ["la demostración"])];
      throw `unexpected ${cmd}`;
    });
    const onOpenScreen = vi.fn();
    const onOpenSession = vi.fn();
    const onStartChat = vi.fn();
    render(<TodayPlan onOpenScreen={onOpenScreen} onOpenSession={onOpenSession} onStartChat={onStartChat} />);
    expect(await screen.findByText("Parcial de Análisis en 3 días; te cuesta derivadas.")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Desde la última vez anoté lo de «triángulos»: quedó pendiente la demostración.");
    await userEvent.click(screen.getByRole("button", { name: "Empezar: Prepará Parcial de Análisis" }));
    await userEvent.click(screen.getByRole("button", { name: "Empezar: Retomá: la demostración" }));
    await userEvent.click(screen.getByRole("button", { name: "Empezar: Repasá derivadas" }));
    expect(onOpenScreen).toHaveBeenCalledWith("academic");
    expect(onOpenSession).toHaveBeenCalledWith("s9");
    expect(onStartChat).toHaveBeenCalledWith("Quiero repasar derivadas.");
    expect(localStorage.getItem("la.lastVisit")! > "2026-10-25").toBe(true);
  });

  it("renders nothing when there is nothing to suggest", async () => {
    mockIPC((cmd) => (cmd === "student_today" || cmd === "session_memories" ? [] : null));
    const { container } = render(<TodayPlan onOpenScreen={() => {}} onOpenSession={() => {}} onStartChat={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
