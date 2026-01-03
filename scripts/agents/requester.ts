import { ethers } from "ethers";
import { getNetworkConfig, getSigner } from "./lib/config";
import {
  getEscrowContractWithSigner,
  getMNEEContractWithSigner,
  Task,
  TaskState,
} from "./lib/contracts";
import {
  computeOutputHash,
  toCanonicalBytes,
  computeJCSHash,
} from "./lib/encoding";
import { REVEAL_WINDOW, MIN_BOND_BPS } from "../../utils/constants";

/**
 * Requester Agent (Agent A)
 *
 * Creates tasks and monitors for completion
 */
class RequesterAgent {
  private signer: ethers.Wallet;
  private escrow: ethers.Contract;
  private mnee: ethers.Contract;

  constructor(privateKey?: string) {
    this.signer = getSigner(privateKey);
    this.escrow = getEscrowContractWithSigner(this.signer);
    this.mnee = getMNEEContractWithSigner(this.signer);

    console.log(`Requester Agent initialized`);
    console.log(`  Address: ${this.signer.address}`);
    console.log(`  Network: ${getNetworkConfig().name}`);
  }

  private async getChainTime(): Promise<number> {
    const block = await this.signer.provider?.getBlock("latest");
    return block?.timestamp ?? Math.floor(Date.now() / 1000);
  }

  /**
   * Create a new task
   */
  async createTask(params: {
    inputData: object;
    amount: bigint;
    bondAmount?: bigint;
    deadline?: number;
  }): Promise<bigint> {
    const { inputData, amount } = params;

    // Default bond is 10% of amount
    const bondAmount = params.bondAmount ?? (amount * BigInt(MIN_BOND_BPS)) / 10000n;

    // Default deadline is 1 hour from now
    const currentTime = Math.floor(Date.now() / 1000);
    const deadline = params.deadline ?? currentTime + 3600;

    // Validate deadline
    if (deadline <= currentTime + REVEAL_WINDOW) {
      throw new Error(`Deadline must be > ${REVEAL_WINDOW} seconds from now`);
    }

    // Validate bond
    const minBond = (amount * BigInt(MIN_BOND_BPS)) / 10000n;
    if (bondAmount < minBond) {
      throw new Error(`Bond must be >= ${ethers.formatUnits(minBond, 18)} MNEE (10% of amount)`);
    }

    // Prepare input bytes (canonicalized JSON)
    const inputBytes = toCanonicalBytes(inputData);

    // Compute expected output hash
    // For JCS spec, output is the same as input (canonicalization is the "computation")
    const expectedOutputHash = computeOutputHash(inputBytes);

    // Spec hash for RFC 8785 JCS
    const specHash = ethers.keccak256(ethers.toUtf8Bytes("RFC8785_JCS_V1"));

    console.log("\nCreating task...");
    console.log(`  Input: ${JSON.stringify(inputData)}`);
    console.log(`  Amount: ${ethers.formatUnits(amount, 18)} MNEE`);
    console.log(`  Bond: ${ethers.formatUnits(bondAmount, 18)} MNEE`);
    console.log(`  Deadline: ${new Date(deadline * 1000).toISOString()}`);

    // Approve tokens
    const escrowAddress = await this.escrow.getAddress();
    const allowance = await this.mnee.allowance(this.signer.address, escrowAddress);

    if (allowance < amount) {
      const approveTx = await this.mnee.approve(escrowAddress, amount);
      await approveTx.wait();
      console.log("  Approved tokens");
    }

    // Create task
    const tx = await this.escrow.createTask(
      inputBytes,
      expectedOutputHash,
      specHash,
      amount,
      bondAmount,
      deadline
    );
    const receipt = await tx.wait();

    // Get task ID from event
    const taskCreatedEvent = receipt.logs.find(
      (log: ethers.Log) => {
        try {
          const parsed = this.escrow.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          return parsed?.name === "TaskCreated";
        } catch {
          return false;
        }
      }
    );

    if (!taskCreatedEvent) {
      throw new Error("TaskCreated event not found");
    }

    const parsed = this.escrow.interface.parseLog({
      topics: taskCreatedEvent.topics as string[],
      data: taskCreatedEvent.data,
    });

    const taskId = parsed!.args.taskId;
    console.log(`  Task created: ID ${taskId}`);
    console.log(`  Transaction: ${tx.hash}`);

    return taskId;
  }

  /**
   * Monitor a task for completion
   */
  async monitorTask(
    taskId: bigint,
    pollInterval: number = 5000
  ): Promise<{ state: TaskState; outputBytes?: string }> {
    console.log(`\nMonitoring task ${taskId}...`);

    return new Promise((resolve) => {
      const checkTask = async () => {
        const task: Task = await this.escrow.getTask(taskId);

        switch (task.state) {
          case TaskState.COMPLETED:
            console.log(`  Task ${taskId} COMPLETED!`);

            // Get output from TaskCompleted event
            const filter = this.escrow.filters.TaskCompleted(taskId);
            const events = await this.escrow.queryFilter(filter);

            if (events.length > 0) {
              const parsed = this.escrow.interface.parseLog({
                topics: events[0].topics as string[],
                data: events[0].data,
              });
              resolve({
                state: TaskState.COMPLETED,
                outputBytes: parsed?.args.outputBytes,
              });
            } else {
              resolve({ state: TaskState.COMPLETED });
            }
            return;

          case TaskState.REFUNDED:
            console.log(`  Task ${taskId} REFUNDED`);
            resolve({ state: TaskState.REFUNDED });
            return;

          case TaskState.COMMITTED:
            console.log(`  Task ${taskId} is committed, waiting for reveal...`);
            break;

          case TaskState.OPEN:
            console.log(`  Task ${taskId} is open, waiting for worker...`);
            break;
        }

        // Check if deadline passed
        const currentTime = await this.getChainTime();
        if (currentTime > Number(task.deadline)) {
          console.log(`  Task ${taskId} deadline passed, claiming timeout...`);
          try {
            await this.claimTimeout(taskId);
            resolve({ state: TaskState.REFUNDED });
            return;
          } catch (error) {
            console.error(`  Timeout claim failed for task ${taskId}:`, error);
          }
        }

        // Continue polling
        setTimeout(checkTask, pollInterval);
      };

      checkTask();
    });
  }

  /**
   * Claim timeout for an expired task
   */
  async claimTimeout(taskId: bigint): Promise<void> {
    const tx = await this.escrow.claimTimeout(taskId);
    await tx.wait();
    console.log(`  Timeout claimed: ${tx.hash}`);
  }

  /**
   * Get MNEE balance
   */
  async getBalance(): Promise<bigint> {
    return await this.mnee.balanceOf(this.signer.address);
  }
}

// Demo: Create a task and monitor it
async function main() {
  const requester = new RequesterAgent();

  // Check balance
  const balance = await requester.getBalance();
  console.log(`\nMNEE Balance: ${ethers.formatUnits(balance, 18)}`);

  // Create a demo task
  const inputData = {
    task: "canonicalize",
    data: {
      b: 2,
      a: 1,
      nested: { z: 26, y: 25 },
    },
  };

  const amount = ethers.parseUnits("10", 18);

  const taskId = await requester.createTask({
    inputData,
    amount,
  });

  // Monitor the task
  const result = await requester.monitorTask(taskId);

  if (result.state === TaskState.COMPLETED && result.outputBytes) {
    console.log(`\nOutput received: ${ethers.toUtf8String(result.outputBytes)}`);
  }

  // Check final balance
  const finalBalance = await requester.getBalance();
  console.log(`\nFinal MNEE Balance: ${ethers.formatUnits(finalBalance, 18)}`);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Requester failed:", error);
    process.exit(1);
  });
}

export { RequesterAgent };
