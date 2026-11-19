import { describe, expect, it } from "vitest";
import { micError } from "./platform";

const fail = (name: string) => new DOMException("x", name);

describe("micError", () => {
  it("tells a missing microphone apart from a busy one and a denied permission", () => {
    expect(micError(fail("NotFoundError"))).toMatch(/No encontré ningún micrófono/);
    expect(micError(fail("NotReadableError"))).toMatch(/ocupado por otra app/);
    expect(micError(fail("NotAllowedError"))).toMatch(/Privacidad y seguridad → Micrófono/);
    expect(micError(new Error("?"))).toMatch(/permiso/);
  });
});
