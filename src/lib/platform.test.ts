import { describe, expect, it } from "vitest";
import { micError } from "./platform";

const fail = (name: string) => new DOMException("x", name);

describe("micError", () => {
  it("tells a missing microphone apart from a busy one and a denied permission", () => {
    expect(micError(fail("NotFoundError"))).toMatch(/No encontré ningún micrófono/);
    expect(micError(fail("NotReadableError"))).toMatch(/ocupado o no responde/);
    expect(micError(fail("NotAllowedError"))).toMatch(/Privacidad → Micrófono/);
    expect(micError(new Error("?"))).toMatch(/permiso/);
  });
});
