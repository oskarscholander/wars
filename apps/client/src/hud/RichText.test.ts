import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { linkify } from "./RichText.tsx";

const links = (text: string) =>
  linkify(text)
    .filter(isValidElement)
    .map((el) => {
      const p = (el as ReactElement<{ href: string; children: string }>).props;
      return [p.href, p.children];
    });

describe("linkify", () => {
  it("links bare URLs and leaves sentence punctuation outside", () => {
    expect(links("See https://github.com/o/r/pull/7.")).toEqual([["https://github.com/o/r/pull/7", "https://github.com/o/r/pull/7"]]);
    expect(linkify("See https://x.dev/a.").at(-1)).toBe(".");
  });

  it("links markdown links by their text", () => {
    expect(links("Opened [PR #7](https://github.com/o/r/pull/7) for you")).toEqual([["https://github.com/o/r/pull/7", "PR #7"]]);
  });

  it("keeps balanced parentheses in URLs", () => {
    expect(links("(https://en.wikipedia.org/wiki/Foo_(bar))")[0]![0]).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("never links other schemes", () => {
    expect(links("javascript:alert(1) and [x](javascript:alert(1)) and file:///etc/passwd")).toEqual([]);
  });
});
