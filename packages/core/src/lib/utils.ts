import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
const locales = ["en", "zh", "es", "fr", "de", "it", "pt", "ja", "ko"];
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export function getLocalizedHref(path: string, locale: string) {
  if (
    path.startsWith("http") ||
    path.startsWith("mailto:") ||
    path.startsWith("#") ||
    path.includes(".") ||
    path.startsWith("/_next/")
  )
    return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `/${locale}`;
  return locales.includes(normalized.split("/")[1])
    ? normalized
    : `/${locale}${normalized}`;
}
