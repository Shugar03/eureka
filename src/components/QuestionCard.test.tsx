import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionCard } from "./QuestionCard";

describe("QuestionCard", () => {
  it("requires an answer and a confidence before sending", async () => {
    const onSubmit = vi.fn();
    render(<QuestionCard args={{ question: "¿Por qué?", purpose: "check" }} answer={null} pending busy={false} onSubmit={onSubmit} />);
    const send = screen.getByRole("button", { name: "Responder" });

    await userEvent.type(screen.getByLabelText("Tu respuesta"), "porque sí");
    expect(send).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /^Confianza 2:/ }));
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
    expect(screen.getByRole("button", { name: "Contar cómo lo pensaste con la voz" })).toBeInTheDocument();
  });
});
