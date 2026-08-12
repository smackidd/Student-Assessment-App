type InvitationHandoffDependencies = {
  href: string;
  waitForAuthReady: () => Promise<void>;
  hasCurrentUser: () => boolean;
  signOutCurrentUser: () => Promise<void>;
  replaceUrl: (url: string) => void;
};

export async function prepareInvitationHandoff({
  href,
  waitForAuthReady,
  hasCurrentUser,
  signOutCurrentUser,
  replaceUrl
}: InvitationHandoffDependencies) {
  const currentUrl = new URL(href);
  if (currentUrl.searchParams.get("invited") !== "1") return false;

  await waitForAuthReady();
  if (hasCurrentUser()) await signOutCurrentUser();

  currentUrl.searchParams.delete("invited");
  replaceUrl(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  return true;
}
