import { useCallback, useEffect, useMemo, useState } from "react";
import { api, cardsApi } from "./api";
import { listen } from "@tauri-apps/api/event";
import { leftOutText, type PendingImport } from "./lib/deckImport";
import type { ActionScreen, RoutePrefill, SessionSummary } from "./types";
import { Home } from "./components/Home";
import { SessionView } from "./components/SessionView";
import { Settings, type SettingsTab } from "./components/Settings";
import { AccessibilityProvider } from "./components/a11y/AccessibilityContext";
import { useWorkspace, WorkspaceProvider } from "./components/workspace/WorkspaceContext";
import { Onboarding } from "./components/Onboarding";
import { useUiControl } from "./components/useUiControl";
import { Sidebar } from "./components/Sidebar";
import { CommandMenu, type Command } from "./components/CommandMenu";
import { GraphScreen } from "./components/GraphScreen";
import { LibraryScreen } from "./components/LibraryScreen";
import { PracticeScreen } from "./components/PracticeScreen";
import { ExamScreen } from "./components/ExamScreen";
import { CardsScreen } from "./components/cards/CardsScreen";
import { AgendaScreen } from "./components/AgendaScreen";
import { LanguageScreen } from "./components/LanguageScreen";
import { CompanionScreen } from "./components/companion/CompanionScreen";
import { QuoteSplash } from "./components/quotes/QuoteSplash";
import { AcademicScreen } from "./components/academic/AcademicScreen";
import { ClassesScreen } from "./components/classes/ClassesScreen";
import { ProgressScreen } from "./components/ProgressScreen";
import { CodeScreen, type CodeSeed } from "./components/code/CodeScreen";
import { PomodoroWidget } from "./components/pomodoro/PomodoroWidget";
import { Reminders } from "./components/Reminders";
import { useStudyContext } from "./components/pomodoro/PomodoroContext";
import { UpdateNotice } from "./components/UpdateNotice";
import "./App.css";

type Route =
  | { name: "home" }
  | { name: "session"; id: string }
  | { name: "graph" }
  | { name: "library" }
  | { name: "practice"; id: string | null }
  | { name: "exams"; id: string | null; prefill?: RoutePrefill }
  | { name: "cards"; id: string | null }
  | { name: "agenda" }
  | { name: "language" }
  | { name: "companion" }
  | { name: "academic" }
  | { name: "classes" }
  | { name: "progress" }
  | { name: "code"; seed: CodeSeed | null }
  | { name: "settings"; back: Route; tab?: SettingsTab };

export default function App() {
  return (
    <AccessibilityProvider>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </AccessibilityProvider>
  );
}

function AppShell() {
  const { theme, setTheme, name, identity } = useWorkspace();
  const ui = useUiControl();
  const [route, setRoute] = useState<Route>({ name: "home" });
  // Bumped on every navigation, so going to a screen again (e.g. "Exámenes"
  // from inside an exam) shows it from the start.
  const [visit, setVisit] = useState(0);
  const go = (r: Route) => {
    setVisit((v) => v + 1);
    setRoute(r);
  };
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [palette, setPalette] = useState(false);
  // The wallpaper only shows in full on the home screen; elsewhere it is a soft wash.
  useEffect(() => {
    document.documentElement.dataset.view = route.name === "home" ? "home" : "work";
  }, [route.name]);

  const refresh = useCallback(() => {
    api
      .listSessions()
      .then(setSessions)
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  // A pomodoro finished in a session is logged under it.
  const current = route.name === "session" ? sessions.find((s) => s.id === route.id) : undefined;
  useStudyContext(current ? { kind: "session", id: current.id, title: current.title } : null);

  const home = () => setRoute({ name: "home" });
  const open = (id: string) => setRoute({ name: "session", id });
  const graph = () => setRoute({ name: "graph" });
  const library = () => setRoute({ name: "library" });
  const practice = (id: string | null = null) => go({ name: "practice", id });
  const exams = (id: string | null = null, prefill?: RoutePrefill) => go({ name: "exams", id, prefill });
  const cards = (id: string | null = null) => go({ name: "cards", id });
  const code = (seed: CodeSeed | null = null) => go({ name: "code", seed });
  const language = () => go({ name: "language" });
  const companion = () => go({ name: "companion" });
  const academic = () => go({ name: "academic" });
  const classes = () => go({ name: "classes" });
  const progress = () => go({ name: "progress" });
  // "Estudiar esta materia": a chat, so the assistant decides how to start.
  const study = async (message: string) => {
    try {
      const s = await api.startChat(message);
      refresh();
      open(s.id);
    } catch {
      home();
    }
  };
  const openScreen = (s: ActionScreen) => {
    const to: Record<ActionScreen, () => void> = {
      library,
      practice: () => practice(),
      exams: () => exams(),
      cards: () => cards(),
      agenda: () => agenda(),
      code: () => code(),
      language,
      graph,
      companion,
      academic,
      classes,
      progress,
      settings: () => settings(),
    };
    to[s]();
  };
  const agenda = () => setRoute({ name: "agenda" });
  const settings = (tab?: SettingsTab) =>
    setRoute((r) => ({
      name: "settings",
      back: r.name === "settings" ? r.back : r,
      tab,
    }));

  // AC-154: a `.eureka` opened with a double click (at launch, or handed over
  // by a second launch) goes to Tarjetas as a preview; nothing is imported blind.
  const [incoming, setIncoming] = useState<PendingImport | null>(null);
  // The file is handed over once, so its answer is used even if this effect
  // was already cleaned up (StrictMode runs it twice in development).
  useEffect(() => {
    const take = () =>
      cardsApi
        .openedDeck()
        .then((d) => {
          if (!d) return;
          setIncoming({ name: d.name, cards: d.cards, leftOut: leftOutText({ skipped: d.skipped }), origin: "shared" });
          cards();
        })
        .catch(() => {});
    take();
    const off = listen("deck-opened", take).catch(() => null);
    return () => {
      off.then((f) => f?.());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      { id: "new", label: "Nueva sesión", group: "Acciones", run: home },
      {
        id: "settings",
        label: "Abrir ajustes",
        group: "Acciones",
        run: () => settings(),
      },
      {
        id: "graph",
        label: "Abrir grafo de conocimiento",
        group: "Acciones",
        run: graph,
      },
      {
        id: "library",
        label: "Abrir la biblioteca (PDFs y apuntes)",
        group: "Acciones",
        run: library,
      },
      {
        id: "practice",
        label: "Practicar",
        group: "Acciones",
        run: () => practice(),
      },
      {
        id: "exams",
        label: "Preparar un examen o certificación",
        group: "Acciones",
        run: () => exams(),
      },
      {
        id: "cards",
        label: "Estudiar tarjetas",
        group: "Acciones",
        run: () => cards(),
      },
      {
        id: "agenda",
        label: "Abrir agenda (clases y fechas)",
        group: "Acciones",
        run: agenda,
      },
      {
        id: "code",
        label: "Abrir la consola de código",
        group: "Acciones",
        run: () => code(),
      },
      {
        id: "language",
        label: "Practicar idiomas (listening y speaking)",
        group: "Acciones",
        run: language,
      },
      {
        id: "academic",
        label: "Abrir Mi cursada (horario, materias y fechas)",
        group: "Acciones",
        run: academic,
      },
      {
        id: "classes",
        label: "Grabar una clase",
        group: "Acciones",
        run: classes,
      },
      {
        id: "progress",
        label: "Abrir Mi progreso (lo que Eureka sabe de vos)",
        group: "Acciones",
        run: progress,
      },
      {
        id: "companion",
        label: "Abrir Acompañamiento (hablar, diario, respirar)",
        group: "Acciones",
        run: companion,
      },
      {
        id: "t-dark",
        label: "Tema: oscuro",
        group: "Apariencia",
        run: () => setTheme("dark"),
      },
      {
        id: "t-light",
        label: "Tema: claro",
        group: "Apariencia",
        run: () => setTheme("light"),
      },
      {
        id: "t-system",
        label: "Tema: según el sistema",
        group: "Apariencia",
        run: () => setTheme("system"),
      },
      {
        id: "workspace",
        label: "Mi espacio: fondo, color de acento y nombre",
        group: "Apariencia",
        run: () => settings("workspace"),
      },
      {
        id: "a11y",
        label: "Accesibilidad: leer en voz alta, dictar, texto grande, lectura fácil",
        group: "Apariencia",
        run: () => settings("accessibility"),
      },
      ...sessions.map((s) => ({
        id: `s-${s.id}`,
        label: s.title,
        group: "Sesiones",
        run: () => open(s.id),
      })),
    ],
    [sessions],
  );

  return (
    <>
      <div className="wallpaper" aria-hidden />
      <div className="shell">
        <Sidebar
          sessions={sessions}
          activeId={route.name === "session" ? route.id : null}
          view={route.name}
          onHome={home}
          onOpen={open}
          onSettings={() => settings()}
          onGraph={graph}
          onLibrary={library}
          onPractice={() => practice()}
          onExams={() => exams()}
          onCards={() => cards()}
          onAgenda={agenda}
          onCode={() => code()}
          onLanguage={language}
          onCompanion={companion}
          onAcademic={academic}
          onClasses={classes}
          onProgress={progress}
          onCommand={() => setPalette(true)}
          theme={theme}
          onTheme={setTheme}
          name={name}
          onWorkspace={() => settings("workspace")}
          footer={<PomodoroWidget />}
        />
        <main className="main">
          {route.name === "home" && (
            <Home
              name={name}
              onGo={(to) => (to === "exams" ? exams() : to === "cards" ? cards() : to === "practice" ? practice() : library())}
              sessions={sessions}
              onChanged={refresh}
              onOpen={open}
              onOpenSettings={() => settings()}
              onOpenExam={(id) => exams(id)}
              onOpenDeck={(id) => cards(id)}
              onOpenAgenda={agenda}
              onOpenScreen={openScreen}
            />
          )}
          {route.name === "session" && (
            <SessionView
              key={route.id}
              id={route.id}
              onBack={home}
              onOpenSettings={() => settings()}
              onChanged={refresh}
              onOpenGraph={graph}
              onOpenCode={code}
              onOpenScreen={openScreen}
              onOpenExam={(id) => exams(id)}
              onOpenDeck={(id) => cards(id)}
              onOpenPractice={(id) => practice(id)}
              onUiCommand={ui.run}
              uiSnapshot={ui.snapshot}
            />
          )}
          {route.name === "graph" && <GraphScreen onOpenSession={open} onPractice={(id) => practice(id)} />}
          {route.name === "library" && (
            <LibraryScreen
              onOpenSession={(id) => {
                refresh();
                open(id);
              }}
            />
          )}
          {route.name === "practice" && <PracticeScreen key={visit} initialId={route.id} onOpenGraph={graph} />}
          {route.name === "exams" && <ExamScreen key={visit} initialId={route.id} prefill={route.prefill ?? null} onOpenSession={open} onChanged={refresh} onOpenDeck={(id) => cards(id)} onOpenCode={code} />}
          {route.name === "cards" && <CardsScreen key={visit} initialId={route.id} incoming={incoming} onIncomingDone={() => setIncoming(null)} />}
          {route.name === "agenda" && <AgendaScreen onOpenExam={(id) => exams(id)} onOpenAcademic={academic} />}
          {route.name === "code" && <CodeScreen key={visit} seed={route.seed} />}
          {route.name === "language" && <LanguageScreen key={visit} />}
          {route.name === "companion" && <CompanionScreen key={visit} />}
          {route.name === "academic" && <AcademicScreen key={visit} onOpenChat={home} onStudy={study} onOpenExam={(id) => exams(id)} onNewRoute={(p) => exams(null, p)} />}
          {route.name === "classes" && <ClassesScreen key={visit} onOpenSettings={() => settings("models")} onOpenDeck={(id) => cards(id)} onStudy={study} />}
          {route.name === "progress" && <ProgressScreen key={visit} onOpenScreen={openScreen} onOpenSession={open} onStudy={study} />}
          {route.name === "settings" && <Settings key={route.tab ?? "connection"} initialTab={route.tab} onBack={() => setRoute(route.back)} />}
        </main>
        <Reminders />
        <UpdateNotice />
        <QuoteSplash />
        {identity && !identity.onboarded && <Onboarding />}
        {palette && <CommandMenu commands={commands} onClose={() => setPalette(false)} />}
      </div>
    </>
  );
}
