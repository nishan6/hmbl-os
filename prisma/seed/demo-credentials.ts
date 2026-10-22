/**
 * DEMO credentials for the development and test seed. Public on purpose:
 * they only ever exist in databases seeded by `pnpm db:seed`, which refuses
 * to run in production. Never reuse them anywhere real.
 */

// Shared password for every demo account.
export const DEMO_PASSWORD = "demo-password-2026";

/**
 * Shared authenticator-app secret for demo users whose role requires
 * two-factor. Add it to an authenticator app with the key in README.md.
 */
export const DEMO_TOTP_SECRET = "HMBLDEMOTOTPSECRETDONOTUSEINPROD";
