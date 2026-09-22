import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const safeInlineImage =
  /^data:image\/(avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function MarkdownPreview({ source }: { source: string }) {
  if (!source.trim()) {
    return <p className="markdown-empty">No description yet.</p>;
  }

  return (
    <div className="markdown-preview">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          safeInlineImage.test(url) ? url : defaultUrlTransform(url)
        }
      >
        {source}
      </Markdown>
    </div>
  );
}
