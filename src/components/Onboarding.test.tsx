import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";
import { WorkspaceProvider } from "./workspace/WorkspaceContext";
import { PomodoroProvider } from "./pomodoro/PomodoroContext";
import { identityApi } from "../api";
import { loadReminderSettings } from "./Reminders";
import { loadSound } from "../lib/sounds";
import { install } from "../e2e/mockBackend";

beforeAll(() => install());
beforeEach(async () => {
  localStorage.clear();
  // The demo backend keeps the profile between tests, like the real one would between runs.
  await identityApi.save({ first_name: "", last_name: "", school: "", career: "", age: null, treatment: "", treatment_other: "", onboarded: false });
});

const open = () =>
  render(
    <PomodoroProvider>
      <WorkspaceProvider>
        <Onboarding />
      </WorkspaceProvider>
    </PomodoroProvider>,
  );

const dialog = () => screen.getByRole("dialog", { name: "Bienvenida" });
const next = () => userEvent.click(within(dialog()).getByRole("button", { name: "Siguiente" }));

describe("Onboarding (AC-92, AC-97, AC-98)", () => {
  it("walks the five steps, asks only what it needs and says where it goes", async () => {
    open();
    expect(within(dialog()).getByText("Paso 1 de 5")).toBeInTheDocument();
    expect(within(dialog()).getByText(/se comparten con el modelo de IA/)).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Atrás" })).toBeDisabled();
    await userEvent.type(within(dialog()).getByRole("textbox", { name: "Tu nombre" }), "Emanuel");
    await userEvent.type(within(dialog()).getByRole("textbox", { name: "Tu apellido" }), "Paz");
    await next();

    expect(within(dialog()).getByText("Paso 2 de 5")).toBeInTheDocument();
    await userEvent.type(within(dialog()).getByRole("textbox", { name: "Dónde estudiás" }), "UTN");
    await userEvent.type(within(dialog()).getByRole("textbox", { name: "Qué estudiás" }), "Ingeniería en Sistemas");
    await userEvent.type(within(dialog()).getByRole("spinbutton", { name: "Tu edad" }), "21");
    await next();

    // Inclusive options, none pre-selected for the person.
    const group = within(dialog()).getByRole("radiogroup", { name: "Cómo preferís que te hablemos" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent?.split(/(?=[A-Z][a-z]+ )/)[0])).toHaveLength(4);
    await userEvent.click(within(group).getByRole("radio", { name: /^Elle/ }));
    await userEvent.type(within(dialog()).getByRole("textbox", { name: "Otra forma de tratarte" }), "con lenguaje neutro");
    await next();

    await userEvent.click(within(dialog()).getByRole("radio", { name: "Claro" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    await next();

    expect(within(dialog()).getByText("Paso 5 de 5")).toBeInTheDocument();
    expect(within(dialog()).getByTestId("hello")).toHaveTextContent(/^Buen(os días|as tardes|as noches), Emanuel$/);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Empezar" }));

    await vi_waitFor(async () => {
      const id = await identityApi.get();
      expect(id).toMatchObject({ first_name: "Emanuel", last_name: "Paz", school: "UTN", career: "Ingeniería en Sistemas", age: 21, treatment: "elle", treatment_other: "con lenguaje neutro", onboarded: true });
    });
    // The care step was left as suggested: stand every 25 min, water every 60, sound on.
    expect(loadReminderSettings()).toMatchObject({ enabled: true, stand: true, standMinutes: 25, water: true, waterMinutes: 60 });
    expect(loadSound().enabled).toBe(true);
  });

  it("everything can be skipped and nothing is saved but the fact that it was skipped", async () => {
    open();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Omitir todo" }));
    await vi_waitFor(async () => {
      const id = await identityApi.get();
      expect(id).toMatchObject({ first_name: "", career: "", treatment: "", onboarded: true });
    });
    expect(loadReminderSettings()).toMatchObject({ stand: false, water: false });
  });

  it("the care step can be turned off and the sound too", async () => {
    open();
    for (let i = 0; i < 4; i++) await next();
    await userEvent.click(within(dialog()).getByRole("checkbox", { name: "Avisarme que me pare" }));
    await userEvent.click(within(dialog()).getByRole("checkbox", { name: "Avisarme que tome agua" }));
    await userEvent.click(within(dialog()).getByRole("checkbox", { name: "Sonidos del pomodoro" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Empezar" }));
    await vi_waitFor(() => expect(loadSound().enabled).toBe(false));
    expect(loadReminderSettings()).toMatchObject({ stand: false, water: false });
  });
});

/** vi.waitFor without importing vi twice in this file's top-level imports. */
import { vi } from "vitest";
const vi_waitFor = <T,>(f: () => T | Promise<T>) => vi.waitFor(f, { timeout: 3000 });
