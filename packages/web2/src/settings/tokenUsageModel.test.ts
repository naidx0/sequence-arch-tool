import { describe, expect, it } from 'vitest';
import type { GetTokenUsageResponse, TokenUsageDay } from '@sequence/api-types';

import { MAP_WEEKS, buildTokenMap, compactTokens, dayLabel, describeUsage, exactTokens } from './tokenUsageModel';

function day(date: string, total: number): TokenUsageDay {
  return { date, total, input: total, output: 0, turns: 1 };
}

const TODAY = new Date(2026, 9, 20);

/* The map is a year ending with the current week, Sunday first: the gate is the
   window's shape and where a day's intensity comes from, not the pixels. */
describe('the token map', () => {
  it('is fifty-three week columns of seven days ending with the current week', () => {
    const map = buildTokenMap([], TODAY);
    expect(map.weeks).toHaveLength(MAP_WEEKS);
    for (const week of map.weeks) expect(week.cells).toHaveLength(7);
    /* 2026-10-20 is a Tuesday: the last column starts on Sunday the 18th. */
    expect(map.weeks.at(-1)?.cells[0].date).toBe('2026-10-18');
    expect(map.weeks.at(-1)?.cells[2].date).toBe('2026-10-20');
    expect(map.to).toBe('2026-10-20');
  });

  it('marks the days after today as future, never as zero days', () => {
    const map = buildTokenMap([], TODAY);
    const last = map.weeks.at(-1)!;
    expect(last.cells[2].future).toBe(false);
    expect(last.cells[3].future).toBe(true);
    expect(last.cells[3].label).toBe('');
    expect(last.cells[6].future).toBe(true);
  });

  it('fills the silent days as empty cells and keeps the reported day', () => {
    const map = buildTokenMap([day('2026-10-14', 500)], TODAY);
    const cells = map.weeks.flatMap((w) => w.cells);
    const filled = cells.find((c) => c.date === '2026-10-14')!;
    expect(filled.total).toBe(500);
    expect(filled.level).toBe(4);
    expect(filled.label).toBe('500 tokens on Oct 14, 2026');
    expect(cells.find((c) => c.date === '2026-10-13')!.total).toBe(0);
    expect(cells.find((c) => c.date === '2026-10-13')!.level).toBe(0);
    expect(map.windowTotal).toBe(500);
    expect(map.activeDays).toBe(1);
  });

  it('shades a day against the busiest day in the window', () => {
    const map = buildTokenMap([day('2026-10-01', 1000), day('2026-10-02', 500), day('2026-10-03', 100)], TODAY);
    const at = (date: string) => map.weeks.flatMap((w) => w.cells).find((c) => c.date === date)!;
    expect(map.max).toBe(1000);
    expect(at('2026-10-01').level).toBe(4);
    expect(at('2026-10-02').level).toBe(3);
    expect(at('2026-10-03').level).toBe(1);
  });

  it('leaves usage older than the window out of the map but not out of the total', () => {
    const report: GetTokenUsageResponse = { total: 9000, input: 8000, output: 1000, turns: 9, days: [day('2023-01-01', 9000)], since: '2023-01-01' };
    const map = buildTokenMap(report.days, TODAY);
    expect(map.windowTotal).toBe(0);
    expect(map.weeks.flatMap((w) => w.cells).every((c) => c.total === 0)).toBe(true);
    expect(describeUsage(report, map)).toContain('Jan 1, 2023');
  });

  it('labels a month on its first week, never crowding the label before it', () => {
    const map = buildTokenMap([], TODAY);
    const at = map.weeks.map((w, i) => ({ i, month: w.month })).filter((w) => w.month);
    expect(at.length).toBeGreaterThan(10);
    for (let i = 1; i < at.length; i++) expect(at[i].i - at[i - 1].i).toBeGreaterThanOrEqual(4);
    /* 53 columns is a year and a bit: the first and last labels are the same month. */
    expect(at[0].month).toBe('Oct');
    expect(at.at(-1)?.month).toBe('Oct');
  });
});

describe('the token numbers as words', () => {
  it('drops a trailing zero and steps through k and m', () => {
    expect(exactTokens(1234567)).toBe('1,234,567');
    expect(compactTokens(999)).toBe('999');
    expect(compactTokens(1500)).toBe('1.5k');
    expect(compactTokens(12000)).toBe('12k');
    expect(compactTokens(1500000)).toBe('1.5m');
    expect(compactTokens(12000000)).toBe('12m');
  });

  it('names a day from the date alone, not the runner\'s clock', () => {
    expect(dayLabel('2026-10-14')).toBe('Oct 14, 2026');
    expect(dayLabel('2026-01-02')).toBe('Jan 2, 2026');
  });

  it('says the total is a floor when turns that reported nothing are around', () => {
    const report: GetTokenUsageResponse = { total: 100, input: 60, output: 40, turns: 1, days: [day('2026-10-14', 100)], since: '2026-10-14' };
    const map = buildTokenMap(report.days, TODAY);
    expect(describeUsage(report, map)).toContain('1 turn since Oct 14, 2026');
    expect(describeUsage(report, map)).toContain('Only turns where the agent reported usage are counted.');
  });
});
