// AC-220: a plan is shown by kind of change, applied once from its card, and undone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { FolderPlanCard } from "./FolderPlanCard";
import { DEMO_FOLDER, organizePlan } from "../../e2e/folderMock";
import type { FolderPlanMeta, Session } from "../../types";

afterEach(() => clearMocks());

describe("FolderPlanCard (AC-220)", () => {
  it("shows the changes by kind, and only Aplicar changes the folder; then Deshacer", async () => {
    const meta = organizePlan("c1", DEMO_FOLDER);
    const calls: string[] = [];
    const sessionWith = (m: FolderPlanMeta) => ({ id: "s1", messages: [{ role: "tool", tool_call_id: "c1", meta: m }] }) as unknown as Session;
    mockIPC((cmd, a) => {
      calls.push(`${cmd}:${(a as { callId: string }).callId}`);
      if (cmd === "folder_plan_apply") return sessionWith({ ...meta, status: "applied", done: 9 });
      if (cmd === "folder_plan_undo") return sessionWith({ ...meta, status: "undone", kept: [] });
      throw `unexpected ${cmd}`;
    });
    const onSession = vi.fn();
    const { rerender } = render(<FolderPlanCard meta={meta} sessionId="s1" callId="c1" onSession={onSession} />);
    const card = screen.getByRole("region", { name: "Cambios en «Apuntes»" });
    expect(card).toHaveTextContent("2 carpetas nuevas, 5 movidos o renombrados, 1 a la papelera, 1 documentos nuevos");
    // Nine changes: folded until asked.
    await userEvent.click(within(card).getByRole("button", { name: "Ver los 9 cambios" }));
    expect(within(card).getByRole("group", { name: "Mover o renombrar" })).toHaveTextContent("Física/TP 1 - Cinemática.pdf");
    expect(within(card).getByRole("group", { name: "A la papelera de Eureka" })).toHaveTextContent("se aparta, no se borra");

    await userEvent.click(within(card).getByRole("button", { name: "Aplicar" }));
    expect(calls).toEqual(["folder_plan_apply:c1"]);
    const applied = (onSession.mock.calls[0][0] as Session).messages[0].meta as FolderPlanMeta;
    rerender(<FolderPlanCard meta={applied} sessionId="s1" callId="c1" onSession={onSession} />);
    expect(screen.getByRole("region", { name: "Cambios en «Apuntes»" })).toHaveTextContent("Hecho");
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(calls).toEqual(["folder_plan_apply:c1", "folder_plan_undo:c1"]);
    const undone = (onSession.mock.calls[1][0] as Session).messages[0].meta as FolderPlanMeta;
    rerender(<FolderPlanCard meta={undone} sessionId="s1" callId="c1" onSession={onSession} />);
    expect(screen.getByRole("region", { name: "Cambios en «Apuntes»" })).toHaveTextContent("La carpeta quedó como estaba.");
  });

  it("a plan cut halfway says how far it got and can be undone", () => {
    const meta = { ...organizePlan("c1", DEMO_FOLDER), status: "failed" as const, done: 3, error: "no pude mover «tp2 dinamica.docx» (¿está abierto en otro programa?)" };
    render(<FolderPlanCard meta={meta} sessionId="s1" callId="c1" onSession={() => {}} />);
    expect(screen.getByText(/está abierto en otro programa.*Se hicieron 3 pasos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });
});
