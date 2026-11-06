import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionCard, formatOf, shuffled } from "./QuestionCard";

describe("QuestionCard", () => {
  it("requires an answer and a confidence before sending", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "¿Por qué?", purpose: "check" }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    const send = screen.getByRole("button", { name: "Responder" });

    await userEvent.type(screen.getByLabelText("Tu respuesta"), "porque sí");
    expect(send).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /^Confianza 2:/ }));
    await userEvent.click(screen.getByRole("button", { name: "+ Contar cómo lo pensé" }));
    await userEvent.type(screen.getByLabelText("Pensando en voz alta"), "no estoy seguro");
    await userEvent.click(send);

    expect(onSubmit).toHaveBeenCalledWith({ text: "porque sí", confidence: 2, thinking: "no estoy seguro" });
  });

  it("joins the chosen option with the optional comment", async () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard args={{ question: "Elegí", purpose: "probe", options: ["A", "B"] }} answer={null} pending busy={false} onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    await userEvent.type(screen.getByLabelText("Comentario"), "por descarte");
    await userEvent.click(screen.getByRole("radio", { name: /^Confianza 3:/ }));
    await userEvent.click(screen.getByRole("button", { name: "Responder" }));

    expect(onSubmit).toHaveBeenCalledWith({ text: "B — por descarte", confidence: 3, thinking: "" });
  });

  it("shows a past answer and no form when not pending", () => {
    render(
      <QuestionCard
        args={{ question: "q", purpose: "predict" }}
        answer={{ kind: "answer", text: "mi respuesta", confidence: 5, thinking: "seguro" }}
        pending={false}
        busy={false}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("mi respuesta")).toBeInTheDocument();
    expect(screen.getByText("Confianza 5/5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Responder" })).not.toBeInTheDocument();
  });

  it("cannot send while the agent is busy, or with a blank answer", async () => {
    const { rerender } = render(<QuestionCard args={{ question: "q", purpose: "check" }} answer={null} pending busy onSubmit={() => {}} />);
    await userEvent.type(screen.getByLabelText("Tu respuesta"), "algo");
    await userEvent.click(screen.getByRole("radio", { name: /^Confianza 3:/ }));
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
    rerender(<QuestionCard args={{ question: "q", purpose: "check" }} answer={null} pending busy={false} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: "Responder" })).toBeEnabled();
    await userEvent.clear(screen.getByLabelText("Tu respuesta"));
    await userEvent.type(screen.getByLabelText("Tu respuesta"), "   ");
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
  });

  it("trims the answer and the thinking", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "q", purpose: "check" }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Tu respuesta"), "  hola  ");
    await userEvent.click(screen.getByRole("button", { name: "+ Contar cómo lo pensé" }));
    await userEvent.type(screen.getByLabelText("Pensando en voz alta"), "  dudo  ");
    await userEvent.click(screen.getByRole("radio", { name: /^Confianza 5:/ }));
    await userEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(onSubmit).toHaveBeenCalledWith({ text: "hola", confidence: 5, thinking: "dudo" });
  });

  it("marks the chosen option and confidence, numbered 1 to 5", async () => {
    render(<QuestionCard args={{ question: "q", purpose: "probe", options: ["A", "B"] }} answer={null} pending busy={false} onSubmit={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    await userEvent.click(screen.getByRole("radio", { name: /^Confianza 2:/ }));
    expect(screen.getByRole("radio", { name: "B" })).toHaveClass("is-selected");
    expect(screen.getByRole("radio", { name: "A" })).not.toHaveClass("is-selected");
    expect(screen.getByRole("radio", { name: /^Confianza 2:/ })).toHaveClass("is-selected");
    expect(screen.getByRole("radio", { name: /^Confianza 1:/ })).not.toHaveClass("is-selected");
    const confs = screen.getAllByRole("radio", { name: /^Confianza/ });
    expect(confs.map((c) => c.textContent?.[0])).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("open questions have no options group", () => {
    render(<QuestionCard args={{ question: "q", purpose: "probe", options: [] }} answer={null} pending busy={false} onSubmit={() => {}} />);
    expect(screen.queryByRole("radiogroup", { name: "Opciones" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tu respuesta")).toBeInTheDocument();
  });

  it("shows the purpose label, or the raw purpose when unknown", () => {
    const { rerender } = render(<QuestionCard args={{ question: "q", purpose: "predict" }} answer={null} pending={false} busy={false} onSubmit={() => {}} />);
    expect(screen.getByText("Predicción")).toBeInTheDocument();
    rerender(<QuestionCard args={{ question: "q", purpose: "otro" as never }} answer={null} pending={false} busy={false} onSubmit={() => {}} />);
    expect(screen.getByText("otro")).toBeInTheDocument();
  });

  it("hides confidence and thinking of a past answer when absent", () => {
    render(
      <QuestionCard
        args={{ question: "q", purpose: "check" }}
        answer={{ kind: "answer", text: "x", confidence: null, thinking: "" }}
        pending={false}
        busy={false}
        onSubmit={() => {}}
      />,
    );
    expect(screen.queryByText(/Confianza/)).not.toBeInTheDocument();
    expect(document.querySelector(".answer-thinking")).toBeNull();
  });

  it("AC-184: a diagnostic question says which one it is and offers to stop", async () => {
    const onEnough = vi.fn();
    const { rerender } = render(<QuestionCard args={{ question: "¿?", purpose: "probe", of: 3 }} answer={null} pending busy={false} onSubmit={vi.fn()} step={{ n: 2, of: 3 }} onEnough={onEnough} />);
    expect(screen.getByTestId("probe-step")).toHaveTextContent("Pregunta 2 de ~3");
    await userEvent.click(screen.getByRole("button", { name: "Con esto alcanza, empecemos" }));
    expect(onEnough).toHaveBeenCalledOnce();
    // The estimate never trails the count: a fourth question under «~3» reads «de ~4».
    rerender(<QuestionCard args={{ question: "¿?", purpose: "probe" }} answer={null} pending busy={false} onSubmit={vi.fn()} step={{ n: 4, of: 3 }} />);
    expect(screen.getByTestId("probe-step")).toHaveTextContent("Pregunta 4 de ~4");
    expect(screen.queryByRole("button", { name: "Con esto alcanza, empecemos" })).not.toBeInTheDocument();
    // Without an estimate there is no total to promise.
    rerender(<QuestionCard args={{ question: "¿?", purpose: "probe" }} answer={null} pending busy={false} onSubmit={vi.fn()} step={{ n: 1 }} />);
    expect(screen.getByTestId("probe-step")).toHaveTextContent(/^Pregunta 1$/);
  });

  it("the card has a microphone for the answer and for the thinking, named apart from the chat's", () => {
    render(<QuestionCard args={{ question: "¿Por qué?", purpose: "check" }} answer={null} pending busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Responder con la voz" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Contar cómo lo pensaste con la voz" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Contar cómo lo pensé" }));
    expect(screen.getByRole("button", { name: "Contar cómo lo pensaste con la voz" })).toBeInTheDocument();
  });
});

describe("QuestionCard formats (AC-204)", () => {
  const send = () => userEvent.click(screen.getByRole("button", { name: "Responder" }));
  const sure = () => userEvent.click(screen.getByRole("radio", { name: /^Confianza 4:/ }));

  it("true_false: every statement marked before sending, spelled out for the teacher", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "Marcá", purpose: "check", format: "true_false", statements: ["La CEPAL es de 1948", "El IIPE es de 1990"] }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    await sure();
    await userEvent.click(screen.getAllByRole("radio", { name: "Verdadero" })[0]);
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
    await userEvent.click(screen.getAllByRole("radio", { name: "Falso" })[1]);
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ text: "1. «La CEPAL es de 1948»: verdadero\n2. «El IIPE es de 1990»: falso", confidence: 4, thinking: "" });
  });

  it("order: shuffled at first, moved with the arrows, sent in the learner's order", async () => {
    const onSubmit = vi.fn();
    const items = ["Crisis del 30", "CEPAL", "Alianza para el Progreso"];
    render(<QuestionCard args={{ question: "Ordená", purpose: "check", format: "order", items }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    const shown = () => screen.getAllByRole("listitem").map((li) => li.querySelector(".order-text")?.textContent);
    expect(shown()).not.toEqual(items);
    expect([...shown()].sort()).toEqual([...items].sort());
    // Put it right: each item where it belongs.
    for (const [target, x] of items.entries()) {
      while (shown().indexOf(x) > target) await userEvent.click(screen.getByRole("button", { name: `Subir «${x}»` }));
    }
    expect(shown()).toEqual(items);
    await sure();
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ text: "Mi orden: 1) Crisis del 30 2) CEPAL 3) Alianza para el Progreso", confidence: 4, thinking: "" });
  });

  it("match: each left gets one of the shuffled rights", async () => {
    const onSubmit = vi.fn();
    const pairs = [{ left: "Carballeda", right: "intervención" }, { left: "Oszlak", right: "agenda" }, { left: "Argüello", right: "sentidos" }];
    render(<QuestionCard args={{ question: "Uní", purpose: "check", format: "match", pairs }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    await sure();
    for (const p of pairs.slice(0, 2)) await userEvent.selectOptions(screen.getByRole("combobox", { name: `Par de «${p.left}»` }), p.right);
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Par de «Argüello»" }), "agenda");
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ text: "«Carballeda» → «intervención»\n«Oszlak» → «agenda»\n«Argüello» → «agenda»", confidence: 4, thinking: "" });
  });

  it("cloze: the gaps are filled back into the sentence", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "La ___ entra a la agenda cuando se ___.", purpose: "check", format: "cloze" }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Hueco 1" }), "cuestión social");
    await userEvent.type(screen.getByRole("textbox", { name: "Hueco 2" }), "problematiza");
    await sure();
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ text: "La [cuestión social] entra a la agenda cuando se [problematiza].", confidence: 4, thinking: "" });
  });

  it("multi: several options, in the order shown", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "Elegí todas", purpose: "probe", format: "multi", options: ["A", "B", "C"] }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "C" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "A" }));
    await sure();
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ text: "Elegí: A; C", confidence: 4, thinking: "" });
  });

  it("a prediction can be sent without saying how sure", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "¿Qué pasa?", purpose: "predict", format: "choice", options: ["Sube", "Baja"] }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    expect(screen.getByText("¿Qué tan seguro? (opcional)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Sube" }));
    await send();
    expect(onSubmit).toHaveBeenCalledWith({ text: "Sube", confidence: null, thinking: "" });
  });

  it("the shuffle is stable for a question and never the given order", () => {
    const items = ["a", "b", "c", "d"];
    expect(shuffled(items, "q1")).toEqual(shuffled(items, "q1"));
    for (const seed of ["x", "y", "z", "Ordená", "Ordená la cadena", "q2", "q3", "q4"]) {
      const out = shuffled(items, seed);
      expect(out.filter((x, i) => x === items[i]).length * 2, seed).toBeLessThan(items.length);
    }
    expect(formatOf({ question: "q", purpose: "check", options: ["a", "b"] })).toBe("choice");
    expect(formatOf({ question: "q", purpose: "check" })).toBe("open");
  });
});
