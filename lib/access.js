// Who may use Homey Home's room controls: the HomeyDeck admin, plus the
// usernames in HOME_USERS (comma separated). Everyone with an account can
// still use the HomeyDeck page for their own PCs.

export function allowedUsers(env) {
  return String(env.HOME_USERS ?? "")
    .split(/[,\s]+/)
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

export function canUseHome(user, env) {
  return user?.role === "admin" || allowedUsers(env).includes(String(user?.name ?? "").toLowerCase());
}
