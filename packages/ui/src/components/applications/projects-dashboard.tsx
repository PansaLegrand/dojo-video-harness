"use client";

import React from "react";
import Link from "next/link";
import { SignInButton } from "@/host/local-user";
import { Film, Loader2, Pencil, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectContext } from "@/contexts/ProjectContext";
import { useTranslation } from "@/lib/i18n";
import { getLocalizedHref } from "@/lib/utils";
import {
  clampProjectName,
  PROJECT_NAME_MAX_LENGTH,
} from "@/lib/project-name";

type ProjectsDashboardProps = {
  isSignedIn: boolean;
  onCreateProject: () => void;
  isCreatingProject: boolean;
  mode?: "editor" | "workflow";
  hideEmptyCreate?: boolean;
};

export function ProjectsDashboard({
  isSignedIn,
  onCreateProject,
  isCreatingProject,
  mode = "editor",
  hideEmptyCreate = false,
}: ProjectsDashboardProps) {
  const {
    projects,
    isLoadingProjects,
    error,
    fetchProjects,
    updateProject,
    deleteProject,
  } = useProjectContext();
  const { t, locale } = useTranslation();
  const isWorkflowMode = mode === "workflow";
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editLoading, setEditLoading] = React.useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isSignedIn) {
      void fetchProjects({ project_kind: isWorkflowMode ? "workflow" : "editor" });
    }
  }, [fetchProjects, isSignedIn, isWorkflowMode]);

  if (!isSignedIn) {
    const authTitleKey = isWorkflowMode
      ? "application.workflows.auth.title"
      : "application.projects.auth.title";
    const authSubtitleKey = isWorkflowMode
      ? "application.workflows.auth.subtitle"
      : "application.projects.auth.subtitle";

    if (isWorkflowMode) {
      return (
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700">
            <Workflow className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">
            {t(authTitleKey)}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            {t(authSubtitleKey)}
          </p>
          <div className="mx-auto mt-5 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
            {[
              "application.workflows.auth.feature.arrange",
              "application.workflows.auth.feature.reuse",
              "application.workflows.auth.feature.run",
            ].map((key) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
                {t(key)}
              </div>
            ))}
          </div>
          <SignInButton mode="modal">
            <Button className="mt-5">
              {t("common.header.login")}
            </Button>
          </SignInButton>
        </div>
      );
    }

    return (
      <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-white p-6 text-center shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">
          {t(authTitleKey)}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {t(authSubtitleKey)}
        </p>

      </div>
    );
  }

  if (isLoadingProjects) {
    return <p className="text-sm text-gray-600">{t("application.projects.loading")}</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {t("application.projects.error_prefix")} {error}
      </div>
    );
  }

  if (projects.length === 0) {
    const emptyKey = isWorkflowMode
      ? "application.workflows.empty"
      : "application.projects.empty";
    const creatingKey = isWorkflowMode
      ? "application.workflows.action.creating"
      : "application.projects.action.creating";
    const createFirstKey = isWorkflowMode
      ? "application.workflows.action.create_first"
      : "application.projects.action.create_first";

    return (
      <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-700">
          {t(emptyKey)}
        </p>
        {!hideEmptyCreate && <Button className="mt-4" onClick={onCreateProject} disabled={isCreatingProject}>
          {isCreatingProject ? t(creatingKey) : t(createFirstKey)}
        </Button>}
      </div>
    );
  }

  const handleEdit = (projectId: string, currentName: string, currentDescription: string) => {
    setEditingId(projectId);
    setEditName(currentName);
    setEditDescription(currentDescription || "");
  };

  const handleEditSave = async (projectId: string) => {
    setEditLoading(true);
    await updateProject(projectId, {
      name: clampProjectName(editName),
      description: editDescription,
    });
    setEditLoading(false);
    setEditingId(null);
  };

  const handleEditKeyDown = (event: React.KeyboardEvent, projectId: string) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleEditSave(projectId);
      return;
    }
    if (event.key === "Escape") {
      setEditingId(null);
    }
  };

  const handleDelete = async (projectId: string) => {
    if (!window.confirm(t("application.projects.confirm_delete"))) return;
    setDeleteLoadingId(projectId);
    await deleteProject(projectId);
    setDeleteLoadingId(null);
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => {
        if (typeof project.id !== "string") return null;
        const projectId = project.id;
        const isEditing = editingId === projectId;
        const editorHref = getLocalizedHref(`/applications/editor/${projectId}`, locale);
        const workflowHref = getLocalizedHref(`/workflows/${projectId}`, locale);
        const primaryHref = isWorkflowMode ? workflowHref : editorHref;
        const primaryLabel = isWorkflowMode
          ? t("application.workflows.action.open_workflow")
          : t("application.projects.action.open_editor");

        return (
          <article key={projectId} className="rounded-lg border bg-white p-4 shadow-sm">
            {isEditing ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleEditSave(projectId);
                }}
              >
                <input
                  type="text"
                  value={editName}
                  onChange={(event) =>
                    setEditName(clampProjectName(event.target.value))
                  }
                  disabled={editLoading}
                  autoFocus
                  onKeyDown={(event) => handleEditKeyDown(event, projectId)}
                  placeholder={t("application.projects.input.name_placeholder")}
                  className="w-full rounded-md border px-2 py-1 text-sm"
                  maxLength={PROJECT_NAME_MAX_LENGTH}
                />
                <textarea
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  disabled={editLoading}
                  onKeyDown={(event) => handleEditKeyDown(event, projectId)}
                  placeholder={t("application.projects.input.description_placeholder")}
                  className="min-h-[72px] w-full rounded-md border px-2 py-1 text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" type="submit" disabled={editLoading}>
                    {editLoading
                      ? t("application.projects.action.saving")
                      : t("application.projects.action.save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={editLoading}
                  >
                    {t("application.projects.action.cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <Link href={primaryHref} className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-blue-700 hover:text-blue-800">
                      {project.name}
                    </h3>
                  </Link>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        handleEdit(projectId, project.name, project.description ?? "")
                      }
                      title={t("application.projects.action.edit")}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleDelete(projectId)}
                      title={t("application.projects.action.delete")}
                      disabled={deleteLoadingId === projectId}
                    >
                      {deleteLoadingId === projectId ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                  {project.description || t("application.projects.field.no_description")}
                </p>
                <p className="mt-3 text-xs text-gray-500">
                  {t("application.projects.field.last_updated")}{" "}
                  {new Date(project.updated_at).toLocaleDateString(locale)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={primaryHref}>
                      {isWorkflowMode ? (
                        <Workflow className="h-4 w-4" aria-hidden="true" />
                      ) : null}
                      {primaryLabel}
                    </Link>
                  </Button>
                  {!isWorkflowMode ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={getLocalizedHref(
                          `/applications/editor/${projectId}/outputs`,
                          locale,
                        )}
                      >
                        <Film className="h-4 w-4" aria-hidden="true" />
                        {t("application.projects.action.videos")}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
