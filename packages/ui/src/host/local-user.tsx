"use client";
import type { ReactNode } from "react";
/** The loopback application has one local owner; no Clerk SDK or credentials. */
export const useUser = () => ({
  isLoaded: true,
  isSignedIn: true,
  user: { id: "local" },
});
export function SignInButton({
  children,
}: {
  children: ReactNode;
  mode?: string;
}) {
  return <>{children}</>;
}
