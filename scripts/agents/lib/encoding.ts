// Re-export encoding utilities from utils/
export {
  computeInputHash,
  computeOutputHash,
  computeCommitHash,
  generateSalt,
  stringToBytes,
  bytesToString,
} from "../../../utils/encoding";

export {
  canonicalizeJSON,
  computeJCSHash,
  toCanonicalBytes,
} from "../../../utils/canonicalize";
