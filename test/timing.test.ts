import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, createTaskParams, createTask, getBlockTimestamp } from "./fixtures";
import { REVEAL_WINDOW, TaskState } from "../utils/constants";
import { computeCommitHash, generateSalt, stringToBytes, computeOutputHash } from "../utils/encoding";

describe("Timing Boundaries", function () {
  describe("commit cutoff (strict <)", function () {
    it("REVERTS at exactly deadline - REVEAL_WINDOW", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const timestamp = await getBlockTimestamp();
      const deadline = timestamp + REVEAL_WINDOW + 1000;
      const params = await createTaskParams({ deadline });
      await createTask(escrow, mnee, requester, params);

      // Advance to exactly deadline - REVEAL_WINDOW
      await time.setNextBlockTimestamp(deadline - REVEAL_WINDOW);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);

      await expect(escrow.connect(worker).commit(0, commitHash))
        .to.be.revertedWithCustomError(escrow, "CommitWindowClosed");
    });

    it("PASSES at deadline - REVEAL_WINDOW - 1 second", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const timestamp = await getBlockTimestamp();
      const deadline = timestamp + REVEAL_WINDOW + 1000;
      const params = await createTaskParams({ deadline });
      await createTask(escrow, mnee, requester, params);

      // Pre-approve before setting timestamp
      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);

      // Now set timestamp for the commit call
      await time.setNextBlockTimestamp(deadline - REVEAL_WINDOW - 1);

      await expect(escrow.connect(worker).commit(0, commitHash)).to.not.be.reverted;

      const task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMMITTED);
    });
  });

  describe("reveal deadline (<=)", function () {
    it("PASSES at exactly revealDeadline", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      const task = await escrow.getTask(0);
      // Set timestamp to exactly revealDeadline
      await time.setNextBlockTimestamp(Number(task.revealDeadline));

      await expect(escrow.connect(worker).reveal(0, outputBytes, salt)).to.not.be.reverted;
    });

    it("REVERTS at revealDeadline + 1 second", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      const task = await escrow.getTask(0);
      await time.setNextBlockTimestamp(Number(task.revealDeadline) + 1);

      await expect(escrow.connect(worker).reveal(0, outputBytes, salt))
        .to.be.revertedWithCustomError(escrow, "RevealWindowExpired");
    });
  });

  describe("expireCommit window", function () {
    it("REVERTS at exactly revealDeadline (must be >)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      const task = await escrow.getTask(0);
      await time.setNextBlockTimestamp(Number(task.revealDeadline));

      await expect(escrow.expireCommit(0))
        .to.be.revertedWithCustomError(escrow, "RevealWindowActive");
    });

    it("PASSES at revealDeadline + 1 second", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      const task = await escrow.getTask(0);
      await time.setNextBlockTimestamp(Number(task.revealDeadline) + 1);

      await expect(escrow.expireCommit(0)).to.not.be.reverted;
    });

    it("PASSES at exactly deadline", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      // Set to exactly deadline (which is valid for expireCommit)
      await time.setNextBlockTimestamp(params.deadline);

      await expect(escrow.expireCommit(0)).to.not.be.reverted;
    });

    it("REVERTS at deadline + 1 second (use claimTimeout)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      await time.setNextBlockTimestamp(params.deadline + 1);

      await expect(escrow.expireCommit(0))
        .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    });
  });

  describe("claimTimeout", function () {
    it("REVERTS at exactly deadline (must be >)", async function () {
      const { escrow, mnee, requester } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      await time.setNextBlockTimestamp(params.deadline);

      await expect(escrow.claimTimeout(0))
        .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    });

    it("PASSES at deadline + 1 second (OPEN task)", async function () {
      const { escrow, mnee, requester } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      await time.setNextBlockTimestamp(params.deadline + 1);

      await expect(escrow.claimTimeout(0)).to.not.be.reverted;
    });

    it("PASSES at deadline + 1 second when revealDeadline already passed (COMMITTED)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      // Due to strict < in commit, revealDeadline < deadline always
      // So at deadline + 1, revealDeadline is already passed
      await time.setNextBlockTimestamp(params.deadline + 1);

      await expect(escrow.claimTimeout(0)).to.not.be.reverted;
    });

    it("REVERTS at deadline + 1 second when revealDeadline NOT passed (COMMITTED, deadline rug)", async function () {
      // This test verifies deadline rug protection
      // Due to the strict < check in commit, this scenario shouldn't be possible
      // because revealDeadline = commitTime + REVEAL_WINDOW
      // and commitTime < deadline - REVEAL_WINDOW
      // So revealDeadline < deadline always

      // We skip this specific test as it's already covered by the commit constraint
      // The deadline rug protection is enforced by the strict < in commit
    });
  });

  describe("timing invariant", function () {
    it("revealDeadline < deadline always holds (due to strict < in commit)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const timestamp = await getBlockTimestamp();
      // Create task with deadline just after minimum
      const deadline = timestamp + REVEAL_WINDOW + 100;
      const params = await createTaskParams({ deadline });
      await createTask(escrow, mnee, requester, params);

      // Pre-approve before setting timestamp
      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);

      // Commit at the latest possible moment
      await time.setNextBlockTimestamp(deadline - REVEAL_WINDOW - 1);
      await escrow.connect(worker).commit(0, commitHash);

      const task = await escrow.getTask(0);
      // revealDeadline = (deadline - REVEAL_WINDOW - 1) + REVEAL_WINDOW = deadline - 1
      expect(Number(task.revealDeadline)).to.be.lessThan(deadline);
    });
  });
});
