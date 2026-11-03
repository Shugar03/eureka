import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionScreen } from "./CompanionScreen";
import { AccessibilityProvider } from "../a11y/AccessibilityContext";
import { companionApi } from "../../api";
import { install } from "../../e2e/mockBackend";

beforeAll(() => install());
beforeEach(async () => {
  await companionApi.erase();
});

const open = () =>
  render(
    <AccessibilityProvider>
      <CompanionScreen />
    </AccessibilityProvider>,
  );

async function accept() {
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Entendido, seguir" }));
  await screen.findByRole("tab", { name: "Charlar" });
}

async function say(text: string) {
  await userEvent.type(screen.getByRole("textbox", { name: "Mensaje" }), text);
  await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await screen.findByText(text);
}

describe("Acompañamiento: lo que hay que saber antes (AC-82)", () => {
  it("says what it is, what it isn't and where the messages go, before anything else", async () => {
    open();
    const gate = await screen.findByRole("region", { name: "Antes de empezar" });
    expect(within(gate).getByText(/Acá no se estudia/)).toBeInTheDocument();
    expect(within(gate).getByText(/No es terapia/)).toBeInTheDocument();
    expect(within(gate).getByText(/Tus mensajes viajan a/)).toBeInTheDocument();
    expect(within(gate).getByText(/El profesor no lee nada de esto/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Mensaje" })).toBeNull();
    await userEvent.click(within(gate).getByRole("button", { name: "Entendido, seguir" }));
    expect(await screen.findByRole("textbox", { name: "Mensaje" })).toBeInTheDocument();
  });
});

describe("Acompañamiento: charla (AC-82, AC-84)", () => {
  it("listens, and keeps the message in the box if sending fails", async () => {
    await accept();
    const box = screen.getByRole("textbox", { name: "Mensaje" });
    await userEvent.type(box, "FALLA por favor");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(box).toHaveValue("FALLA por favor");

    await userEvent.clear(box);
    await userEvent.type(box, "Estoy cansado");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText(/Suena a que venís cargado/)).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(screen.queryByRole("region", { name: "Líneas de ayuda" })).toBeNull();
  });

  it("shows the help lines when there are signs of risk, and keeps them", async () => {
    await accept();
    await say("a veces pienso en quitarme la vida");
    const help = await screen.findByRole("region", { name: "Líneas de ayuda" });
    expect(within(help).getByText(/135/)).toBeInTheDocument();
    expect(within(help).getByText(/llamá a emergencias/)).toBeInTheDocument();
    await say("no sé");
    expect(screen.getByRole("region", { name: "Líneas de ayuda" })).toBeInTheDocument();
  });
});

describe("Acompañamiento: diario (AC-83)", () => {
  it("saves a check-in in ten seconds and lists it under today", async () => {
    await accept();
    await userEvent.click(screen.getByRole("tab", { name: "Diario" }));
    const save = screen.getByRole("button", { name: "Guardar check-in" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Mal" }));
    await userEvent.click(screen.getByRole("button", { name: "cansancio" }));
    await userEvent.click(save);
    const day = await screen.findByRole("region", { name: "Hoy" });
    expect(within(day).getByText("Check-in")).toBeInTheDocument();
    expect(within(day).getByText("Mal")).toBeInTheDocument();
    expect(within(day).getByText("cansancio")).toBeInTheDocument();
  });

  it("drafts an entry from the talk, saves it only on request, and starts a fresh talk", async () => {
    await accept();
    await say("estoy cansado de tanto parcial");
    expect(screen.getByRole("button", { name: "Guardar esta charla en mi diario" })).toBeDisabled();
    await say("caminar me ayudó");
    await userEvent.click(screen.getByRole("button", { name: "Guardar esta charla en mi diario" }));
    const editor = await screen.findByRole("region", { name: "Así quedaría tu entrada" });
    expect(within(editor).getByRole("textbox", { name: "Título de la entrada" })).toHaveValue("Una semana de parciales");
    await userEvent.click(within(editor).getByRole("button", { name: "Guardar en mi diario" }));
    expect(await screen.findByText(/Guardado en tu diario/)).toBeInTheDocument();
    expect(screen.queryByText("caminar me ayudó")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Diario" }));
    expect(await screen.findByText("Una semana de parciales")).toBeInTheDocument();
    expect(screen.getByText(/Me ayudó: salir a caminar/)).toBeInTheDocument();
  });
});

describe("Acompañamiento: herramientas (AC-87)", () => {
  it("walks the 5-4-3-2-1 exercise", async () => {
    await accept();
    await userEvent.click(screen.getByRole("tab", { name: "Herramientas" }));
    const g = screen.getByRole("region", { name: "Anclaje 5-4-3-2-1" });
    await userEvent.click(within(g).getByRole("button", { name: "Empezar" }));
    expect(within(g).getByText(/5 cosas que podés ver/)).toBeInTheDocument();
    for (let i = 0; i < 4; i++) await userEvent.click(within(g).getByRole("button", { name: "Siguiente" }));
    expect(within(g).getByText(/1 cosa que podés saborear/)).toBeInTheDocument();
    await userEvent.click(within(g).getByRole("button", { name: "Terminar" }));
    expect(within(g).getByText(/Estás acá/)).toBeInTheDocument();
  });
});

describe("Acompañamiento: privacidad (AC-85, AC-86)", () => {
  it("locks with a PIN, refuses a wrong one, and erasing is always possible", async () => {
    await accept();
    await userEvent.click(screen.getByRole("tab", { name: "Diario" }));
    await userEvent.type(screen.getByRole("textbox", { name: "PIN nuevo" }), "4321");
    await userEvent.click(screen.getByRole("button", { name: "Poner PIN" }));
    await userEvent.click(await screen.findByRole("button", { name: "Bloquear ahora" }));
    const lock = await screen.findByRole("region", { name: "Diario bloqueado" });
    expect(screen.queryByRole("tab", { name: "Diario" })).toBeNull();
    await userEvent.type(within(lock).getByRole("textbox", { name: "PIN del diario" }), "0000");
    await userEvent.click(within(lock).getByRole("button", { name: "Desbloquear" }));
    expect(await within(lock).findByRole("alert")).toHaveTextContent("PIN incorrecto");
    await userEvent.click(within(lock).getByRole("button", { name: "Olvidé mi PIN" }));
    await userEvent.click(within(lock).getByRole("button", { name: "¿Seguro? Borrar todo para siempre" }));
    expect(await screen.findByRole("region", { name: "Antes de empezar" })).toBeInTheDocument();
  });
});
