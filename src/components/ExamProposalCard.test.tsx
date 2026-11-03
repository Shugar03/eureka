import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExamProposalCard } from "./ExamProposalCard";
import { api } from "../api";
import type { ExamProposal } from "../types";
import { install } from "../e2e/mockBackend";

beforeAll(() => install());
beforeEach(async () => {
  for (const e of await api.listExams()) await api.deleteExam(e.id);
});

const proposal = (over: Partial<ExamProposal> = {}): ExamProposal => ({ name: "AWS Certified AI Practitioner", kind: "certification", exam_date: "2099-12-15", hours_per_week: 6, passing_pct: null, guide: null, ...over });
const open = (p = proposal(), onOpenExam = vi.fn()) => {
  render(<ExamProposalCard proposal={p} onOpenExam={onOpenExam} />);
  return onOpenExam;
};

describe("ExamProposalCard (AC-120)", () => {
  it("shows what it will create and creates nothing until asked", async () => {
    open();
    const card = screen.getByRole("region", { name: "Preparación de AWS Certified AI Practitioner" });
    expect(card).toHaveTextContent("15 de diciembre de 2099");
    expect(card).toHaveTextContent("Horas por semana 6");
    expect(card).toHaveTextContent("todavía no la tengo");
    expect(await api.listExams()).toEqual([]);
    expect(within(card).getByRole("button", { name: "Buscar la guía y crear mi preparación" })).toBeInTheDocument();
  });

  it("without a guide it looks one up on the web, builds the exam with its date and shows the roadmap", async () => {
    const go = open();
    await userEvent.click(screen.getByRole("button", { name: "Buscar la guía y crear mi preparación" }));
    expect(await screen.findByRole("heading", { name: "Tu preparación está lista" })).toBeInTheDocument();
    expect(screen.getByText(/con la guía que encontré en la web/)).toBeInTheDocument();
    const road = screen.getByRole("list", { name: "Ruta de estudio" });
    expect(within(road).getAllByRole("listitem").length).toBeGreaterThan(1);
    const [made] = await api.listExams();
    expect(made).toMatchObject({ name: "AWS Certified AI Practitioner", exam_date: "2099-12-15" });
    await userEvent.click(screen.getByRole("button", { name: "Abrir mi ruta de estudio" }));
    expect(go).toHaveBeenCalledWith(made.id);
  });

  it("uses the guide the person pasted, and a guide the agent already had", async () => {
    open(proposal({ name: "Materia", kind: "subject", exam_date: null, hours_per_week: null }));
    await userEvent.type(screen.getByRole("textbox", { name: "Guía o programa del examen" }), "Unidad 1: Matrices\n- Suma\n- Producto\nUnidad 2: Determinantes\n- Cofactores");
    await userEvent.click(screen.getByRole("button", { name: "Crear mi preparación" }));
    expect(await screen.findByRole("heading", { name: "Tu preparación está lista" })).toBeInTheDocument();
    expect(screen.queryByText(/guía que encontré en la web/)).toBeNull();
  });

  it("says why when it cannot build it, and keeps the paste box so the person can go on", async () => {
    open(proposal({ name: "Examen raro" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Guía o programa del examen" }), "sin dominios claros");
    await userEvent.click(screen.getByRole("button", { name: "Crear mi preparación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se encontraron dominios");
    expect(screen.getByRole("textbox", { name: "Guía o programa del examen" })).toHaveValue("sin dominios claros");
    expect(await api.listExams()).toEqual([]);
  });

  it("does not offer to build the same exam twice, and can be dismissed", async () => {
    const guide = "Dominio 1: Fundamentos\n- IA\n- ML\nDominio 2: Servicios\n- Bedrock";
    await api.createExam("aws certified ai practitioner", guide, "certification");
    const go = open();
    expect(await screen.findByText("Ya tenés una preparación con este nombre.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crear mi preparación/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Abrirla" }));
    expect(go).toHaveBeenCalled();
  });

  it("goes away with Ahora no", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("region", { name: /Preparación de/ })).toBeNull();
  });
});
