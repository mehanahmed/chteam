import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "./markdown";

describe("markdown rendering", () => {
  it("renders WhatsApp bold (*bold*) and markdown bold (**bold**)", () => {
    const html1 = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("*bold text*", { isOwn: false }),
      ),
    );
    expect(html1).toContain("<strong");
    expect(html1).toContain("bold text</strong>");

    const html2 = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("**markdown bold**", { isOwn: false }),
      ),
    );
    expect(html2).toContain("<strong");
    expect(html2).toContain("markdown bold</strong>");
  });

  it("renders WhatsApp italic (_italic_)", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("_italic text_", { isOwn: false }),
      ),
    );
    expect(html).toContain("<em");
    expect(html).toContain("italic text</em>");
  });

  it("does not italicize underscores inside identifier names", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("const my_variable_name = 1;", { isOwn: false }),
      ),
    );
    expect(html).not.toContain("<em");
    expect(html).toContain("my_variable_name");
  });

  it("does not bold asterisks in math expressions", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("5 * 3 * 2 = 30", { isOwn: false }),
      ),
    );
    expect(html).not.toContain("<strong");
    expect(html).toContain("5 * 3 * 2 = 30");
  });

  it("renders strikethrough (~strike~ and ~~strike~~)", () => {
    const html1 = renderToStaticMarkup(
      createElement("div", null, renderMarkdown("~strike~", { isOwn: false })),
    );
    expect(html1).toContain("<del");
    expect(html1).toContain("strike</del>");

    const html2 = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("~~strike2~~", { isOwn: false }),
      ),
    );
    expect(html2).toContain("<del");
    expect(html2).toContain("strike2</del>");
  });

  it("renders inline code (`code`)", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("Check `npm install` now", { isOwn: false }),
      ),
    );
    expect(html).toContain("<code");
    expect(html).toContain("npm install</code>");
  });

  it("renders nested bold and italic (*_bold italic_*)", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("*_bold and italic_*", { isOwn: false }),
      ),
    );
    expect(html).toContain("<strong");
    expect(html).toContain("<em");
    expect(html).toContain("bold and italic");
  });

  it("renders markdown links ([text](url)) and rejects javascript protocols", () => {
    const htmlValid = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("See [Our Website](https://example.com) for info", {
          isOwn: false,
        }),
      ),
    );
    expect(htmlValid).toContain('<a href="https://example.com/"');
    expect(htmlValid).toContain("Our Website</a>");

    const htmlInvalid = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown("See [Attack](javascript:alert(1))", { isOwn: false }),
      ),
    );
    expect(htmlInvalid).not.toContain("href=");
    expect(htmlInvalid).toContain("[Attack](javascript:alert(1))");
  });

  it("renders code blocks with language and code content", () => {
    const markdown = "```typescript\nconst message = 'hello';\n```";
    const html = renderToStaticMarkup(
      createElement("div", null, renderMarkdown(markdown, { isOwn: false })),
    );
    expect(html).toContain("typescript");
    expect(html).toContain("<pre");
    expect(html).toContain("const message = &#x27;hello&#x27;;");
  });

  it("renders blockquotes (> quote)", () => {
    const markdown = "> This is an important quote\n> Second line of quote";
    const html = renderToStaticMarkup(
      createElement("div", null, renderMarkdown(markdown, { isOwn: false })),
    );
    expect(html).toContain("<blockquote");
    expect(html).toContain("This is an important quote");
    expect(html).toContain("Second line of quote");
  });

  it("renders unordered and ordered lists", () => {
    const bulletMd = "- First item\n- Second item with *bold*";
    const bulletHtml = renderToStaticMarkup(
      createElement("div", null, renderMarkdown(bulletMd, { isOwn: false })),
    );
    expect(bulletHtml).toContain("<ul");
    expect(bulletHtml).toContain("<li>First item</li>");
    expect(bulletHtml).toContain("<strong");
    expect(bulletHtml).toContain("bold</strong>");

    const numberedMd = "1. First step\n2. Second step";
    const numberedHtml = renderToStaticMarkup(
      createElement("div", null, renderMarkdown(numberedMd, { isOwn: false })),
    );
    expect(numberedHtml).toContain("<ol");
    expect(numberedHtml).toContain("<li>First step</li>");
    expect(numberedHtml).toContain("<li>Second step</li>");
  });

  it("renders headings (# Heading 1)", () => {
    const headingMd = "# Welcome to CHTeam\n## Getting Started";
    const headingHtml = renderToStaticMarkup(
      createElement("div", null, renderMarkdown(headingMd, { isOwn: false })),
    );
    expect(headingHtml).toContain("Welcome to CHTeam");
    expect(headingHtml).toContain("Getting Started");
  });

  it("renders horizontal rules (---)", () => {
    const hrMd = "Above\n---\nBelow";
    const hrHtml = renderToStaticMarkup(
      createElement("div", null, renderMarkdown(hrMd, { isOwn: false })),
    );
    expect(hrHtml).toContain("<hr");
    expect(hrHtml).toContain("Above");
    expect(hrHtml).toContain("Below");
  });

  it("resolves WhatsApp participant mentions inside formatted text", () => {
    const text = "*Hello @98797300309 welcome!*";
    const participants = [
      {
        jid: "98797300309@s.whatsapp.net",
        phoneNumber: "98797300309",
        displayName: "Kelvin Cheng",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        renderMarkdown(text, {
          isOwn: false,
          mentionParticipants: participants,
        }),
      ),
    );
    expect(html).toContain("<strong");
    expect(html).toContain("@Kelvin Cheng");
    expect(html).toContain("welcome!</strong>");
  });
});
