// TypeScript type checking in the browser (AC-53): Node only strips types
// when running, so mistakes like `const n: number = "a"` would go unnoticed.
// The compiler and its lib files load only when TypeScript is first used.

export interface TsDiagnostic {
  line: number;
  column: number;
  message: string;
}

type TS = typeof import("typescript");

let loaded: Promise<{ ts: TS; libs: Map<string, string> }> | null = null;

function load() {
  loaded ??= (async () => {
    const ts = (await import("typescript")).default as TS;
    const files = import.meta.glob("/node_modules/typescript/lib/lib.*.d.ts", { query: "?raw", import: "default" });
    const libs = new Map<string, string>();
    await Promise.all(
      Object.entries(files).map(async ([path, read]) => {
        libs.set(path.split("/").pop()!, (await read()) as string);
      }),
    );
    return { ts, libs };
  })();
  return loaded;
}

/** Type errors of a single main.ts (strict, ES2022 + DOM's console). */
export async function tsCheck(code: string): Promise<TsDiagnostic[]> {
  const { ts, libs } = await load();
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [], skipLibCheck: true };
  const files = new Map([["main.ts", code], ...libs]);
  const host: import("typescript").CompilerHost = {
    getSourceFile: (name, version) => {
      const text = files.get(name.split("/").pop()!);
      return text == null ? undefined : ts.createSourceFile(name, text, version);
    },
    getDefaultLibFileName: () => "lib.es2022.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (name) => files.has(name.split("/").pop()!),
    readFile: (name) => files.get(name.split("/").pop()!),
    getCanonicalFileName: (n) => n,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram(["main.ts"], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName.endsWith("main.ts"))
    .map((d) => {
      const { line, character } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      return { line: line + 1, column: character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") };
    });
}
