// Guide: act on behalf of a user (authorization_code + PKCE). The consent screen IS the
// installation on the user — there is nothing to call on /installations for this case.
// Split across your redirect handler (step 1) and your callback handler (steps 2–3).
import { Wefunder, createAuthorizationUrl, exchangeCode, generatePkce, type TokenSet } from "../src/index.js";

export async function beginAuthorization(saveAttempt: (state: string, codeVerifier: string) => Promise<void>) {
  // #region guides/user-token
  // 1. Send the investor to consent. Keep state + the PKCE verifier in their session.
  const pkce = generatePkce();
  const state = crypto.randomUUID();
  await saveAttempt(state, pkce.codeVerifier);
  const authorizationUrl = createAuthorizationUrl({
    clientId: process.env.WEFUNDER_CLIENT_ID!,
    redirectUri: process.env.WEFUNDER_REDIRECT_URI!,
    scopes: ["read:investments"],
    state,
    pkce,
  });
  // redirect(authorizationUrl)

  // 2. On the callback, exchange the code (after checking `state` matches the session).
  const tokens = await exchangeCode({
    clientId: process.env.WEFUNDER_CLIENT_ID!,
    clientSecret: process.env.WEFUNDER_CLIENT_SECRET, // omit for public clients
    code: "AUTHORIZATION_CODE",
    redirectUri: process.env.WEFUNDER_REDIRECT_URI!,
    codeVerifier: pkce.codeVerifier,
  });

  // 3. Read their holdings. The access token lasts two hours; the SDK rotates the refresh
  //    token for you and hands every new set to `store.save` — persist the whole thing.
  const wf = new Wefunder({
    tokens,
    clientId: process.env.WEFUNDER_CLIENT_ID!,
    clientSecret: process.env.WEFUNDER_CLIENT_SECRET,
    store: { save: (next: TokenSet) => persistTokens(next) },
  });
  const portfolio = await wf.portfolio.get();
  console.log(portfolio.attributes?.total_current_value_cents);
  // #endregion
  return authorizationUrl;
}

async function persistTokens(_tokens: TokenSet): Promise<void> {} // harness stand-in for your DB
