// AC-107: pin, rename, archive and delete sessions, against a small IPC mock.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { useEffect, useState } from "react";
import { api } from "../api";
import { SessionList } from "./SessionList";
import type { SessionSummary } from "../types";

let sessions: SessionSummary[];
let calls: { cmd: string; args: Record<string, unknown> }[];

const row = (id: string, title: string, over: Partial<SessionSummary> = {}): SessionSummary => ({ id, title, goal: "", phase: "chat", updated_at: "2026-10-28T10:00:00Z", plan_total: 0, plan_done: 0, ...over });

beforeEach(() => {
  sessions = [row("a", "Triángulos"), row("b", "Derivadas"), row("c", "Historia vieja", { archived: true })];
  calls = [];
  mockIPC((cmd, args) => {
    const a = args as Record<string, unknown>;
    calls.push({ cmd, args: a });
    if (cmd === "list_sessions") return [...sessions].sort((x, y) => Number(!!y.pinned) - Number(!!x.pinned));
    if (cmd === "update_session_meta") {
      const s = sessions.find((x) => x.id === a.id)!;
      if (typeof a.title === "string") s.title = a.title;
      if (typeof a.pinned === "boolean") s.pinned = a.pinned;
      if (typeof a.archived === "boolean") s.archived = a.archived;
      return s;
    }
    if (cmd === "delete_session") {
      sessions = sessions.filter((x) => x.id !== a.id);
      return null;
    }
    throw `unexpected ${cmd}`;
  });
});
afterEach(() => clearMocks());

/** Like Home: the list reloads after every change. */
function Harness() {
  const [list, setList] = useState<SessionSummary[]>([]);
  const refresh = () => void api.listSessions().then(setList);
  useEffect(refresh, []);
  return <SessionList sessions={list} onOpen={() => {}} onChanged={refresh} />;
}

const titles = () => screen.getAllByRole("listitem").map((li) => li.querySelector(".session-title")?.textContent?.replace("● ", ""));

describe("SessionList (AC-107)", () => {
  it("hides archived sessions behind a toggle and can bring them back", async () => {
    render(<Harness />);
    expect(await screen.findByText("Triángulos")).toBeInTheDocument();
    expect(screen.queryByText("Historia vieja")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Archivadas (1)" }));
    expect(screen.getByRole("heading", { name: "Archivadas" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Desarchivar Historia vieja" }));
    expect(await screen.findByText("No hay sesiones archivadas.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver a sesiones" }));
    expect(await screen.findByText("Historia vieja")).toBeInTheDocument();
  });

  it("pins a session to the top and archives another", async () => {
    render(<Harness />);
    await screen.findByText("Derivadas");
    await userEvent.click(screen.getByRole("button", { name: "Fijar Derivadas" }));
    await screen.findByRole("button", { name: "Desfijar Derivadas" });
    expect(titles()[0]).toBe("Derivadas");
    expect(within(screen.getAllByRole("listitem")[0]).getByLabelText("Fijada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archivar Triángulos" }));
    await screen.findByRole("button", { name: "Archivadas (2)" });
    expect(screen.queryByText("Triángulos")).toBeNull();
  });

  it("renames inline; Escape cancels and an empty name can't be saved", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Renombrar Triángulos" }));
    const box = screen.getByLabelText("Nuevo nombre de Triángulos");
    await userEvent.clear(box);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await userEvent.type(box, "Geometría{Enter}");
    expect(await screen.findByText("Geometría")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Renombrar Geometría" }));
    await userEvent.type(screen.getByLabelText("Nuevo nombre de Geometría"), "xx{Escape}");
    expect(screen.getByText("Geometría")).toBeInTheDocument();
    expect(calls.filter((c) => c.cmd === "update_session_meta")).toHaveLength(1);
  });

  it("deleting keeps what was learned unless the person asks to forget it", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Borrar Triángulos" }));
    const confirm = screen.getByRole("group", { name: "Confirmar borrar Triángulos" });
    expect(confirm).toHaveTextContent("sigue en tu memoria");
    await userEvent.click(within(confirm).getByRole("button", { name: "Borrar" }));
    await screen.findByText("Derivadas");
    expect(screen.queryByText("Triángulos")).toBeNull();
    expect(calls.find((c) => c.cmd === "delete_session")?.args).toMatchObject({ id: "a", forget: false });

    await userEvent.click(screen.getByRole("button", { name: "Borrar Derivadas" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Olvidar también lo que aprendí en esta sesión" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Confirmar borrar Derivadas" })).getByRole("button", { name: "Borrar" }));
    await screen.findByText("Todas tus sesiones están archivadas.");
    expect(calls.filter((c) => c.cmd === "delete_session")[1].args).toMatchObject({ id: "b", forget: true });
  });
});
