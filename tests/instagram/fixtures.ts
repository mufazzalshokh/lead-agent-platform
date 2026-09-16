import type { InstagramPlatformConfig } from "../../packages/config/src/index.js";
export { IDS, NOW, NONCE, authorization, dataProtection, digest } from "../telegram/fixtures.js";
export const instagramConfig: InstagramPlatformConfig = Object.freeze({
  appId: "123456789",
  appSecret: "s".repeat(32),
  graphApiVersion: "v25.0",
  oauthRedirectUri: "https://api.example.test/v1/integrations/instagram/callback",
  requestTimeoutMilliseconds: 50,
  webhookVerifyToken: "v".repeat(43),
});
export const TOKEN = "synthetic_instagram_test_token_only";
export const ACCOUNT_ID = "123456789012345";
export const CUSTOMER_ID = "987654321098765";
