import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CharacterCard } from "./CharacterCard";

describe("CharacterCard", () => {
  it("disables the start action while an import is in progress", () => {
    const html = renderToStaticMarkup(
      <CharacterCard name="A" description="B" startLabel="Downloading" startDisabled />,
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain("Downloading");
  });

  it("卡内的 z-index 关在自己的层叠上下文里，不会盖住吸顶的 tab", () => {
    const html = renderToStaticMarkup(
      <CharacterCard name="A" description="B" startLabel="开始" />,
    );

    expect(html).toContain("character-card group relative isolate");
  });
});
