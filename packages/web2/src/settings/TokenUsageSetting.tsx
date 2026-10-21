/**
   AGENT USAGE / Settings > General
   packages/web2/src/settings/TokenUsageSetting.tsx

   The total the agents reported and a contribution-style year of it: one cell
   per local day, darker where more tokens were spent. Counts only; the server
   never sends prompts or paths, and a turn with no report stays blank rather
   than becoming a zero (an estimate would make the map a mood).
   ------------------------------------------------ */

import { useEffect, useRef, useState } from 'react';
import type { GetTokenUsageResponse } from '@sequence/api-types';

import { createTokenUsageClient, type TokenUsageClient } from './tokenUsageClient';
import { buildTokenMap, compactTokens, dayLabel, describeUsage, exactTokens } from './tokenUsageModel';

const LEVELS = [0, 1, 2, 3, 4] as const;

export function TokenUsageSetting({ client }: { client?: TokenUsageClient }) {
  const api = useRef<TokenUsageClient | null>(null);
  if (api.current === null) api.current = client ?? createTokenUsageClient();
  const [report, setReport] = useState<GetTokenUsageResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.current
      ?.tokens()
      .then((answer) => {
        if (!live) return;
        if (answer) setReport(answer);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const map = report ? buildTokenMap(report.days) : null;
  const busiest = report?.days.length
    ? report.days.reduce((best, day) => (day.total > best.total ? day : best), report.days[0])
    : null;

  return (
    <section className="sb-group" data-testid="token-usage">
      <h3 className="sb-lab">Agent usage</h3>
      <div className="sb-card">
        {failed ? (
          <p className="sb-hint" data-testid="token-usage-failed">
            Could not read usage from the local server. The map returns on the next open.
          </p>
        ) : report === null ? (
          <p className="sb-hint" data-testid="token-usage-loading">
            Reading usage…
          </p>
        ) : report.total <= 0 ? (
          <>
            <div className="sb-tmap-total" data-testid="token-total">
              <span className="sb-tmap-num">0</span>
              <span className="sb-tmap-unit">tokens</span>
            </div>
            <p className="sb-hint" data-testid="token-usage-empty">
              No tokens reported yet. Run an agent in this project and the usage it reports appears here.
            </p>
          </>
        ) : (
          <>
            <div className="sb-tmap-head">
              <div className="sb-tmap-total" data-testid="token-total">
                <span className="sb-tmap-num">{compactTokens(report.total)}</span>
                <span className="sb-tmap-unit">tokens</span>
              </div>
              <div className="sb-tmap-stats">
                <span className="sb-tmap-stat">
                  <span className="sb-tmap-stat-t">Last 12 months</span>
                  <span className="sb-tmap-stat-v" data-testid="token-window-total">
                    {compactTokens(map?.windowTotal ?? 0)}
                  </span>
                </span>
                <span className="sb-tmap-stat">
                  <span className="sb-tmap-stat-t">Busiest day</span>
                  <span className="sb-tmap-stat-v" data-testid="token-busiest">
                    {busiest ? compactTokens(busiest.total) : '0'}
                  </span>
                  <span className="sb-tmap-stat-s">{busiest ? dayLabel(busiest.date) : ''}</span>
                </span>
                <span className="sb-tmap-stat">
                  <span className="sb-tmap-stat-t">Input / output</span>
                  <span className="sb-tmap-stat-v" data-testid="token-in-out">
                    {compactTokens(report.input)} / {compactTokens(report.output)}
                  </span>
                </span>
              </div>
            </div>
            <div className="sb-tmap" data-testid="token-map">
              <div className="sb-tmap-months" aria-hidden="true">
                {map?.weeks.map((week, w) => (
                  <span className="sb-tmap-month" key={w}>
                    {week.month ?? ''}
                  </span>
                ))}
              </div>
              <div
                className="sb-tmap-grid"
                role="img"
                aria-label={`${exactTokens(report.total)} tokens reported by agents; ${map?.activeDays ?? 0} active days in the last year.`}
              >
                {map?.weeks.map((week) =>
                  week.cells.map((cell) => (
                    <span
                      className="sb-tmap-cell"
                      data-level={cell.level}
                      data-future={cell.future ? '1' : undefined}
                      data-testid="token-day"
                      key={cell.date}
                      title={cell.label || undefined}
                    />
                  )),
                )}
              </div>
              <div className="sb-tmap-foot">
                <span className="sb-hint" data-testid="token-usage-note">
                  {describeUsage(report, map!)}
                </span>
                <span className="sb-tmap-legend" aria-hidden="true">
                  <span className="sb-tmap-legend-t">Less</span>
                  {LEVELS.map((level) => (
                    <span className="sb-tmap-cell" data-level={level} key={level} />
                  ))}
                  <span className="sb-tmap-legend-t">More</span>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default TokenUsageSetting;
