export type InlineImage = {
  dataUrl: string;
  id: string;
  name: string;
};

const dataImagePattern =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/g;
const imageReferencePattern =
  /(!\[[^\]]*\]\()taskpilot-image:([a-zA-Z0-9_-]+)(\))/g;

export function prepareEditableMarkdown(source: string) {
  const images = new Map<string, InlineImage>();
  let imageNumber = 0;
  const markdown = source.replace(
    dataImagePattern,
    (_, alt: string, dataUrl: string) => {
      const id = `image-${++imageNumber}`;
      images.set(id, { id, dataUrl, name: alt || "Image" });
      return imageReference(alt || "Image", id);
    },
  );
  return { images, markdown };
}

export type MissingInlineImage = {
  id: string;
  name: string;
};

export function hydrateImageReferences(
  source: string,
  images: Map<string, InlineImage>,
) {
  return source.replace(
    imageReferencePattern,
    (match, prefix: string, id: string, suffix: string) => {
      const image = images.get(id);
      return image ? `${prefix}${image.dataUrl}${suffix}` : match;
    },
  );
}

export function findMissingImageReferences(
  source: string,
  images: Map<string, InlineImage>,
): MissingInlineImage[] {
  const missing: MissingInlineImage[] = [];
  source.replace(
    imageReferencePattern,
    (_, prefix: string, id: string) => {
      if (!images.has(id)) {
        const name = prefix.slice(2, -2).trim() || "Image";
        missing.push({ id, name });
      }
      return _;
    },
  );
  return missing;
}

export function replaceMissingImageReferences(source: string) {
  return source.replace(imageReferencePattern, (_, prefix: string) => {
    const name = prefix.slice(2, -2).trim() || "Image";
    return `_${name} is unavailable_`;
  });
}

export function imageReference(name: string, id: string) {
  const alt = name.replace(/[\[\]]/g, "").trim() || "Image";
  return `![${alt}](taskpilot-image:${id})`;
}

export function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
