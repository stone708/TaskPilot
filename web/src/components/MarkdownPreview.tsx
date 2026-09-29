import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MissingInlineImage,
  replaceMissingImageReferences,
} from "./inlineImages";

const safeInlineImage =
  /^data:image\/(avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function imageSize(title?: string | null) {
  const match = /^taskpilot-size:(\d{1,3})$/.exec(title || "");
  if (!match) return 100;
  return Math.min(100, Math.max(25, Number(match[1])));
}

export function MarkdownPreview({
  source,
  missingImages = [],
  onImageSizeChange,
}: {
  source: string;
  missingImages?: MissingInlineImage[];
  onImageSizeChange?: (dataUrl: string, size: number) => void;
}) {
  if (!source.trim()) {
    return <p className="markdown-empty">No description yet.</p>;
  }

  return (
    <div className="markdown-preview">
      {missingImages.length > 0 && (
        <p className="missing-image" role="alert">
          {missingImages.length === 1
            ? `“${missingImages[0].name}” is unavailable. Remove its reference and add the image again.`
            : `${missingImages.length} images are unavailable. Remove their references and add the images again.`}
        </p>
      )}
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          safeInlineImage.test(url) ? url : defaultUrlTransform(url)
        }
        components={{
          img: ({ alt, src, title }) => {
            const size = imageSize(title);
            const canResize =
              typeof src === "string" &&
              safeInlineImage.test(src) &&
              onImageSizeChange;
            return (
              <figure className="resizable-image">
                <img
                  src={src}
                  alt={alt || ""}
                  style={{ width: `${size}%` }}
                />
                {canResize && (
                  <label className="image-size-control">
                    <span>Image size: {size}%</span>
                    <input
                      type="range"
                      min="25"
                      max="100"
                      step="5"
                      value={size}
                      aria-label={`Size for ${alt || "image"}`}
                      onChange={(event) =>
                        onImageSizeChange(src, Number(event.target.value))
                      }
                    />
                    <small>Aspect ratio is locked.</small>
                  </label>
                )}
              </figure>
            );
          },
        }}
      >
        {replaceMissingImageReferences(source)}
      </Markdown>
    </div>
  );
}
