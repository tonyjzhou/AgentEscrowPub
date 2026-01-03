import { ethers } from "ethers";

/**
 * Compute the hash of output bytes
 * @param outputBytes The output as a hex string (0x-prefixed) or Uint8Array
 * @returns The keccak256 hash as bytes32
 */
export function computeOutputHash(outputBytes: string | Uint8Array): string {
  return ethers.keccak256(outputBytes);
}

/**
 * Compute the hash of input bytes
 * @param inputBytes The input as a hex string (0x-prefixed) or Uint8Array
 * @returns The keccak256 hash as bytes32
 */
export function computeInputHash(inputBytes: string | Uint8Array): string {
  return ethers.keccak256(inputBytes);
}

/**
 * Compute the commit hash from output hash and salt
 * Uses abi.encode (NOT encodePacked) for determinism
 * @param outputHash The keccak256 hash of the output (bytes32)
 * @param salt Random 32-byte salt (bytes32)
 * @returns The keccak256 hash of abi.encode(outputHash, salt)
 */
export function computeCommitHash(outputHash: string, salt: string): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32"],
    [outputHash, salt]
  );
  return ethers.keccak256(encoded);
}

/**
 * Generate a random 32-byte salt
 * @returns A random bytes32 value
 */
export function generateSalt(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

/**
 * Convert a string to bytes (hex-encoded)
 * @param str The string to convert
 * @returns The hex-encoded bytes
 */
export function stringToBytes(str: string): string {
  return ethers.hexlify(ethers.toUtf8Bytes(str));
}

/**
 * Convert hex bytes to string
 * @param bytes The hex-encoded bytes
 * @returns The decoded string
 */
export function bytesToString(bytes: string): string {
  return ethers.toUtf8String(bytes);
}
