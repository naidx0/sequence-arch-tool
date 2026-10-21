/** Run the same durability assertion against a git revision, without changing a working tree. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const revision = process.argv[2] ?? 'HEAD';
const source = file => execFileSync('git', ['show', `${revision}:packages/web2/src/${file}`], { encoding: 'utf8' });
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
let config = source('agents/chatConfig.ts');
if (config.includes("from '../state/switchRule'")) config = config.replace("'../state/switchRule'", JSON.stringify(moduleUrl(source('state/switchRule.ts'))));
const { writeSavedPicks, readSavedPicks, stateFromSaved } = await import(moduleUrl(config));
let value;
const storage = { getItem: () => value, setItem: (_, v) => { value = v; } };
const state = { agents: { chat: 'claude' }, chatConfig: { chat: { switchRule: { target: 'codex', remaining: 19, createdAt: 10, counted: ['turn-1'] } } } };
writeSavedPicks(storage, state);
assert.deepEqual(stateFromSaved(readSavedPicks(storage)), state, `${revision}: a 19-turn countdown must survive reload with its deduplication receipt`);
console.log(`PASS ${revision}: 19-turn countdown and receipt survived the existing preference storage round trip`);
