import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, createTaskParams, createTask } from "./fixtures";
import { TaskState } from "../utils/constants";
import { computeCommitHash, generateSalt, stringToBytes, computeOutputHash } from "../utils/encoding";

describe("State Transitions", function () {
  describe("valid transitions", function () {
    it("OPEN → COMMITTED (commit)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      let task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.OPEN);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMMITTED);
    });

    it("COMMITTED → OPEN (expireCommit)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      let task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMMITTED);

      await time.increaseTo(Number(task.revealDeadline) + 1);
      await escrow.expireCommit(0);

      task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.OPEN);
    });

    it("COMMITTED → COMPLETED (reveal)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      let task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMMITTED);

      await escrow.connect(worker).reveal(0, outputBytes, salt);

      task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMPLETED);
    });

    it("OPEN → REFUNDED (claimTimeout)", async function () {
      const { escrow, mnee, requester } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      let task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.OPEN);

      await time.increaseTo(params.deadline + 1);
      await escrow.claimTimeout(0);

      task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.REFUNDED);
    });

    it("COMMITTED → REFUNDED (claimTimeout after both deadlines)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      let task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMMITTED);

      await time.increaseTo(params.deadline + 1);
      await escrow.claimTimeout(0);

      task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.REFUNDED);
    });
  });

  describe("invalid transitions from COMPLETED", function () {
    async function getCompletedTask() {
      const fixture = await loadFixture(deployFixture);
      const { escrow, mnee, requester, worker, escrowAddress } = fixture;
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);
      await escrow.connect(worker).reveal(0, outputBytes, salt);

      const task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.COMPLETED);

      return { ...fixture, outputBytes, salt, params };
    }

    it('COMPLETED → reveal() REVERTS "Task not committed"', async function () {
      const { escrow, worker, outputBytes, salt } = await getCompletedTask();

      await expect(escrow.connect(worker).reveal(0, outputBytes, salt))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it('COMPLETED → commit() REVERTS "Task not open"', async function () {
      const { escrow, worker, escrowAddress, mnee, params } = await getCompletedTask();

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);

      await expect(escrow.connect(worker).commit(0, commitHash))
        .to.be.revertedWithCustomError(escrow, "TaskNotOpen");
    });

    it('COMPLETED → expireCommit() REVERTS "Task not committed"', async function () {
      const { escrow, params } = await getCompletedTask();
      await time.increaseTo(params.deadline + 1);

      await expect(escrow.expireCommit(0))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it('COMPLETED → claimTimeout() REVERTS "Task already finalized"', async function () {
      const { escrow, params } = await getCompletedTask();
      await time.increaseTo(params.deadline + 1);

      await expect(escrow.claimTimeout(0))
        .to.be.revertedWithCustomError(escrow, "TaskAlreadyFinalized");
    });
  });

  describe("invalid transitions from REFUNDED", function () {
    async function getRefundedTask() {
      const fixture = await loadFixture(deployFixture);
      const { escrow, mnee, requester } = fixture;
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      await time.increaseTo(params.deadline + 1);
      await escrow.claimTimeout(0);

      const task = await escrow.getTask(0);
      expect(task.state).to.equal(TaskState.REFUNDED);

      return { ...fixture, params };
    }

    it('REFUNDED → reveal() REVERTS "Task not committed"', async function () {
      const { escrow, worker, params } = await getRefundedTask();
      const outputBytes = stringToBytes("hello world");
      const salt = generateSalt();

      await expect(escrow.connect(worker).reveal(0, outputBytes, salt))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it('REFUNDED → commit() REVERTS "Task not open"', async function () {
      const { escrow, worker, escrowAddress, mnee, params } = await getRefundedTask();

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);

      await expect(escrow.connect(worker).commit(0, commitHash))
        .to.be.revertedWithCustomError(escrow, "TaskNotOpen");
    });

    it('REFUNDED → expireCommit() REVERTS "Task not committed"', async function () {
      const { escrow } = await getRefundedTask();

      await expect(escrow.expireCommit(0))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it('REFUNDED → claimTimeout() REVERTS "Task already finalized"', async function () {
      const { escrow } = await getRefundedTask();

      await expect(escrow.claimTimeout(0))
        .to.be.revertedWithCustomError(escrow, "TaskAlreadyFinalized");
    });
  });

  describe("invalid transitions from OPEN", function () {
    it('OPEN → reveal() REVERTS "Task not committed"', async function () {
      const { escrow, mnee, requester, worker } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const outputBytes = stringToBytes("hello world");
      const salt = generateSalt();

      await expect(escrow.connect(worker).reveal(0, outputBytes, salt))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it('OPEN → expireCommit() REVERTS "Task not committed"', async function () {
      const { escrow, mnee, requester } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      await expect(escrow.expireCommit(0))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });
  });

  describe("invalid transitions from COMMITTED", function () {
    it('COMMITTED → commit() REVERTS "Task not open"', async function () {
      const { escrow, mnee, requester, worker, attacker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      // Try second commit from attacker
      await mnee.connect(attacker).approve(escrowAddress, params.bondAmount);
      await expect(escrow.connect(attacker).commit(0, commitHash))
        .to.be.revertedWithCustomError(escrow, "TaskNotOpen");
    });
  });

  describe("idempotency / double-action", function () {
    it("reveal() twice on same task → second REVERTS", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const outputBytes = stringToBytes("hello world");
      const outputHash = computeOutputHash(outputBytes);
      const params = await createTaskParams({ expectedOutputHash: outputHash });
      await createTask(escrow, mnee, requester, params);

      const salt = generateSalt();
      const commitHash = computeCommitHash(outputHash, salt);
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);
      await escrow.connect(worker).reveal(0, outputBytes, salt);

      // Second reveal
      await expect(escrow.connect(worker).reveal(0, outputBytes, salt))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it("expireCommit() twice on same task → second REVERTS (now OPEN)", async function () {
      const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      const commitHash = computeCommitHash(params.expectedOutputHash, generateSalt());
      await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
      await escrow.connect(worker).commit(0, commitHash);

      const task = await escrow.getTask(0);
      await time.increaseTo(Number(task.revealDeadline) + 1);
      await escrow.expireCommit(0);

      // Second expireCommit - task is now OPEN
      await expect(escrow.expireCommit(0))
        .to.be.revertedWithCustomError(escrow, "TaskNotCommitted");
    });

    it("claimTimeout() twice on same task → second REVERTS", async function () {
      const { escrow, mnee, requester } = await loadFixture(deployFixture);
      const params = await createTaskParams();
      await createTask(escrow, mnee, requester, params);

      await time.increaseTo(params.deadline + 1);
      await escrow.claimTimeout(0);

      // Second claimTimeout
      await expect(escrow.claimTimeout(0))
        .to.be.revertedWithCustomError(escrow, "TaskAlreadyFinalized");
    });
  });
});
