import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useHistoryBack } from "./history";

let go: (s: string) => void = () => {};
function Screen() {
  const [screen, setScreen] = useState("home");
  go = setScreen;
  useHistoryBack(screen, setScreen);
  return <p>{screen}</p>;
}

const back = () => act(() => window.dispatchEvent(new PopStateEvent("popstate")));

describe("useHistoryBack", () => {
  it("the back button returns to the previous screens in order", () => {
    const { container } = render(<Screen />);
    act(() => go("cards"));
    act(() => go("settings"));
    back();
    expect(container.textContent).toBe("cards");
    back();
    expect(container.textContent).toBe("home");
    // Nothing left: the app is left to close.
    back();
    expect(container.textContent).toBe("home");
  });

  it("a Volver button to the screen just left does not stack it again", () => {
    const { container } = render(<Screen />);
    act(() => go("settings"));
    act(() => go("home"));
    // Our own history.back() fires a popstate that is ignored.
    back();
    expect(container.textContent).toBe("home");
    act(() => go("cards"));
    back();
    expect(container.textContent).toBe("home");
  });
});
