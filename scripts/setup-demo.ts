import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🎭 Setting up demo environment...\n");

  // Load deployment addresses
  const deploymentsPath = path.join(process.cwd(), ".deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Deployments not found. Run `npm run deploy:local` first.");
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const network = await ethers.provider.getNetwork();
  const networkName = network.chainId === 31337n ? "localhost" : network.name;

  if (!deployments[networkName]) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const { mnee: mneeAddress, escrow: escrowAddress } = deployments[networkName];

  // Get signers (Hardhat default accounts)
  const [deployer, requester, worker, attacker] = await ethers.getSigners();

  console.log("Demo Wallets:");
  console.log("  Deployer:", deployer.address);
  console.log("  Requester (Agent A):", requester.address);
  console.log("  Worker (Agent B):", worker.address);
  console.log("  Attacker:", attacker.address);

  // Connect to contracts
  const mnee = await ethers.getContractAt("MockMNEE", mneeAddress);
  const escrow = await ethers.getContractAt("AgentEscrow", escrowAddress);

  // Fund demo wallets with MNEE
  console.log("\n💰 Minting MNEE tokens...");

  const requesterAmount = ethers.parseUnits("100", 18);
  const workerAmount = ethers.parseUnits("10", 18);
  const attackerAmount = ethers.parseUnits("10", 18);

  await mnee.mint(requester.address, requesterAmount);
  console.log(`  Minted ${ethers.formatUnits(requesterAmount, 18)} MNEE to Requester`);

  await mnee.mint(worker.address, workerAmount);
  console.log(`  Minted ${ethers.formatUnits(workerAmount, 18)} MNEE to Worker`);

  await mnee.mint(attacker.address, attackerAmount);
  console.log(`  Minted ${ethers.formatUnits(attackerAmount, 18)} MNEE to Attacker`);

  // Verify balances
  console.log("\n📊 Wallet Balances:");
  console.log(`  Requester: ${ethers.formatUnits(await mnee.balanceOf(requester.address), 18)} MNEE`);
  console.log(`  Worker: ${ethers.formatUnits(await mnee.balanceOf(worker.address), 18)} MNEE`);
  console.log(`  Attacker: ${ethers.formatUnits(await mnee.balanceOf(attacker.address), 18)} MNEE`);

  // Pre-approve escrow for common amounts (optional, makes demo smoother)
  console.log("\n🔓 Pre-approving escrow contract...");

  const maxApproval = ethers.MaxUint256;
  await mnee.connect(requester).approve(escrowAddress, maxApproval);
  console.log("  Requester approved escrow for max amount");

  await mnee.connect(worker).approve(escrowAddress, maxApproval);
  console.log("  Worker approved escrow for max amount");

  await mnee.connect(attacker).approve(escrowAddress, maxApproval);
  console.log("  Attacker approved escrow for max amount");

  // Save demo wallet info
  deployments[networkName].demoWallets = {
    requester: requester.address,
    worker: worker.address,
    attacker: attacker.address,
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  console.log("\n✅ Demo setup complete!");
  console.log("\nContract Addresses:");
  console.log(`  MNEE: ${mneeAddress}`);
  console.log(`  AgentEscrow: ${escrowAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
