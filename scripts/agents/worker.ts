import { ethers } from "ethers";
import {
  getNetworkConfig,
  getSigner,
  getWorkerConfig,
  WorkerConfig,
} from "./lib/config";
import {
  getEscrowContractWithSigner,
  getMNEEContractWithSigner,
  Task,
  TaskState,
  TaskCreatedEvent,
} from "./lib/contracts";
import {
  computeOutputHash,
  computeCommitHash,
  generateSalt,
  canonicalizeJSON,
  toCanonicalBytes,
  bytesToString,
} from "./lib/encoding";
import {
  addPendingReveal,
  removePendingReveal,
  getAllPendingReveals,
} from "./lib/persistence";
import { listenForTaskCreated } from "./lib/events";
import { REVEAL_WINDOW } from "../../utils/constants";

/**
 * Worker Agent (Agent B)
 *
 * Listens for TaskCreated events, evaluates tasks, commits, and reveals
 */
class WorkerAgent {
  private signer: ethers.Wallet;
  private escrow: ethers.Contract;
  private mnee: ethers.Contract;
  private config: WorkerConfig;
  private isRunning: boolean = false;
  private stopListener: (() => void) | null = null;

  // Stats
  private tasksEvaluated: number = 0;
  private tasksAccepted: number = 0;
  private totalEarned: bigint = 0n;

  constructor(privateKey?: string) {
    this.signer = getSigner(privateKey);
    this.escrow = getEscrowContractWithSigner(this.signer);
    this.mnee = getMNEEContractWithSigner(this.signer);
    this.config = getWorkerConfig();

    console.log(`Worker Agent initialized`);
    console.log(`  Address: ${this.signer.address}`);
    console.log(`  Network: ${getNetworkConfig().name}`);
  }

  /**
   * Start the worker agent
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("Worker is already running");
      return;
    }

    this.isRunning = true;
    console.log("\nWorker Agent starting...");

    // Check for pending reveals from previous session
    await this.recoverPendingReveals();

    // Start listening for new tasks
    this.stopListener = listenForTaskCreated(async (event) => {
      await this.handleTaskCreated(event);
    });

    console.log("Listening for TaskCreated events...\n");
  }

  /**
   * Stop the worker agent
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.stopListener) {
      this.stopListener();
      this.stopListener = null;
    }

    console.log("\nWorker Agent stopped");
    this.printStats();
  }

  private async getChainTime(): Promise<number> {
    const block = await this.signer.provider?.getBlock("latest");
    return block?.timestamp ?? Math.floor(Date.now() / 1000);
  }

  /**
   * Handle a TaskCreated event
   */
  private async handleTaskCreated(event: TaskCreatedEvent): Promise<void> {
    const taskId = event.taskId.toString();
    console.log(`\n[Task ${taskId}] New task detected`);
    this.tasksEvaluated++;

    // Evaluate the task
    const evaluation = await this.evaluateTask(event);

    if (!evaluation.shouldAccept) {
      console.log(`[Task ${taskId}] Skipping: ${evaluation.reason}`);
      return;
    }

    console.log(`[Task ${taskId}] Accepting task`);
    console.log(`  Estimated profit: ${ethers.formatUnits(evaluation.estimatedProfit!, 18)} MNEE`);

    // Commit and reveal
    try {
      await this.commitAndReveal(event, evaluation.outputBytes!);
      this.tasksAccepted++;
      this.totalEarned += event.amount;
      console.log(`[Task ${taskId}] Completed successfully!`);
    } catch (error) {
      console.error(`[Task ${taskId}] Failed:`, error);
    }
  }

  /**
   * Evaluate a task for profitability and correctness
   */
  async evaluateTask(event: TaskCreatedEvent): Promise<{
    shouldAccept: boolean;
    reason: string;
    estimatedProfit?: bigint;
    outputBytes?: string;
  }> {
    // Check 1: Is the spec supported?
    if (!this.config.supportedSpecs.includes(event.specHash)) {
      return { shouldAccept: false, reason: "Unsupported spec" };
    }

    // Check 2: Is there enough time?
    const currentTime = await this.getChainTime();
    const commitCutoff = Number(event.deadline) - REVEAL_WINDOW - this.config.commitBuffer;

    if (currentTime >= commitCutoff) {
      return { shouldAccept: false, reason: "Not enough time to commit" };
    }

    // Check 3: Compute local output and verify hash
    let outputBytes: string;
    try {
      outputBytes = await this.computeOutput(event.inputBytes, event.specHash);
    } catch (error) {
      return { shouldAccept: false, reason: `Failed to compute output: ${error}` };
    }

    const outputHash = computeOutputHash(outputBytes);
    if (outputHash !== event.expectedOutputHash) {
      return {
        shouldAccept: false,
        reason: "Output hash mismatch - cannot produce expected output",
      };
    }

    // Check 4: Profitability (simple gas estimate)
    const feeData = await this.signer.provider!.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
    if (!gasPrice) {
      return { shouldAccept: false, reason: "Gas price unavailable" };
    }

    const baseGas = 200000n; // Conservative estimate for commit + reveal
    const gasMultiplier = BigInt(Math.max(1, Math.round(this.config.gasEstimateMultiplier * 100)));
    const estimatedGas = (baseGas * gasMultiplier) / 100n;
    const gasCostWei = estimatedGas * gasPrice;
    const gasCostInMnee = (gasCostWei * this.config.mneePerEth) / (10n ** 18n);

    const estimatedProfit = event.amount - gasCostInMnee;

    if (estimatedProfit < this.config.minProfitMargin) {
      return {
        shouldAccept: false,
        reason: `Insufficient profit margin: ${ethers.formatUnits(estimatedProfit, 18)} MNEE`,
      };
    }

    return {
      shouldAccept: true,
      reason: "Task accepted",
      estimatedProfit,
      outputBytes,
    };
  }

  /**
   * Compute output for a task (JCS canonicalization)
   */
  private async computeOutput(inputBytes: string, specHash: string): Promise<string> {
    // For RFC8785_JCS_V1, we parse the input as JSON and canonicalize it
    const inputStr = bytesToString(inputBytes);
    const inputObj = JSON.parse(inputStr);
    return toCanonicalBytes(inputObj);
  }

  /**
   * Commit to a task and reveal
   */
  private async commitAndReveal(
    event: TaskCreatedEvent,
    outputBytes: string
  ): Promise<void> {
    const taskId = event.taskId.toString();

    // Generate salt
    const salt = generateSalt();
    const outputHash = computeOutputHash(outputBytes);
    const commitHash = computeCommitHash(outputHash, salt);

    // CRITICAL: Persist salt BEFORE commit (crash safety)
    const currentTime = await this.getChainTime();
    const pendingReveal = {
      salt,
      outputBytes,
      commitHash,
      committedAt: currentTime,
      revealDeadline: currentTime + REVEAL_WINDOW,
    };
    addPendingReveal(taskId, pendingReveal);

    console.log(`[Task ${taskId}] Salt persisted, committing...`);

    let commitMined = false;
    try {
      // Approve bond
      const escrowAddress = await this.escrow.getAddress();
      const allowance = await this.mnee.allowance(this.signer.address, escrowAddress);

      if (allowance < event.bondAmount) {
        const approveTx = await this.mnee.approve(escrowAddress, event.bondAmount);
        await approveTx.wait();
        console.log(`[Task ${taskId}] Approved bond`);
      }

      // Commit
      const commitTx = await this.escrow.commit(event.taskId, commitHash);
      await commitTx.wait();
      commitMined = true;
      console.log(`[Task ${taskId}] Committed: ${commitTx.hash}`);

      const task: Task = await this.escrow.getTask(event.taskId);
      addPendingReveal(taskId, { ...pendingReveal, revealDeadline: Number(task.revealDeadline) });

      // Reveal immediately
      const revealTx = await this.escrow.reveal(event.taskId, outputBytes, salt);
      await revealTx.wait();
      console.log(`[Task ${taskId}] Revealed: ${revealTx.hash}`);

      // Remove pending reveal on success
      removePendingReveal(taskId);
    } catch (error) {
      if (!commitMined) {
        removePendingReveal(taskId);
      }
      throw error;
    }
  }

  /**
   * Recover and process pending reveals from previous session
   */
  private async recoverPendingReveals(): Promise<void> {
    const pendingReveals = getAllPendingReveals();
    const taskIds = Object.keys(pendingReveals);

    if (taskIds.length === 0) {
      return;
    }

    console.log(`Found ${taskIds.length} pending reveals from previous session`);

    for (const taskId of taskIds) {
      const pending = pendingReveals[taskId];

      const task: Task = await this.escrow.getTask(BigInt(taskId));
      if (task.state !== TaskState.COMMITTED || task.committedWorker !== this.signer.address) {
        console.log(`[Task ${taskId}] Task state changed, removing from pending`);
        removePendingReveal(taskId);
        continue;
      }

      const currentTime = await this.getChainTime();
      const revealDeadline = Number(task.revealDeadline);
      if (currentTime > revealDeadline) {
        console.log(`[Task ${taskId}] Reveal window expired, removing from pending`);
        removePendingReveal(taskId);
        continue;
      }

      addPendingReveal(taskId, { ...pending, revealDeadline });
      console.log(`[Task ${taskId}] Attempting to reveal...`);
      try {
        const revealTx = await this.escrow.reveal(
          BigInt(taskId),
          pending.outputBytes,
          pending.salt
        );
        await revealTx.wait();
        console.log(`[Task ${taskId}] Recovered reveal successful: ${revealTx.hash}`);
        removePendingReveal(taskId);
      } catch (error) {
        console.error(`[Task ${taskId}] Recovery failed:`, error);
      }
    }
  }

  /**
   * Get agent status
   */
  getStatus(): {
    isRunning: boolean;
    address: string;
    tasksEvaluated: number;
    tasksAccepted: number;
    totalEarned: bigint;
  } {
    return {
      isRunning: this.isRunning,
      address: this.signer.address,
      tasksEvaluated: this.tasksEvaluated,
      tasksAccepted: this.tasksAccepted,
      totalEarned: this.totalEarned,
    };
  }

  /**
   * Print statistics
   */
  private printStats(): void {
    console.log("\nWorker Statistics:");
    console.log(`  Tasks Evaluated: ${this.tasksEvaluated}`);
    console.log(`  Tasks Accepted: ${this.tasksAccepted}`);
    console.log(`  Total Earned: ${ethers.formatUnits(this.totalEarned, 18)} MNEE`);
  }
}

// Main entry point
async function main() {
  const worker = new WorkerAgent();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, shutting down...");
    worker.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, shutting down...");
    worker.stop();
    process.exit(0);
  });

  await worker.start();

  // Keep process alive
  console.log("Press Ctrl+C to stop\n");
}

// Run if executed directly
main().catch((error) => {
  console.error("Worker failed:", error);
  process.exit(1);
});

export { WorkerAgent };
