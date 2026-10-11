import { useState } from 'react';
import { HARNESS_BRANDS, OPEN_HARNESS_BRANDS } from '@/components/HarnessLogos';
import { OPEN_ROWS, ROWS, type Cell, type Row } from '@/components/sections/Difference';

/**
 * THE SAME CHECKLIST THE PAGE ALREADY CARRIED (Difference.tsx), drawn dark.
 * Rows and cells are imported, not retyped: have / some / none from each
 * product's own documentation, no scores. The open-harness tab keeps their
 * home-field rows on top, where Sequence loses.
 */
const SETS = {
  closed: {
    label: 'Editors and agents',
    brands: HARNESS_BRANDS,
    rows: ROWS,
    note: 'Cursor, Claude Code, Codex and Windsurf. Cells are have, some or none, read from each product’s own documentation. Windsurf Codemaps is the closest graph. Logos via Simple Icons.',
  },
  open: {
    label: 'Open harnesses',
    brands: OPEN_HARNESS_BRANDS,
    rows: OPEN_ROWS,
    note: 'Pi, OpenCode and T3 Code lead the first three rows, and Sequence’s cells there say so. Cells from each product’s own documentation, no scores.',
  },
} as const;

function CellView({ value, seq }: { value: Cell; seq: boolean }) {
  if (value === true) {
    return (
      <span
        aria-label="Yes"
        className={`inline-grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold ${
          seq ? 'bg-[color:rgb(var(--accent-dark-rgb))] text-white' : 'bg-white/14 text-[color:var(--on-dark)]'
        }`}
      >
        ✓
      </span>
    );
  }
  if (value === 'partial') {
    return (
      <span aria-label="Partial" className="inline-flex h-6 items-center rounded-full bg-white/8 px-2 text-[11px] text-[color:var(--on-dark-muted)]">
        some
      </span>
    );
  }
  return (
    <span aria-label="No" className="text-[14px] text-white/25">
      —
    </span>
  );
}

export function Compare() {
  const [which, setWhich] = useState<keyof typeof SETS>('closed');
  const set = SETS[which];
  const rows: readonly Row[] = set.rows;

  return (
    <section id="compare" className="cx-section cx-rule" aria-labelledby="compare-title">
      <div className="cx-wrap-wide">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[40rem]">
            <p className="cx-kicker">Compare</p>
            <h2 id="compare-title" className="cx-h2">
              The same checklist for every tool.
            </h2>
          </div>
          <div className="cx-tabs self-start md:self-auto" role="tablist" aria-label="Which tools">
            {(Object.keys(SETS) as (keyof typeof SETS)[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={which === key}
                aria-controls="compare-table"
                onClick={() => setWhich(key)}
              >
                {SETS[key].label}
              </button>
            ))}
          </div>
        </div>

        <div className="cx-panel mt-10 overflow-hidden" id="compare-table" role="tabpanel">
          {/* Phones: one block per row, every tool visible without sideways scrolling. */}
          <div
            className="grid gap-1.5 border-b border-[color:var(--hairline-dark)] px-4 py-3 sm:hidden"
            style={{ gridTemplateColumns: `repeat(${set.brands.length}, minmax(0, 1fr))` }}
            aria-hidden="true"
          >
            {set.brands.map((b) => (
              <span key={b.id} className="text-center text-[10.5px] leading-tight text-[color:var(--on-dark-muted)]">
                {b.name}
              </span>
            ))}
          </div>
          <ul className="m-0 list-none p-0 sm:hidden">
            {rows.map((r) => (
              <li key={r.label} className="border-b border-[color:var(--hairline-dark)] px-4 py-4 last:border-b-0">
                <p className="text-[14px] font-medium">{r.label}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-[color:var(--on-dark-muted)]">{r.hint}</p>
                <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${set.brands.length}, minmax(0, 1fr))` }}>
                  {r.values.map((v, i) => {
                    const b = set.brands[i]!;
                    const Mark = b.Mark;
                    const seq = b.id === 'sequence';
                    return (
                      <div
                        key={b.id}
                        className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2 ${seq ? 'is-seq bg-[rgba(var(--accent-dark-rgb),0.12)]' : ''}`}
                      >
                        <span className="cx-plate !h-6 !w-6 !rounded-[6px]">
                          <Mark className="h-3.5 w-3.5" />
                        </span>
                        <CellView value={v} seq={seq} />
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="cx-table">
              <thead>
                <tr>
                  <th scope="col" className="px-5 py-4 text-[12px] font-medium text-[color:var(--on-dark-muted)] sm:px-7">
                    Behaviour
                  </th>
                  {set.brands.map((b) => {
                    const Mark = b.Mark;
                    const seq = b.id === 'sequence';
                    return (
                      <th key={b.id} scope="col" className={`w-[92px] px-2 py-4 text-center ${seq ? 'is-seq' : ''}`}>
                        <span className="inline-flex flex-col items-center gap-2">
                          <span className="cx-plate">
                            <Mark className="h-[18px] w-[18px]" />
                          </span>
                          <span className={`text-[11.5px] font-medium ${seq ? 'text-[color:var(--on-dark)]' : 'text-[color:var(--on-dark-muted)]'}`}>
                            {b.name}
                          </span>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" className="px-5 py-4 align-middle font-normal sm:px-7">
                      <p className="text-[14px] font-medium text-[color:var(--on-dark)]">{r.label}</p>
                      <p className="mt-1 max-w-[34rem] text-[12.5px] leading-snug text-[color:var(--on-dark-muted)]">{r.hint}</p>
                    </th>
                    {r.values.map((v, i) => {
                      const seq = set.brands[i]!.id === 'sequence';
                      return (
                        <td key={set.brands[i]!.id} className={`px-2 py-4 text-center align-middle ${seq ? 'is-seq' : ''}`}>
                          <CellView value={v} seq={seq} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="cx-note mt-5 max-w-[52rem]">{set.note}</p>
      </div>
    </section>
  );
}
