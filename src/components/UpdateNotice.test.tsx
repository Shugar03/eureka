// AC-202: «Novedades» after an update can be read to the end with the keyboard.
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { WhatsNewCard } from "./UpdateNotice";

afterEach(() => clearMocks());

describe("WhatsNewCard (AC-202)", () => {
  it("the notes take the focus so they can be scrolled, and Tab stays inside the dialog", async () => {
    mockIPC((cmd) => {
      if (cmd === "update_whats_new") return { version: "0.11.0", from: "0.10.0", notes: "### Nuevo\n- **Carpetas de trabajo:** se puede **deshacer** (AC-219..AC-222)." };
      throw `unexpected ${cmd}`;
    });
    render(<WhatsNewCard />);
    const done = await screen.findByRole("button", { name: "Listo" });
    await waitFor(() => expect(done).toHaveFocus());
    const notes = screen.getByRole("region", { name: "Lista de novedades" });
    expect(notes).not.toHaveTextContent("AC-219");
    await userEvent.tab();
    expect(notes).toHaveFocus();
    await userEvent.tab();
    expect(done).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(notes).toHaveFocus();
  });
});
