// Pure CHANGELOG.md transformation used by scripts/release.cjs (no IO, so it can be tested).
//
// Publishing version X moves the «## Sin publicar» section into «## [X] - YYYY-MM-DD»,
// leaves an empty «## Sin publicar» on top, and adds the `[X]: …/releases/tag/vX` link
// above the older ones. The moved text doubles as the release notes.
const UNRELEASED = "## Sin publicar";

/** Local YYYY-MM-DD: toISOString() is UTC and would date an evening release tomorrow. */
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {string} text   the whole CHANGELOG.md
 * @param {string} version e.g. "0.6.0"
 * @param {string} date    YYYY-MM-DD
 * @param {string} repo    "owner/name", for the link reference
 * @returns {{ text: string, notes: string }} the new file and the moved section (trimmed, may be "")
 */
function releaseChangelog(text, version, date, repo) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === UNRELEASED);
  if (start === -1) throw new Error(`CHANGELOG.md no tiene la sección «${UNRELEASED}»`);
  const escaped = version.replace(/\./g, "\\.");
  if (lines.some((l) => new RegExp(`^## \\[${escaped}\\]`).test(l))) throw new Error(`CHANGELOG.md ya tiene la versión ${version}`);

  // The section runs until the next level-2 heading or the link references at the bottom.
  let end = lines.findIndex((l, i) => i > start && (/^## /.test(l) || /^\[[^\]]+\]: /.test(l)));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const notes = body.join("\n");

  const section = [UNRELEASED, "", `## [${version}] - ${date}`, ...(body.length ? ["", ...body] : []), ""];
  const out = [...lines.slice(0, start), ...section, ...lines.slice(end)];

  // Link reference, newest first: above the first existing one, or appended at the end.
  const link = `[${version}]: https://github.com/${repo}/releases/tag/v${version}`;
  const firstRef = out.findIndex((l) => /^\[[^\]]+\]: /.test(l));
  if (firstRef === -1) {
    while (out.length && !out[out.length - 1].trim()) out.pop();
    out.push("", link, "");
  } else {
    out.splice(firstRef, 0, link);
  }
  return { text: out.join(eol), notes };
}

/**
 * The moved section as one plain-text line for the in-app update notice (it renders text,
 * not Markdown): the bullets without headings, emphasis, links or the (AC-n) references.
 */
function plainNotes(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) =>
      l
        .replace(/^\s*[-*]\s+/, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|`/g, "")
        .replace(/\s*\((?:AC-\d+(?:[,\s]+|\.\.|…)?)+\)/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" · ");
}

module.exports = { releaseChangelog, localDate, plainNotes };
