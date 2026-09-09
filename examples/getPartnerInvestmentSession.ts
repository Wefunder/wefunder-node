// operationId: getPartnerInvestmentSession — the full session, including an `events` timeline
// of durable platform events recorded about it (read:investment_sessions).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getPartnerInvestmentSession
  const session = await wf.partner.investmentSessions.get("is_demoSession");
  console.log(session.attributes?.status, session.attributes?.funding_status);
  for (const event of session.attributes?.events ?? []) {
    console.log(event.event, event.occurred_at);
  }
  // #endregion
  return session;
}
