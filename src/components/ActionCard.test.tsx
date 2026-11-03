import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionCard } from "./ActionCard";
import { PomodoroProvider, usePomodoro } from "./pomodoro/PomodoroContext";
import { loadReminderSettings } from "./Reminders";
import type { ProposedAction } from "../types";

beforeEach(() => localStorage.clear());

function Probe() {
  const p = usePomodoro();
  return <p data-testid="pomo">{p.state.running ? `corriendo ${p.settings.focus}` : "quieto"}</p>;
}

const open = (action: ProposedAction, onOpenScreen = vi.fn()) => {
  render(
    <PomodoroProvider>
      <ActionCard action={action} onOpenScreen={onOpenScreen} />
      <Probe />
    </PomodoroProvider>,
  );
  return onOpenScreen;
};

describe("ActionCard (AC-90)", () => {
  it("says what the tap will do, and does nothing until it is tapped", async () => {
    const go = open({ kind: "open_screen", screen: "library", label: "Abrir la biblioteca" });
    expect(screen.getByText("Te lleva a la biblioteca")).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Abrir la biblioteca" }));
    expect(go).toHaveBeenCalledWith("library");
  });

  it("starts a pomodoro of the length it offered, once", async () => {
    open({ kind: "start_pomodoro", minutes: 40, label: "Pomodoro de 40 min" });
    expect(screen.getByTestId("pomo")).toHaveTextContent("quieto");
    expect(screen.getByText(/40 min de foco/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pomodoro de 40 min" }));
    expect(screen.getByTestId("pomo")).toHaveTextContent("corriendo 40");
    expect(screen.getByRole("status")).toHaveTextContent("Pomodoro en marcha");
    expect(screen.getByRole("button", { name: "Pomodoro de 40 min" })).toBeDisabled();
  });

  it("turns on the stand-up and water reminders it offered, keeping the rest", async () => {
    localStorage.setItem("la.reminders", JSON.stringify({ slotMinutes: 30, cardsAt: "" }));
    open({ kind: "set_reminders", stand_minutes: 25, water_minutes: 45, label: "Activar recordatorios" });
    expect(screen.getByText("Te avisa que te pares cada 25 min y que tomes agua cada 45 min")).toBeInTheDocument();
    expect(loadReminderSettings().stand).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Activar recordatorios" }));
    expect(loadReminderSettings()).toMatchObject({ enabled: true, stand: true, standMinutes: 25, water: true, waterMinutes: 45, slotMinutes: 30, cardsAt: "" });
    expect(screen.getByRole("status")).toHaveTextContent("quedó activado");
  });

  it("offers only the reminder it was asked for", async () => {
    open({ kind: "set_reminders", water_minutes: 60, label: "Agua" });
    expect(screen.getByText("Te avisa que tomes agua cada 60 min")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Agua" }));
    expect(loadReminderSettings()).toMatchObject({ stand: false, water: true, waterMinutes: 60 });
  });
});
