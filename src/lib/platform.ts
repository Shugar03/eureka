// The same screens run on the computer and on the phone (Android).

export const onPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent);

/** Where the data stays: "esta computadora" or "este celular". */
export const thisDevice = () => (onPhone() ? "este celular" : "esta computadora");
export const yourDevice = () => (onPhone() ? "tu celular" : "tu computadora");

/** The computer's own dictation, mentioned while no voice model is chosen. */
export const systemDictation = () => (onPhone() ? "" : " Mientras tanto, Win + H dicta en Windows.");

/** Why the microphone could not start, in words the student can act on (`e` is what getUserMedia threw). */
export function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  const phone = onPhone();
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return phone
      ? "No encontré ningún micrófono en este celular."
      : "No encontré ningún micrófono. Conectá uno (o revisá que esté activado en Configuración → Sistema → Sonido) y probá de nuevo.";
  if (name === "NotReadableError" || name === "AbortError")
    return "El micrófono está ocupado o no responde. Cerrá otras apps que lo usen (una llamada, Zoom, Teams…) o desconectalo y volvé a conectarlo, y probá de nuevo.";
  return phone
    ? "No tengo permiso para usar el micrófono. Activalo en los ajustes del celular y probá de nuevo."
    : "No tengo permiso para usar el micrófono. Activalo en la Configuración de Windows, en Privacidad y seguridad → Micrófono, y probá de nuevo.";
}
