"use client";
import { useNativeEditorText as useProductEditorText } from "./native-editor-copy.product";
import { localEditorCopy } from "@/host/editor-copy";
export function useNativeEditorText() {
  const productText = useProductEditorText();
  return (text: string) => productText(localEditorCopy(text));
}
