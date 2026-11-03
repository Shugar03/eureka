import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcademicScreen } from "./AcademicScreen";
import { academicApi } from "../../api";
import { install } from "../../e2e/mockBackend";

beforeAll(() => install());
beforeEach(async () => {
  // The demo backend keeps Mi cursada between tests, like the real one between runs.
  const d = await academicApi.state();
  for (const t of d.terms) await academicApi.deleteTerm(t.id);
});

const open = (props: Partial<Parameters<typeof AcademicScreen>[0]> = {}) => render(<AcademicScreen onOpenChat={() => {}} onStudy={() => {}} {...props} />);

async function createTerm(name = "2.º cuatrimestre 2026") {
  await userEvent.click(await screen.findByRole("button", { name: "Cargarlo a mano" }));
  const form = screen.getByRole("form", { name: "Nuevo período" });
  const input = within(form).getByRole("textbox", { name: "Nombre del período" });
  await userEvent.clear(input);
  await userEvent.type(input, name);
  await userEvent.click(within(form).getByRole("button", { name: "Guardar período" }));
  await screen.findByRole("combobox", { name: "Período" });
}

const timeInput = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

async function addCourse() {
  await userEvent.click(screen.getByRole("button", { name: "Agregar materia" }));
  const form = screen.getByRole("form", { name: "Agregar materia" });
  await userEvent.type(within(form).getByRole("textbox", { name: "Nombre de la materia" }), "Análisis I");
  await userEvent.type(within(form).getByRole("textbox", { name: "Profesor o profesora" }), "Pérez");
  await userEvent.type(within(form).getByRole("textbox", { name: "Aula habitual" }), "Aula 3");
  await userEvent.click(within(form).getByRole("button", { name: "+ Agregar horario" }));
  await userEvent.selectOptions(within(form).getByLabelText("Día 1"), "Lunes");
  fireEvent.change(timeInput("Desde 1"), { target: { value: "10:00" } });
  fireEvent.change(timeInput("Hasta 1"), { target: { value: "12:00" } });
  await userEvent.click(within(form).getByRole("button", { name: "+ Agregar horario" }));
  await userEvent.selectOptions(within(form).getByLabelText("Día 2"), "Miércoles");
  fireEvent.change(timeInput("Desde 2"), { target: { value: "10:00" } });
  fireEvent.change(timeInput("Hasta 2"), { target: { value: "12:00" } });
  await userEvent.click(within(form).getByRole("button", { name: "Guardar materia" }));
}

describe("Mi cursada: armarla a mano (AC-99, AC-100)", () => {
  it("starts empty with the three ways in, and asks for a term first", async () => {
    open();
    const empty = await screen.findByRole("region", { name: "Armá tu cursada" });
    expect(within(empty).getByText(/Pegá tu horario/)).toBeInTheDocument();
    expect(within(empty).getByText(/Contáselo al asistente/)).toBeInTheDocument();
    // Adding a course with no term asks for the term first.
    await userEvent.click(screen.getByRole("button", { name: "Agregar materia" }));
    expect(screen.getByRole("form", { name: "Nuevo período" })).toBeInTheDocument();
    // The name is suggested from today's date.
    expect((screen.getByRole("textbox", { name: "Nombre del período" }) as HTMLInputElement).value).toMatch(/cuatrimestre \d{4}|Verano \d{4}/);
  });

  it("builds a term, a course with two classes, and shows them in the week grid", async () => {
    open();
    await createTerm();
    await addCourse();
    const grid = await screen.findByRole("group", { name: "Horario semanal" });
    expect(within(grid).getByRole("button", { name: "Análisis I, Lunes de 10:00 a 12:00, Aula 3" })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "Análisis I, Miércoles de 10:00 a 12:00, Aula 3" })).toBeInTheDocument();
    expect(within(grid).queryByRole("group", { name: "Sábado" })).toBeNull();
    const courses = screen.getByRole("region", { name: "Materias" });
    expect(within(courses).getByText("Prof. Pérez")).toBeInTheDocument();
    expect(within(courses).getByText("lun 10:00–12:00 · Aula 3")).toBeInTheDocument();
    expect(screen.getByText(/4 h de clase por semana/)).toBeInTheDocument();
  });

  it("refuses a class that ends before it starts, next to the field, and keeps the form", async () => {
    open();
    await createTerm();
    await userEvent.click(screen.getByRole("button", { name: "Agregar materia" }));
    const form = screen.getByRole("form", { name: "Agregar materia" });
    await userEvent.type(within(form).getByRole("textbox", { name: "Nombre de la materia" }), "Física");
    await userEvent.click(within(form).getByRole("button", { name: "+ Agregar horario" }));
    fireEvent.change(timeInput("Desde 1"), { target: { value: "12:00" } });
    fireEvent.change(timeInput("Hasta 1"), { target: { value: "10:00" } });
    await userEvent.click(within(form).getByRole("button", { name: "Guardar materia" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("El horario 1 tiene que terminar después de empezar");
    expect((await academicApi.state()).courses).toHaveLength(0);
    fireEvent.change(timeInput("Hasta 1"), { target: { value: "14:00" } });
    await userEvent.click(within(form).getByRole("button", { name: "Guardar materia" }));
    expect(await screen.findByRole("group", { name: "Horario semanal" })).toBeInTheDocument();
  });

  it("keeps the dates that matter: pending by day, marked done, and deleted with confirmation", async () => {
    open();
    await createTerm();
    await addCourse();
    await userEvent.click(screen.getByRole("button", { name: "Agregar fecha" }));
    const form = screen.getByRole("form", { name: "Agregar fecha" });
    await userEvent.type(within(form).getByRole("textbox", { name: "Título de la fecha" }), "Primer parcial");
    await userEvent.selectOptions(within(form).getByLabelText("Materia de la fecha"), "Análisis I");
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const ymd = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    fireEvent.change(within(form).getByLabelText("Fecha"), { target: { value: ymd } });
    await userEvent.click(within(form).getByRole("button", { name: "Guardar fecha" }));

    const list = await screen.findByRole("region", { name: "Fechas importantes" });
    const row = within(list).getByTestId("date-item");
    expect(row).toHaveTextContent("Primer parcial");
    expect(row).toHaveTextContent("Análisis I");
    expect(row).toHaveTextContent("En 3 días");
    // The course card says what is next.
    expect(within(screen.getByRole("region", { name: "Materias" })).getByText(/Próxima:/)).toHaveTextContent("Parcial");

    await userEvent.click(within(list).getByRole("checkbox", { name: "Marcar como hecho: Primer parcial" }));
    expect(await within(list).findByText("Hechas (1)")).toBeInTheDocument();
    expect(within(list).queryByText("En 3 días")).toBeNull();

    await userEvent.click(within(list).getByText("Hechas (1)"));
    await userEvent.click(within(list).getByRole("button", { name: "Borrar Primer parcial" }));
    await userEvent.click(within(list).getByRole("button", { name: "Confirmar borrar Primer parcial" }));
    expect(await within(list).findByText(/Sin fechas todavía/)).toBeInTheDocument();
  });

  it("switches term, and deleting a term needs a second tap", async () => {
    open();
    await createTerm("1.º cuatrimestre 2026");
    await userEvent.click(screen.getByRole("button", { name: "Nuevo período" }));
    const input = screen.getByRole("textbox", { name: "Nombre del período" });
    await userEvent.clear(input);
    await userEvent.type(input, "2.º cuatrimestre 2026");
    await userEvent.click(screen.getByRole("button", { name: "Guardar período" }));
    const select = await screen.findByRole("combobox", { name: "Período" });
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    expect((select as HTMLSelectElement).selectedOptions[0].textContent).toBe("2.º cuatrimestre 2026");
    await userEvent.selectOptions(select, "1.º cuatrimestre 2026");
    await userEvent.click(screen.getByRole("button", { name: "Borrar período" }));
    expect(screen.getByRole("button", { name: "¿Seguro? Borrar período" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "¿Seguro? Borrar período" }));
    expect(await screen.findAllByRole("option")).toHaveLength(1);
  });

  it("'Estudiar esta materia' hands the course to the assistant", async () => {
    const onStudy = vi.fn();
    open({ onStudy });
    await createTerm();
    await addCourse();
    await userEvent.click(await screen.findByRole("button", { name: "Estudiar Análisis I" }));
    expect(onStudy).toHaveBeenCalledWith("Quiero estudiar Análisis I");
  });
});

describe("Mi cursada: pegar el horario (AC-101)", () => {
  it("reads it, shows what it understood, and saves only on request; again, nothing is duplicated", async () => {
    open();
    await userEvent.click((await screen.findAllByRole("button", { name: "Pegar mi horario" }))[0]);
    const panel = screen.getByRole("region", { name: "Pegar mi horario" });
    expect(within(panel).getByText(/se envía al modelo de IA/)).toBeInTheDocument();
    await userEvent.type(within(panel).getByRole("textbox", { name: "Horario o fechas para leer" }), "Lunes 10:00 a 12:00 Análisis I");
    await userEvent.click(within(panel).getByRole("button", { name: "Leer mi horario" }));

    const preview = await screen.findByRole("region", { name: "Propuesta para Mi cursada" });
    expect(within(preview).getByText("2 materias y 2 fechas")).toBeInTheDocument();
    expect(within(preview).getByText("Análisis I")).toBeInTheDocument();
    expect(within(preview).getByText("Primer parcial")).toBeInTheDocument();
    expect((await academicApi.state()).terms).toHaveLength(0);

    await userEvent.click(within(preview).getByRole("button", { name: "Guardar en Mi cursada" }));
    expect(await within(preview).findByRole("status")).toHaveTextContent("Guardado en «2.º cuatrimestre 2026»: 2 materias nuevas, 2 fechas nuevas");
    const saved = await academicApi.state();
    expect([saved.terms.length, saved.courses.length, saved.dates.length]).toEqual([1, 2, 2]);

    // Importing the same thing again updates, never duplicates.
    await userEvent.click(within(preview).getByRole("button", { name: "Abrir Mi cursada" }));
    await userEvent.click(await screen.findByRole("button", { name: "Pegar mi horario" }));
    const again = screen.getByRole("region", { name: "Pegar mi horario" });
    await userEvent.type(within(again).getByRole("textbox", { name: "Horario o fechas para leer" }), "Lunes 10:00 a 12:00 Análisis I");
    await userEvent.click(within(again).getByRole("button", { name: "Leer mi horario" }));
    const p2 = await screen.findByRole("region", { name: "Propuesta para Mi cursada" });
    await userEvent.click(within(p2).getByRole("button", { name: "Guardar en Mi cursada" }));
    expect(await within(p2).findByRole("status")).toHaveTextContent("2 materias actualizadas, 2 fechas que ya estaban");
    expect((await academicApi.state()).courses).toHaveLength(2);
  });

  it("says plainly when there is nothing to read", async () => {
    open();
    await userEvent.click((await screen.findAllByRole("button", { name: "Pegar mi horario" }))[0]);
    await userEvent.type(screen.getByRole("textbox", { name: "Horario o fechas para leer" }), "hola cómo estás");
    await userEvent.click(screen.getByRole("button", { name: "Leer mi horario" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No encontré horarios ni fechas");
    expect(screen.getByRole("button", { name: "Leer mi horario" })).toBeEnabled();
  });
});
