import { ethers } from "hardhat";
import { REVEAL_WINDOW, MIN_BOND_BPS } from "../../utils/constants";

/**
 * Deployment fixture for tests
 * Deploys MockMNEE and AgentEscrow contracts
 * Funds test wallets with MNEE
 */
export async function deployFixture() {
  const [deployer, requester, worker, attacker, other] = await ethers.getSigners();

  // Deploy MockMNEE
  const MockMNEE = await ethers.getContractFactory("MockMNEE");
  const mnee = await MockMNEE.deploy();
  await mnee.waitForDeployment();

  // Deploy AgentEscrow
  const AgentEscrow = await ethers.getContractFactory("AgentEscrow");
  const escrow = await AgentEscrow.deploy(await mnee.getAddress());
  await escrow.waitForDeployment();

  // Mint MNEE to test accounts
  const initialBalance = ethers.parseUnits("1000", 18);
  await mnee.mint(requester.address, initialBalance);
  await mnee.mint(worker.address, initialBalance);
  await mnee.mint(attacker.address, initialBalance);

  // Get contract addresses
  const mneeAddress = await mnee.getAddress();
  const escrowAddress = await escrow.getAddress();

  return {
    mnee,
    escrow,
    mneeAddress,
    escrowAddress,
    deployer,
    requester,
    worker,
    attacker,
    other,
    initialBalance,
  };
}

/**
 * Helper to get current block timestamp
 */
export async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

/**
 * Helper to create valid task parameters
 */
export async function createTaskParams(overrides: Partial<{
  inputBytes: string;
  expectedOutputHash: string;
  specHash: string;
  amount: bigint;
  bondAmount: bigint;
  deadline: number;
}> = {}) {
  const timestamp = await getBlockTimestamp();
  const defaultAmount = ethers.parseUnits("10", 18);
  const defaultBond = (defaultAmount * BigInt(MIN_BOND_BPS)) / 10000n;

  return {
    inputBytes: overrides.inputBytes ?? ethers.hexlify(ethers.toUtf8Bytes("hello world")),
    expectedOutputHash: overrides.expectedOutputHash ?? ethers.keccak256(ethers.toUtf8Bytes("hello world")),
    specHash: overrides.specHash ?? ethers.keccak256(ethers.toUtf8Bytes("RFC8785_JCS_V1")),
    amount: overrides.amount ?? defaultAmount,
    bondAmount: overrides.bondAmount ?? defaultBond,
    deadline: overrides.deadline ?? timestamp + REVEAL_WINDOW + 3600, // 1 hour after minimum
  };
}

/**
 * Helper to approve tokens and create a task
 */
export async function createTask(
  escrow: any,
  mnee: any,
  requester: any,
  params: Awaited<ReturnType<typeof createTaskParams>>
) {
  // Approve escrow to spend requester's tokens
  await mnee.connect(requester).approve(await escrow.getAddress(), params.amount);

  // Create task
  const tx = await escrow.connect(requester).createTask(
    params.inputBytes,
    params.expectedOutputHash,
    params.specHash,
    params.amount,
    params.bondAmount,
    params.deadline
  );

  return tx;
}
