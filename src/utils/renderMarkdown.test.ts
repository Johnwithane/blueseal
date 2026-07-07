// @vitest-environment jsdom
//
// P1-02: rendered markdown is fed to v-html, so untrusted (prompt-injected)
// content must be sanitized, not just marked-escaped. DOMPurify does the actual
// stripping; it needs a spec-complete DOM, and the suite's default happy-dom is
// not faithful enough to run DOMPurify's traversal (it mangles output), so this
// one file pins jsdom — DOMPurify's own reference environment — to verify the
// dangerous payloads are genuinely neutralized end-to-end.

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

describe("renderMarkdown", () => {
  it("renders ordinary markdown structure", () => {
    const html = renderMarkdown("# Hi\n\n- one\n- two\n\n**bold**");
    expect(html).toContain("<h1");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("passes breaks:true through to marked (chat feel)", () => {
    expect(renderMarkdown("a\nb", { breaks: true })).toContain("<br>");
    expect(renderMarkdown("a\nb")).not.toContain("<br>");
  });

  it("strips inline event handlers (onerror)", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips <svg onload> payloads", () => {
    const html = renderMarkdown('<svg onload="alert(1)"></svg>');
    expect(html).not.toContain("onload");
  });

  it("strips javascript: hrefs", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("drops <script> tags", () => {
    const html = renderMarkdown("<script>alert(1)</scr" + "ipt>");
    expect(html.toLowerCase()).not.toContain("<script");
  });

  it("keeps safe relative links for LegalDocument's rewrite step", () => {
    expect(renderMarkdown("[privacy](./privacy-policy.md)")).toContain(
      'href="./privacy-policy.md"',
    );
  });
});
