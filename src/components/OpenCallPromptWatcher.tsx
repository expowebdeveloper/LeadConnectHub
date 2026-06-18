/**
 * Previously polled for un-dispoed calls and forced a re-open of the
 * outcome dialog. We now enforce dispo only on the *current* call via the
 * outcome dialog's close-guard, so this background nag is intentionally a
 * no-op. Kept as an export so existing mounts compile without churn.
 */
export function OpenCallPromptWatcher() {
  return null;
}