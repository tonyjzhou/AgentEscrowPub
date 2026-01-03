# AgentEscrow

**Bonded commit-reveal escrow primitive for trustless settlement between autonomous agents.**

> The "HTLC for agent services" — where Hash Time-Locked Contracts enabled atomic swaps for payments, AgentEscrow enables atomic settlement for computation.

## Overview

AgentEscrow is a smart contract system that enables trustless settlement between autonomous agents for deterministically verifiable outputs. Key features:

- **Trustless Settlement**: Payment releases IFF output hash matches expectation
- **Theft Resistance**: Zero successful front-running attacks
- **Grief Resistance**: Griefing costs attacker more than victim (10% minimum bond)
- **Liveness**: Blocked tasks can always be recovered

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests (89 tests)
npm test

# Start local node
npm run node

# In another terminal: deploy and setup demo
npm run deploy:local
npm run setup-demo

# Run the demo
npm run demo
```

## Project Structure

```
contracts/
├── AgentEscrow.sol      # Main escrow contract
└── mocks/
    └── MockMNEE.sol     # Test ERC-20 token

scripts/
├── deploy.ts            # Deployment script
├── setup-demo.ts        # Demo wallet setup
├── demo/
│   └── run-demo.ts      # Full demo script
└── agents/
    ├── worker.ts        # Agent B (Worker)
    ├── requester.ts     # Agent A (Requester)
    └── attacker.ts      # Attack demonstrations

test/
├── AgentEscrow.test.ts  # Core function tests
├── timing.test.ts       # Timing boundary tests
├── state-machine.test.ts # State transition tests
├── attacks.test.ts      # Attack scenario tests
└── encoding.test.ts     # Hash encoding tests

dashboard/
└── index.html           # Monitoring dashboard

utils/
├── constants.ts         # Protocol constants
├── encoding.ts          # Hash utilities
└── canonicalize.ts      # RFC 8785 JCS
```

## Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `REVEAL_WINDOW` | 10 minutes | Time for worker to reveal after commit |
| `MIN_BOND_BPS` | 1000 (10%) | Minimum bond as % of payment |
| `MAX_INPUT_SIZE` | 4 KB | Maximum input bytes |
| `MAX_OUTPUT_SIZE` | 4 KB | Maximum output bytes |

## How It Works

### Task Flow

```
1. Requester creates task with:
   - Input bytes
   - Expected output hash (they know the answer)
   - Payment amount + required bond
   - Deadline

2. Worker evaluates task:
   - Checks spec support
   - Verifies timing
   - Computes output locally
   - Verifies output hash matches

3. Worker commits:
   - Posts commitHash = keccak256(outputHash, salt)
   - Locks bond

4. Worker reveals:
   - Submits actual output + salt
   - Contract verifies hashes
   - Payment + bond transferred to worker

5. If worker fails to reveal:
   - Anyone can call expireCommit()
   - Bond slashed to requester
   - Task reopens for other workers
```

### State Machine

```
  OPEN → COMMITTED → COMPLETED
    │         │
    │         └──→ OPEN (expireCommit, bond slashed)
    │
    └──→ REFUNDED (claimTimeout after deadline)
```

## Security Properties

| Attack | Protection |
|--------|------------|
| Reveal Front-Running | `msg.sender == committedWorker` check |
| Commit Griefing | Bond slashing on expiry |
| Deadline Rug | Reveal window protection |
| Cheap Griefing | 10% minimum bond enforcement |
| Size DoS | 4KB input/output limits |

## Running the Demo

The demo showcases:
1. **Happy Path**: Successful task completion
2. **Attack Resistance**:
   - Reveal front-running blocked
   - Commit griefing punished
   - Cheap griefing prevented

```bash
# Terminal 1: Start Hardhat node
npm run node

# Terminal 2: Deploy and run demo
npm run deploy:local
npm run setup-demo
npm run demo
```

## Dashboard

Open `dashboard/index.html` in a browser to monitor:
- Task states (OPEN/COMMITTED/COMPLETED/REFUNDED)
- Wallet balances
- Real-time event log

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx hardhat test test/attacks.test.ts

# Run with gas reporting
REPORT_GAS=true npm test

# Run with coverage
npm run test:coverage
```

## Contract Interface

```solidity
interface IAgentEscrow {
    // Create a new task
    function createTask(
        bytes calldata inputBytes,
        bytes32 expectedOutputHash,
        bytes32 specHash,
        uint256 amount,
        uint256 bondAmount,
        uint256 deadline
    ) external returns (uint256 taskId);

    // Commit to completing a task
    function commit(uint256 taskId, bytes32 commitHash) external;

    // Reveal output and claim payment
    function reveal(
        uint256 taskId,
        bytes calldata outputBytes,
        bytes32 salt
    ) external;

    // Expire a stale commit (anyone can call)
    function expireCommit(uint256 taskId) external;

    // Claim timeout for expired task (anyone can call)
    function claimTimeout(uint256 taskId) external;
}
```

## Canonicalization (RFC 8785)

For deterministic JSON hashing across agents, we use RFC 8785 JSON Canonicalization Scheme (JCS):

```typescript
import { canonicalizeJSON, computeJCSHash } from "./utils/canonicalize";

const input = { b: 2, a: 1 };
const canonical = canonicalizeJSON(input); // '{"a":1,"b":2}'
const hash = computeJCSHash(input); // keccak256 of canonical form
```

## License

MIT
