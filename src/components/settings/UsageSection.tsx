import { useEffect, useState } from "react";
import { errorText, usageApi } from "../../api";
import type { UsageGroup, UsageSummary, UsageTotals } from "../../types";

const num = (n: number) => n.toLocaleString("es-AR");

/** Share of the input the provider served from its cache, or a dash when it never said. */
export function cachedShare(t: UsageTotals): string {
  if (t.cached === null || t.input === 0) return "—";
  return `${Math.round((t.cached / t.input) * 100)} %`;
}

/** Only what a provider reported: never an estimate. */
export function costText(t: UsageTotals): string {
  if (t.cost === null) return "—";
  return `US$ ${t.cost.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: t.cost < 1 ? 4 : 2 })}`;
}

function Row({ label, t }: { label: string; t: UsageTotals }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{num(t.calls)}</td>
      <td>{num(t.input)}</td>
      <td>{cachedShare(t)}</td>
      <td>{num(t.output)}</td>
      <td>{costText(t)}</td>
    </tr>
  );
}

function Table({ caption, first, rows }: { caption: string; first: string; rows: { key: string; label: string; t: UsageTotals }[] }) {
  return (
    <table className="summary-table" aria-label={caption}>
      <thead>
        <tr>
          <th>{first}</th>
          <th>Llamadas</th>
          <th>Entrada</th>
          <th>En caché</th>
          <th>Salida</th>
          <th>Costo</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row key={r.key} label={r.label} t={r.t} />
        ))}
      </tbody>
    </table>
  );
}

const rows = (groups: UsageGroup[]) => groups.map((g) => ({ key: g.key, label: g.label, t: g.totals }));

/** AC-186: tokens per model call, as the provider reported them. Read on this PC, sent nowhere. */
export function UsageSection() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usageApi.summary().then(setUsage).catch((e) => setError(errorText(e)));
  }, []);

  const unknown = usage ? usage.week.calls - usage.week.known : 0;
  return (
    <section className="card" aria-label="Uso">
      <h2>Uso</h2>
      <p className="muted small">
        Cuántos tokens gastó cada llamada al modelo, según lo que informa tu proveedor. Se guarda solo en esta PC (los últimos {usage?.keep_days ?? 90} días), no entra en el respaldo y no se manda a ningún lado.
      </p>
      {error && <p className="muted small">No pude leer el uso: {error}</p>}
      {usage && usage.week.calls === 0 && usage.sessions.length === 0 && <p className="muted small">Todavía no hay llamadas registradas.</p>}
      {usage && (usage.week.calls > 0 || usage.sessions.length > 0) && (
        <>
          <Table
            caption="Totales"
            first="Período"
            rows={[
              { key: "today", label: "Hoy", t: usage.today },
              { key: "week", label: "Últimos 7 días", t: usage.week },
            ]}
          />
          {unknown > 0 && (
            <p className="muted small" data-testid="usage-unknown">
              {unknown === 1 ? "1 llamada" : `${num(unknown)} llamadas`} de los últimos 7 días sin datos del proveedor (no cuentan en los tokens).
            </p>
          )}
          {usage.by_role.length > 0 && (
            <>
              <h3>Por tarea (últimos 7 días)</h3>
              <Table caption="Por tarea" first="Tarea" rows={rows(usage.by_role)} />
            </>
          )}
          {usage.sessions.length > 0 && (
            <>
              <h3>Por sesión</h3>
              <Table caption="Por sesión" first="Sesión" rows={rows(usage.sessions)} />
            </>
          )}
          <p className="muted small">«En caché» es la parte de la entrada que el proveedor ya tenía guardada (suele cobrarse más barata). El costo aparece solo si el proveedor lo informa.</p>
        </>
      )}
    </section>
  );
}
