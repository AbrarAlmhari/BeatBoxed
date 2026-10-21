/** Sign-up's rule (SignUp.tsx), shared by reset and change password. */
export const PASSWORD_MIN = 8

/** What's wrong with a new password and its confirmation, or null if nothing. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`
  if (password !== confirm) return "The two passwords don't match."
  return null
}
