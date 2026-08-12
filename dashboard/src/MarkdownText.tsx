import Markdown, { type Components } from "react-markdown";

const components = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      className="text-sky-300 underline decoration-sky-400/30 underline-offset-2 hover:text-sky-200"
      target="_blank"
      rel="noreferrer"
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote {...props} className="my-3 border-l-2 border-slate-600 pl-3 text-slate-400" />
  ),
  code: ({ node: _node, ...props }) => (
    <code
      {...props}
      className={`rounded bg-slate-950/80 px-1 py-0.5 font-mono text-[0.9em] text-slate-200 ${props.className ?? ""}`}
    />
  ),
  h1: ({ node: _node, ...props }) => <h1 {...props} className="mb-3 mt-5 text-lg font-semibold text-white first:mt-0" />,
  h2: ({ node: _node, ...props }) => <h2 {...props} className="mb-2 mt-5 text-base font-semibold text-white first:mt-0" />,
  h3: ({ node: _node, ...props }) => <h3 {...props} className="mb-2 mt-4 text-sm font-semibold text-slate-100 first:mt-0" />,
  hr: ({ node: _node, ...props }) => <hr {...props} className="my-4 border-slate-700" />,
  li: ({ node: _node, ...props }) => <li {...props} className="my-1 pl-1" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="my-3 list-decimal space-y-1 pl-5" />,
  p: ({ node: _node, ...props }) => <p {...props} className="mb-3 leading-6 last:mb-0" />,
  pre: ({ node: _node, ...props }) => (
    <pre
      {...props}
      className="my-3 max-w-full overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-300"
    />
  ),
  strong: ({ node: _node, ...props }) => <strong {...props} className="font-semibold text-slate-100" />,
  ul: ({ node: _node, ...props }) => <ul {...props} className="my-3 list-disc space-y-1 pl-5" />,
} satisfies Components;

export const MarkdownText = ({ text, live = false }: { text: string; live?: boolean }) => (
  <div className="min-w-0 text-sm leading-6 text-slate-200">
    <Markdown skipHtml components={components}>
      {text}
    </Markdown>
    {live ? <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-emerald-400 align-middle" /> : null}
  </div>
);
