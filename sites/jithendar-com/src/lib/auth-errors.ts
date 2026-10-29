/**
 * Reader-facing messages for Better Auth error codes (OAuth callback `?error=` values and API error codes).
 * Unknown codes get a generic message; raw provider text is never shown.
 */
const MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled. You can try again or use another method.",
  account_not_linked:
    "An account with this email already exists. Sign in with the method you used before, then connect this provider from Account settings.",
  email_not_found: "The provider did not share an email address. Add a verified email to that account, or use another sign-in method.",
  email_not_verified: "That provider account's email is not verified. Verify it with the provider, or use another sign-in method.",
  unable_to_get_user_info: "We could not read your profile from the provider. Please try again.",
  state_mismatch: "The sign-in attempt expired or was opened in another browser. Please start again.",
  state_not_found: "The sign-in attempt expired. Please start again.",
  please_restart_the_process: "The sign-in attempt expired. Please start again.",
  invalid_code: "The provider rejected the sign-in. Please start again.",
  no_code: "The provider did not complete the sign-in. Please try again.",
  oauth_provider_not_found: "That sign-in method is not available.",
  provider_not_found: "That sign-in method is not available.",
  unable_to_create_user: "We could not create your account. Please try again later.",
  registration_closed: "New registrations are currently closed.",
  signup_disabled: "New registrations are currently closed.",
  banned: "This account has been suspended.",
  account_already_linked_to_different_user: "That provider account is already connected to a different user on this site.",
  unable_to_link_account: "We could not connect that account. Please try again.",
  email_does_not_match: "That account's email does not match yours.",
  session_not_fresh: "For your security, sign in again before changing connected accounts.",
  failed_to_unlink_last_account: "You cannot disconnect your only way to sign in. Connect another method first.",
  internal_server_error: "Something went wrong on our side. Please try again later.",
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.toLowerCase().replace(/[\s-]+/g, "_");
  return MESSAGES[key] ?? "Sign-in failed. Please try again.";
}
