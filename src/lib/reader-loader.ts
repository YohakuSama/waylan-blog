import type { ComponentType } from "react";
import type { Post } from "../../shared/types";
let component: ComponentType<{ post: Post }> | null = null;
let pending: Promise<typeof import("../components/Reader")> | null = null;
export function loadReader() {
  return (pending ||= import("../components/Reader").then((module) => {
    component = module.default;
    return module;
  }));
}
export const getReader = () => component;
