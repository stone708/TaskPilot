import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MissingInlineImage,
  replaceMissingImageReferences,
} from "./inlineImages";

const safeInlineImage =
  /^data:image\/(avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function MarkdownPreview({
  source,
  missingImages = [],
}: {
  source: string;
  missingImages?: MissingInlineImage[];
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
      >
        {replaceMissingImageReferences(source)}
      </Markdown>
    </div>
  );
}
