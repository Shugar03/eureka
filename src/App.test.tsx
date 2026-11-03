// Whole-app integration in jsdom: the real React tree + api.ts + IPC Channel,
// against the scripted fake backend (the same one the web e2e use).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { PomodoroProvider } from "./components/pomodoro/PomodoroContext";
import { install } from "./e2e/mockBackend";

beforeAll(() => install());

const pendingQuestion = () => screen.findByTestId("question-pending", {}, { timeout: 5000 });

async function answer(opts: { text?: string; option?: string; confidence: number }) {
  const q = within(await pendingQuestion());
  if (opts.option) await userEvent.click(q.getByRole("radio", { name: opts.option }));
  if (opts.text) await userEvent.type(q.getByLabelText("Tu respuesta"), opts.text);
  await userEvent.click(q.getByRole("radio", { name: new RegExp(`^Confianza ${opts.confidence}:`) }));
  await userEvent.click(q.getByRole("button", { name: "Responder" }));
}

describe("App (jsdom + fake backend)", () => {
  it("runs a session from the goal to the plan", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Mensaje"), "qué es una derivada");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));

    expect(await pendingQuestion()).toHaveTextContent("pendiente 2");
    expect(screen.getByRole("list", { name: "Fases" }).querySelector("[aria-current='step']")).toHaveTextContent("Medir");

    await answer({ text: "sube 2", confidence: 4 });
    expect(await screen.findByText("sólido")).toBeInTheDocument();
    await screen.findByText("Crece sin límite", {}, { timeout: 5000 });
    await answer({ option: "A 0", confidence: 3 });

    expect(await screen.findByText(/zoom infinito/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Fases" }).querySelector("[aria-current='step']")).toHaveTextContent("Enseñar");
    expect(screen.getByTestId("plan-derivada")).toHaveAttribute("data-status", "pending");

    // The sidebar learned about the session.
    const nav = screen.getByRole("navigation", { name: "Navegación" });
    expect(within(nav).getByRole("button", { name: "qué es una derivada" })).toHaveAttribute("aria-current", "page");
  }, 20_000); // the whole goal → probe → plan flow; slow when the suite runs in parallel
});

describe("App shell", () => {
  it("opens the palette with Ctrl+K and runs a command", async () => {
    render(<App />);
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox", { name: "Buscar comando" });
    await userEvent.type(input, "tema: claro{Enter}");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Tema oscuro" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("routes to settings and back to where it was", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByRole("heading", { name: "¿Qué querés entender?" })).toBeInTheDocument();
  });

  it("starts from an example and deletes with confirmation", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Qué es la entropía en termodinámica" }));
    await pendingQuestion();
    await userEvent.click(screen.getByRole("button", { name: "Volver a Sesiones" }));
    const region = await screen.findByRole("region", { name: "Sesiones" });
    const row = within(region).getByText("Qué es la entropía en termodinámica").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /^Borrar/ }));
    await userEvent.click(within(within(row).getByRole("group", { name: /^Confirmar borrar/ })).getByRole("button", { name: "Borrar" }));
    await vi.waitFor(() => expect(within(region).queryByText("Qué es la entropía en termodinámica")).not.toBeInTheDocument());
  });

  it("only Ctrl/Cmd+K toggles the palette", async () => {
    render(<App />);
    await userEvent.keyboard("k");
    await userEvent.keyboard("{Control>}j{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}K{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows exactly one screen per route", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    await screen.findByRole("heading", { name: "Ajustes" });
    expect(screen.queryByRole("heading", { name: "¿Qué querés entender?" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Grafo" }));
    expect(await screen.findByRole("heading", { name: "Grafo de conocimiento" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ajustes" })).not.toBeInTheDocument();
  });

describe("App: chat first (AC-89, AC-90)", () => {
  it("a greeting is just a chat: no diagnostic question, no plan panel", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Mensaje"), "hola");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    expect(await screen.findByText(/Contame qué te gustaría aprender/)).toBeInTheDocument();
    expect(screen.queryByTestId("question-pending")).toBeNull();
    expect(screen.queryByText("Diagnóstico")).toBeNull();
    expect(await screen.findByRole("textbox", { name: "Mensaje" })).toHaveAttribute("placeholder", expect.stringContaining("Escribí un mensaje"));
  });

  it("asking to learn makes the agent start the method by itself, in the same conversation", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Mensaje"), "hola, quiero aprender la derivada");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    expect(await screen.findByText("Empezó a aprender: la derivada")).toBeInTheDocument();
    expect(await pendingQuestion()).toHaveTextContent("pendiente 2");
    expect(await screen.findByText("Diagnóstico", { selector: "h2" })).toBeInTheDocument();
  });

  it("the agent can offer buttons, and tapping one is what makes it happen", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Mensaje"), "ayudame con un pomodoro");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    const group = await screen.findByRole("group", { name: "Empezar un pomodoro de 25 min" });
    expect(group).toHaveTextContent("25 min de foco");
    await userEvent.click(screen.getByRole("button", { name: "Abrir la biblioteca" }));
    expect(await screen.findByRole("heading", { name: "Biblioteca" })).toBeInTheDocument();
  });
});

  it("pasting a timetable in the chat gives a card to confirm; saving it fills Mi cursada", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Mensaje"), "este es mi horario: lunes de 10 a 12 Análisis con Pérez");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    const card = await screen.findByRole("region", { name: "Propuesta para Mi cursada" });
    expect(within(card).getByText("2 materias y 2 fechas")).toBeInTheDocument();
    expect(within(card).getByText("Análisis I")).toBeInTheDocument();
    expect(within(card).getByText(/Se guarda recién cuando lo confirmás/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Guardar en Mi cursada" }));
    expect(await within(card).findByRole("status")).toHaveTextContent("Guardado en «2.º cuatrimestre 2026»");
    await userEvent.click(within(card).getByRole("button", { name: "Abrir Mi cursada" }));
    expect(await screen.findByRole("heading", { name: "Mi cursada" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Horario semanal" })).toBeInTheDocument();
  });

describe("App: the agent runs the app's controls (AC-122)", () => {
  const say = async (text: string) => {
    await userEvent.type(screen.getByLabelText("Mensaje"), text);
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
  };

  it("starts and pauses the pomodoro, switches the theme and silences the sound, all by chat", async () => {
    localStorage.clear();
    render(
      <PomodoroProvider>
        <App />
      </PomodoroProvider>,
    );
    await say("empezá un pomodoro de 40 min");
    expect(await screen.findByText("Empezó un pomodoro de 40 min")).toBeInTheDocument();
    const pomo = screen.getByRole("region", { name: "Pomodoro" });
    expect(await within(pomo).findByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(within(pomo).getByTestId("pomo-time")).toHaveTextContent(/^(40:00|39:5\d)$/);

    await userEvent.type(await screen.findByRole("textbox", { name: "Mensaje" }), "pausá el pomodoro");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    expect(await within(pomo).findByRole("button", { name: "Seguir" })).toBeInTheDocument();
    expect(screen.getByText("Pausó el pomodoro")).toBeInTheDocument();

    await userEvent.type(await screen.findByRole("textbox", { name: "Mensaje" }), "poné el modo claro");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    await userEvent.type(await screen.findByRole("textbox", { name: "Mensaje" }), "apagá el sonido");
    await userEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("la.sound") ?? "{}").enabled).toBe(false));
  });

  it("turns on the reminders it was asked for, keeping the other settings", async () => {
    localStorage.clear();
    render(
      <PomodoroProvider>
        <App />
      </PomodoroProvider>,
    );
    await say("recordame pararme y tomar agua");
    expect(await screen.findByText("Recordatorios: pararte cada 25 min, tomar agua cada 60 min")).toBeInTheDocument();
    const r = JSON.parse(localStorage.getItem("la.reminders") ?? "{}");
    expect(r).toMatchObject({ enabled: true, stand: true, standMinutes: 25, water: true, waterMinutes: 60 });
  });
});
});
