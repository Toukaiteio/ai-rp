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
});
