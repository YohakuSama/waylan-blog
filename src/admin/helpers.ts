import { useEffect, useRef } from "react";
import { MAX_IMAGE, toBase64, uploadPath } from "../../shared/uploads";
import type { Upload } from "./types";

/** Shared editor behavior: date labels, file validation and unsaved-change guards. */
export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};
export const ago = (date: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(date)) / 60000));
  return minutes < 1
    ? "刚刚"
    : minutes < 60
      ? `${minutes} 分钟前`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} 小时前`
        : `${Math.round(minutes / 1440)} 天前`;
};

/** A content branch can store edits without publishing them to the live main branch. */
export const editsLive = (branch: string) => branch === "main";

export function saveMessage(branch: string, operation: "post" | "new-post" | "site" | "delete", title = "") {
  if (!editsLive(branch)) return operation === "delete"
    ? `已从内容分支「${branch}」删除「${title}」，正式网站未受影响；需要通过 PR 合并到 main。`
    : `已保存到内容分支「${branch}」，尚未发布；需要通过 PR 合并到 main。`;
  if (operation === "delete") return `已删除「${title}」，网站会在一两分钟后更新。`;
  if (operation === "new-post") return "已发布，网站会在一两分钟后更新。";
  return "已保存，网站会在一两分钟后更新。";
}

/** Reads an image chosen by the author into an upload, or explains why not. */
export async function readImage(file: File): Promise<Upload> {
  if (file.size > MAX_IMAGE) throw new Error("单张图片不能超过 5 MB。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = await uploadPath(bytes);
  if (!path) throw new Error("只支持 PNG、JPG、GIF、WebP、AVIF 图片。");
  const data = toBase64(bytes),
    ext = path.split(".").pop()!;
  return {
    path,
    data,
    url: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${data}`,
  };
}
export function pickImage(onPick: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif";
  input.onchange = () => input.files?.[0] && onPick(input.files[0]);
  input.click();
}
/** Uploads still referenced by the text being saved. */
export function usedUploads(uploads: Upload[], text: string) {
  const used = uploads
    .filter((u) => !u.sent && text.includes(u.path))
    .filter((u, i, all) => all.findIndex((x) => x.path === u.path) === i);
  if (used.length > 8) throw new Error("一次最多保存 8 张新图片，请分几次保存。");
  if (used.reduce((n, u) => n + u.data.length, 0) > 15 * 1024 * 1024)
    throw new Error("新图片总量太大，请分几次保存。");
  return used.map(({ path, data }) => ({ path, data }));
}

/** Warns before leaving a page that has unsaved edits. */
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const stop = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", stop);
    return () => removeEventListener("beforeunload", stop);
  }, [dirty]);
}
export function useSaveKey(save: () => void) {
  const ref = useRef(save);
  ref.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        ref.current();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

