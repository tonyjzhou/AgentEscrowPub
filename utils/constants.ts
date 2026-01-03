/**
 * Protocol constants - must match contract values
 */

/** Time window for worker to reveal after commit (10 minutes in seconds) */
export const REVEAL_WINDOW = 10 * 60; // 600 seconds

/** Minimum bond as basis points of payment amount (10%) */
export const MIN_BOND_BPS = 1000;

/** Maximum input size in bytes (4 KB) */
export const MAX_INPUT_SIZE = 4096;

/** Maximum output size in bytes (4 KB) */
export const MAX_OUTPUT_SIZE = 4096;

/** Spec hash for RFC 8785 JCS canonicalization */
export const RFC8785_JCS_V1_SPEC_HASH = "0x" + Buffer.from("RFC8785_JCS_V1").toString("hex").padEnd(64, "0");

/** TaskState enum values (matches contract) */
export enum TaskState {
  OPEN = 0,
  COMMITTED = 1,
  COMPLETED = 2,
  REFUNDED = 3,
}
