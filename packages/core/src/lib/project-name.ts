export const DEFAULT_PROJECT_NAME = "Untitled Project";
export const PROJECT_NAME_MAX_LENGTH = 120;
export const DEFAULT_PROJECT_NAMES = new Set([
  "Untitled Project",
  "Proyecto sin título",
  "無題のプロジェクト",
  "Projet sans titre",
  "未命名项目",
]);

const getFileExtension = (value: string) => {
  const extensionMatch = value.match(/(\.[^./\\]+)$/);
  return extensionMatch?.[1] || "";
};

export const clampProjectName = (
  value: string,
  options: { preserveExtension?: boolean } = {},
) => {
  const trimmedValue = value.trim();

  if (trimmedValue.length <= PROJECT_NAME_MAX_LENGTH) {
    return trimmedValue;
  }

  if (options.preserveExtension) {
    const extension = getFileExtension(trimmedValue);

    if (extension && extension.length < PROJECT_NAME_MAX_LENGTH) {
      return (
        trimmedValue.slice(0, PROJECT_NAME_MAX_LENGTH - extension.length) +
        extension
      );
    }
  }

  return trimmedValue.slice(0, PROJECT_NAME_MAX_LENGTH);
};

export const getProjectNameOrDefault = (value?: string | null) => {
  const trimmedValue = value?.trim() || "";

  if (!trimmedValue) {
    return DEFAULT_PROJECT_NAME;
  }

  return clampProjectName(trimmedValue);
};

export const getProjectNameValidationError = (value?: string | null) => {
  const trimmedValue = value?.trim() || "";

  if (!trimmedValue) {
    return "Project name cannot be empty.";
  }

  if (trimmedValue.length > PROJECT_NAME_MAX_LENGTH) {
    return `Project name must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return null;
};

export const isDefaultProjectName = (value?: string | null) => {
  const trimmedValue = value?.trim() || "";
  return DEFAULT_PROJECT_NAMES.has(trimmedValue);
};
