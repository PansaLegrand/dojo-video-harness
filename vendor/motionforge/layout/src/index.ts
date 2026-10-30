export * from "./schema";
export * from "./types";
export * from "./text";
export { compileLayout, tryCompileLayout } from "./solver";

import {
  LAYOUT_CONTRACT_VERSION,
  LAYOUT_ROOT,
  layoutPlanSchema,
  type GridLayout,
  type LayoutItem,
  type LayoutPlan,
  type OverlayLayout,
  type StackLayout,
} from "./schema";

export type LayoutItemOptions = Omit<LayoutItem, "id">;

/** Detached ergonomic item descriptor for TypeScript authoring. */
export function item(id: string, options: LayoutItemOptions = {}): LayoutItem {
  return structuredClone({ id, ...options });
}

type StackPlanOptions = Omit<StackLayout, "kind" | "axis"> & {
  containerId?: string;
  items: LayoutItem[];
};

/** Canonical one-dimensional layout constructor. */
export function stack(
  axis: "row" | "column",
  options: StackPlanOptions,
): LayoutPlan {
  return makePlan(options.containerId, options.items, {
    ...withoutPlanFields(options),
    kind: "stack",
    axis,
  });
}

export function row(options: StackPlanOptions): LayoutPlan {
  return stack("row", options);
}

export function column(options: StackPlanOptions): LayoutPlan {
  return stack("column", options);
}

type GridPlanOptions = Omit<GridLayout, "kind"> & {
  containerId?: string;
  items: LayoutItem[];
};

export function grid(options: GridPlanOptions): LayoutPlan {
  return makePlan(options.containerId, options.items, {
    ...withoutPlanFields(options),
    kind: "grid",
  });
}

type OverlayPlanOptions = Omit<OverlayLayout, "kind"> & {
  containerId?: string;
  items: LayoutItem[];
};

export function overlay(options: OverlayPlanOptions): LayoutPlan {
  return makePlan(options.containerId, options.items, {
    ...withoutPlanFields(options),
    kind: "overlay",
  });
}

function makePlan(
  containerId: string | undefined,
  items: LayoutItem[],
  layout: LayoutPlan["layout"],
): LayoutPlan {
  return layoutPlanSchema.parse({
    layoutVersion: LAYOUT_CONTRACT_VERSION,
    containerId: containerId ?? LAYOUT_ROOT,
    layout,
    items,
  });
}

function withoutPlanFields<
  T extends { containerId?: string; items: LayoutItem[] },
>(value: T): Omit<T, "containerId" | "items"> {
  const { containerId: _containerId, items: _items, ...rest } = value;
  return rest;
}
