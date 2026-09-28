export type InlineImage = {
  dataUrl: string;
  id: string;
  name: string;
};

const dataImagePattern =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/g;
const imageReferencePattern =
  /(!?)\[([^\]]*)\]\(taskpilot-image:([a-zA-Z0-9_-]+)\)/g;

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
    (match, imageMarker: string, alt: string, id: string) => {
      const image = images.get(id);
      return image ? `${imageMarker}[${alt}](${image.dataUrl})` : match;
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
    (_, _imageMarker: string, alt: string, id: string) => {
      if (!images.has(id)) {
        missing.push({ id, name: alt.trim() || "Image" });
      }
      return _;
    },
  );
  return missing;
}

export function replaceMissingImageReferences(source: string) {
  return source.replace(
    imageReferencePattern,
    (_, _imageMarker: string, alt: string) => {
      const name = alt.trim() || "Image";
      return `_${name} is unavailable_`;
    },
  );
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
