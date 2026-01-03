import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, createTaskParams, createTask, getBlockTimestamp } from "./fixtures";
import { REVEAL_WINDOW, MIN_BOND_BPS, MAX_INPUT_SIZE, MAX_OUTPUT_SIZE, TaskState } from "../utils/constants";
import { computeCommitHash, generateSalt, stringToBytes, computeOutputHash } from "../utils/encoding";

describe("Attack Scenarios", function () {
  describe("Attack: Reveal Front-Running", function () {
    it('attacker copying reveal calldata reverts with "Not the committed worker"', async function () {
      const { escrow, mnee, requester, worker, attacker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      // Worker commits
      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      // Attacker sees worker's reveal tx in mempool and copies the calldata
      // (simulated by attacker calling reveal with same params)
      await expect(escrow.connect(attacker).reveal(0, outputBytes, salt))
        .to.be.revertedWithCustomError(escrow, "NotCommittedWorker");

      // Worker's legitimate reveal succeeds
      await escrow.connect(worker).reveal(0, outputBytes, salt);
      const task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMPLETED);
    });
  });

  describe("Attack: Commit Griefing", function () {
    it("griefer loses bond when commit expires", async function () {
      const { escrow, mnee, requester, attacker, escrowAddress, initialBalance } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      // Attacker commits with their own commitHash (they don't know the output)
      const fakeCommitHash = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await mnee.connect(attacker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(attacker).commit(0, fakeCommitHash);

      const attackerBalanceAfterCommit = await mnee.balanceOf(attacker.address);
      expect(attackerBalanceAfterCommit).to.equal(initialBalance - params.bondAmount);

      // Attacker cannot reveal (doesn't know output or salt)
      // Time passes, reveal window expires
      const task = await escrow.getTask(0);
      await time.increaseTo(Number(task.revealDeadline) + 1);

      // Anyone calls expireCommit
      await escrow.expireCommit(0);

      // Attacker lost their bond
      const attackerBalanceAfterExpire = await mnee.balanceOf(attacker.address);
      expect(attackerBalanceAfterExpire).to.equal(initialBalance - params.bondAmount);
    });

    it("original task reopens for legitimate workers", async function () {
      const { escrow, mnee, requester, worker, attacker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      // Attacker griefs
      const fakeCommitHash = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await mnee.connect(attacker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(attacker).commit(0, fakeCommitHash);

      // Expire attacker's commit
      const task = await escrow.getTask(0);
      await time.increaseTo(Number(task.revealDeadline) + 1);
      await escrow.expireCommit(0);

      // Task is now OPEN again
      const taskAfterExpire = await escrow.getTask(0);
      expect(taskAfterExpire.state).to.equal(TaskState.OPEN);

      // Legitimate worker can now commit
      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      // And reveal
      await escrow.connect(worker).reveal(0, outputBytes, salt);

      const finalTask = await escrow.getTask(0);
      expect(finalTask.state).to.equal(TaskState.COMPLETED);
    });
  });

  describe("Attack: Deadline Rug", function () {
    it("requester cannot claimTimeout during reveal window", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      // Worker commits
      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      // Due to strict < in commit, revealDeadline is always < deadline
      // So this attack isn't possible - but let's verify the protection works

      const task = await escrow.getTask(0);
      // Try to claim at a time before deadline
      await time.increaseTo(Number(task.revealDeadline) - 10);

      await expect(escrow.connect(requester).claimTimeout(0))
        .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");

      // Worker can still reveal
      await escrow.connect(worker).reveal(0, outputBytes, salt);
    });
  });

  describe("Attack: Cheap Griefing", function () {
    it("cannot create task with bond < 10% of amount", async function () {
      const { escrow, mnee, requester, escrowAddress } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 18);
      const cheapBond = ethers.parseUnits("1", 18); // Only 1% of amount

      await mnee.connect(requester).approve(escrowAddress, amount);

      const params = await createTaskParams();
      await expect(escrow.connect(requester).createTask(
        params.inputBytes,
        params.expectedOutputHash,
        params.specHash,
        amount,
        cheapBond,
        params.deadline
      )).to.be.revertedWithCustomError(escrow, "InvalidBondAmount");
    });
  });

  describe("Attack: Size DoS", function () {
    it("cannot submit input > 4KB", async function () {
      const { escrow, mnee, requester, escrowAddress } = await loadFixture(deployFixture);
      const oversizedInput = "0x" + "ff".repeat(MAX_INPUT_SIZE + 1);
      const params = await createTaskParams();

      await mnee.connect(requester).approve(escrowAddress, params.amount);

      await expect(escrow.connect(requester).createTask(
        oversizedInput,
        params.expectedOutputHash,
        params.specHash,
        params.amount,
        params.bondAmount,
        params.deadline
      )).to.be.revertedWithCustomError(escrow, "InputTooLarge");
    });

    it("cannot reveal output > 4KB", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const oversizedOutput = "0x" + "ff".repeat(MAX_OUTPUT_SIZE + 1);
      const outputHash = computeOutputHash(oversizedOutput);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      await expect(escrow.connect(worker).reveal(0, oversizedOutput, salt))
        .to.be.revertedWithCustomError(escrow, "OutputTooLarge");
    });
  });

  describe("Attack: Timing Edge Case", function () {
    it("cannot commit at exactly deadline - REVEAL_WINDOW", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const timestamp = await getBlockTimestamp();
      const deadline = timestamp + REVEAL_WINDOW + 1000;
      const params = await createTaskParams({ deadline });
      await createTask(escrow, mnee, requester, params);

      // Set timestamp to exactly the cutoff
      await time.setNextBlockTimestamp(deadline - REVEAL_WINDOW);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);

      await expect(escrow.connect(worker).commit(0, commitHash))
        .to.be.revertedWithCustomError(escrow, "CommitWindowClosed");
    });
  });

  describe("Economic Analysis", function () {
    it("griefing one task costs attacker at least 10% of task value", async function () {
      const { escrow, mnee, requester, attacker, escrowAddress, initialBalance } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 18);
      const minBond = (amount * BigInt(MIN_BOND_BPS)) / 10000n; // 10 MNEE
      const params = await createTaskParams({ amount, bondAmount: minBond });
      await createTask(escrow, mnee, requester, params);

      // Attacker commits
      const fakeCommitHash = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await mnee.connect(attacker).approve(escrowAddress, minBond);
      await escrow.connect(attacker).commit(0, fakeCommitHash);

      // Let commit expire
      const task = await escrow.getTask(0);
      await time.increaseTo(Number(task.revealDeadline) + 1);
      await escrow.expireCommit(0);

      // Attacker lost their bond (10% of task value)
      const attackerFinalBalance = await mnee.balanceOf(attacker.address);
      expect(attackerFinalBalance).to.equal(initialBalance - minBond);

      // Cost to attacker: 10 MNEE for griefing a 100 MNEE task
      // This makes sustained griefing economically irrational
    });
  });
});
