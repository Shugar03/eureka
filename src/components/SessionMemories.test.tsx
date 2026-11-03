// AC-110: what Eureka remembers of each session, and forgetting it.
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { SessionMemories } from "./Settings";
import type { RememberedSession } from "../types";

afterEach(() => clearMocks());

describe("SessionMemories (AC-110)", () => {
  it("lists each session's memory with what is pending and lets the person forget one", async () => {
    let list: RememberedSession[] = [
      { id: "a", title: "Triángulos", updated_at: "2026-10-28T10:00:00Z", archived: true, memory: { summary: "Vimos el triángulo equilátero.", pending: ["la demostración"], struggled: ["la altura"], messages: 8, at: "" } },
    ];
    mockIPC((cmd, args) => {
      if (cmd === "session_memories") return list;
      if (cmd === "forget_session_memory") {
        list = list.filter((r) => r.id !== (args as { id: string }).id);
        return list;
      }
      throw `unexpected ${cmd}`;
    });
    render(<SessionMemories />);
    expect(await screen.findByText("Vimos el triángulo equilátero.")).toBeInTheDocument();
    expect(screen.getByText("Pendiente: la demostración")).toBeInTheDocument();
    expect(screen.getByText("Le costó: la altura")).toBeInTheDocument();
    expect(screen.getByText(/archivada/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Olvidar lo que recuerda de Triángulos" }));
    expect(await screen.findByText(/Todavía nada/)).toBeInTheDocument();
  });
});
