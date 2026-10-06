// Guide: a post-or-ignore rule for `investment.changed` from the docs' sync guide. The event is a
// thin nudge — `first` and `fields` are hints, and both can be null or absent on older events, so
// the rule treats "unknown" as "don't post". Compile-checked by `npm run typecheck:examples`.
import {
  constructEvent,
  dispatchWebhook,
  type InvestmentChangedEventData,
} from "../src/index.js";

export function shouldPost(data: InvestmentChangedEventData): string | null {
  // #region guides/investment-changed-notifier
  const { visible, first, fields } = data;
  if (first === true && visible) return "new investment";
  if (!visible) return "canceled or hidden";
  // Older events carry `fields` as null or omit it: no hint, no post.
  const changed = fields ?? [];
  if (changed.includes("status")) return "status changed";
  if (changed.includes("amounts")) return "amount changed";
  if (changed.includes("group")) return "group changed";
  return null; // `reason: "recomputed"` and every other combination
  // #endregion
}

export async function example(
  rawBody: string,
  signatureHeader: string,
  secret: string,
) {
  let verdict: string | null = null;
  await dispatchWebhook(constructEvent(rawBody, signatureHeader, secret), {
    "investment.changed": (event) => {
      verdict = shouldPost(event.data);
    },
  });
  return verdict;
}
