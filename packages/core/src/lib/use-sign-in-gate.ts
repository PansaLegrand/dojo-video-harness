"use client";
import { useRouter, useParams } from "next/navigation";
export const useSignInGate = () => {
  const router = useRouter(),
    params = useParams();
  return () => router.push(`/${params.lang ?? "en"}/settings`);
};
