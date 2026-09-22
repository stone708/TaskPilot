import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownPreview({ source }: { source: string }) {
  if (!source.trim()) {
    return <p className="markdown-empty">No description yet.</p>;
  }

  return (
    <div className="markdown-preview">
      <Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown>
    </div>
  );
}
