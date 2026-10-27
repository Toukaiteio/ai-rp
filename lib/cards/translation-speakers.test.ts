import { describe, expect, it } from "vitest";
import { parseTranslationDictionary, synchronizeTranslationSpeakers } from "./translation-types";
import { blocksToRaw, parseBlocks } from "@/lib/blocks";

describe("translation speaker synchronization", () => {
  it("changes only exact character who attributes of dlg and act", () => {
    const source = `<dlg who="Alice" title="Alice">Alice and Alicia</dlg>
<act  who = 'Alice' >{{char}} walks</act>
<dlg who="Alicia">NPC</dlg><act who="Alice Jr">NPC</act>
<dlg who="{{char}}">Macro</dlg><unknown who="Alice">Alice</unknown>
<narr>who="Alice"</narr><dlg data-who="Alice" title='who="Alice"'>Text</dlg>`;
    const expected = source.replace('<dlg who="Alice"', '<dlg who="艾丽丝"')
      .replace("<act  who = 'Alice'", "<act  who = '艾丽丝'");
    expect(synchronizeTranslationSpeakers(source, "Alice", "艾丽丝")).toBe(expected);
  });

  it("decodes escaped names for equality and safely escapes translated attribute values", () => {
    const source = `<dlg who='A &amp; &quot;B&quot; &lt;C&gt;'>Hi</dlg><act who="A &#38; &#34;B&#34; &#x3c;C&#x3e;">Acts</act>`;
    const target = `艾 & "丽" '丝' <img onerror="alert(1)">`;
    const escaped = "艾 &amp; &quot;丽&quot; &#39;丝&#39; &lt;img onerror=&quot;alert(1)&quot;&gt;";
    expect(synchronizeTranslationSpeakers(source, 'A & "B" <C>', target)).toBe(
      `<dlg who='${escaped}'>Hi</dlg><act who="${escaped}">Acts</act>`,
    );
    expect(parseBlocks(synchronizeTranslationSpeakers(source, 'A & "B" <C>', target))[0].who).toBe(target);
    const blocks = parseBlocks(synchronizeTranslationSpeakers(source, 'A & "B" <C>', target));
    expect(parseBlocks(blocksToRaw(blocks))).toEqual(blocks);
    expect(synchronizeTranslationSpeakers('<act who="O&apos;Brien">Acts</act>', "O'Brien", "欧布莱恩"))
      .toBe('<act who="欧布莱恩">Acts</act>');
  });

  it("preserves quoted greater-than signs, unknown tags and complete macros without interpreting HTML", () => {
    const source = `<dlg title="a > b" who="Alice">Hi</dlg><script who="Alice">Alice</script>{{<act who="Alice">}}`;
    expect(synchronizeTranslationSpeakers(source, "Alice", "艾丽丝")).toBe(
      `<dlg title="a > b" who="艾丽丝">Hi</dlg><script who="Alice">Alice</script>{{<act who="Alice">}}`,
    );
    expect(parseTranslationDictionary(JSON.stringify({ a: source }), { a: source })).toEqual({ a: source });
    expect(parseTranslationDictionary(JSON.stringify({ a: source.replace('a > b', 'a > c') }), { a: source })).toEqual({
      a: source.replace('a > b', 'a > c'),
    });
    expect(synchronizeTranslationSpeakers('<dlg who="{{char}}">Hi</dlg>', "{{char}}", "艾丽丝"))
      .toBe('<dlg who="{{char}}">Hi</dlg>');
  });
});
