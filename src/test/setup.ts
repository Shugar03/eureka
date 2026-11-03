import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library can't register its own cleanup.
afterEach(() => cleanup());

// jsdom lacks the layout APIs React Flow and scrolling use.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Node-environment tests (the library benchmark) have no DOM to patch.
if (typeof Element !== "undefined") {
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  Element.prototype.scrollTo ??= function () {};
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
    constructor() {}
  } as unknown as typeof DOMMatrixReadOnly;
}
