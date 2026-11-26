// The auth forms own their inputs, so what the user typed is only visible
// inside them. Reporting the credentials alongside the session token lets a
// caller persist them (a desktop app can store them in the OS keyring) or prefill a
// later sign-in. `token` is null when the server doesn't auto-sign-in.
export type AuthSuccess = {
  token: string | null;
  email: string;
  password: string;
};

/**
 * What a submit attempt produced: a session token (null when the server does
 * not auto-sign-in), or a message to show against the form. Supplying one to a
 * form routes the credential exchange somewhere other than a Better Auth
 * client in the page — a desktop app can sign in from its own process,
 * whose requests carry no `Origin` the server would have to trust.
 */
export type AuthSubmitResult = { token: string | null } | { error: string };

export type LoginSubmit = (values: {
  email: string;
  password: string;
}) => Promise<AuthSubmitResult>;

export type RegisterSubmit = (values: {
  name: string;
  email: string;
  password: string;
}) => Promise<AuthSubmitResult>;
