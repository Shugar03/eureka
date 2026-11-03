// SessionView against a tiny controllable IPC mock: errors, retry, composer,
// busy state — the parts the scripted backend can't make fail on demand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";
import { SessionView } from "./SessionView";
import type { AgentEvent, Session } from "../types";

const base = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "Tema",
  goal: "Tema",
  phase: "teach",
  created_at: "",
  updated_at: "",
  findings: [],
  plan: [],
  pending_question: null,
  messages: [{ role: "assistant", content: "Hola, ¿dudas?" }],
  ...over,
});

let session: Session;
let sent: unknown[];
let turn: (ch: Channel<AgentEvent>) => Promise<void>;

beforeEach(() => {
  session = base();
  sent = [];
  turn = async (ch) => {
    ch.onmessage({ type: "done" });
  };
  mockIPC(async (cmd, args) => {
    const a = args as Record<string, unknown>;
    if (cmd === "get_session") return structuredClone(session);
    if (cmd === "send_message") {
      sent.push(a.input);
      return turn(a.onEvent as Channel<AgentEvent>);
    }
    if (cmd === "stop_agent") return null;
    if (cmd === "import_book") return { id: "b1", title: a.title, sections: 3 };
    if (cmd === "get_settings") return { roles: {}, providers: [], accessibility: {} };
    throw `unexpected ${cmd}`;
  });
});
afterEach(() => clearMocks());

const renderView = (props: Partial<Parameters<typeof SessionView>[0]> = {}) =>
  render(<SessionView id="s1" onBack={() => {}} onOpenSettings={() => {}} onChanged={() => {}} onOpenGraph={() => {}} onOpenCode={() => {}} onOpenScreen={() => {}} onOpenExam={() => {}} onOpenDeck={() => {}} onOpenPractice={() => {}} onUiCommand={() => {}} uiSnapshot={() => ""} {...props} />);

describe("SessionView", () => {
  it("shows loading, then the transcript, and does not auto-run when the assistant spoke last", async () => {
    renderView();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(await screen.findByText("Hola, ¿dudas?")).toBeInTheDocument();
    expect(sent).toEqual([]);
    expect(screen.getByText("Todavía no hay hallazgos.")).toBeInTheDocument();
  });

  it("auto-runs once for a fresh session", async () => {
    session = base({ messages: [{ role: "user", content: "Quiero entender: x" }] });
    renderView();
    await vi.waitFor(() => expect(sent).toEqual([null]));
  });

  it("Enter sends a trimmed message, Shift+Enter does not, blank is disabled", async () => {
    renderView();
    const box = await screen.findByRole("textbox", { name: "Mensaje" });
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await userEvent.type(box, "   ");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await userEvent.type(box, "{Enter}");
    expect(sent).toEqual([]);
    await userEvent.clear(box);
    await userEvent.type(box, "una{Shift>}{Enter}{/Shift}duda");
    expect(sent).toEqual([]);
    await userEvent.type(box, "{Enter}");
    await vi.waitFor(() => expect(sent).toEqual([{ text: "una\nduda" }]));
  });

  it("shows the thinking indicator and Stop while busy, then streams text", async () => {
    let release!: () => void;
    turn = (ch) =>
      new Promise<void>((resolve) => {
        release = () => {
          ch.onmessage({ type: "text", delta: "Escribiendo" });
          resolve();
        };
      });
    renderView();
    await userEvent.type(await screen.findByRole("textbox", { name: "Mensaje" }), "hola{Enter}");
    expect(await screen.findByRole("status", { name: "El agente está pensando" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detener" })).toBeInTheDocument();
    await act(async () => release());
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Detener" })).not.toBeInTheDocument());
  });

  it("says what the agent is doing, and drops the label when text arrives", async () => {
    let release!: () => void;
    turn = (ch) =>
      new Promise<void>((resolve) => {
        ch.onmessage({ type: "activity", label: "Buscando en tu biblioteca…" });
        release = () => {
          ch.onmessage({ type: "text", delta: "Listo" });
          resolve();
        };
      });
    renderView();
    await userEvent.type(await screen.findByRole("textbox", { name: "Mensaje" }), "hola{Enter}");
    expect(await screen.findByRole("status", { name: "Buscando en tu biblioteca…" })).toHaveTextContent("Buscando en tu biblioteca…");
    await act(async () => release());
    await vi.waitFor(() => expect(screen.queryByText("Buscando en tu biblioteca…")).not.toBeInTheDocument());
  });

  it("the + puts a document in the library and sends it with the message (AC-105)", async () => {
    renderView();
    await screen.findByText("Hola, ¿dudas?");
    const file = new File(["Tema uno\n\nTexto del apunte."], "apuntes_fisica.txt", { type: "text/plain" });
    await userEvent.upload(screen.getByTestId("attach-input"), file);
    expect(await screen.findByText("apuntes fisica")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Mensaje" }), "resumímelo");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await vi.waitFor(() => expect(sent).toEqual([{ text: "resumímelo\n\nAdjunté a mi biblioteca: «apuntes fisica»." }]));
    expect(screen.queryByText("apuntes fisica")).not.toBeInTheDocument();
  });

  it("the + refuses a file it cannot read and the chip can be removed", async () => {
    renderView();
    await screen.findByText("Hola, ¿dudas?");
    await userEvent.upload(screen.getByTestId("attach-input"), new File(["x"], "plano.zip", { type: "application/zip" }), { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("plano.zip");
    await userEvent.upload(screen.getByTestId("attach-input"), new File(["hola"], "a.md", { type: "text/markdown" }));
    await userEvent.click(await screen.findByRole("button", { name: "Quitar a" }));
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("the microphone is always there and says where to set up Voz when there is no model (AC-105)", async () => {
    renderView();
    await screen.findByText("Hola, ¿dudas?");
    await userEvent.click(screen.getByRole("button", { name: "Hablar con el micrófono" }));
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Ajustes → Avanzado");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Win + H");
  });

  it("a config error offers Abrir ajustes and Reintentar", async () => {
    const onOpenSettings = vi.fn();
    session = base({ messages: [{ role: "user", content: "Quiero entender: x" }] });
    turn = async (ch) => {
      ch.onmessage({ type: "error", message: "Falta la API key de OpenRouter. Cargala en Ajustes." });
      ch.onmessage({ type: "done" });
      throw "Falta la API key";
    };
    renderView({ onOpenSettings });
    expect(await screen.findByRole("alert")).toHaveTextContent("Falta la API key de OpenRouter");
    await userEvent.click(screen.getByRole("button", { name: "Abrir ajustes" }));
    expect(onOpenSettings).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await vi.waitFor(() => expect(sent).toEqual([null, null]));
  });

  it("a non-config error offers retry but not settings, keeping the first message", async () => {
    session = base({ messages: [{ role: "user", content: "Quiero entender: x" }] });
    turn = async (ch) => {
      ch.onmessage({ type: "error", message: "el proveedor respondió 503" });
      throw "otra cosa";
    };
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("el proveedor respondió 503");
    expect(screen.queryByRole("button", { name: "Abrir ajustes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("an invoke failure without an error event still shows it", async () => {
    session = base({ messages: [{ role: "user", content: "Quiero entender: x" }] });
    turn = async () => {
      throw "se cortó la conexión";
    };
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("se cortó la conexión");
  });

  it("a pending question keeps the composer: writing there is a free message, not the form's answer", async () => {
    session = base({
      pending_question: "q1",
      messages: [{ role: "assistant", tool_calls: [{ id: "q1", type: "function", function: { name: "ask_question", arguments: '{"question":"¿Y?","purpose":"check"}' } }] }],
    });
    renderView();
    const box = await screen.findByRole("textbox", { name: "Mensaje" });
    expect(box).toHaveAttribute("placeholder", expect.stringContaining("Respondé la pregunta de arriba o escribí lo que quieras"));
    await userEvent.type(box, "esperá, antes explicame qué es un límite");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await vi.waitFor(() => expect(sent).toEqual([{ text: "esperá, antes explicame qué es un límite", free: true }]));
  });

  it("the breadcrumb goes back and the header shows the phase", async () => {
    const onBack = vi.fn();
    renderView({ onBack });
    await userEvent.click(await screen.findByRole("button", { name: "Volver a Sesiones" }));
    expect(onBack).toHaveBeenCalled();
    expect(document.querySelector(".chat-head .pill")).toHaveTextContent("Enseñar");
  });
});
