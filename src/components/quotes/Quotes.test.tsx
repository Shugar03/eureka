import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteCard } from "./QuoteCard";
import { QuotesSection } from "./QuotesSection";
import { resetQuotePrefsCache } from "./useQuotePrefs";
import { quoteOfDay } from "../../lib/quotes";

beforeEach(() => {
  localStorage.clear();
  resetQuotePrefsCache();
});

describe("QuoteCard (AC-130, AC-131)", () => {
  it("shows today's quote with its author and work", () => {
    const q = quoteOfDay();
    render(<QuoteCard />);
    expect(screen.getByTestId("quote-text")).toHaveTextContent(q.text);
    expect(screen.getByText(q.author)).toBeInTheDocument();
    expect(screen.getByText(q.work)).toBeInTheDocument();
  });

  it("shows another one, keeps a favourite, and hides one with undo", async () => {
    const today = quoteOfDay();
    render(
      <>
        <QuoteCard />
        <QuotesSection />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Otra cita" }));
    const other = screen.getByTestId("quote-text").textContent!;
    expect(other).not.toContain(today.text);

    await userEvent.click(screen.getByRole("button", { name: "Guardar como favorita" }));
    expect(screen.getByRole("button", { name: "Quitar de favoritas" })).toHaveAttribute("aria-pressed", "true");
    const favs = screen.getByRole("list", { name: "Mis favoritas" });
    expect(within(favs).getByText(other.replace(/[“”]/g, ""), { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "No mostrar más" }));
    expect(screen.getByTestId("quote-text")).not.toHaveTextContent(other.replace(/[“”]/g, ""));
    expect(screen.queryByRole("list", { name: "Mis favoritas" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("no te la vuelvo a mostrar");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(screen.getByTestId("quote-text")).toHaveTextContent(other.replace(/[“”]/g, ""));
  });
});

describe("QuotesSection (AC-132, AC-133)", () => {
  it("adds the learner's own quote, and the welcome can be turned on", async () => {
    render(<QuotesSection />);
    expect(screen.getByText(/366 citas, una para cada día del año/)).toBeInTheDocument();
    const welcome = screen.getByRole("checkbox", { name: /Mostrar la cita del día al abrir/ });
    expect(welcome).not.toBeChecked();
    await userEvent.click(welcome);
    expect(welcome).toBeChecked();
    expect(JSON.parse(localStorage.getItem("la.quotes")!).splash).toBe(true);

    await userEvent.type(screen.getByRole("textbox", { name: "Nueva frase" }), "Paso a paso");
    await userEvent.type(screen.getByRole("textbox", { name: "Autor de la frase" }), "mi abuela");
    await userEvent.click(screen.getByRole("button", { name: "Agregar frase" }));
    const mine = screen.getByRole("list", { name: "Mis frases" });
    expect(within(mine).getByText(/Paso a paso/)).toBeInTheDocument();
    await userEvent.click(within(mine).getByRole("button", { name: /Borrar mi frase/ }));
    expect(screen.queryByRole("list", { name: "Mis frases" })).toBeNull();
  });
});
