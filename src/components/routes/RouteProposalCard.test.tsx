// AC-214: the proposed route can be edited before it exists, and is created once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { RouteProposalCard } from "./RouteProposalCard";
import { mockRouteProposal } from "../../e2e/routeMock";
import type { RouteProposal } from "../../types";

afterEach(() => clearMocks());

describe("RouteProposalCard (AC-214)", () => {
  it("shows where it comes from, lets the person trim it and change the pace, and creates what they left", async () => {
    let created: RouteProposal | null = null;
    mockIPC((cmd, a) => {
      if (cmd === "route_list") return [];
      if (cmd === "route_create") {
        created = (a as { proposal: RouteProposal }).proposal;
        return { id: "r1", title: created.title, current: "c2", units: [], total: 6, done: 0 };
      }
      if (cmd === "route_start_class") return { id: "s9" };
      throw `unexpected ${cmd}`;
    });
    const onOpenSession = vi.fn();
    render(<RouteProposalCard proposal={mockRouteProposal("Machine Learning")} onOpenRoute={() => {}} onOpenSession={onOpenSession} />);
    const card = screen.getByRole("region", { name: "Ruta propuesta: Machine Learning desde cero" });
    // Real sources, and what it already knows is marked.
    expect(within(card).getByRole("link", { name: "CS229: Machine Learning — Syllabus" })).toHaveAttribute("href", "https://cs229.stanford.edu/syllabus");
    expect(card).toHaveTextContent("1 ya la sabés");
    expect(card).toHaveTextContent("7 clases");

    // Take a whole unit out, then a class of another.
    await userEvent.click(within(card).getByRole("button", { name: "Sacar la unidad Clasificar" }));
    expect(card).toHaveTextContent("5 clases");
    await userEvent.click(within(card).getByRole("button", { name: /^Aprender de datos/ }));
    await userEvent.click(within(card).getByRole("button", { name: "Sacar la clase Error cuadrático" }));
    expect(card).toHaveTextContent("4 clases");
    // Pace: 2 h a week takes longer.
    await userEvent.click(within(card).getByRole("radio", { name: "2 h" }));
    expect(within(card).getByRole("radio", { name: "2 h" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(within(card).getByRole("button", { name: "Crear la ruta" }));
    expect(created!.hours_per_week).toBe(2);
    expect(created!.units.map((u) => u.title)).toEqual(["Bases matemáticas", "Aprender de datos"]);
    expect(created!.units[1].classes.map((c) => c.title)).toEqual(["Regresión lineal", "Descenso por gradiente"]);
    await userEvent.click(await screen.findByRole("button", { name: "Empezar la clase 1" }));
    expect(onOpenSession).toHaveBeenCalledWith("s9");
  });

  it("a reloaded chat does not offer to create the same route twice", async () => {
    mockIPC((cmd) => {
      if (cmd === "route_list") return [{ id: "r1", title: "Machine Learning desde cero" }];
      throw `unexpected ${cmd}`;
    });
    const onOpenRoute = vi.fn();
    render(<RouteProposalCard proposal={mockRouteProposal("Machine Learning")} onOpenRoute={onOpenRoute} onOpenSession={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Abrir la ruta" }));
    expect(onOpenRoute).toHaveBeenCalledWith("r1");
    expect(screen.queryByRole("button", { name: "Crear la ruta" })).toBeNull();
  });
  it("taking a unit or a class out leaves the focus on the next one, not lost on the page", async () => {
    mockIPC((cmd) => {
      if (cmd === "route_list") return [];
      throw `unexpected ${cmd}`;
    });
    render(<RouteProposalCard proposal={mockRouteProposal("Machine Learning")} onOpenRoute={() => {}} onOpenSession={() => {}} />);
    const card = screen.getByRole("region", { name: "Ruta propuesta: Machine Learning desde cero" });
    await userEvent.click(within(card).getByRole("button", { name: "Sacar la unidad Bases matemáticas" }));
    expect(within(card).getByRole("button", { name: "Sacar la unidad Aprender de datos" })).toHaveFocus();

    await userEvent.click(within(card).getByRole("button", { name: /^Aprender de datos/ }));
    await userEvent.click(within(card).getByRole("button", { name: "Sacar la clase Regresión lineal" }));
    expect(within(card).getByRole("button", { name: "Sacar la clase Error cuadrático" })).toHaveFocus();

    await userEvent.click(within(card).getByRole("button", { name: "Sacar la unidad Aprender de datos" }));
    await userEvent.click(within(card).getByRole("button", { name: "Sacar la unidad Clasificar" }));
    expect(within(card).getByRole("heading", { name: "Machine Learning desde cero" })).toHaveFocus();
  });

  it("without web search it says where to turn it on", async () => {
    mockIPC((cmd) => {
      if (cmd === "route_list") return [];
      throw `unexpected ${cmd}`;
    });
    render(<RouteProposalCard proposal={{ ...mockRouteProposal("Machine Learning"), researched: false, sources: [] }} onOpenRoute={() => {}} onOpenSession={() => {}} />);
    expect(screen.getByRole("region", { name: /^Ruta propuesta/ })).toHaveTextContent("no hubo búsqueda web (configurala en Ajustes → Avanzado → Búsqueda web)");
  });
});
