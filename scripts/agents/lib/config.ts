import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

/**
 * Network configuration
 */
export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  confirmations: number;
}

/**
 * Deployment addresses
 */
export interface DeploymentAddresses {
  mnee: string;
  escrow: string;
}

/**
 * Get network config based on environment
 */
export function getNetworkConfig(): NetworkConfig {
  const network = process.env.NETWORK || "localhost";

  switch (network) {
    case "localhost":
    case "hardhat":
      return {
        name: "localhost",
        rpcUrl: "http://127.0.0.1:8545",
        chainId: 31337,
        confirmations: 0,
      };
    case "sepolia":
      return {
        name: "sepolia",
        rpcUrl: process.env.SEPOLIA_RPC_URL || "",
        chainId: 11155111,
        confirmations: 2,
      };
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

/**
 * Get deployment addresses from .deployments.json
 */
export function getDeploymentAddresses(): DeploymentAddresses {
  const deploymentsPath = path.join(process.cwd(), ".deployments.json");

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      "Deployments file not found. Run `npm run deploy:local` first."
    );
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const network = getNetworkConfig().name;

  if (!deployments[network]) {
    throw new Error(`No deployments found for network: ${network}`);
  }

  return {
    mnee: deployments[network].mnee,
    escrow: deployments[network].escrow,
  };
}

/**
 * Get provider for the current network
 */
export function getProvider(): ethers.JsonRpcProvider {
  const config = getNetworkConfig();
  return new ethers.JsonRpcProvider(config.rpcUrl);
}

/**
 * Get signer from private key
 */
export function getSigner(privateKey?: string): ethers.Wallet {
  const provider = getProvider();
  const key = privateKey || process.env.PRIVATE_KEY;

  // Hardhat's first default account for local development
  const DEFAULT_HARDHAT_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const network = getNetworkConfig();

  if (!key) {
    if (network.name === "localhost") {
      console.warn("⚠️  No PRIVATE_KEY set, using default Hardhat account");
      return new ethers.Wallet(DEFAULT_HARDHAT_KEY, provider);
    }
    throw new Error("No private key provided. Set PRIVATE_KEY in .env");
  }

  return new ethers.Wallet(key, provider);
}

/**
 * Worker agent configuration
 */
export interface WorkerConfig {
  minProfitMargin: bigint;
  supportedSpecs: string[];
  commitBuffer: number;
  gasEstimateMultiplier: number;
  mneePerEth: bigint;
  confirmations: number;
}

/**
 * Get default worker configuration
 */
export function getWorkerConfig(): WorkerConfig {
  return {
    minProfitMargin: ethers.parseUnits("0.1", 18), // 0.1 MNEE minimum profit
    supportedSpecs: [ethers.keccak256(ethers.toUtf8Bytes("RFC8785_JCS_V1"))],
    commitBuffer: 60, // 60 seconds buffer
    gasEstimateMultiplier: 1.2, // 20% safety margin
    mneePerEth: ethers.parseUnits(process.env.MNEE_PER_ETH || "1", 18),
    confirmations: getNetworkConfig().confirmations,
  };
}
