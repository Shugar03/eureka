import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavDrawer } from "./NavDrawer";

// The app closes the drawer when the screen changes; here a pick stands for that.
function Harness({ onSearch = () => {} }: { onSearch?: () => void }) {
  const [open, setOpen] = useState(false);
  const [screenName, setScreen] = useState("Inicio");
  const pick = (s: string) => {
    setScreen(s);
    setOpen(false);
  };
  return (
    <>
      <NavDrawer open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onSearch={onSearch}>
        <nav aria-label="Navegación">
          <button onClick={() => pick("Tarjetas")}>Tarjetas</button>
          <button onClick={() => pick("Agenda")}>Agenda</button>
        </nav>
      </NavDrawer>
      <main>{screenName}</main>
    </>
  );
}

const menu = () => screen.getByRole("button", { name: "Abrir menú" });

describe("NavDrawer (teléfono)", () => {
  it("abre el menú como diálogo y pone el foco adentro", async () => {
    render(<Harness />);
    expect(menu()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();
    await userEvent.click(menu());
    expect(menu()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Menú" })).toHaveClass("is-open");
    expect(screen.getByRole("button", { name: "Tarjetas" })).toHaveFocus();
  });

  it("Esc lo cierra y devuelve el foco al botón del menú", async () => {
    render(<Harness />);
    await userEvent.click(menu());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();
    expect(menu()).toHaveAttribute("aria-expanded", "false");
    expect(menu()).toHaveFocus();
  });

  it("el fondo lo cierra", async () => {
    render(<Harness />);
    await userEvent.click(menu());
    await userEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();
  });

  it("elegir una pantalla navega y cierra el menú", async () => {
    render(<Harness />);
    await userEvent.click(menu());
    await userEvent.click(screen.getByRole("button", { name: "Agenda" }));
    expect(screen.getByRole("main")).toHaveTextContent("Agenda");
    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();
  });

  it("el foco no se escapa del menú con Tab", async () => {
    render(<Harness />);
    await userEvent.click(menu());
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Agenda" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Tarjetas" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Agenda" })).toHaveFocus();
  });

  it("la lupa abre la búsqueda", async () => {
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    await userEvent.click(screen.getByRole("button", { name: "Buscar o ejecutar" }));
    expect(onSearch).toHaveBeenCalled();
  });
});
