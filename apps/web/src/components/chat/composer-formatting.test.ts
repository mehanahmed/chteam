import { describe, expect, it } from "bun:test";
import { formatComposerText } from "./composer-formatting";

describe("composer formatting shortcuts", () => {
  it("wraps selected text with bold delimiter (*)", () => {
    const res = formatComposerText("hello world", 0, 5, "*");
    expect(res.text).toBe("*hello* world");
    expect(res.selectionStart).toBe(0);
    expect(res.selectionEnd).toBe(7);
  });

  it("unwraps when the selected text is already wrapped", () => {
    const res = formatComposerText("*hello* world", 0, 7, "*");
    expect(res.text).toBe("hello world");
    expect(res.selectionStart).toBe(0);
    expect(res.selectionEnd).toBe(5);
  });

  it("unwraps when text immediately outside the selection is wrapped", () => {
    const res = formatComposerText("*hello* world", 1, 6, "*");
    expect(res.text).toBe("hello world");
    expect(res.selectionStart).toBe(0);
    expect(res.selectionEnd).toBe(5);
  });

  it("inserts delimiter pair and positions cursor in between when no text is selected", () => {
    const res = formatComposerText("hello ", 6, 6, "*");
    expect(res.text).toBe("hello **");
    expect(res.selectionStart).toBe(7);
    expect(res.selectionEnd).toBe(7);
  });

  it("supports italic delimiter (_)", () => {
    const res = formatComposerText("some text", 5, 9, "_");
    expect(res.text).toBe("some _text_");
  });

  it("supports strikethrough delimiter (~)", () => {
    const res = formatComposerText("strike this", 0, 6, "~");
    expect(res.text).toBe("~strike~ this");
  });

  it("supports inline code delimiter (`)", () => {
    const res = formatComposerText("const x = 1", 0, 11, "`");
    expect(res.text).toBe("`const x = 1`");
  });
});
