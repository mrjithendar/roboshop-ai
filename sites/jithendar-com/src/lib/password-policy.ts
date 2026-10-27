/** One password rule for sign-up, reset, change and /setup (shared by server and browser forms). */
export const PASSWORD_MIN = 9;
export const PASSWORD_MAX = 128;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters, including a number and a special character. Breached passwords are rejected.`;

/** Returns a message describing what is missing, or null when the password satisfies the rule. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/\d/.test(password)) return "Include at least one number.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Include at least one special character (for example ! @ # $ %).";
  return null;
}
