import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, createTaskParams, createTask } from "./fixtures";
import {
  computeInputHash,
  computeOutputHash,
  computeCommitHash,
  generateSalt,
  stringToBytes,
  bytesToString,
} from "../utils/encoding";
import { canonicalizeJSON, computeJCSHash, toCanonicalBytes } from "../utils/canonicalize";

describe("JS ↔ Solidity Hash Verification", function () {
  it("inputHash matches: JS keccak256(inputBytes) === Solidity keccak256(inputBytes)", async function () {
    const { escrow, mnee, requester } = await loadFixture(deployFixture);
    const inputStr = "hello world";
    const inputBytes = stringToBytes(inputStr);
    const jsInputHash = computeInputHash(inputBytes);

    const params = await createTaskParams({ inputBytes });
    await mnee.connect(requester).approve(await escrow.getAddress(), params.amount);
    await escrow.connect(requester).createTask(
      inputBytes,
      params.expectedOutputHash,
      params.specHash,
      params.amount,
      params.bondAmount,
      params.deadline
    );

    const task = await escrow.getTask(0);
    expect(task.inputHash).to.equal(jsInputHash);
  });

  it("outputHash matches: JS keccak256(outputBytes) === Solidity keccak256(outputBytes)", async function () {
    const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
    const outputStr = "hello world";
    const outputBytes = stringToBytes(outputStr);
    const jsOutputHash = computeOutputHash(outputBytes);

    const params = await createTaskParams({ expectedOutputHash: jsOutputHash });
    await createTask(escrow, mnee, requester, params);

    const salt = generateSalt();
    const commitHash = computeCommitHash(jsOutputHash, salt);
    await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
    await escrow.connect(worker).commit(0, commitHash);

    // If the reveal succeeds, the output hash matched
    await expect(escrow.connect(worker).reveal(0, outputBytes, salt)).to.not.be.reverted;
  });

  it("commitHash matches: JS keccak256(abi.encode(outputHash, salt)) === Solidity", async function () {
    const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);
    const outputStr = "hello world";
    const outputBytes = stringToBytes(outputStr);
    const outputHash = computeOutputHash(outputBytes);

    const params = await createTaskParams({ expectedOutputHash: outputHash });
    await createTask(escrow, mnee, requester, params);

    const salt = generateSalt();
    const jsCommitHash = computeCommitHash(outputHash, salt);

    await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
    await escrow.connect(worker).commit(0, jsCommitHash);

    // If the reveal succeeds, the commit hash computation matched
    await expect(escrow.connect(worker).reveal(0, outputBytes, salt)).to.not.be.reverted;

    // Verify the stored commit hash matches what we computed in JS
    // (Check by comparing what was stored before reveal changed state)
    // Actually, we can verify by the fact that reveal succeeded
  });

  it("verifies full round-trip: create → commit → reveal with matching hashes", async function () {
    const { escrow, mnee, requester, worker, escrowAddress } = await loadFixture(deployFixture);

    // Prepare data
    const inputData = { task: "compute", value: 42 };
    const outputData = { result: "computed", answer: 42 };

    // Canonicalize for determinism
    const inputBytes = toCanonicalBytes(inputData);
    const outputBytes = toCanonicalBytes(outputData);

    // Compute hashes
    const inputHash = computeInputHash(inputBytes);
    const expectedOutputHash = computeOutputHash(outputBytes);

    // Create task
    const params = await createTaskParams({
      inputBytes,
      expectedOutputHash,
    });
    await mnee.connect(requester).approve(await escrow.getAddress(), params.amount);
    await escrow.connect(requester).createTask(
      inputBytes,
      expectedOutputHash,
      params.specHash,
      params.amount,
      params.bondAmount,
      params.deadline
    );

    // Verify stored input hash
    const task = await escrow.getTask(0);
    expect(task.inputHash).to.equal(inputHash);
    expect(task.expectedOutputHash).to.equal(expectedOutputHash);

    // Worker commits
    const salt = generateSalt();
    const commitHash = computeCommitHash(expectedOutputHash, salt);
    await mnee.connect(worker).approve(escrowAddress, params.bondAmount);
    await escrow.connect(worker).commit(0, commitHash);

    // Worker reveals
    await escrow.connect(worker).reveal(0, outputBytes, salt);

    // Task completed - all hashes matched
    const finalTask = await escrow.getTask(0);
    expect(finalTask.state).to.equal(2); // COMPLETED
  });
});

describe("RFC 8785 JCS Canonicalization", function () {
  it("canonicalize produces RFC 8785 compliant output", async function () {
    // Test object with unordered keys
    const input = { b: 2, a: 1 };
    const canonical = canonicalizeJSON(input);

    // Keys should be sorted
    expect(canonical).to.equal('{"a":1,"b":2}');
  });

  it("key ordering follows UTF-16 code unit sorting", async function () {
    // UTF-16 code unit ordering
    const input = { "é": 1, "a": 2, "A": 3, "z": 4 };
    const canonical = canonicalizeJSON(input);

    // In UTF-16, uppercase comes before lowercase
    // A (65) < a (97) < z (122) < é (233)
    expect(canonical).to.equal('{"A":3,"a":2,"z":4,"é":1}');
  });

  it("number formatting matches spec (no trailing zeros, proper exponents)", async function () {
    const input = { int: 10, float: 1.5, zero: 0 };
    const canonical = canonicalizeJSON(input);

    // Numbers should be minimal representation
    expect(canonical).to.equal('{"float":1.5,"int":10,"zero":0}');
  });

  it("no whitespace between elements", async function () {
    const input = { a: [1, 2, 3], b: { c: "d" } };
    const canonical = canonicalizeJSON(input);

    // No spaces or newlines
    expect(canonical).to.not.include(" ");
    expect(canonical).to.not.include("\n");
    expect(canonical).to.equal('{"a":[1,2,3],"b":{"c":"d"}}');
  });

  it("cross-agent hash verification for identical logical objects", async function () {
    // Two different representations of the same logical object
    const agent1Input = { name: "task", value: 100, nested: { b: 2, a: 1 } };
    const agent2Input = { nested: { a: 1, b: 2 }, value: 100, name: "task" };

    // Both should produce the same canonical form
    const canonical1 = canonicalizeJSON(agent1Input);
    const canonical2 = canonicalizeJSON(agent2Input);
    expect(canonical1).to.equal(canonical2);

    // Both should produce the same hash
    const hash1 = computeJCSHash(agent1Input);
    const hash2 = computeJCSHash(agent2Input);
    expect(hash1).to.equal(hash2);
  });

  it("nested objects are recursively canonicalized", async function () {
    const input = {
      level1: {
        z: { b: 2, a: 1 },
        a: { d: 4, c: 3 },
      },
    };
    const canonical = canonicalizeJSON(input);

    // All nested keys should be sorted
    expect(canonical).to.equal('{"level1":{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}}');
  });

  it("arrays maintain order (arrays are not sorted)", async function () {
    const input = { arr: [3, 1, 2] };
    const canonical = canonicalizeJSON(input);

    // Arrays should preserve order
    expect(canonical).to.equal('{"arr":[3,1,2]}');
  });
});

describe("Encoding Edge Cases", function () {
  it("handles empty bytes", async function () {
    const emptyBytes = "0x";
    const hash = computeInputHash(emptyBytes);
    // keccak256 of empty bytes is a known value
    expect(hash).to.equal("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  it("handles UTF-8 special characters", async function () {
    const input = { emoji: "🚀", japanese: "日本語" };
    const canonical = canonicalizeJSON(input);
    const bytes = toCanonicalBytes(input);

    // Should be valid UTF-8
    expect(canonical).to.include("🚀");
    expect(canonical).to.include("日本語");

    // Hash should be computable
    const hash = computeJCSHash(input);
    expect(hash).to.be.a("string");
    expect(hash).to.match(/^0x[a-f0-9]{64}$/);
  });

  it("salt is exactly 32 bytes", async function () {
    const salt = generateSalt();
    // 0x + 64 hex chars = 66 chars
    expect(salt.length).to.equal(66);
    expect(salt).to.match(/^0x[a-f0-9]{64}$/);
  });
});
