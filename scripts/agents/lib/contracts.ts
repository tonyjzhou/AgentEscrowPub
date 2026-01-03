import { ethers } from "ethers";
import { getDeploymentAddresses, getProvider, getSigner } from "./config";

// Import ABIs from typechain-generated types
import AgentEscrowABI from "../../../artifacts/contracts/AgentEscrow.sol/AgentEscrow.json";
import MockMNEEABI from "../../../artifacts/contracts/mocks/MockMNEE.sol/MockMNEE.json";

/**
 * Get AgentEscrow contract instance (read-only)
 */
export function getEscrowContract(): ethers.Contract {
  const { escrow } = getDeploymentAddresses();
  const provider = getProvider();
  return new ethers.Contract(escrow, AgentEscrowABI.abi, provider);
}

/**
 * Get AgentEscrow contract instance with signer
 */
export function getEscrowContractWithSigner(
  signer: ethers.Wallet
): ethers.Contract {
  const { escrow } = getDeploymentAddresses();
  return new ethers.Contract(escrow, AgentEscrowABI.abi, signer);
}

/**
 * Get MNEE token contract instance (read-only)
 */
export function getMNEEContract(): ethers.Contract {
  const { mnee } = getDeploymentAddresses();
  const provider = getProvider();
  return new ethers.Contract(mnee, MockMNEEABI.abi, provider);
}

/**
 * Get MNEE token contract instance with signer
 */
export function getMNEEContractWithSigner(
  signer: ethers.Wallet
): ethers.Contract {
  const { mnee } = getDeploymentAddresses();
  return new ethers.Contract(mnee, MockMNEEABI.abi, signer);
}

/**
 * Task state enum
 */
export enum TaskState {
  OPEN = 0,
  COMMITTED = 1,
  COMPLETED = 2,
  REFUNDED = 3,
}

/**
 * Task data structure
 */
export interface Task {
  requester: string;
  inputHash: string;
  expectedOutputHash: string;
  specHash: string;
  amount: bigint;
  bondAmount: bigint;
  deadline: bigint;
  state: TaskState;
  committedWorker: string;
  commitHash: string;
  revealDeadline: bigint;
}

/**
 * TaskCreated event data
 */
export interface TaskCreatedEvent {
  taskId: bigint;
  requester: string;
  inputBytes: string;
  inputHash: string;
  expectedOutputHash: string;
  specHash: string;
  amount: bigint;
  bondAmount: bigint;
  deadline: bigint;
}

/**
 * Parse TaskCreated event from log
 */
export function parseTaskCreatedEvent(log: ethers.Log): TaskCreatedEvent | null {
  const escrow = getEscrowContract();
  try {
    const parsed = escrow.interface.parseLog({
      topics: log.topics as string[],
      data: log.data,
    });

    if (parsed?.name === "TaskCreated") {
      return {
        taskId: parsed.args.taskId,
        requester: parsed.args.requester,
        inputBytes: parsed.args.inputBytes,
        inputHash: parsed.args.inputHash,
        expectedOutputHash: parsed.args.expectedOutputHash,
        specHash: parsed.args.specHash,
        amount: parsed.args.amount,
        bondAmount: parsed.args.bondAmount,
        deadline: parsed.args.deadline,
      };
    }
  } catch {
    // Not a TaskCreated event
  }
  return null;
}
