import { useState } from 'react';
import { HARNESS_BRANDS, OPEN_HARNESS_BRANDS } from '@/components/HarnessLogos';
import { OPEN_ROWS, ROWS, type Cell, type Row } from '@/components/sections/Difference';
import { Reveal } from '@/components/lt/hooks';

/**
 * THE DIFFERENCE CHECKLIST (Difference.tsx), drawn light. Rows and cells are
 * imported, not retyped: have / some / none from each product's own
 * documentation, no scores. The open-harness tab keeps their home-field rows
 * on top, where Sequence loses.
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
    note: 'Sequence is open source under MIT, like these three. T3 Code leads on remote and mobile chrome. Cells from each product’s own documentation, no scores.',
  },
} as const;

function CellView({ value, seq }: { value: Cell; seq: boolean }) {
  if (value === true) {
    return (
      <span aria-label="Yes" className={`lt-yes ${seq ? 'is-seq' : ''}`}>
        ✓
      </span>
    );
  }
  if (value === 'partial') {
    return (
      <span aria-label="Partial" className="lt-some">
        some
      </span>
    );
  }
  return (
    <span aria-label="No" className="lt-no">
      —
    </span>
  );
}

export function Compare() {
  const [which, setWhich] = useState<keyof typeof SETS>('closed');
  const set = SETS[which];
  const rows: readonly Row[] = set.rows;
  const cols = { gridTemplateColumns: `repeat(${set.brands.length}, minmax(0, 1fr))` };

  return (
    <section id="compare" className="lt-section" aria-labelledby="compare-title">
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[44rem] text-center">
          <p className="lt-kicker">Compare</p>
          <h2 id="compare-title" className="lt-h2">
            The same checklist for every tool.
          </h2>
        </Reveal>
        <div className="mt-8 flex justify-center">
          <div className="lt-tabs" role="tablist" aria-label="Which tools" style={{ ['--tab' as string]: which === 'closed' ? 0 : 1 }}>
            <span className="lt-tabs-pill" aria-hidden="true" />
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

        <div key={which} className="lt-panel lt-swap mt-8 overflow-hidden" id="compare-table" role="tabpanel">
          {/* Phones: one block per row, every tool visible without sideways scrolling. */}
          <div className="grid gap-1.5 border-b border-[color:var(--lt-line)] px-4 py-3 sm:hidden" style={cols} aria-hidden="true">
            {set.brands.map((b) => (
              <span key={b.id} className="text-center text-[10.5px] leading-tight text-[color:var(--lt-muted)]">
                {b.name}
              </span>
            ))}
          </div>
          <ul className="m-0 list-none p-0 sm:hidden">
            {rows.map((r) => (
              <li key={r.label} className="border-b border-[color:var(--lt-line)] px-4 py-4 last:border-b-0">
                <p className="text-[14px] font-medium">{r.label}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-[color:var(--lt-muted)]">{r.hint}</p>
                <div className="mt-3 grid gap-1.5" style={cols}>
                  {r.values.map((v, i) => {
                    const b = set.brands[i]!;
                    const Mark = b.Mark;
                    const seq = b.id === 'sequence';
                    return (
                      <div key={b.id} className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2 ${seq ? 'lt-seq-cell' : ''}`}>
                        <span className="lt-plate !h-6 !w-6 !rounded-[6px]">
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
            <table className="lt-table">
              <thead>
                <tr>
                  <th scope="col" className="px-5 py-4 text-[12px] font-medium text-[color:var(--lt-muted)] sm:px-7">
                    Behaviour
                  </th>
                  {set.brands.map((b) => {
                    const Mark = b.Mark;
                    const seq = b.id === 'sequence';
                    return (
                      <th key={b.id} scope="col" className={`w-[92px] px-2 py-4 text-center ${seq ? 'is-seq' : ''}`}>
                        <span className="inline-flex flex-col items-center gap-2">
                          <span className="lt-plate">
                            <Mark className="h-[18px] w-[18px]" />
                          </span>
                          <span className={`text-[11.5px] font-medium ${seq ? '' : 'text-[color:var(--lt-muted)]'}`}>{b.name}</span>
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
                      <p className="text-[14px] font-medium">{r.label}</p>
                      <p className="mt-1 max-w-[34rem] text-[12.5px] leading-snug text-[color:var(--lt-muted)]">{r.hint}</p>
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
        <p className="lt-note mx-auto mt-5 max-w-[52rem] text-center">{set.note}</p>
      </div>
    </section>
  );
}
