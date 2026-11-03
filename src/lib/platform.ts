// The same screens run on the computer and on the phone (Android).

export const onPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent);

/** Where the data stays: "esta computadora" or "este celular". */
export const thisDevice = () => (onPhone() ? "este celular" : "esta computadora");

/** The computer's own dictation, mentioned while no voice model is chosen. */
export const systemDictation = () => (onPhone() ? "" : " Mientras tanto, Win + H dicta en Windows.");

export const MIC_DENIED = "No pude usar el micrófono. Dale permiso en los ajustes del sistema y probá de nuevo.";
