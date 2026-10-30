import type { ReactNode } from "react";
import { ProjectProvider } from "@/contexts/ProjectContext";
export default function LocalApplicationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ProjectProvider>{children}</ProjectProvider>;
}
