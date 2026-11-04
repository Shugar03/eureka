import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEMO_CSP, DemoFrame, DemoPane, withCsp } from "./DemoFrame";
import { ResearchCard } from "./ResearchCard";
import { Diagram } from "./Diagram";
import { buildTranscript } from "../lib/transcript";
import type { Session } from "../types";

describe("DemoFrame in the chat", () => {
  it("offers to open the demo in the panel, and shows a note instead of a second copy while it is open", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<DemoFrame title="Demo" html="<p>hola</p>" onOpen={onOpen} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir en el panel" }));
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(<DemoFrame title="Demo" html="<p>hola</p>" opened onOpen={onOpen} onClose={onClose} />);
    expect(screen.queryByTitle("Demo")).not.toBeInTheDocument();
    expect(screen.getByText(/abierta en el panel/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("DemoPane", () => {
  const setup = () => {
    localStorage.removeItem("la.demoFit");
    const props = { title: "Demo", html: "<p>hola</p>", width: 520, onWidth: vi.fn(), onClose: vi.fn() };
    render(<DemoPane {...props} />);
    return props;
  };

  it("keeps the sandbox and the CSP, and adds only the size report", () => {
    setup();
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain("demo-size");
    for (const net of ["fetch", "XMLHttpRequest", "WebSocket", "sendBeacon"]) expect(doc).not.toContain(net);
  });

  it("maximizes over the window and Escape restores it", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    setup();
    const frame = document.querySelector("iframe")!;
    await userEvent.click(screen.getByRole("button", { name: "Maximizar" }));
    expect(screen.getByTestId("demo-pane")).toHaveClass("is-max");
    expect(document.querySelector("iframe")!).toBe(frame);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("demo-pane")).not.toHaveClass("is-max");
  });

  it("remembers the Ajustar choice, shows the demo at real size without it, and closes", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const p = setup();
    const fit = screen.getByRole("button", { name: "Ajustar" });
    expect(fit).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(fit);
    expect(fit).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("la.demoFit")).toBe("0");
    expect(document.querySelector("iframe")!).toHaveClass("is-real");
    expect(document.querySelector("iframe")!.getAttribute("srcdoc")).not.toContain("demo-size");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar panel" }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it("the width handle answers the keyboard", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const p = setup();
    screen.getByRole("separator", { name: "Cambiar el ancho del panel" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(p.onWidth).toHaveBeenCalledWith(544);
  });
});

describe("DemoFrame invert (AC-175)", () => {
  it("inverts the frame's colors, keeps the sandbox and remembers the choice", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    localStorage.removeItem("la.demoInvert");
    const { unmount } = render(<DemoFrame title="Demo" html="<p>hola</p>" />);
    const button = screen.getByRole("button", { name: "Invertir colores" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(screen.getByTitle("Demo")).toHaveClass("is-inverted");
    expect(screen.getByTitle("Demo").getAttribute("sandbox")).toBe("allow-scripts");
    expect(localStorage.getItem("la.demoInvert")).toBe("1");
    unmount();
    render(<DemoFrame title="Otra" html="<p>x</p>" />);
    expect(screen.getByTitle("Otra")).toHaveClass("is-inverted");
    await userEvent.click(screen.getByRole("button", { name: "Invertir colores" }));
    expect(screen.getByTitle("Otra")).not.toHaveClass("is-inverted");
    expect(localStorage.getItem("la.demoInvert")).toBe("0");
  });
});

describe("DemoFrame (NF-14)", () => {
  it("injects the CSP before anything else", () => {
    expect(withCsp("<p>x</p>").startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    const withHead = withCsp('<html><head><script src="https://evil.test/x.js"></script></head></html>');
    expect(withHead.indexOf("Content-Security-Policy")).toBeLessThan(withHead.indexOf("<script"));
    expect(DEMO_CSP).toContain("default-src 'none'");
    expect(DEMO_CSP).not.toMatch(/connect-src|https?:/);
  });

  it("runs in a sandbox with scripts only (no same-origin, no top navigation)", () => {
    render(<DemoFrame title="Demo" html="<p>hola</p>" />);
    const frame = screen.getByTitle("Demo");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });
});

describe("ResearchCard", () => {
  it("shows the summary and sources opening outside the app", () => {
    render(
      <ResearchCard
        question="¿para qué sirve?"
        result={{ kind: "research", question: "q", summary: "Sirve [1].", sources: [{ title: "Física", url: "https://fisica.example/v" }], error: null }}
      />,
    );
    const link = screen.getByRole("link", { name: "Física" });
    expect(link).toHaveAttribute("href", "https://fisica.example/v");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("fisica.example")).toBeInTheDocument();
  });

  it("explains why research did not run, and shows progress before the result", () => {
    const { rerender } = render(<ResearchCard question="q" result={null} />);
    expect(screen.getByText("Buscando…")).toBeInTheDocument();
    rerender(<ResearchCard question="q" result={{ kind: "research", question: "q", summary: "", sources: [], error: "búsqueda web no configurada" }} />);
    expect(screen.getByTestId("research-error")).toHaveTextContent("búsqueda web no configurada");
  });
});

describe("Diagram", () => {
  it("falls back to the source code when Mermaid cannot render", async () => {
    render(<Diagram title="Roto" code={"esto no es mermaid ((("} />);
    expect(await screen.findByText(/No se pudo dibujar/, {}, { timeout: 25_000 })).toBeInTheDocument();
    expect(screen.getByText("esto no es mermaid (((")).toBeInTheDocument();
  }, 30_000); // Mermaid is a big dynamic import (slow under Stryker's instrumentation)
});

describe("transcript visual and research items", () => {
  const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const session = (messages: Session["messages"]): Session => ({
    id: "s",
    title: "t",
    goal: "g",
    phase: "teach",
    created_at: "",
    updated_at: "",
    findings: [],
    plan: [],
    pending_question: null,
    messages,
  });

  it("maps show_diagram, show_demo and research (with its result) to items", () => {
    const items = buildTranscript(
      session([
        {
          role: "assistant",
          tool_calls: [
            call("d", "show_diagram", { title: "D", mermaid: "graph TD; A-->B" }),
            call("m", "show_demo", { title: "M", html: "<p/>" }),
            call("r", "research", { question: "¿q?" }),
            call("x", "show_demo", { html: "<p/>" }),
          ],
        },
        { role: "tool", tool_call_id: "r", content: "Investigación", meta: { kind: "research", question: "¿q?", summary: "s", sources: [], error: null } },
      ]),
    );
    expect(items.map((i) => i.kind)).toEqual(["diagram", "demo", "research"]);
    const r = items[2];
    expect(r.kind === "research" && r.result?.summary).toBe("s");
  });
});
