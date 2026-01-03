import canonicalize from "canonicalize";
import { ethers } from "ethers";

/**
 * Canonicalize a JSON object per RFC 8785 (JCS)
 * @param obj The object to canonicalize
 * @returns The canonical JSON string
 */
export function canonicalizeJSON(obj: object): string {
  const result = canonicalize(obj);
  if (result === undefined) {
    throw new Error("Failed to canonicalize object");
  }
  return result;
}

/**
 * Compute the keccak256 hash of a canonicalized JSON object
 * @param obj The object to hash
 * @returns The keccak256 hash as bytes32
 */
export function computeJCSHash(obj: object): string {
  const canonical = canonicalizeJSON(obj);
  const bytes = ethers.toUtf8Bytes(canonical);
  return ethers.keccak256(bytes);
}

/**
 * Convert a JSON object to canonical bytes
 * @param obj The object to convert
 * @returns The canonical bytes as hex string
 */
export function toCanonicalBytes(obj: object): string {
  const canonical = canonicalizeJSON(obj);
  return ethers.hexlify(ethers.toUtf8Bytes(canonical));
}
