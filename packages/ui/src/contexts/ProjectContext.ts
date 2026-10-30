import { useSyncExternalStore } from "react";
type Project = { id: string; name: string };
let currentProject: Project | null = null;
const listeners = new Set<() => void>();
const snapshot = () => currentProject;
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
const publish = (p: Project) => {
  currentProject = p;
  listeners.forEach((f) => f());
};
async function selectProject(id: string) {
  const r = await fetch("/api/projects/" + id);
  const v = await r.json();
  if (r.ok) publish(v.data);
}
async function updateProject(id: string, patch: Partial<Project>) {
  const r = await fetch("/api/projects/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const v = await r.json();
  if (!r.ok) return null;
  if (currentProject?.id === id) publish(v.data);
  return v.data as Project;
}
export function useProjectContext() {
  return {
    currentProject: useSyncExternalStore(subscribe, snapshot, snapshot),
    selectProject,
    updateProject,
  };
}
