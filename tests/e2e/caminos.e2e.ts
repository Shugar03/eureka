// features/caminos.feature — seeded random walks over the web app (mock backend).
import { test } from "@e2e-dev/web";
import { seeds, walk } from "./walk.ts";

for (const seed of seeds("101,202,303,404,505")) {
  test(`camino aleatorio semilla ${seed}`, async (fx) => walk(seed, fx));
}
