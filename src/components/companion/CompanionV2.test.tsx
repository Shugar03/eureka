import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionScreen } from "./CompanionScreen";
import { InsightsPanel } from "./InsightsPanel";
import { AccessibilityProvider } from "../a11y/AccessibilityContext";
import { companionApi } from "../../api";
import { install } from "../../e2e/mockBackend";
import type { CompanionView, JournalEntry } from "../../types";

beforeAll(() => install());
beforeEach(async () => {
  await companionApi.erase();
});
afterEach(() => vi.restoreAllMocks());

async function open(tab: string) {
  render(
    <AccessibilityProvider>
      <CompanionScreen />
    </AccessibilityProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Entendido, seguir" }));
  await userEvent.click(await screen.findByRole("tab", { name: tab }));
}

describe("Registro de pensamientos (AC-93)", () => {
  it("asks one question at a time, needs what happened and what was thought, and saves a readable entry", async () => {
    await open("Herramientas");
    await userEvent.click(screen.getByRole("button", { name: "Empezar un registro" }));
    const w = screen.getByRole("region", { name: "Registro de pensamientos" });
    expect(within(w).getByTestId("wizard-step")).toHaveTextContent("Paso 1 de 5");
    const next = within(w).getByRole("button", { name: "Siguiente" });
    expect(next).toBeDisabled();
    await userEvent.type(within(w).getByRole("textbox", { name: "Qué pasó" }), "Me fue mal en el parcial");
    await userEvent.click(next);
    expect(within(w).getByRole("button", { name: "Siguiente" })).toBeDisabled();
    await userEvent.type(within(w).getByRole("textbox", { name: "Qué pensaste" }), "Soy un desastre");
    await userEvent.click(within(w).getByRole("button", { name: "Siguiente" }));
    // Feeling: pick a word from the wheel.
    await userEvent.click(within(w).getByRole("radio", { name: "Agobio" }));
    await userEvent.click(within(w).getByRole("button", { name: "desbordado" }));
    await userEvent.click(within(w).getByRole("button", { name: "Siguiente" }));
    await userEvent.type(within(w).getByRole("textbox", { name: "Lo que no encaja con el pensamiento" }), "Aprobé los dos anteriores");
    await userEvent.click(within(w).getByRole("button", { name: "Siguiente" }));
    expect(within(w).getByTestId("wizard-step")).toHaveTextContent("Paso 5 de 5");
    await userEvent.type(within(w).getByRole("textbox", { name: "Otra mirada" }), "Un parcial no dice quién soy");
    await userEvent.click(within(w).getByRole("checkbox", { name: /Volver a medir/ }));
    await userEvent.click(within(w).getByRole("button", { name: "Guardar en mi diario" }));
    expect(await screen.findByText("Guardado en tu diario.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Diario" }));
    const entry = await screen.findByTestId("entry");
    expect(within(entry).getByText("Registro de pensamientos")).toBeInTheDocument();
    expect(within(entry).getByText(/Situación: Me fue mal en el parcial/)).toBeInTheDocument();
    expect(within(entry).getByText(/Otra mirada: Un parcial no dice quién soy/)).toBeInTheDocument();
    expect(within(entry).getByText("desbordado")).toBeInTheDocument();
    expect(within(entry).getByText(/Intensidad 50 → 50/)).toBeInTheDocument();
  });

  it("can be cancelled from the first step without saving anything", async () => {
    await open("Herramientas");
    await userEvent.click(screen.getByRole("button", { name: "Empezar un registro" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Qué pasó" }), "algo");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Empezar un registro" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Diario" }));
    expect(screen.queryByTestId("entry")).toBeNull();
  });
});

describe("Rueda de emociones (AC-94)", () => {
  it("goes from a family to the word, and saves it as a check-in only with a mood", async () => {
    await open("Herramientas");
    const card = screen.getByRole("region", { name: "Rueda de emociones" });
    await userEvent.click(within(card).getByRole("radio", { name: "Tristeza" }));
    await userEvent.click(within(card).getByRole("button", { name: "desanimado" }));
    await userEvent.click(within(card).getByRole("radio", { name: "Miedo" }));
    await userEvent.click(within(card).getByRole("button", { name: "nervioso" }));
    expect(within(card).getByTestId("wheel-chosen")).toHaveTextContent("desanimado, nervioso");
    const save = within(card).getByRole("button", { name: "Guardar como check-in" });
    expect(save).toBeDisabled();
    await userEvent.click(within(card).getByRole("radio", { name: "Mal" }));
    await userEvent.click(save);
    expect(await within(card).findByText("Guardado como check-in en tu diario.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Diario" }));
    const day = await screen.findByRole("region", { name: "Hoy" });
    expect(within(day).getByText("desanimado")).toBeInTheDocument();
    expect(within(day).getByText("nervioso")).toBeInTheDocument();
  });

  it("is also at hand inside the check-in", async () => {
    await open("Diario");
    await userEvent.click(screen.getByRole("button", { name: /No encuentro la palabra/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Enojo" }));
    await userEvent.click(screen.getByRole("button", { name: "frustrado" }));
    const emotions = screen.getByRole("group", { name: "Emociones" });
    expect(within(emotions).getByRole("button", { name: "frustrado", pressed: true })).toBeInTheDocument();
  });
});

describe("Lo que noté (AC-95)", () => {
  // Sundays hard, the rest fine: three weeks of check-ins.
  const sundayEntries = (): JournalEntry[] => {
    const now = new Date();
    return Array.from({ length: 21 }, (_, daysAgo) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12);
      const sunday = d.getDay() === 0;
      return { id: `e${daysAgo}`, at: d.toISOString(), kind: "checkin", title: "Check-in", text: "", mood: sunday ? 1 : 4, emotions: [], helped: [] };
    });
  };
  const view = (insights: CompanionView["insights"] = {}): CompanionView => ({ locked: false, has_pin: false, privacy_ack: true, resources: [], conversation: { turns: [], risk: false }, entries: sundayEntries(), insights });

  it("shows a pattern as a guess the person can confirm or reject, and says it is not a diagnosis", async () => {
    const onView = vi.fn();
    const set = vi.spyOn(companionApi, "setInsight").mockResolvedValue(view({ "weekday-low-0": "confirmed" }));
    render(<InsightsPanel view={view()} onView={onView} />);
    expect(screen.getByText(/no son un diagnóstico ni explican por qué/)).toBeInTheDocument();
    const card = screen.getByText("Los domingos suelen costarte más").closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: /Me suena/ }));
    expect(set).toHaveBeenCalledWith("weekday-low-0", "confirmed");
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ insights: { "weekday-low-0": "confirmed" } }));
  });

  it("keeps what was confirmed on top, hides what was rejected, and lets both be taken back", async () => {
    const onView = vi.fn();
    const set = vi.spyOn(companionApi, "setInsight").mockResolvedValue(view());
    const { rerender } = render(<InsightsPanel view={view({ "weekday-low-0": "confirmed" })} onView={onView} />);
    const group = screen.getByLabelText("Lo que ya confirmé");
    expect(within(group).getByText("Los domingos suelen costarte más")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: /Quitar de lo confirmado/ }));
    expect(set).toHaveBeenCalledWith("weekday-low-0", null);

    rerender(<InsightsPanel view={view({ "weekday-low-0": "rejected" })} onView={onView} />);
    expect(screen.queryByText(/costarte más/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ver las que descarté (1)" }));
    await userEvent.click(screen.getByRole("button", { name: /Volver a mostrar/ }));
    expect(set).toHaveBeenLastCalledWith("weekday-low-0", null);
  });

  it("says how many more entries it needs instead of guessing", () => {
    render(<InsightsPanel view={{ ...view(), entries: [] }} onView={() => {}} />);
    expect(screen.getByTestId("insights-empty")).toHaveTextContent("Con 8 anotaciones más con tu ánimo, empiezo a ver cosas.");
  });
});
