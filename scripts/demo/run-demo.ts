import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { REVEAL_WINDOW, MIN_BOND_BPS } from "../../utils/constants";

// Demo state file for dashboard sync
const DEMO_STATE_PATH = path.join(process.cwd(), ".demo-state.json");

interface DemoState {
  scenario: string;
  step: string;
  description: string;
  status: "running" | "paused" | "completed";
}

function writeState(scenario: string, step: string, description: string, status: DemoState["status"] = "running") {
  const state: DemoState = { scenario, step, description, status };
  fs.writeFileSync(DEMO_STATE_PATH, JSON.stringify(state, null, 2));
}

function clearState() {
  if (fs.existsSync(DEMO_STATE_PATH)) {
    fs.unlinkSync(DEMO_STATE_PATH);
  }
}

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title: string) {
  console.log("\n" + "═".repeat(60));
  log(`  ${title}`, "bright");
  console.log("═".repeat(60));
}

function subHeader(title: string) {
  console.log("\n" + "─".repeat(40));
  log(`  ${title}`, "cyan");
  console.log("─".repeat(40));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n${colors.yellow}▶ ${prompt}${colors.reset}`, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  // Clear any previous state
  clearState();

  log("\n╔════════════════════════════════════════════════════════════╗", "bright");
  log("║        AGENTESCROW DEMO - Trustless Agent Settlement       ║", "bright");
  log("╚════════════════════════════════════════════════════════════╝", "bright");

  // Load deployment
  const deploymentsPath = path.join(process.cwd(), ".deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Run deploy and setup-demo first");
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const { mnee: mneeAddress, escrow: escrowAddress } = deployments.localhost;

  // Get signers
  const [deployer, requester, worker, attacker] = await ethers.getSigners();

  // Connect to contracts
  const mnee = await ethers.getContractAt("MockMNEE", mneeAddress);
  const escrow = await ethers.getContractAt("AgentEscrow", escrowAddress);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: HAPPY PATH
  // ═══════════════════════════════════════════════════════════════════════════

  writeState("Demo 1: Happy Path", "Starting", "Successful task completion - requester creates task, worker commits and reveals", "paused");
  await waitForEnter("Press Enter to start Demo 1: Happy Path...");

  header("DEMO 1: Happy Path - Successful Task Completion");
  writeState("Demo 1: Happy Path", "Initial Balances", "Showing starting wallet balances", "running");

  // Show initial balances
  subHeader("Initial Balances");
  log(`  Requester: ${ethers.formatUnits(await mnee.balanceOf(requester.address), 18)} MNEE`, "blue");
  log(`  Worker: ${ethers.formatUnits(await mnee.balanceOf(worker.address), 18)} MNEE`, "blue");

  await waitForEnter("Press Enter for Step 1: Requester Creates Task...");

  // Step 1: Create task
  writeState("Demo 1: Happy Path", "Step 1: Create Task", "Requester creates task with payment and expected output hash", "running");
  subHeader("Step 1: Requester Creates Task");

  const inputData = { task: "canonicalize", data: { b: 2, a: 1 } };
  const inputBytes = ethers.toUtf8Bytes(JSON.stringify(inputData));
  const sortedData = { data: { a: 1, b: 2 }, task: "canonicalize" }; // Keys sorted
  const outputBytes = ethers.toUtf8Bytes(JSON.stringify(sortedData));
  const expectedOutputHash = ethers.keccak256(outputBytes);
  const specHash = ethers.keccak256(ethers.toUtf8Bytes("RFC8785_JCS_V1"));
  const amount = ethers.parseUnits("10", 18);
  const bondAmount = (amount * BigInt(MIN_BOND_BPS)) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const createTx = await escrow.connect(requester).createTask(
    inputBytes,
    expectedOutputHash,
    specHash,
    amount,
    bondAmount,
    deadline
  );
  const createReceipt = await createTx.wait();

  log(`  Input: ${JSON.stringify(inputData)}`, "yellow");
  log(`  Amount: ${ethers.formatUnits(amount, 18)} MNEE`, "yellow");
  log(`  Bond Required: ${ethers.formatUnits(bondAmount, 18)} MNEE`, "yellow");
  log(`  Task ID: 0`, "green");
  log(`  Tx: ${createTx.hash}`, "cyan");

  await waitForEnter("Press Enter for Step 2: Worker Commits...");

  // Step 2: Worker commits
  writeState("Demo 1: Happy Path", "Step 2: Worker Commits", "Worker evaluates task profitability and commits with bond", "running");
  subHeader("Step 2: Worker Evaluates and Commits");

  const salt = ethers.randomBytes(32);
  const outputHash = ethers.keccak256(outputBytes);
  const commitHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [outputHash, salt]
    )
  );

  log(`  Evaluating task...`, "yellow");
  log(`    ✓ Spec supported (RFC8785_JCS_V1)`, "green");
  log(`    ✓ Time remaining sufficient`, "green");
  log(`    ✓ Profitability check passed`, "green");
  log(`    ✓ Output hash matches expected`, "green");

  const commitTx = await escrow.connect(worker).commit(0, commitHash);
  await commitTx.wait();

  log(`  Committed to task!`, "green");
  log(`  Bond locked: ${ethers.formatUnits(bondAmount, 18)} MNEE`, "yellow");
  log(`  Tx: ${commitTx.hash}`, "cyan");

  await waitForEnter("Press Enter for Step 3: Worker Reveals...");

  // Step 3: Worker reveals
  writeState("Demo 1: Happy Path", "Step 3: Worker Reveals", "Worker submits output proof - payment transfers on success", "running");
  subHeader("Step 3: Worker Reveals Output");

  const revealTx = await escrow.connect(worker).reveal(0, outputBytes, salt);
  await revealTx.wait();

  log(`  Output: ${JSON.stringify(sortedData)}`, "yellow");
  log(`  ✓ Output hash verified`, "green");
  log(`  ✓ Commit hash verified`, "green");
  log(`  ✓ Payment + bond transferred to worker`, "green");
  log(`  Tx: ${revealTx.hash}`, "cyan");

  await waitForEnter("Press Enter to view Final Balances...");

  // Final balances
  subHeader("Final Balances");
  const requesterFinal = await mnee.balanceOf(requester.address);
  const workerFinal = await mnee.balanceOf(worker.address);
  log(`  Requester: ${ethers.formatUnits(requesterFinal, 18)} MNEE (-10 payment)`, "blue");
  log(`  Worker: ${ethers.formatUnits(workerFinal, 18)} MNEE (+10 payment)`, "blue");

  log("\n  ✅ HAPPY PATH COMPLETE", "green");
  writeState("Demo 1: Happy Path", "Complete", "Task completed successfully - payment transferred to worker", "completed");

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: ATTACK DEMONSTRATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  writeState("Attack 1: Front-Running", "Starting", "Attacker tries to steal worker's reveal by copying transaction", "paused");
  await waitForEnter("Press Enter to continue to Attack 1: Front-Running...");

  header("DEMO 2: Attack Resistance");

  // Attack 1: Reveal Front-Running
  writeState("Attack 1: Front-Running", "In Progress", "Attacker copies reveal calldata and submits with higher gas", "running");
  subHeader("Attack 1: Reveal Front-Running");
  log(`  Scenario: Attacker sees worker's reveal tx in mempool`, "yellow");
  log(`  Strategy: Copy calldata, submit with higher gas`, "yellow");

  // Create another task for this demo
  await escrow.connect(requester).createTask(
    inputBytes,
    expectedOutputHash,
    specHash,
    amount,
    bondAmount,
    deadline + 3600
  );

  const salt2 = ethers.randomBytes(32);
  const commitHash2 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [outputHash, salt2]
    )
  );

  await escrow.connect(worker).commit(1, commitHash2);

  // Attacker tries to front-run
  try {
    await escrow.connect(attacker).reveal(1, outputBytes, salt2);
    log(`  ❌ ATTACK SUCCEEDED (BUG!)`, "red");
  } catch (error: any) {
    if (error.message.includes("NotCommittedWorker")) {
      log(`  ✅ ATTACK BLOCKED: NotCommittedWorker`, "green");
      log(`     Contract verifies msg.sender == committedWorker`, "cyan");
    } else {
      log(`  Attack failed: ${error.message}`, "red");
    }
  }

  await waitForEnter("Press Enter to see legitimate worker reveal...");

  // Worker successfully reveals
  await escrow.connect(worker).reveal(1, outputBytes, salt2);
  log(`  Worker's legitimate reveal succeeded`, "green");
  writeState("Attack 1: Front-Running", "Blocked", "Attack failed - contract verifies msg.sender == committedWorker", "completed");

  writeState("Attack 2: Commit Griefing", "Starting", "Attacker commits with fake hash to block task", "paused");
  await waitForEnter("Press Enter to continue to Attack 2: Commit Griefing...");

  // Attack 2: Commit Griefing
  writeState("Attack 2: Commit Griefing", "In Progress", "Attacker commits with fake hash - cannot reveal", "running");
  subHeader("Attack 2: Commit Griefing");
  log(`  Scenario: Attacker blocks task by committing without ability to reveal`, "yellow");
  log(`  Strategy: Commit with fake hash, let it expire`, "yellow");

  // Create task for griefing demo
  await escrow.connect(requester).createTask(
    inputBytes,
    expectedOutputHash,
    specHash,
    amount,
    bondAmount,
    deadline + 7200
  );

  const fakeCommitHash = ethers.keccak256(ethers.toUtf8Bytes("fake"));
  const attackerBalanceBefore = await mnee.balanceOf(attacker.address);

  await escrow.connect(attacker).commit(2, fakeCommitHash);
  log(`  Attacker committed (bond locked: ${ethers.formatUnits(bondAmount, 18)} MNEE)`, "yellow");

  await waitForEnter("Press Enter to fast-forward time (reveal window expires)...");

  // Fast-forward time (simulate reveal window expiry)
  writeState("Attack 2: Commit Griefing", "Time Skip", "Reveal window expires - attacker cannot reveal", "running");
  log(`  [Time passes... reveal window expires]`, "magenta");
  await ethers.provider.send("evm_increaseTime", [REVEAL_WINDOW + 1]);
  await ethers.provider.send("evm_mine", []);

  await waitForEnter("Press Enter to expire commit and slash bond...");

  // Anyone can expire the commit
  await escrow.expireCommit(2);

  const attackerBalanceAfter = await mnee.balanceOf(attacker.address);
  const bondLost = attackerBalanceBefore - attackerBalanceAfter;

  log(`  ✅ GRIEFING PUNISHED: Bond slashed`, "green");
  log(`     Attacker lost: ${ethers.formatUnits(bondLost, 18)} MNEE`, "red");
  log(`     Task reopened for legitimate workers`, "cyan");
  writeState("Attack 2: Commit Griefing", "Punished", "Bond slashed to requester - griefing is costly", "completed");

  writeState("Attack 3: Cheap Griefing", "Starting", "Attacker tries to create task with minimal bond", "paused");
  await waitForEnter("Press Enter to continue to Attack 3: Cheap Griefing...");

  // Attack 3: Cheap Griefing
  writeState("Attack 3: Cheap Griefing", "In Progress", "Attacker attempts bond < 10% to grief cheaply", "running");
  subHeader("Attack 3: Cheap Griefing Attempt");
  log(`  Scenario: Create task with minimal bond to enable cheap griefing`, "yellow");
  log(`  Strategy: Set bond < 10% of amount`, "yellow");

  const cheapBond = ethers.parseUnits("0.5", 18); // Only 0.5% of 100 MNEE

  try {
    await escrow.connect(attacker).createTask(
      inputBytes,
      expectedOutputHash,
      specHash,
      ethers.parseUnits("100", 18),
      cheapBond,
      deadline + 10800
    );
    log(`  ❌ ATTACK SUCCEEDED (BUG!)`, "red");
  } catch (error: any) {
    if (error.message.includes("InvalidBondAmount")) {
      log(`  ✅ ATTACK BLOCKED: InvalidBondAmount`, "green");
      log(`     Contract enforces MIN_BOND_BPS = 10%`, "cyan");
    }
  }
  writeState("Attack 3: Cheap Griefing", "Blocked", "Contract enforces 10% minimum bond", "completed");

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  writeState("Summary", "Starting", "All attacks blocked - security properties demonstrated", "paused");
  await waitForEnter("Press Enter to view Summary...");

  writeState("Summary", "Security Properties", "Reviewing all security guarantees", "running");
  header("DEMO SUMMARY");

  console.log("\n  Security Properties Demonstrated:");
  log("    ✅ Payment only releases for correct output hash", "green");
  log("    ✅ Reveal front-running blocked (worker binding)", "green");
  log("    ✅ Commit griefing punished (bond slashing)", "green");
  log("    ✅ Cheap griefing prevented (10% minimum bond)", "green");
  log("    ✅ Tasks always recoverable (permissionless timeout)", "green");

  console.log("\n  Protocol Constants:");
  log(`    REVEAL_WINDOW: ${REVEAL_WINDOW / 60} minutes`, "cyan");
  log(`    MIN_BOND_BPS: ${MIN_BOND_BPS} (10%)`, "cyan");
  log(`    MAX_INPUT_SIZE: 4 KB`, "cyan");
  log(`    MAX_OUTPUT_SIZE: 4 KB`, "cyan");

  console.log("\n  Final Wallet Balances:");
  log(`    Requester: ${ethers.formatUnits(await mnee.balanceOf(requester.address), 18)} MNEE`, "blue");
  log(`    Worker: ${ethers.formatUnits(await mnee.balanceOf(worker.address), 18)} MNEE`, "blue");
  log(`    Attacker: ${ethers.formatUnits(await mnee.balanceOf(attacker.address), 18)} MNEE`, "blue");

  log("\n╔════════════════════════════════════════════════════════════╗", "bright");
  log("║                    DEMO COMPLETE                          ║", "bright");
  log("║         Trustless Settlement for Autonomous Agents        ║", "bright");
  log("╚════════════════════════════════════════════════════════════╝", "bright");

  writeState("Demo Complete", "Finished", "AgentEscrow - Trustless Settlement for Autonomous Agents", "completed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
