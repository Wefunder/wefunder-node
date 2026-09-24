// operationId: testWebhookEndpoint — POST a real, signed example event at your endpoint (write:webhooks) and see
// the outcome inline — same envelope, signature and transport as production. Never affects
// delivery health. 10/min per endpoint.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region testWebhookEndpoint
  const outcome = await wf.webhookEndpoints.test("whe_8f3ExampleEndpoint00", "investment.executed");
  if (outcome.delivered) {
    console.log(`endpoint answered ${outcome.response_code} in ${outcome.duration_ms}ms`);
  } else {
    console.log(`no response: ${outcome.error}`); // timeout | blocked_url | tls_error | connection_failed
  }
  // #endregion
  return outcome;
}
