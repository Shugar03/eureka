// Saving a file the user keeps. On the computer it is a download (Descargas);
// on the phone the webview ignores downloads and Descargas is a folder only the
// app sees, so Android's own "Guardar como" asks where it goes.

import { onPhone } from "./platform";

export { onPhone };

/** Saves text or bytes made on screen. False when the user cancels. */
export async function saveFile(name: string, data: string | Uint8Array, type: string): Promise<boolean> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (onPhone()) return saveAs(name, bytes);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/**
 * A file the app already wrote in Descargas (a backup, an .apkg, a .eureka).
 * On the phone it is copied to where the user picks; returns where it is to
 * show, or null when the user cancels.
 */
export async function keepFile(path: string): Promise<string | null> {
  if (!onPhone()) return path;
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const name = path.split(/[\\/]/).pop() ?? path;
  return (await saveAs(name, await readFile(path))) ? name : null;
}

async function saveAs(name: string, bytes: Uint8Array): Promise<boolean> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const to = await save({ defaultPath: name });
  if (!to) return false;
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(to, bytes);
  return true;
}
