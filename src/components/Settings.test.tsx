import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";
import { install } from "../e2e/mockBackend";
import { AccessibilityProvider } from "./a11y/AccessibilityContext";
import { accessibilityApi, usageApi } from "../api";
import { cachedShare, costText } from "./settings/UsageSection";

beforeAll(() => install());

describe("Settings › Avanzado (modelos)", () => {
  it("shows providers with key state and never the key", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    const key = await screen.findByLabelText("API key de OpenRouter");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("placeholder", "•••••• guardada");
    expect(screen.getByLabelText("API key de OpenAI")).toHaveAttribute("placeholder", "API key");
    expect(screen.getAllByRole("button", { name: "Quitar key" })).toHaveLength(1);
  });

  it("saves a new key and reports it", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    await userEvent.type(await screen.findByLabelText("API key de OpenAI"), "sk-test");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Guardado.")).toBeInTheDocument();
    expect(screen.getByLabelText("API key de OpenAI")).toHaveValue("");
    expect(screen.getAllByRole("button", { name: "Quitar key" })).toHaveLength(2);
  });

  it("lists every model of the chosen provider, whatever is already typed", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    await screen.findByLabelText("Proveedor de Profesor");
    await userEvent.click(screen.getAllByRole("button", { name: "Listar modelos" })[0]);
    expect(await screen.findByText("3 modelos encontrados.")).toBeInTheDocument();
    const pick = screen.getByLabelText("Modelo de Profesor: elegir de la lista");
    // All of them, not only the ones matching the typed id (what a datalist did).
    expect(pick.querySelectorAll("option")).toHaveLength(4);
    const second = pick.querySelectorAll("option")[2].textContent!;
    await userEvent.selectOptions(pick, second);
    expect(screen.getByLabelText("Modelo de Profesor")).toHaveValue(second);
  });

  it("reports when a provider has no key", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    await userEvent.selectOptions(await screen.findByLabelText("Proveedor de Profesor"), "anthropic");
    await userEvent.click(screen.getAllByRole("button", { name: "Listar modelos" })[0]);
    expect(await screen.findByText(/No se pudieron listar los modelos/)).toBeInTheDocument();
  });

  it("disables listing models without a provider", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    const buttons = await screen.findAllByRole("button", { name: "Listar modelos" });
    expect(buttons[1]).toBeDisabled(); // prober has no provider
  });

  it("adds and removes providers", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    await screen.findByLabelText("API key de OpenRouter");
    const before = screen.getAllByLabelText("Nombre").length;
    await userEvent.click(screen.getByRole("button", { name: "+ Agregar proveedor" }));
    expect(screen.getAllByLabelText("Nombre")).toHaveLength(before + 1);
    await userEvent.click(screen.getByRole("button", { name: "Eliminar Personalizado" }));
    expect(screen.getAllByLabelText("Nombre")).toHaveLength(before);
  });

  it("goes back", async () => {
    const onBack = vi.fn();
    render(<Settings onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("Settings › modo avanzado", () => {
  beforeEach(() => localStorage.removeItem("la.advanced"));
  afterEach(() => localStorage.removeItem("la.advanced"));

  it("hides the prompts editor until advanced mode is turned on, and remembers it", async () => {
    const { unmount } = render(<Settings onBack={() => {}} />);
    expect(screen.queryByRole("tab", { name: "Prompts" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Modo avanzado/ }));
    expect(screen.getByRole("tab", { name: "Prompts" })).toBeInTheDocument();
    unmount();
    render(<Settings onBack={() => {}} />);
    expect(screen.getByRole("tab", { name: "Prompts" })).toBeInTheDocument();
  });

  it("turning it off while editing prompts goes back to Conexión", async () => {
    localStorage.setItem("la.advanced", "1");
    render(<Settings onBack={() => {}} initialTab="prompts" />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Modo avanzado/ }));
    expect(screen.queryByRole("tab", { name: "Prompts" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Conexión" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Settings › Prompts", () => {
  it("edits, saves and restores a prompt", async () => {
    localStorage.setItem("la.advanced", "1");
    render(<Settings onBack={() => {}} />);
    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));
    const nav = await screen.findByRole("button", { name: "Fase Enseñar" });
    await userEvent.click(nav);
    const editor = screen.getByLabelText("Contenido del prompt") as HTMLTextAreaElement;
    expect(editor.value).toContain("Fase: ENSEÑAR");
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toBeDisabled();

    await userEvent.clear(editor);
    await userEvent.type(editor, "nuevo");
    await userEvent.click(save);
    expect(await screen.findByText("Guardado. Se usa desde el próximo mensaje.")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Fase Enseñar" })).getByTitle("Modificado")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Restaurar original" }));
    expect(await screen.findByText("Restaurado al original.")).toBeInTheDocument();
    expect((screen.getByLabelText("Contenido del prompt") as HTMLTextAreaElement).value).toContain("Fase: ENSEÑAR");
  });
});

describe("Settings › Accesibilidad (AC-73)", () => {
  it("saves each choice at once and applies display ones to the page", async () => {
    render(
      <AccessibilityProvider>
        <Settings onBack={() => {}} initialTab="accessibility" />
      </AccessibilityProvider>,
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: /Más espacio entre letras/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Muy grande" }));
    expect(document.documentElement.dataset.spacing).toBe("on");
    expect(document.documentElement.dataset.textSize).toBe("larger");
    await userEvent.click(screen.getByRole("checkbox", { name: /Lenguaje literal/ }));
    expect(await accessibilityApi.get()).toMatchObject({ spacing: true, text_size: "larger", literal: true });
    expect(screen.queryByText(/dislexia|TDAH|autismo/i)).toBeNull();
  });
});

describe("Settings › Accesibilidad: guardado", () => {
  it("announces when a change was saved, and the speed slider reads in words", async () => {
    render(
      <AccessibilityProvider>
        <Settings onBack={() => {}} initialTab="accessibility" />
      </AccessibilityProvider>,
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: /Sin animaciones/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Guardado.");
    expect(screen.getByRole("slider", { name: "Velocidad de lectura" })).toHaveAttribute("aria-valuetext", expect.stringMatching(/veces$/));
  });

  it("goes back to what is stored when saving fails, and says so", async () => {
    const save = vi.spyOn(accessibilityApi, "save").mockRejectedValueOnce("no se pudo guardar");
    render(
      <AccessibilityProvider>
        <Settings onBack={() => {}} initialTab="accessibility" />
      </AccessibilityProvider>,
    );
    const box = await screen.findByRole("checkbox", { name: /Pasos cortos/ });
    const before = (box as HTMLInputElement).checked;
    await userEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("no se pudo guardar");
    expect((screen.getByRole("checkbox", { name: /Pasos cortos/ }) as HTMLInputElement).checked).toBe(before);
    save.mockRestore();
  });
});

describe("Settings › Voz en esta PC (AC-106)", () => {
  it("offers the local model only for Voz, shows the size, downloads it and can delete it", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    const provider = await screen.findByLabelText("Proveedor de Voz");
    expect(within(screen.getByLabelText("Proveedor de Profesor")).queryByRole("option", { name: /En esta PC/ })).toBeNull();
    await userEvent.selectOptions(provider, "En esta PC");
    expect(screen.queryByLabelText("Modelo de Voz")).toBeNull();
    const local = await screen.findByLabelText("Modelo de voz local");
    // AC-185: Parakeet v3 is what «En esta PC» picks.
    expect(local).toHaveValue("parakeet-v3");
    expect(screen.queryByRole("note")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Descargar (670 MB)" }));
    expect(await screen.findByRole("button", { name: "Borrar modelo" }, { timeout: 4000 })).toBeInTheDocument();
    expect(within(local).getByRole("option", { name: /Mejor calidad \(Parakeet v3\) · 670 MB · descargado/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Borrar modelo" }));
    expect(await screen.findByRole("button", { name: "Descargar (670 MB)" })).toBeInTheDocument();
  });

  it("lists Parakeet v3 first and keeps a Whisper someone chose (AC-185)", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    await userEvent.selectOptions(await screen.findByLabelText("Proveedor de Voz"), "En esta PC");
    const local = await screen.findByLabelText("Modelo de voz local");
    await within(local).findByRole("option", { name: /Whisper base/ });
    expect(within(local).getAllByRole("option").map((o) => o.textContent)).toEqual(["Mejor calidad (Parakeet v3) · 670 MB", "Liviano (Whisper tiny) · 151 MB", "Liviano, mejor (Whisper base) · 290 MB"]);
    await userEvent.selectOptions(local, "whisper-base");
    expect(local).toHaveValue("whisper-base");
    expect(screen.getByRole("button", { name: "Descargar (290 MB)" })).toBeInTheDocument();
  });
});

describe("Settings › Voz (AC-65)", () => {
  it("warns when the voice role has a text model, and stops when it is a transcription one", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    const model = await screen.findByLabelText("Modelo de Voz");
    expect(screen.queryByRole("note")).toBeNull();
    await userEvent.clear(model);
    await userEvent.type(model, "deepseek-v4.1-flash");
    expect(screen.getByRole("note")).toHaveTextContent("parece un modelo de texto");
    await userEvent.clear(model);
    await userEvent.type(model, "whisper-large-v3");
    expect(screen.queryByRole("note")).toBeNull();
    await userEvent.clear(model);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("Settings › Conexión", () => {
  it("opens on one service, one key and one model", async () => {
    render(<Settings onBack={() => {}} />);
    expect(screen.getByRole("tab", { name: "Conexión" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Servicio")).toBeInTheDocument();
    expect(screen.getByLabelText("Clave de acceso")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Modelo")).toBeInTheDocument();
    expect(screen.queryByLabelText("Proveedor de Profesor")).toBeNull();
    expect(screen.queryByText(/Contexto del modelo/)).toBeNull();
  });

  it("asks for a model before saving, and saves the chosen one as the only model", async () => {
    render(<Settings onBack={() => {}} />);
    const model = await screen.findByLabelText("Modelo");
    await userEvent.clear(model);
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Elegí un modelo");
    await userEvent.type(model, "demo/otro");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Guardado.")).toBeInTheDocument();
    expect(screen.getByTestId("connection-state")).toHaveTextContent("demo/otro");
  });

  it("asks for the key when the service has none", async () => {
    render(<Settings onBack={() => {}} />);
    await userEvent.selectOptions(await screen.findByLabelText("Servicio"), "anthropic");
    await userEvent.type(screen.getByLabelText("Modelo"), "algo");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pegá tu clave");
  });
});

describe("Settings › Avanzado › Uso (AC-186)", () => {
  const zero = { calls: 0, known: 0, input: 0, output: 0, cached: null, reasoning: null, cost: null, ms: 0 };

  it("shows today, the last 7 days, the cached share, the tasks and the sessions", async () => {
    render(<Settings onBack={() => {}} initialTab="models" />);
    const uso = await screen.findByRole("region", { name: "Uso" });
    const totals = await within(uso).findByRole("table", { name: "Totales" });
    const today = within(totals).getByRole("row", { name: /Hoy/ });
    expect(today).toHaveTextContent("98.400");
    expect(today).toHaveTextContent("63 %");
    expect(today).toHaveTextContent("US$ 0,0213");
    expect(within(uso).getByTestId("usage-unknown")).toHaveTextContent("2 llamadas de los últimos 7 días sin datos del proveedor");
    expect(within(within(uso).getByRole("table", { name: "Por tarea" })).getByRole("row", { name: /Diagnóstico/ })).toHaveTextContent("52.400");
    expect(within(uso).getByRole("table", { name: "Por sesión" })).toHaveTextContent("qué es una derivada");
    expect(within(uso).getByText(/solo en esta PC/)).toBeInTheDocument();
  });

  it("says when nothing was recorded yet, and never invents a cost or a cache share", async () => {
    const spy = vi.spyOn(usageApi, "summary").mockResolvedValueOnce({ today: zero, week: zero, by_role: [], sessions: [], keep_days: 90 });
    render(<Settings onBack={() => {}} initialTab="models" />);
    expect(await screen.findByText("Todavía no hay llamadas registradas.")).toBeInTheDocument();
    expect(cachedShare({ ...zero, input: 100 })).toBe("—");
    expect(costText(zero)).toBe("—");
    expect(cachedShare({ ...zero, input: 1000, cached: 0 })).toBe("0 %");
    spy.mockRestore();
  });

  it("a failing read does not break the rest of the tab", async () => {
    const spy = vi.spyOn(usageApi, "summary").mockRejectedValueOnce("sin acceso");
    render(<Settings onBack={() => {}} initialTab="models" />);
    expect(await screen.findByText("No pude leer el uso: sin acceso")).toBeInTheDocument();
    expect(screen.getByLabelText("API key de OpenRouter")).toBeInTheDocument();
    spy.mockRestore();
  });
});
