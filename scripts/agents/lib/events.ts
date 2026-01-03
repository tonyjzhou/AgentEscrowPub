import { ethers } from "ethers";
import { getEscrowContract, parseTaskCreatedEvent, TaskCreatedEvent } from "./contracts";

/**
 * Event listener callback type
 */
export type TaskCreatedCallback = (event: TaskCreatedEvent) => void | Promise<void>;

/**
 * Start listening for TaskCreated events
 * Returns a cleanup function to stop listening
 */
export function listenForTaskCreated(
  callback: TaskCreatedCallback
): () => void {
  const escrow = getEscrowContract();

  const filter = escrow.filters.TaskCreated();

  const listener = async (
    taskId: bigint,
    requester: string,
    inputBytes: string,
    inputHash: string,
    expectedOutputHash: string,
    specHash: string,
    amount: bigint,
    bondAmount: bigint,
    deadline: bigint
  ) => {
    const event: TaskCreatedEvent = {
      taskId,
      requester,
      inputBytes,
      inputHash,
      expectedOutputHash,
      specHash,
      amount,
      bondAmount,
      deadline,
    };

    try {
      await callback(event);
    } catch (error) {
      console.error("Error in TaskCreated callback:", error);
    }
  };

  escrow.on(filter, listener);

  // Return cleanup function
  return () => {
    escrow.off(filter, listener);
  };
}

/**
 * Wait for a specific number of confirmations
 */
export async function waitForConfirmations(
  txHash: string,
  confirmations: number
): Promise<ethers.TransactionReceipt | null> {
  if (confirmations === 0) {
    return null;
  }

  const escrow = getEscrowContract();
  const provider = escrow.runner?.provider as ethers.Provider;

  const receipt = await provider.waitForTransaction(txHash, confirmations);
  return receipt;
}
