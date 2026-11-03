// features/caminos.feature — the same seeded random walks, on the REAL app
// (Rust agent loop + fake provider).
import { test } from "@e2e-dev/web";
import { seeds, walk } from "../e2e/walk.ts";
import { fakeProvider } from "./launch.ts";

for (const seed of seeds("707,808")) {
  test(`D-camino aleatorio semilla ${seed}`, async (fx) => {
    await fakeProvider.reset();
    await walk(seed, fx, 20_000);
  });
}
