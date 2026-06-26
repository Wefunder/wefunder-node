// Authorization-code + PKCE flow in an Express server, with token persistence.
// Run: npx tsx examples/oauth-pkce-server.ts
import express from "express";
import {
  generatePkce,
  createAuthorizationUrl,
  exchangeCode,
  Wefunder,
  type TokenSet,
  type Pkce,
} from "@wefunder/sdk";
import { randomBytes } from "node:crypto";

const clientId = process.env.WEFUNDER_CLIENT_ID!;
const clientSecret = process.env.WEFUNDER_CLIENT_SECRET; // optional for public PKCE clients
const redirectUri = "http://localhost:3000/callback";

// Toy stores. Use a real session + DB in production.
const pending = new Map<string, { pkce: Pkce; state: string }>();
let savedTokens: TokenSet | undefined;

const app = express();

app.get("/login", (_req, res) => {
  const pkce = generatePkce();
  const state = randomBytes(16).toString("hex");
  pending.set(state, { pkce, state });
  res.redirect(
    createAuthorizationUrl({ clientId, redirectUri, scopes: ["read:investments"], state, pkce }),
  );
});

app.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const entry = state ? pending.get(state) : undefined;
  if (!code || !entry) return res.status(400).send("bad state");
  pending.delete(entry.state);

  savedTokens = await exchangeCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
    codeVerifier: entry.pkce.codeVerifier,
  });
  res.send("authorized — try /me");
});

app.get("/me", async (_req, res) => {
  if (!savedTokens) return res.redirect("/login");
  const wf = new Wefunder({
    tokens: savedTokens,
    clientId,
    clientSecret,
    onTokenRefresh: (t) => {
      savedTokens = t; // persist the rotated token
    },
  });
  res.json(await wf.users.me());
});

app.listen(3000, () => console.log("http://localhost:3000/login"));
