import { PBKDF2_ITERATIONS } from "./crypto";

export interface VaultKdfParams {
  /** Base64-encoded salt. Salt is not a secret, but must remain stable. */
  salt: string;
  iterations: number;
}

/** KDF parameters supplied by the deployment for first-time archive imports. */
export function getDeploymentVaultKdf(): VaultKdfParams {
  const iterations = Number.parseInt(process.env.NEXT_PUBLIC_VAULT_ITERATIONS ?? "", 10);
  return {
    salt: (process.env.NEXT_PUBLIC_VAULT_SALT ?? "").trim(),
    iterations: Number.isSafeInteger(iterations) && iterations > 0 ? iterations : PBKDF2_ITERATIONS,
  };
}
