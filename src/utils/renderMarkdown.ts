import { marked } from "marked";
import DOMPurify from "dompurify";

// Render Markdown to HTML that is safe to hand to `v-html`. `marked` escapes
// `<`/`>` in normal text, but that is a blocklist, not a sanitizer: model
// output or prompt-injected content (an OCR'd receipt, another party's job
// description flowing through the assistant) can still smuggle event handlers
// (`<img onerror>`), `<svg onload>`, or `javascript:` hrefs, which then execute
// when rendered in an authenticated session. DOMPurify strips all of those.
// Every `v-html` of rendered markdown must go through here (P1-02).
export function renderMarkdown(
  source: string,
  opts: { breaks?: boolean } = {},
): string {
  const raw = marked.parse(source, {
    gfm: true,
    breaks: opts.breaks ?? false,
    async: false,
  }) as string;
  return DOMPurify.sanitize(raw);
}
