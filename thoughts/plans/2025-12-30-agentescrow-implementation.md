# AgentEscrow Implementation Plan

## Overview

Implement the AgentEscrow bonded commit-reveal escrow primitive for trustless settlement between autonomous agents. This is a hackathon project (MNEE) requiring a Solidity smart contract, TypeScript agents, comprehensive tests, and a demo dashboard.

## Current State

- **Existing:** PRD.md (comprehensive), .gitignore (Hardhat setup)
- **Missing:** All implementation code
- **Framework Decision:** Hardhat with TypeScript (per PRD §14.1 Q9)
- **Target:** Local Hardhat network + Sepolia testnet

## Desired End State

- Deployed AgentEscrow contract with full functionality
- Agent A (Requester) and Agent B (Worker) TypeScript scripts
- Attacker demo script showing blocked attacks
- Web dashboard for monitoring
- Comprehensive test suite including attack scenarios
- Demo-ready with scripted 3:15 presentation flow

## NOT Doing (Explicit Exclusions from PRD §3.2)

- On-chain computation verification
- Reputation systems
- Multi-worker coordination
- Cross-chain settlement
- Data confidentiality (inputs/outputs are PUBLIC)
- Keeper bounties for claimTimeout
- Historical event backfill on worker restart (online-only mode)
- Blockchain reorg handling (out of scope for MVP)

## Complexity: Medium-Complex | Confidence: High

Research completed on all key technical areas. Clear PRD with well-defined requirements.

---

## Timing Model (Critical)

**Definition:** `revealDeadline = commitTime + REVEAL_WINDOW` (NOT deadline)

```
Timeline for a task:

T0: createTask(deadline=T0+X where X > REVEAL_WINDOW)
    └── Task in OPEN state
    └── Constraint: deadline > block.timestamp + REVEAL_WINDOW

T1: commit() where T1 < deadline - REVEAL_WINDOW (STRICT <)
    └── revealDeadline = T1 + REVEAL_WINDOW
    └── Task in COMMITTED state
    └── Invariant: revealDeadline < deadline (guaranteed by strict <)

T2: reveal() where T2 <= revealDeadline
    └── Task in COMPLETED state

OR

T3: expireCommit() where revealDeadline < T3 <= deadline
    └── Task back to OPEN state (bond slashed)
    └── Gap between revealDeadline and deadline allows multiple commit cycles

OR

T4: claimTimeout() where T4 > deadline
    └── If COMMITTED: also requires T4 > revealDeadline (deadline rug protection)
    └── Task in REFUNDED state
```

**Why `revealDeadline = commitTime + REVEAL_WINDOW`:**
- Workers get exactly REVEAL_WINDOW time to reveal after committing
- Early commits don't extend reveal window to deadline
- Allows task reopening via expireCommit if worker fails
- Multiple commit/expire cycles possible before deadline

---

## State Machine (Critical)

```
Valid Transitions:
  OPEN       → COMMITTED  (via commit)
  COMMITTED  → OPEN       (via expireCommit, bond slashed)
  COMMITTED  → COMPLETED  (via reveal)
  OPEN       → REFUNDED   (via claimTimeout after deadline)
  COMMITTED  → REFUNDED   (via claimTimeout after deadline AND revealDeadline)

Terminal States: COMPLETED, REFUNDED (no further transitions)

Invalid Transitions (must revert):
  COMPLETED  → any
  REFUNDED   → any
  OPEN       → COMPLETED  (can't reveal without commit)
  OPEN       → expireCommit (nothing to expire)
  COMMITTED  → COMMITTED  (can't commit twice)
```

---

## Phase 1: Project Setup & Core Contract

### 1.1 Initialize Hardhat TypeScript Project

**Changes:**
- `package.json` - Dependencies: hardhat, @nomicfoundation/hardhat-toolbox, @openzeppelin/contracts, ethers v6, typechain, canonicalize, dotenv
- `hardhat.config.ts` - Solidity ^0.8.19, networks (hardhat, localhost, sepolia), typechain config
- `tsconfig.json` - Path aliases (@utils/*, @contracts/*), strict mode
- `.env.example` - Template for SEPOLIA_RPC_URL, PRIVATE_KEY

**Success (Automated):** `npx hardhat compile` succeeds

### 1.2 Implement AgentEscrow.sol

**File:** `contracts/AgentEscrow.sol`

**Implementation:**
```
Contract Structure:
├── Constants: REVEAL_WINDOW (10 min), MIN_BOND_BPS (1000), MAX_INPUT_SIZE (4096), MAX_OUTPUT_SIZE (4096)
├── Enums: TaskState { OPEN, COMMITTED, COMPLETED, REFUNDED }
├── Structs: Task (requester, inputHash, expectedOutputHash, specHash, amount, bondAmount, deadline, state, committedWorker, commitHash, revealDeadline)
├── State: tasks mapping, nextTaskId counter, mnee token address
├── Events: TaskCreated, TaskCommitted, TaskCompleted, TaskRefunded, CommitExpired
├── Functions:
│   ├── constructor(address _mnee)
│   ├── createTask(bytes inputBytes, bytes32 expectedOutputHash, bytes32 specHash, uint256 amount, uint256 bondAmount, uint256 deadline) → taskId
│   ├── commit(uint256 taskId, bytes32 commitHash)
│   ├── reveal(uint256 taskId, bytes outputBytes, bytes32 salt)
│   ├── expireCommit(uint256 taskId)
│   └── claimTimeout(uint256 taskId)
└── Modifiers: Uses ReentrancyGuard, SafeERC20
```

**Critical Implementation Details:**

| Function | Timing Check | State Check |
|----------|--------------|-------------|
| createTask | `deadline > block.timestamp + REVEAL_WINDOW` | N/A (creates new) |
| commit | `block.timestamp < deadline - REVEAL_WINDOW` (strict `<`) | `state == OPEN` |
| reveal | `block.timestamp <= revealDeadline` | `state == COMMITTED`, `msg.sender == committedWorker` |
| expireCommit | `block.timestamp > revealDeadline && block.timestamp <= deadline` | `state == COMMITTED` |
| claimTimeout | `block.timestamp > deadline` (+ `> revealDeadline` if COMMITTED) | `state == OPEN \|\| state == COMMITTED` |

**revealDeadline Assignment (in commit):**
```solidity
task.revealDeadline = block.timestamp + REVEAL_WINDOW;
```

**Success (Automated):** `npx hardhat compile` succeeds with no warnings

### 1.3 Implement MockMNEE.sol (Test Token)

**File:** `contracts/mocks/MockMNEE.sol`

Simple ERC-20 token with mint function for testing. Follows OpenZeppelin ERC20 pattern.

**Success (Automated):** Contract compiles, can mint and transfer tokens

---

## Phase 2: Test Suite

### 2.1 Shared Test Utilities

**Files:**
- `utils/constants.ts` - Protocol constants matching contract
- `utils/encoding.ts` - Hash computation helpers (keccak256, abi.encode)
- `utils/canonicalize.ts` - RFC 8785 JCS wrapper with test vectors
- `test/fixtures/index.ts` - Deployment fixture with funded wallets

**Key Utility Functions:**
```typescript
// utils/encoding.ts
computeOutputHash(outputBytes: string): string
computeCommitHash(outputHash: string, salt: string): string
generateSalt(): string

// utils/canonicalize.ts
canonicalizeJSON(obj: object): string
computeJCSHash(obj: object): string
```

**Success (Automated):** TypeScript compiles, utilities are importable

### 2.2 Core Function Tests

**File:** `test/AgentEscrow.test.ts`

**Test Cases:**
```
describe("createTask")
  ✓ creates task with valid parameters
  ✓ stores correct inputHash from inputBytes
  ✓ transfers MNEE from requester to contract
  ✓ emits TaskCreated event with inputBytes
  ✓ reverts if amount is 0
  ✓ reverts if bondAmount < 10% of amount (MIN_BOND_BPS)
  ✓ reverts if deadline <= block.timestamp + REVEAL_WINDOW
  ✓ reverts if inputBytes > MAX_INPUT_SIZE (4KB)
  ✓ reverts if insufficient MNEE allowance  ← NEW

describe("commit")
  ✓ commits to OPEN task
  ✓ transfers bond from worker
  ✓ sets revealDeadline = block.timestamp + REVEAL_WINDOW  ← EXPLICIT
  ✓ emits TaskCommitted event
  ✓ reverts if task not OPEN
  ✓ reverts if block.timestamp >= deadline - REVEAL_WINDOW (strict <)
  ✓ reverts if insufficient MNEE allowance

describe("reveal")
  ✓ reveals matching output, transfers payment + bond to worker
  ✓ emits TaskCompleted with outputBytes
  ✓ reverts if msg.sender != committedWorker (front-run protection)
  ✓ reverts if block.timestamp > revealDeadline
  ✓ reverts if commitHash doesn't match
  ✓ reverts if outputHash != expectedOutputHash
  ✓ reverts if outputBytes > MAX_OUTPUT_SIZE (4KB)

describe("expireCommit")
  ✓ slashes bond to requester after revealDeadline
  ✓ resets task to OPEN state
  ✓ clears committedWorker, commitHash, revealDeadline
  ✓ reverts if within reveal window (block.timestamp <= revealDeadline)
  ✓ reverts if after deadline (block.timestamp > deadline)

describe("claimTimeout")
  ✓ refunds requester after deadline (OPEN task)
  ✓ refunds requester + slashes bond after deadline (COMMITTED task)
  ✓ callable by anyone (permissionless)
  ✓ sends funds to requester, not msg.sender
  ✓ reverts if deadline not passed
  ✓ reverts if COMMITTED and revealDeadline not passed (deadline rug protection)
```

**Success (Automated):** `npx hardhat test` passes all tests

### 2.3 Boundary Timestamp Tests (NEW)

**File:** `test/timing.test.ts`

**Test Cases:**
```
describe("Timing Boundaries")

  describe("commit cutoff (strict <)")
    ✓ REVERTS at exactly deadline - REVEAL_WINDOW
    ✓ PASSES at deadline - REVEAL_WINDOW - 1 second

  describe("reveal deadline (<=)")
    ✓ PASSES at exactly revealDeadline
    ✓ REVERTS at revealDeadline + 1 second

  describe("expireCommit window")
    ✓ REVERTS at exactly revealDeadline (must be >)
    ✓ PASSES at revealDeadline + 1 second
    ✓ PASSES at exactly deadline
    ✓ REVERTS at deadline + 1 second (use claimTimeout)

  describe("claimTimeout")
    ✓ REVERTS at exactly deadline (must be >)
    ✓ PASSES at deadline + 1 second (OPEN task)
    ✓ PASSES at deadline + 1 second when revealDeadline already passed (COMMITTED)
    ✓ REVERTS at deadline + 1 second when revealDeadline NOT passed (COMMITTED, deadline rug)

  describe("timing invariant")
    ✓ revealDeadline < deadline always holds (due to strict < in commit)
```

**Success (Automated):** All timing boundary tests pass

### 2.4 State Machine Tests (NEW)

**File:** `test/state-machine.test.ts`

**Test Cases:**
```
describe("State Transitions")

  describe("valid transitions")
    ✓ OPEN → COMMITTED (commit)
    ✓ COMMITTED → OPEN (expireCommit)
    ✓ COMMITTED → COMPLETED (reveal)
    ✓ OPEN → REFUNDED (claimTimeout)
    ✓ COMMITTED → REFUNDED (claimTimeout after both deadlines)

  describe("invalid transitions from COMPLETED")
    ✓ COMPLETED → reveal() REVERTS "Task not committed"
    ✓ COMPLETED → commit() REVERTS "Task not open"
    ✓ COMPLETED → expireCommit() REVERTS "Task not committed"
    ✓ COMPLETED → claimTimeout() REVERTS "Task already finalized"

  describe("invalid transitions from REFUNDED")
    ✓ REFUNDED → reveal() REVERTS "Task not committed"
    ✓ REFUNDED → commit() REVERTS "Task not open"
    ✓ REFUNDED → expireCommit() REVERTS "Task not committed"
    ✓ REFUNDED → claimTimeout() REVERTS "Task already finalized"

  describe("invalid transitions from OPEN")
    ✓ OPEN → reveal() REVERTS "Task not committed"
    ✓ OPEN → expireCommit() REVERTS "Task not committed"

  describe("invalid transitions from COMMITTED")
    ✓ COMMITTED → commit() REVERTS "Task not open"

  describe("idempotency / double-action")
    ✓ reveal() twice on same task → second REVERTS
    ✓ expireCommit() twice on same task → second REVERTS (now OPEN)
    ✓ claimTimeout() twice on same task → second REVERTS
```

**Success (Automated):** All state machine tests pass

### 2.5 Attack Scenario Tests

**File:** `test/attacks.test.ts`

**Test Cases:**
```
describe("Attack: Reveal Front-Running")
  ✓ attacker copying reveal calldata reverts with "Not the committed worker"

describe("Attack: Commit Griefing")
  ✓ griefer loses bond when commit expires
  ✓ original task reopens for legitimate workers

describe("Attack: Deadline Rug")
  ✓ requester cannot claimTimeout during reveal window

describe("Attack: Cheap Griefing")
  ✓ cannot create task with bond < 10% of amount

describe("Attack: Size DoS")
  ✓ cannot submit input > 4KB
  ✓ cannot reveal output > 4KB

describe("Attack: Timing Edge Case")
  ✓ cannot commit at exactly deadline - REVEAL_WINDOW
```

**Success (Automated):** All attack tests pass

### 2.6 Encoding Verification Tests (Critical for Risk R1)

**File:** `test/encoding.test.ts`

**Test Cases:**
```
describe("JS ↔ Solidity Hash Verification")
  ✓ inputHash matches: JS keccak256(inputBytes) === Solidity keccak256(inputBytes)
  ✓ outputHash matches: JS keccak256(outputBytes) === Solidity keccak256(outputBytes)
  ✓ commitHash matches: JS keccak256(abi.encode(outputHash, salt)) === Solidity keccak256(abi.encode(outputHash, salt))

describe("RFC 8785 JCS Canonicalization")
  ✓ canonicalize produces RFC 8785 compliant output
  ✓ key ordering follows UTF-16 code unit sorting
  ✓ number formatting matches spec (no trailing zeros, proper exponents)
  ✓ cross-agent hash verification for identical logical objects
```

**Success (Automated):** All encoding tests pass

---

## Phase 3: Agent Scripts

### 3.1 Shared Agent Utilities

**Files:**
- `scripts/agents/lib/config.ts` - Environment config, contract addresses
- `scripts/agents/lib/contracts.ts` - Type-safe contract getters
- `scripts/agents/lib/events.ts` - Event listener helpers
- `scripts/agents/lib/encoding.ts` - Re-export from utils/
- `scripts/agents/lib/persistence.ts` - Salt storage (NEW)

**Event Handling Notes:**
- Input/output bytes exist ONLY in event logs (calldata), not in contract storage
- Agents must index events to reconstruct task data
- For Sepolia: wait 2 confirmations before processing events
- For local Hardhat: instant finality, no confirmation wait needed

### 3.2 Agent B (Worker) - Critical Path

**File:** `scripts/agents/worker.ts`

**Implementation Flow:**
```
1. Listen for TaskCreated events (live only, no backfill)
2. For each task, evaluate:
   a. specHash ∈ KNOWN_SPECS (RFC8785_JCS_V1)
   b. block.timestamp < deadline - REVEAL_WINDOW - buffer
   c. amount - estimatedGasCost > MIN_PROFIT
   d. Compute local output from inputBytes (from event)
   e. Verify keccak256(localOutput) == expectedOutputHash
3. If all pass:
   a. Generate random salt
   b. Compute commitHash = keccak256(abi.encode(outputHash, salt))
   c. PERSIST salt to file BEFORE commit (crash safety)
   d. Approve bond + call commit()
   e. Call reveal(outputBytes, salt)
   f. On success: remove salt from persistence
4. Handle errors gracefully (log, continue)
```

**Salt Persistence (NEW):**
```typescript
// File: data/worker-state.json
interface WorkerState {
  pendingReveals: {
    [taskId: string]: {
      salt: string;
      outputBytes: string;
      commitHash: string;
      committedAt: number;
      revealDeadline: number;
    }
  }
}

// Write salt BEFORE commit tx
// Delete entry AFTER successful reveal
// On crash: manual recovery possible via file inspection
```

**Limitation (Documented):** Online-only mode. If worker restarts:
- Loses live event stream
- Must manually check `data/worker-state.json` for pending reveals
- No automatic backfill of missed TaskCreated events

**Configuration:**
```typescript
interface WorkerConfig {
  minProfitMargin: bigint;      // Minimum profit in MNEE after gas
  supportedSpecs: string[];     // [keccak256("RFC8785_JCS_V1")]
  commitBuffer: number;         // Seconds buffer (default: 60)
  gasEstimateMultiplier: number; // Safety margin (default: 1.2)
  confirmations: number;        // 0 for local, 2 for Sepolia
}
```

**Success (Manual):** Worker correctly evaluates, commits, and reveals tasks on local network

### 3.3 Agent A (Requester)

**File:** `scripts/agents/requester.ts`

**Implementation Flow:**
```
1. Prepare input data
2. Compute expected output (for demo: simple JCS canonicalization)
3. Compute expectedOutputHash = keccak256(canonicalize(output))
4. Set specHash = keccak256("RFC8785_JCS_V1")
5. Approve tokens + call createTask()
6. Listen for TaskCompleted or timeout
7. If timeout, call claimTimeout()
```

**Success (Manual):** Requester creates tasks and receives completion events

### 3.4 Attacker Script (Demo)

**File:** `scripts/agents/attacker.ts`

**Demo Scenarios:**
```
1. attemptRevealFrontRun(taskId, revealTx)
   - Copy reveal calldata from pending tx
   - Submit with higher gas
   - Show revert: "Not the committed worker"

2. attemptCommitGrief(taskId)
   - Front-run legitimate commit
   - Wait for expireCommit
   - Show bond slashed

3. attemptDeadlineRug(taskId)
   - As requester, try claimTimeout during reveal window
   - Show revert: "Reveal window still active"
```

**Success (Manual):** All attacks visibly fail with expected errors

---

## Phase 4: Dashboard

### 4.1 Dashboard Implementation

**File:** `dashboard/index.html` (single file, vanilla JS per PRD §14.2 Q8)

**Features:**
- Task list with state visualization (color-coded: OPEN=blue, COMMITTED=yellow, COMPLETED=green, REFUNDED=red)
- Real-time updates via event subscription
- Wallet balances for demo wallets (Agent A, Agent B, Attacker)
- Transaction log with block explorer links
- Bond status (locked/slashed/returned)

**Event Indexing Note:**
- Dashboard reconstructs task data from events
- Must listen to TaskCreated for inputBytes
- Must listen to TaskCompleted for outputBytes
- Store event data in memory for display

**Tech Stack:**
- Vanilla HTML/CSS/JS
- ethers.js v6 (CDN)
- Connect to local Hardhat network or Sepolia

**Success (Manual):** Dashboard displays tasks, updates in real-time, shows balances

---

## Phase 5: Deployment & Demo

### 5.1 Deployment Scripts

**Files:**
- `scripts/deploy.ts` - Deploy MockMNEE + AgentEscrow
- `scripts/setup-demo.ts` - Fund demo wallets, approve tokens

**Output:** `.deployments.json` with contract addresses

### 5.2 Demo Script (3:15 Presentation)

**File:** `scripts/demo/run-demo.ts`

**Sequence:**
```
[0:00-0:30] Introduction + Architecture Overview
[0:30-1:30] Happy Path Demo
  - Requester creates task
  - Worker evaluates, commits, reveals
  - Payment transfers

[1:30-2:30] Attack Demonstrations
  - Reveal front-run blocked
  - Commit grief punished
  - Deadline rug blocked

[2:30-3:15] Conclusion + Q&A Setup
```

### 5.3 Documentation

**Files:**
- `README.md` - Project overview, quick start
- `docs/DEPLOYMENT.md` - Deployment instructions
- `docs/DEMO.md` - Demo script walkthrough

---

## Risks & Mitigations

| Risk | Mitigation | Status |
|------|------------|--------|
| R1: Encoding mismatch (JS↔Solidity) | test/encoding.test.ts with cross-verification | Phase 2.6 |
| R2: Gas estimation wrong | Conservative estimates + configurable margin | Phase 3.2 |
| R3: Demo timing issues | Pre-mined Hardhat blocks; Sepolia backup | Phase 5.2 |
| R4: Event indexing delay | Polling fallback for agents | Phase 3.1 |
| R5: Timing edge cases | Explicit boundary tests in test/timing.test.ts | Phase 2.3 |
| R6: State machine bugs | Comprehensive state transition tests | Phase 2.4 |
| R7: Salt loss on crash | Persist to JSON before commit | Phase 3.2 |

---

## Dependencies Between Phases

```
Phase 1 (Setup + Contract)
    ↓
Phase 2 (Tests) ← validates Phase 1
    ↓
Phase 3 (Agents) ← uses utils from Phase 2
    ↓
Phase 4 (Dashboard) ← uses contracts from Phase 1
    ↓
Phase 5 (Demo) ← integrates all phases
```

---

## Implementation Order Summary

1. **Phase 1.1-1.3:** Project setup + contracts (~2h)
2. **Phase 2.1-2.6:** Test utilities + full test suite (~4h, +1h for timing/state tests)
3. **Phase 3.2:** Agent B (Worker) - critical path (~2.5h, +0.5h for persistence)
4. **Phase 3.3:** Agent A (Requester) (~1h)
5. **Phase 3.4:** Attacker script (~1h)
6. **Phase 4.1:** Dashboard (~2h)
7. **Phase 5.1-5.3:** Deployment + demo prep (~2h)

**Total Estimated:** ~15-17 hours of focused implementation

---

## References

- PRD: `PRD.md`
- Contract Interface: PRD §9.1
- Agent Interface: PRD §9.2
- Security Requirements: PRD §10
- Test Vectors: PRD §15.2
