import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders inline and display math with KaTeX", () => {
    const { container } = render(<Markdown text={"La pendiente $m=2$ y\n\n$$\n\\frac{1}{n}\n$$"} />);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("renders GFM tables and emphasis", () => {
    const { container } = render(<Markdown text={"**fuerte**\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });
});
