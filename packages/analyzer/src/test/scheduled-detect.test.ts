import assert from 'node:assert';
import { test } from 'node:test';
import { factsSuggestScheduledJob } from '../scheduledDetect.js';
import type { FileFacts } from '../types.js';

function fact(file: string, lines: string[]): FileFacts {
  return {
    file,
    language: 'py',
    loc: lines.length,
    lines,
    /* Required on FileFacts since the expression-position slot landed: a hand
       built fixture states it rather than the type going optional to accommodate
       one test. */
    envReads: [],
    imports: [],
    calls: [],
    functions: [],
    classes: [],
    assignments: new Map(),
    parseErrors: 0,
  };
}

test('detects APScheduler in service source', () => {
  const facts = [
    fact('worker/scheduler.py', [
      'from apscheduler.schedulers.background import BackgroundScheduler',
      'scheduler = BackgroundScheduler()',
    ]),
  ];
  assert.strictEqual(factsSuggestScheduledJob(facts), true);
});

test('detects a cron expression literal', () => {
  const facts = [fact('jobs.py', ['CRON = "0 9 * * 1"'])];
  assert.strictEqual(factsSuggestScheduledJob(facts), true);
});

test('returns false when no scheduler evidence exists', () => {
  const facts = [fact('api/main.py', ['from fastapi import FastAPI', 'app = FastAPI()'])];
  assert.strictEqual(factsSuggestScheduledJob(facts), false);
});
