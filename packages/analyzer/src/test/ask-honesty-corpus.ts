import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(here, '..', '..', 'test', 'fixtures', 'ask-honesty');

export type AskHonestyFixtureId =
  | 'process-sequence-bare'
  | 'fenced-seqd'
  | 'propose-topology-bare'
  | 'bare-nodes';

const FIXTURE_FILES: Record<AskHonestyFixtureId, string> = {
  'process-sequence-bare': 'process-sequence-bare.json',
  'fenced-seqd': 'fenced-seqd.json',
  'propose-topology-bare': 'propose-topology-bare.json',
  'bare-nodes': 'bare-nodes.json',
};

export function loadAskHonestyFixture(id: AskHonestyFixtureId): string {
  const file = path.join(FIXTURE_DIR, FIXTURE_FILES[id]);
  return fs.readFileSync(file, 'utf8').trim();
}

export function wrapProse(inner: string, lead = 'Here is the shape:', tail = 'That covers it.'): string {
  return `${lead}\n${inner}\n${tail}`;
}

export function wrapFencedSeqd(body: string): string {
  return `Here is the plan.\n\n\`\`\`json\n${body}\n\`\`\`\n`;
}
