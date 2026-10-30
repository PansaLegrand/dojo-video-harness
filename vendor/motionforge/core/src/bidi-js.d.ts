declare module "bidi-js" {
  type Embeddings = {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  };
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): Embeddings;
    getReorderedIndices(text: string, embeddings: Embeddings): number[];
  };
}
