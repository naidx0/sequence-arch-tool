import { diffFromProposedContent, diffTotals, type DiffFileChange } from '../review/diffModel';
import type { FileEditProposal, ProposalId } from '../state/types';

export interface EditLedgerFileRow {
  path: string;
  added: number;
  removed: number;
}

export interface EditLedgerSummary {
  fileCount: number;
  added: number;
  removed: number;
  files: EditLedgerFileRow[];
}

/** Summarize edit proposals for the Codex-style ledger strip. */
export function summarizeEditLedger(
  proposalIds: readonly ProposalId[],
  proposals: Record<ProposalId, FileEditProposal>,
): EditLedgerSummary | null {
  if (proposalIds.length === 0) return null;
  const diffs: DiffFileChange[] = [];
  for (const id of proposalIds) {
    const proposal = proposals[id];
    if (!proposal) continue;
    for (const file of proposal.files) {
      diffs.push(diffFromProposedContent(file.path, file.content));
    }
  }
  if (diffs.length === 0) return null;
  const totals = diffTotals(diffs);
  const files = diffs.map((d) => ({ path: d.path, added: d.added, removed: d.removed }));
  return {
    fileCount: files.length,
    added: totals.added,
    removed: totals.removed,
    files,
  };
}
