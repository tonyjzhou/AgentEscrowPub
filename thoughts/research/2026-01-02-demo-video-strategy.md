# Research: Demo Video Strategy for Hackathon Judges

**Date:** 2026-01-02
**Query:** Best action steps for creating a 5-minute demo video
**Scope:** Demo scripts, agent behavior, contract interactions, dashboard
**Depth:** standard

## Summary

AgentEscrow has comprehensive demo infrastructure ready for video production. The challenge is condensing the full demo suite (happy path + 4 attack scenarios + autonomous agents) into a 5-minute format that clearly communicates value to hackathon judges. Recommended approach: 90-second problem statement + 2.5-minute live demo + 90-second technical highlights.

## Key Findings

### Available Demo Components

| Component | Purpose | Video Value | Time Budget |
|-----------|---------|-------------|-------------|
| `npm run demo` | Full automated demo (happy path + 3 attacks) | High - shows everything works | 2-3 min |
| Dashboard (`dashboard/index.html`) | Real-time visual monitoring | Critical - non-technical comprehension | Constant overlay |
| Worker Agent | Autonomous decision-making | Medium - shows AI/agent angle | 20-30 sec |
| Attacker Agent | Security proof | High - differentiator from competitors | 45-60 sec |
| Contract code | Technical credibility | Low - judges won't read code | Skip or <10 sec |

### Recommended 5-Minute Structure

**SEGMENT 1: Hook & Problem (0:00-1:30)**
- **0:00-0:20** - One-sentence pitch + visual hook
  - "AgentEscrow: The HTLC for AI agent services - trustless settlement without oracles"
  - Show dashboard with live task flow animation
- **0:20-1:00** - Problem statement (WHY this matters)
  - Current state: Agents can't pay each other trustlessly
  - 3 unsolved attacks: reveal front-running, commit griefing, deadline rugging
  - Use case: Agent A needs computation from Agent B, can't trust escrow
- **1:00-1:30** - Solution overview (HOW it works)
  - Commit-reveal protocol
  - Bond slashing for griefing resistance
  - Known output hash enables trustless verification

**SEGMENT 2: Live Demo (1:30-4:00)**
- **1:30-2:30** - Happy Path (60 seconds)
  - Terminal: `npm run demo` (pre-recorded or live)
  - Show dashboard side-by-side
  - Narrate: "Requester creates task → Worker evaluates profitability → Worker commits bond → Worker reveals output → Payment transfers"
  - Highlight balance changes in real-time
  - Pause briefly on key events: TaskCreated, TaskCommitted, TaskCompleted

- **2:30-3:30** - Attack Demonstrations (60 seconds)
  - **Attack 1 - Reveal Front-Running (20 sec):**
    - Attacker tries to copy reveal transaction
    - Contract blocks with `NotCommittedWorker` error
    - Show failed transaction + attacker wasted gas
  - **Attack 2 - Commit Griefing (20 sec):**
    - Attacker commits with fake hash
    - Time-lapse: reveal window expires
    - Contract slashes bond to requester
    - Show attacker lost 10% of task value
  - **Attack 3 - Cheap Griefing (20 sec):**
    - Attacker tries to create task with 1% bond
    - Contract rejects with `InvalidBondAmount`
    - Explain: 10% minimum makes griefing unprofitable

- **3:30-4:00** - Autonomous Agent (30 seconds)
  - Switch to terminal with Worker Agent running
  - Show live decision-making:
    - Task appears
    - Worker evaluates: "Checking profitability... margin: 15% ✓"
    - Worker accepts and commits
  - Explain: "Worker autonomously evaluates tasks based on gas costs, timing, and profit margins"

**SEGMENT 3: Technical Highlights & CTA (4:00-5:00)**
- **4:00-4:30** - Why This Matters (differentiation)
  - "First bonded commit-reveal escrow for agent-to-agent settlement"
  - "All 4 major attack vectors blocked with economic incentives, not access control"
  - "Production-ready: 89 tests, comprehensive attack suite, crash-safe agent design"
- **4:30-4:50** - Technical credibility (optional, if time allows)
  - Flash test results: `npm test` output showing 89 passing tests
  - Show PRD.md or architecture diagram briefly
- **4:50-5:00** - Call to action
  - "Try it yourself: npm run demo"
  - GitHub repo URL on screen
  - Team contact info

### Visual Strategy

**Screen Layout Options:**

**Option A: Split Screen (Recommended)**
```
┌─────────────────────────────────┐
│    Dashboard (Right 60%)        │
│    ┌─────────────────────┐      │
│    │ Task State: OPEN    │      │
│    │ Events Log          │      │
│    │ Balances            │      │
│    └─────────────────────┘      │
│                                 │
│    Terminal (Left 40%)          │
│    $ npm run demo               │
│    ✓ Task created...           │
│    ✓ Worker committed...       │
└─────────────────────────────────┘
```

**Option B: Picture-in-Picture**
```
┌─────────────────────────────────┐
│    Terminal (Full Screen)       │
│                                 │
│    $ npm run demo               │
│    ✓ Task created...           │
│                                 │
│    ┌──────────┐                │
│    │Dashboard │  (Corner PIP)  │
│    │ Live     │                │
│    └──────────┘                │
└─────────────────────────────────┘
```

**Recording Tips:**
- Pre-record terminal sessions, narrate over them (avoid live typing errors)
- Use terminal recording tool with syntax highlighting (asciinema + agg for GIF conversion, or OBS with theme)
- Dashboard must be live or pre-recorded with browser dev tools open showing real transactions
- Use colored terminal output (demo script already has this in `scripts/demo/run-demo.ts:62-76`)

### Timing Considerations

**Critical Constraint: Blockchain Time**
- Reveal window: 10 minutes (600 seconds)
- Can't show full commit expiry in real demo

**Solutions:**
1. **Time-lapse for commit expiry** - Speed up video 20x during wait (show timer countdown)
2. **Pre-record attack demos** - Edit out wait times
3. **Split recording sessions** - Record happy path separately from attacks
4. **Use Hardhat time manipulation** - Modify demo script to use `time.increase()` (needs code change)

**Recommended: Pre-record with editing**
- Record 3 separate sessions:
  1. Happy path (real-time, ~90 seconds)
  2. Front-run attack (real-time, ~30 seconds)
  3. Commit griefing (time-lapse or Hardhat time skip, ~30 seconds)
- Edit together with transitions
- Add voiceover narration

### File Reference

| File | Purpose | Video Usage |
|------|---------|-------------|
| `scripts/demo/run-demo.ts` | Automated demo script | Primary demo footage source |
| `dashboard/index.html` | Visual monitoring UI | Constant overlay for comprehension |
| `scripts/agents/worker.ts` | Autonomous agent logic | Show decision-making logs |
| `scripts/agents/attacker.ts` | Attack demonstrations | Security proof segment |
| `test/attacks.test.ts` | Attack test suite | Flash credibility (test results) |
| `README.md` | Quick start guide | On-screen reference for "Try it" CTA |
| `docs/PRD.md` | Product requirements | Architecture diagram source |

### Technical Setup Requirements

**Hardware:**
- Screen recording: OBS Studio, Loom, or QuickTime (macOS)
- Audio: External microphone recommended (clear narration critical)
- Display: 1920x1080 minimum (readable terminal text)

**Software Preparation:**
```bash
# Terminal 1: Blockchain (run in background, don't show)
npm run node

# Terminal 2: Deploy & Setup (run once before recording)
npm run deploy:local
npm run setup-demo

# Terminal 3: Demo script (THIS IS WHAT YOU RECORD)
npm run demo

# Browser: Dashboard (record alongside terminal)
open dashboard/index.html
```

**Pre-Flight Checklist:**
- [ ] Clean terminal history (`clear`)
- [ ] Increase terminal font size (16pt minimum)
- [ ] Use high-contrast theme (dark background, bright text)
- [ ] Close unnecessary browser tabs
- [ ] Disable notifications (Focus mode on macOS)
- [ ] Test microphone levels
- [ ] Prepare voiceover script (write it out word-for-word)

### Demo Script Modifications (Optional Enhancements)

**For faster demo without code changes:**
Use existing `scripts/demo/run-demo.ts` as-is, but:
- Skip Attack 3 (Deadline Rug) - least visually interesting
- Focus on Front-Run (most dramatic) and Griefing (shows bond slashing)

**For professional production (requires code changes):**

Create `scripts/demo/run-demo-video.ts` that:
1. Uses Hardhat `time.increase()` to skip wait periods
2. Adds 2-second pauses between key events (easier to narrate)
3. Prints larger status messages (more readable in video)
4. Removes verbose logs (cleaner output)

Example modification:
```typescript
// In run-demo-video.ts
import { time } from "@nomicfoundation/hardhat-network-helpers";

// After commit:
console.log("\n⏰ Fast-forwarding reveal window expiry...\n");
await time.increase(REVEAL_WINDOW + 1);
await sleep(2000); // Pause for narration
```

### Narrative Hooks (Voiceover Script Template)

**Opening (0:00-0:20):**
> "Imagine two AI agents trying to do business together, but neither trusts the other. Traditional escrow needs arbitrators. AgentEscrow solves this with cryptographic proofs and economic incentives."

**Problem (0:20-1:00):**
> "Here's the challenge: if Agent A pays Agent B for computation, three attacks can break the system. First, front-runners can steal the output. Second, griefers can lock up funds without doing work. Third, requesters can rug workers by timing out early. Every existing solution requires a trusted third party."

**Solution (1:00-1:30):**
> "AgentEscrow uses a bonded commit-reveal protocol. The requester knows the expected output hash upfront. The worker commits to their answer with a bond, then proves they have the correct output. Griefing costs real money, and front-running is cryptographically impossible."

**Demo Intro (1:30-1:45):**
> "Let's watch this in action. On the left, our terminal runs the protocol. On the right, the dashboard shows state changes in real-time."

**Happy Path (1:45-2:30):**
> "Agent A creates a task with 10 tokens payment. Agent B evaluates the task, decides it's profitable, and commits a 1-token bond along with a hash of their output. They immediately reveal the actual output. The contract verifies the hash matches, and releases payment. Notice how balances update atomically."

**Attack 1 (2:30-2:50):**
> "Now watch an attacker try to front-run the reveal. They copy the transaction and bid higher gas. The contract rejects them because only the committed worker can reveal. The attacker just wasted gas."

**Attack 2 (2:50-3:10):**
> "Here's a griefing attack. The attacker commits with a fake hash, locking up the task. But after 10 minutes, the reveal window expires and the contract slashes their bond to the requester. Griefing costs 10% of the task value - making it unprofitable."

**Attack 3 (3:10-3:30):**
> "What if the attacker tries to grief cheaply with a 1% bond? The contract enforces a 10% minimum and rejects the transaction. Economic incentives prevent spam."

**Autonomous Agent (3:30-4:00):**
> "This is the Worker Agent running autonomously. When a task appears, it evaluates profitability by checking gas costs, timing, and profit margins. It decides to accept, commits, and reveals - all without human intervention. This is how agents can participate in the economy."

**Closing (4:00-5:00):**
> "AgentEscrow is the first bonded commit-reveal escrow primitive for trustless agent-to-agent settlement. It blocks all major attack vectors using economic incentives, not access control. It's production-ready with 89 tests and crash-safe agent design. Try it yourself at [GitHub URL]."

## Recommended Action Steps

### Phase 1: Preparation (1-2 hours)
1. **Write voiceover script** (word-for-word, 650-750 words for 5 min)
2. **Create visual storyboard** (which screen shown when)
3. **Test recording setup** (record 30-second test, check readability)
4. **Prepare environment:**
   - Clean desktop
   - Configure terminal theme (high contrast, large font)
   - Open dashboard in fullscreen browser
   - Close all other applications

### Phase 2: Recording (2-3 hours with retakes)
1. **Record terminal sessions** (3 separate takes):
   - Happy path demo (2 min)
   - Attack demonstrations (2 min)
   - Worker agent logs (1 min)
2. **Record dashboard footage** (can reuse across segments)
3. **Record voiceover** (use script, no improvisation)
4. **Optional: Record intro/outro** (talking head or logo animation)

### Phase 3: Editing (2-4 hours)
1. **Video editing** (iMovie, DaVinci Resolve, or Premiere):
   - Sync terminal + dashboard footage
   - Add time-lapse speed-up for wait periods
   - Insert transitions between segments
   - Overlay voiceover narration
2. **Add graphics:**
   - Title card (0:00-0:05)
   - Section headers ("The Problem", "The Solution", "Live Demo")
   - GitHub URL + contact info (4:50-5:00)
   - Optional: Architecture diagram at 1:00-1:30
3. **Final touches:**
   - Background music (subtle, non-distracting)
   - Highlight mouse cursor for key clicks
   - Zoom in on important terminal output
   - Fade-out ending

### Phase 4: Review & Export (30 min)
1. **Quality checks:**
   - Audio levels consistent
   - Text readable at 1080p
   - Pacing feels natural (not rushed)
   - All claims are accurate
2. **Export settings:**
   - Resolution: 1920x1080 (1080p)
   - Frame rate: 30 fps minimum
   - Format: MP4 (H.264 codec)
   - Bitrate: 8-10 Mbps
3. **Upload to platform** (YouTube unlisted link for judges)

## Code Examples

### Quick Demo Recording Script

```bash
#!/bin/bash
# scripts/record-demo.sh

# Terminal setup
clear
echo "═══════════════════════════════════════"
echo "   AgentEscrow Demo - Recording Mode   "
echo "═══════════════════════════════════════"
sleep 2

# Start local node (background, don't show)
npm run node > /dev/null 2>&1 &
sleep 5

# Deploy contracts
echo "\n📦 Deploying contracts..."
npm run deploy:local
sleep 2

# Setup demo wallets
echo "\n💰 Funding demo wallets..."
npm run setup-demo
sleep 2

# Run main demo
echo "\n🎬 Starting demo recording..."
sleep 1
npm run demo

# Cleanup
echo "\n✓ Demo complete - ready for editing"
```

### Time-Accelerated Demo (Optional Code Change)

```typescript
// scripts/demo/run-demo-video.ts
// Add to commit griefing section:

console.log(chalk.yellow("\n⏰ Waiting for reveal window to expire..."));
console.log(chalk.dim("(Fast-forwarding time for video demo)"));

// Instead of real wait, use Hardhat time manipulation:
await time.increase(REVEAL_WINDOW + 1);
await sleep(1000); // Just for visual pacing

console.log(chalk.green("✓ Reveal window expired"));
```

## Open Questions for User

1. **Target audience expertise?**
   - Technical judges (focus on architecture) or business judges (focus on use cases)?

2. **Submission format?**
   - YouTube link, video file upload, live presentation?

3. **Judging criteria?**
   - Innovation, technical execution, presentation quality, market potential?

4. **Voiceover preference?**
   - Your voice, professional narrator, text-on-screen only?

5. **Branding?**
   - Team name, logo, color scheme to incorporate?

## Related Research

- `README.md` - User-facing documentation for "Try it yourself" segment
- `docs/PRD.md` - Product requirements (source for architecture diagram)
- `scripts/demo/run-demo.ts:62-76` - Colored output styling (already production-ready)
- `dashboard/index.html:150-200` - Real-time event rendering logic

## Next Steps

Once you confirm preferences for the open questions above, recommended next actions:

1. **Immediate:** Write voiceover script (I can help draft this)
2. **Before recording:** Test recording setup with 30-second trial
3. **Optional enhancement:** Modify demo script for time-lapse capability
4. **Day-of:** Follow Phase 1-4 checklist above

Total estimated time: **6-10 hours** (preparation + recording + editing)
