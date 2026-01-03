import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🚀 Deploying AgentEscrow...\n");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("Network:", network.name || "hardhat", `(chainId: ${network.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy MockMNEE
  console.log("Deploying MockMNEE...");
  const MockMNEE = await ethers.getContractFactory("MockMNEE");
  const mnee = await MockMNEE.deploy();
  await mnee.waitForDeployment();
  const mneeAddress = await mnee.getAddress();
  console.log("  MockMNEE deployed to:", mneeAddress);

  // Deploy AgentEscrow
  console.log("\nDeploying AgentEscrow...");
  const AgentEscrow = await ethers.getContractFactory("AgentEscrow");
  const escrow = await AgentEscrow.deploy(mneeAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("  AgentEscrow deployed to:", escrowAddress);

  // Save deployment addresses
  const deploymentsPath = path.join(process.cwd(), ".deployments.json");
  let deployments: Record<string, any> = {};

  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }

  const networkName = network.chainId === 31337n ? "localhost" : network.name;
  deployments[networkName] = {
    mnee: mneeAddress,
    escrow: escrowAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployment addresses saved to .deployments.json");

  // Verify constants
  console.log("\n📋 Verifying contract constants...");
  console.log("  REVEAL_WINDOW:", Number(await escrow.REVEAL_WINDOW()), "seconds");
  console.log("  MIN_BOND_BPS:", Number(await escrow.MIN_BOND_BPS()), "bps (10%)");
  console.log("  MAX_INPUT_SIZE:", Number(await escrow.MAX_INPUT_SIZE()), "bytes");
  console.log("  MAX_OUTPUT_SIZE:", Number(await escrow.MAX_OUTPUT_SIZE()), "bytes");

  console.log("\n✅ Deployment complete!");
  console.log("\nNext steps:");
  console.log("  1. Run `npm run setup-demo` to fund demo wallets");
  console.log("  2. Start the demo with `npm run demo`");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
