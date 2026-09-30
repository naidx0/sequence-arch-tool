import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { SESSION_TITLE_PROMPT_CHARS, fallbackGoalName, goalNamePrompt, parseGoalName, sessionTitlePrompt } from '../server/goalName.js';
import {
  createSession,
  persistPlanAdoptingGoal,
  planTurnGoalCandidate,
  readSessionGoal,
  readSessionIndex,
  updateSession,
} from '../server/sessionsStore.js';

/*
 * ══════════════════════════════════════════════════════════════════════════
 * A GOAL HAS A NAME, AND THE NAME IS NOT THE PROMPT — owner, 2026-09-22.
 *
 * The Bastion row as it stood: title and goal were both
 *   "this long running task and goal from earlier make tand decide on the
 *    logic behind this feature and platofmr and please have it ready …"
 * with `titleEdited: true`, because the goal form wrote the goal's text into
 * the title. These cases start from that record.
 * ══════════════════════════════════════════════════════════════════════════
 */
const BASTION_GOAL =
  'this long running task and goal from earlier make tand decide on the logic behind this feature and platofmr and please have it ready and formatted and ready to be used as well please';

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-goal-name-'));
}

function row(repo: string, id: string) {
  return readSessionIndex(repo)!.sessions.find((s) => s.id === id)!;
}

describe('the store', () => {
  it('a new goal is named at once, and the goal text is kept verbatim', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goal: BASTION_GOAL });
    const r = row(repo, id);
    assert.equal(r.goal, BASTION_GOAL, 'the instruction is never rewritten');
    assert.ok(r.goalName && r.goalName.length <= 49, r.goalName);
    assert.notEqual(r.goalName, BASTION_GOAL);
  });

  it("the model's name replaces the trimmer's, and the title follows it while the title is ours", () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goal: BASTION_GOAL });
    updateSession(repo, id, { goalName: 'Decide the feature and platform logic' });
    const r = row(repo, id);
    assert.equal(r.goalName, 'Decide the feature and platform logic');
    assert.equal(r.title, 'Decide the feature and platform logic');
  });

  it('THE BASTION ROW: a title that was only the goal text is ours to move', () => {
    /* The old form sent `title: goal`, which set titleEdited. That is not the
       person renaming the thread, and the row must not stay pinned to it. */
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goal: BASTION_GOAL, title: BASTION_GOAL });
    assert.equal(row(repo, id).titleEdited, true);
    updateSession(repo, id, { goalName: 'Decide the feature and platform logic' });
    assert.equal(row(repo, id).title, 'Decide the feature and platform logic');
  });

  it('a title the person chose is never moved by a goal', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { title: 'My Bastion work' });
    updateSession(repo, id, { goal: BASTION_GOAL });
    updateSession(repo, id, { goalName: 'Decide the feature and platform logic' });
    assert.equal(row(repo, id).title, 'My Bastion work');
  });

  it('clearing the goal clears its name', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goal: BASTION_GOAL });
    updateSession(repo, id, { goal: '' });
    assert.equal(row(repo, id).goal, '');
    assert.equal(row(repo, id).goalName, undefined);
    assert.equal(readSessionGoal(repo, id).goalName, undefined);
  });

  it('a name with no goal is not stored', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goalName: 'Orphan name' });
    assert.equal(row(repo, id).goalName, undefined);
  });

  it('a row written before names existed reads with a name', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goal: BASTION_GOAL });
    const indexPath = path.join(repo, '.sequence', 'sessions', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    delete index.sessions.find((s: { id: string }) => s.id === id).goalName;
    fs.writeFileSync(indexPath, JSON.stringify(index));
    assert.equal(readSessionGoal(repo, id).goalName, fallbackGoalName(BASTION_GOAL));
  });
});

describe('reading a name out of a reply', () => {
  it('takes one clean line', () => {
    assert.equal(parseGoalName('Explore and explain the Bastion repository'), 'Explore and explain the Bastion repository');
    assert.equal(parseGoalName('"decide the feature logic."'), 'Decide the feature logic');
    assert.equal(parseGoalName('Name: Ship the parser guard'), 'Ship the parser guard');
    assert.equal(parseGoalName('<think>hmm</think>\n**Map the insurer services**'), 'Map the insurer services');
  });

  it('refuses what is not a name', () => {
    assert.equal(parseGoalName(''), null);
    assert.equal(parseGoalName('Bastion'), null, 'one word names nothing');
    assert.equal(
      parseGoalName('This goal is about deciding the logic behind the feature and the platform and making it ready'),
      null,
      'a sentence is not a name',
    );
  });

  it('the prompt carries the goal and asks for a short outcome, without absolutes', () => {
    const p = goalNamePrompt(BASTION_GOAL);
    assert.ok(p.includes(BASTION_GOAL));
    assert.doesNotMatch(p, /MUST|NEVER|EXACTLY|ONLY/);
  });
});

describe('a Plan turn that writes a plan makes the goal', () => {
  const step = (text: string) => ({ id: text, text, status: 'open' as const });

  it('is a candidate only in Plan, only with no goal and no plan', () => {
    const q = 'dive into the Bastion repo and explain it with possible changes';
    assert.equal(planTurnGoalCandidate({}, { permission: 'plan', question: q }), q);
    assert.equal(planTurnGoalCandidate({}, { permission: 'build', question: q }), null, 'Build does not adopt');
    assert.equal(planTurnGoalCandidate({ goal: 'x' }, { permission: 'plan', question: q }), null);
    assert.equal(planTurnGoalCandidate({ plan: [step('a')] }, { permission: 'plan', question: q }), null);
    assert.equal(planTurnGoalCandidate({}, { permission: 'plan', question: '  ' }), null);
  });

  it('a goal the person CLEARED stays cleared', () => {
    assert.equal(planTurnGoalCandidate({ goal: '' }, { permission: 'plan', question: 'plan it' }), null);
  });

  it('persisting the plan adopts the goal, and the goal gets a name', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    const adopted = persistPlanAdoptingGoal(repo, id, BASTION_GOAL, [step('read the README'), step('map services')]);
    assert.equal(adopted, true);
    const r = row(repo, id);
    assert.equal(r.goal, BASTION_GOAL);
    assert.equal(r.plan?.length, 2);
    assert.ok(r.goalName && r.goalName !== BASTION_GOAL);
  });

  it('a goal set in the meantime is not overwritten', () => {
    const repo = freshRepo();
    const id = createSession(repo).id;
    updateSession(repo, id, { goal: 'the person typed this' });
    assert.equal(persistPlanAdoptingGoal(repo, id, BASTION_GOAL, [step('a')]), false);
    assert.equal(row(repo, id).goal, 'the person typed this');
  });
});

describe('naming a chat from the beginning of its first message (owner, 2026-09-22)', () => {
  it('the prompt carries the beginning of the message, asks for an outcome, and shows the shape he asked for', () => {
    const p = sessionTitlePrompt('can u build the memroy feature pls');
    assert.ok(p.includes('can u build the memroy feature pls'));
    assert.match(p, /Build the memory feature/, 'the example is his: "build XYZ feature"');
    assert.doesNotMatch(p, /MUST|NEVER|EXACTLY|ONLY/);
  });

  it('only the BEGINNING goes to the model — a long paste is cut, not sent', () => {
    const long = 'explain this '.repeat(200);
    const p = sessionTitlePrompt(long);
    assert.ok(p.length < SESSION_TITLE_PROMPT_CHARS + 400, `prompt is ${p.length} chars`);
    assert.ok(!p.includes(long.trim()));
  });
});
