/**
 * The page a signed-out person lands on after signing in (CD-445).
 * `/login` is the sign-in page itself, so it goes home. Anywhere else is the deep link
 * they opened (a pipeline, a company, a meeting) and stays: sign-in was shown on that
 * page, and the address was not replaced.
 */
export function pathAfterSignIn(pathname: string): string {
  return pathname === '/login' ? '/' : pathname;
}
