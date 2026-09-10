/**
 * ADR-013 Phase D — atomic gateway spend reservations and reconciliation.
 *
 * Pure in-process logic (no I/O). Concurrent reservations cannot overshoot the
 * configured hard cap: `committed + reserved + newEstimate <= hardCap`.
 *
 * Persistence of `committedUsd` is the caller's job (meter.ts / usage.json).
 */

import { randomBytes } from 'node:crypto';

export interface SpendLedgerPolicy {
  /** Hard USD ceiling — reservations + committed must stay at or below this. */
  hardCapUsd: number;
}

export interface SpendReservation {
  id: string;
  estimatedUsd: number;
}

export interface SpendLedgerDiagnostics {
  committedUsd: number;
  reservedUsd: number;
  hardCapUsd: number;
  activeReservations: number;
  capRejections: number;
  maxConcurrentOvershootUsd: number;
}

export interface SpendLedger {
  /** Attempt to reserve `estimateUsd` before a gateway call. */
  tryReserve(estimateUsd: number): { allowed: true; reservation: SpendReservation } | { allowed: false; reason: 'cap' };
  /** Finalize a reservation with the actual (provider or estimated) cost. */
  reconcile(reservationId: string, actualUsd: number): void;
  /** Release a reservation without charging (failed/blocked attempt). */
  release(reservationId: string): void;
  diagnostics(): SpendLedgerDiagnostics;
}

export interface SpendLedgerState {
  committedUsd: number;
}

function newReservationId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Create an in-process spend ledger. `getCommitted` reads the persisted axis;
 * `setCommitted` is called after reconcile to persist the new total.
 */
export function createSpendLedger(
  policy: SpendLedgerPolicy,
  getCommitted: () => number,
  setCommitted: (usd: number) => void,
): SpendLedger {
  const reservations = new Map<string, number>();
  let capRejections = 0;
  let maxConcurrentOvershootUsd = 0;

  function reservedTotal(): number {
    let sum = 0;
    for (const v of reservations.values()) sum += v;
    return sum;
  }

  function wouldExceed(estimateUsd: number): boolean {
    const total = getCommitted() + reservedTotal() + estimateUsd;
    if (total > policy.hardCapUsd) {
      const overshoot = total - policy.hardCapUsd;
      if (overshoot > maxConcurrentOvershootUsd) maxConcurrentOvershootUsd = overshoot;
      return true;
    }
    return false;
  }

  return {
    tryReserve(estimateUsd: number) {
      const est = Math.max(0, estimateUsd);
      if (wouldExceed(est)) {
        capRejections++;
        return { allowed: false as const, reason: 'cap' as const };
      }
      const reservation: SpendReservation = { id: newReservationId(), estimatedUsd: est };
      reservations.set(reservation.id, est);
      return { allowed: true as const, reservation };
    },

    reconcile(reservationId: string, actualUsd: number) {
      const held = reservations.get(reservationId);
      if (held === undefined) return;
      reservations.delete(reservationId);
      const actual = Math.max(0, actualUsd);
      const next = getCommitted() + actual;
      setCommitted(next);
    },

    release(reservationId: string) {
      reservations.delete(reservationId);
    },

    diagnostics() {
      return {
        committedUsd: getCommitted(),
        reservedUsd: reservedTotal(),
        hardCapUsd: policy.hardCapUsd,
        activeReservations: reservations.size,
        capRejections,
        maxConcurrentOvershootUsd,
      };
    },
  };
}

/**
 * Admission check without mutating state — for tests and pre-flight diagnostics.
 */
export function canReserveSpend(
  committedUsd: number,
  reservedUsd: number,
  estimateUsd: number,
  hardCapUsd: number,
): boolean {
  return committedUsd + reservedUsd + Math.max(0, estimateUsd) <= hardCapUsd;
}
