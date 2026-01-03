import * as fs from "fs";
import * as path from "path";

/**
 * Pending reveal data
 */
export interface PendingReveal {
  salt: string;
  outputBytes: string;
  commitHash: string;
  committedAt: number;
  revealDeadline: number;
}

/**
 * Worker state persisted to disk
 */
export interface WorkerState {
  pendingReveals: {
    [taskId: string]: PendingReveal;
  };
}

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "worker-state.json");

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load worker state from disk
 */
export function loadWorkerState(): WorkerState {
  ensureDataDir();

  if (!fs.existsSync(STATE_FILE)) {
    return { pendingReveals: {} };
  }

  try {
    const data = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Failed to load worker state:", error);
    return { pendingReveals: {} };
  }
}

/**
 * Save worker state to disk
 */
export function saveWorkerState(state: WorkerState): void {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Add pending reveal (MUST be called BEFORE commit tx)
 */
export function addPendingReveal(
  taskId: string,
  reveal: PendingReveal
): void {
  const state = loadWorkerState();
  state.pendingReveals[taskId] = reveal;
  saveWorkerState(state);
}

/**
 * Remove pending reveal (called AFTER successful reveal)
 */
export function removePendingReveal(taskId: string): void {
  const state = loadWorkerState();
  delete state.pendingReveals[taskId];
  saveWorkerState(state);
}

/**
 * Get pending reveal for a task
 */
export function getPendingReveal(taskId: string): PendingReveal | undefined {
  const state = loadWorkerState();
  return state.pendingReveals[taskId];
}

/**
 * Get all pending reveals
 */
export function getAllPendingReveals(): { [taskId: string]: PendingReveal } {
  const state = loadWorkerState();
  return state.pendingReveals;
}
