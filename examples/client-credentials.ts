// Server-to-server: exchange client credentials for a token and make a call.
// Run: WEFUNDER_CLIENT_ID=... WEFUNDER_CLIENT_SECRET=... npx tsx examples/client-credentials.ts
import { Wefunder } from "@wefunder/sdk";

async function main() {
  const wf = await Wefunder.fromClientCredentials({
    clientId: process.env.WEFUNDER_CLIENT_ID!,
    clientSecret: process.env.WEFUNDER_CLIENT_SECRET!,
    scopes: ["read:public"],
  });

  console.log("mode:", wf.mode); // "live" or "test", from the token prefix

  // client_credentials holds only read:public — browse public offerings.
  // (wf.users.me() would throw 403 insufficient_scope: it needs read:profile.)
  for await (const offering of wf.offerings.all()) {
    console.log(offering.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
