import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandMenu, type Command } from "./CommandMenu";

const setup = () => {
  const runs = { a: vi.fn(), b: vi.fn(), c: vi.fn() };
  const commands: Command[] = [
    { id: "a", label: "Nueva sesión", group: "Acciones", run: runs.a },
    { id: "b", label: "Abrir ajustes", group: "Acciones", run: runs.b },
    { id: "c", label: "Derivadas", group: "Sesiones", run: runs.c },
  ];
  const onClose = vi.fn();
  render(<CommandMenu commands={commands} onClose={onClose} />);
  return { runs, onClose, input: screen.getByRole("combobox", { name: "Buscar comando" }) };
};

describe("CommandMenu", () => {
  it("focuses the input and groups results", () => {
    const { input } = setup();
    expect(input).toHaveFocus();
    expect(screen.getByText("Acciones")).toBeInTheDocument();
    expect(screen.getByText("Sesiones")).toBeInTheDocument();
  });

  it("filters case-insensitively and runs the match with Enter", async () => {
    const { input, runs, onClose } = setup();
    await userEvent.type(input, "AJUS{Enter}");
    expect(runs.b).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("moves the selection with the arrows and tracks aria-activedescendant", async () => {
    const { input, runs } = setup();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-b");
    expect(screen.getByRole("option", { name: "Abrir ajustes" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(runs.b).toHaveBeenCalledOnce();
  });

  it("clamps the selection at both ends", async () => {
    const { input } = setup();
    await userEvent.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-a");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-c");
  });

  it("shows an empty state and Enter does nothing", async () => {
    const { input, runs, onClose } = setup();
    await userEvent.type(input, "zzz{Enter}");
    expect(screen.getByText("Sin resultados")).toBeInTheDocument();
    expect(Object.values(runs).every((r) => r.mock.calls.length === 0)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with Escape and on a backdrop click, not on a dialog click", async () => {
    const { onClose, input } = setup();
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveFocus(); // clicking inside keeps the keyboard working
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("cmd-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("runs a command on click", async () => {
    const { runs } = setup();
    await userEvent.click(screen.getByRole("option", { name: "Derivadas" }));
    expect(runs.c).toHaveBeenCalledOnce();
  });

  it("trims the query and resets the selection when it changes", async () => {
    const { input } = setup();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-c");
    await userEvent.type(input, "  sesión  ");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-a");
    expect(screen.queryByText("Sin resultados")).not.toBeInTheDocument();
  });

  it("marks only the active option and shows hints", () => {
    render(<CommandMenu commands={[{ id: "h", label: "Con atajo", group: "G", hint: "Ctrl N", run: () => {} }, { id: "n", label: "Sin atajo", group: "G", run: () => {} }]} onClose={() => {}} />);
    expect(screen.getByRole("option", { name: /Con atajo/ })).toHaveClass("is-active");
    expect(screen.getByRole("option", { name: "Sin atajo" })).not.toHaveClass("is-active");
    expect(screen.getByText("Ctrl N").tagName).toBe("KBD");
    expect(document.querySelectorAll("kbd")).toHaveLength(1);
    expect(screen.getAllByText("G")).toHaveLength(1); // one header per group
  });
});
