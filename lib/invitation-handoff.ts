type InvitationHandoffDependencies = {
  href: string;
  waitForAuthReady: () => Promise<void>;
  hasCurrentUser: () => boolean;
  signOutCurrentUser: () => Promise<void>;
  replaceUrl: (url: string) => void;
};

export type InvitationSignInMethod = "google" | "password";

export async function prepareInvitationHandoff({
  href,
  waitForAuthReady,
  hasCurrentUser,
  signOutCurrentUser,
  replaceUrl
}: InvitationHandoffDependencies) {
  const currentUrl = new URL(href);
  const invitation = currentUrl.searchParams.get("invited");
  if (invitation !== "1" && invitation !== "google") return false;

  await waitForAuthReady();
  if (hasCurrentUser()) await signOutCurrentUser();

  currentUrl.searchParams.delete("invited");
  replaceUrl(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  return invitation === "google" ? "google" as const : "password" as const;
}
