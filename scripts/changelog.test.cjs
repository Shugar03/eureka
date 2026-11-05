// node --test scripts/changelog.test.cjs  (npm run test:scripts)
const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseChangelog, localDate } = require("./changelog.cjs");

const REPO = "Shugar03/eureka";
const BEFORE = `# Cambios

Intro.

## Sin publicar

### Nuevo
- Algo nuevo (AC-200).

### Arreglado
- Algo arreglado.

## [0.5.0] - 2026-11-04

### Nuevo
- Voz local.

[0.5.0]: https://github.com/Shugar03/eureka/releases/tag/v0.5.0
[0.4.0]: https://github.com/Shugar03/eureka/releases/tag/v0.4.0
`;

test("moves «Sin publicar» into the new version and leaves it empty on top", () => {
  const { text, notes } = releaseChangelog(BEFORE, "0.6.0", "2026-11-05", REPO);
  assert.equal(
    text,
    `# Cambios

Intro.

## Sin publicar

## [0.6.0] - 2026-11-05

### Nuevo
- Algo nuevo (AC-200).

### Arreglado
- Algo arreglado.

## [0.5.0] - 2026-11-04

### Nuevo
- Voz local.

[0.6.0]: https://github.com/Shugar03/eureka/releases/tag/v0.6.0
[0.5.0]: https://github.com/Shugar03/eureka/releases/tag/v0.5.0
[0.4.0]: https://github.com/Shugar03/eureka/releases/tag/v0.4.0
`,
  );
  assert.equal(notes, "### Nuevo\n- Algo nuevo (AC-200).\n\n### Arreglado\n- Algo arreglado.");
});

test("an empty «Sin publicar» gives empty notes and a version with no body", () => {
  const empty = BEFORE.replace(/## Sin publicar[\s\S]*?(?=## \[0\.5\.0\])/, "## Sin publicar\n\n");
  const { text, notes } = releaseChangelog(empty, "0.5.1", "2026-11-05", REPO);
  assert.equal(notes, "");
  assert.match(text, /## Sin publicar\n\n## \[0\.5\.1\] - 2026-11-05\n\n## \[0\.5\.0\]/);
});

test("a changelog with no released versions yet gets its first link at the bottom", () => {
  const { text } = releaseChangelog("# Cambios\n\n## Sin publicar\n\n- Primera.\n", "0.1.0", "2026-01-02", REPO);
  assert.equal(text, "# Cambios\n\n## Sin publicar\n\n## [0.1.0] - 2026-01-02\n\n- Primera.\n\n[0.1.0]: https://github.com/Shugar03/eureka/releases/tag/v0.1.0\n");
});

test("keeps CRLF line endings", () => {
  const { text, notes } = releaseChangelog(BEFORE.replace(/\n/g, "\r\n"), "0.6.0", "2026-11-05", REPO);
  assert.ok(!/[^\r]\n/.test(text), "every newline is CRLF");
  assert.equal(notes.includes("\r"), false);
});

test("refuses a version that is already there, or a file without «Sin publicar»", () => {
  assert.throws(() => releaseChangelog(BEFORE, "0.5.0", "2026-11-05", REPO), /ya tiene la versión 0\.5\.0/);
  assert.throws(() => releaseChangelog("# Cambios\n", "0.6.0", "2026-11-05", REPO), /Sin publicar/);
});

test("the real CHANGELOG.md goes through", () => {
  const real = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "CHANGELOG.md"), "utf8");
  const { text, notes } = releaseChangelog(real, "9.9.9", "2026-11-05", REPO);
  assert.match(text, /## Sin publicar\r?\n\r?\n## \[9\.9\.9\] - 2026-11-05/);
  assert.match(text, /\[9\.9\.9\]: https:\/\/github\.com\/Shugar03\/eureka\/releases\/tag\/v9\.9\.9\r?\n\[0\.5\.0\]/);
  assert.ok(notes.length > 0);
  // Nothing else changes: dropping the two added lines gives back the original text.
  const undo = (s) => s.replace(/\r\n/g, "\n").replace("## [9.9.9] - 2026-11-05\n\n", "").replace(/\[9\.9\.9\]: .*\n/, "");
  assert.equal(undo(text), real.replace(/\r\n/g, "\n"));
});

test("localDate uses the local calendar day", () => {
  assert.equal(localDate(new Date(2026, 10, 5, 23, 30)), "2026-11-05");
  assert.equal(localDate(new Date(2026, 0, 9)), "2026-01-09");
});
