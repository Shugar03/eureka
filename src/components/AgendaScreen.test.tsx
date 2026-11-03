import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgendaScreen } from "./AgendaScreen";
import { academicApi } from "../api";
import { install } from "../e2e/mockBackend";
import { timetableProposal } from "../e2e/teacherScript";

beforeAll(() => install());
beforeEach(async () => {
  const d = await academicApi.state();
  for (const t of d.terms) await academicApi.deleteTerm(t.id);
});

describe("Agenda with Mi cursada (AC-103)", () => {
  it("starts by pointing at Mi cursada when nothing is loaded", async () => {
    const onOpenAcademic = vi.fn();
    render(<AgendaScreen onOpenExam={() => {}} onOpenAcademic={onOpenAcademic} />);
    expect(await screen.findByText("Tu semana está vacía")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abrir Mi cursada" }));
    expect(onOpenAcademic).toHaveBeenCalled();
  });

  it("shows the classes of the active term in the week, and its dates next to the exams", async () => {
    await academicApi.importProposal(timetableProposal());
    const onOpenAcademic = vi.fn();
    render(<AgendaScreen onOpenExam={() => {}} onOpenAcademic={onOpenAcademic} />);

    const week = await screen.findByRole("region", { name: "Semana" });
    expect(within(within(week).getByRole("group", { name: "Lunes" })).getByRole("button", { name: /Análisis I/ })).toBeInTheDocument();
    expect(within(within(week).getByRole("group", { name: "Martes" })).getByRole("button", { name: /Física I/ })).toBeInTheDocument();
    expect(within(week).getByRole("group", { name: "Miércoles" })).toHaveTextContent("Análisis I");
    expect(screen.getByTestId("week-hours")).toHaveTextContent("7 h de clase · 0 h de estudio planificado");

    const dates = screen.getByRole("region", { name: "Próximas fechas" });
    expect(within(dates).getByRole("button", { name: /TP 1: informe · Física I/ })).toBeInTheDocument();
    expect(within(dates).getByRole("button", { name: /Primer parcial · Análisis I/ })).toBeInTheDocument();
    expect(dates).toHaveTextContent("En 7 días");
    expect(dates).toHaveTextContent("En 14 días");
    // Earlier first.
    expect(within(dates).getAllByRole("listitem")[0]).toHaveTextContent("TP 1");

    await userEvent.click(within(dates).getByRole("button", { name: /Primer parcial/ }));
    expect(onOpenAcademic).toHaveBeenCalled();
  });

  it("leaves out what is done", async () => {
    await academicApi.importProposal(timetableProposal());
    const data = await academicApi.state();
    const tp = data.dates.find((d) => d.title.startsWith("TP 1"))!;
    await academicApi.saveDate({ ...tp, done: true });
    render(<AgendaScreen onOpenExam={() => {}} onOpenAcademic={() => {}} />);
    const dates = await screen.findByRole("region", { name: "Próximas fechas" });
    expect(within(dates).queryByText(/TP 1/)).toBeNull();
    expect(within(dates).getByText(/Primer parcial/)).toBeInTheDocument();
  });
});
