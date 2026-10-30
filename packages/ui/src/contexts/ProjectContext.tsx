"use client";
import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";
export type LocalProject = {
  id: string;
  name: string;
  description?: string | null;
  project_kind: "video";
  updated_at: string;
};
function useLocalProjects() {
  const [projects, setProjects] = useState<LocalProject[]>([]),
    [currentProject, setCurrentProject] = useState<LocalProject | null>(null),
    [isLoadingProjects, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const fetchProjects = useCallback(
    async (_filter?: { project_kind: string }) => {
      setLoading(true);
      try {
        const r = await fetch("/api/projects");
        const b = await r.json();
        if (!r.ok) throw new Error(b.message);
        setProjects(b.data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load projects");
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  const selectProject = useCallback(async (id: string) => {
    try {
      const r = await fetch("/api/projects/" + id);
      const b = await r.json();
      if (!r.ok) throw new Error(b.message);
      setCurrentProject(b.data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load project",
      );
    }
  }, []);
  const updateProject = useCallback(
    async (id: string, patch: { name?: string; description?: string }) => {
      try {
        const r = await fetch("/api/projects/" + id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.message);
        const p = b.data as LocalProject;
        setCurrentProject((old) => (old?.id === id ? p : old));
        setProjects((old) => old.map((item) => (item.id === id ? p : item)));
        return p;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save project");
        return null;
      }
    },
    [],
  );
  const deleteProject = useCallback(async (id: string) => {
    try {
      const r = await fetch("/api/projects/" + id, { method: "DELETE" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.message);
      setProjects((old) => old.filter((p) => p.id !== id));
      setCurrentProject((old) => (old?.id === id ? null : old));
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete project",
      );
      return false;
    }
  }, []);
  return {
    projects,
    currentProject,
    isLoadingProjects,
    error,
    fetchProjects,
    selectProject,
    updateProject,
    deleteProject,
  };
}
const Context = createContext<ReturnType<typeof useLocalProjects> | null>(null);
export function ProjectProvider({ children }: { children: ReactNode }) {
  const value = useLocalProjects();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useProjectContext() {
  const value = useContext(Context);
  if (!value) throw new Error("ProjectProvider is required");
  return value;
}
