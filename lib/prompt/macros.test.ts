import { describe, expect, it } from "vitest";
import { applyMacros, type MacroVars } from "./macros";

const vars: MacroVars = { char: "Alice", user: "Bob" };

describe("read-only text macros", () => {
  it("keeps char/user case, whitespace and legacy compatibility", () => {
    expect(applyMacros("{{ CHAR }} {{uSeR}} <USER>/<BOT>/<CHAR>/<GROUP>/<CHARIFNOTGROUP>", vars))
      .toBe("Alice Bob Bob/Alice/Alice/Alice/Alice");
    expect(applyMacros("{{group}}|{{groupNotMuted}}|{{charIfNotGroup}}|{{notChar}}", vars))
      .toBe("Alice|Alice|Alice|Bob");
  });

  it("substitutes names literally, including replacement metacharacters and macro-looking text", () => {
    expect(applyMacros("{{char}} <BOT> {{user}}", { char: "$&{{user}}", user: "$$`{{char}}" }))
      .toBe("$&{{user}} $&{{user}} $$`{{char}}");
  });

  it("evaluates nested utilities inside-out with every argument separator", () => {
    expect(applyMacros("{{ reverse :: {{reverse Hello {{ user }}}} }}", vars)).toBe("Hello Bob");
    expect(applyMacros("{{reverse:abc}}|{{space 2}}|{{newline::2}}|{{noop}}", vars))
      .toBe("cba|  |\n\n|");
    expect(applyMacros("a\n\n{{trim}}\n\nb", vars)).toBe("ab");
    expect(applyMacros("{{reverse::A😀B}}", vars)).toBe("B😀A");
    expect(applyMacros("{{reverse::{{reverse::{{char}}}}}}", vars)).toBe("Alice");
    expect(applyMacros("{{reverse::{{charFirstMessage::1}}}}", { ...vars, card: { alternate_greetings: ["abc"] } })).toBe("cba");
  });

  it("unescapes literal macros exactly once, including within fields and arguments", () => {
    const escaped = String.raw`\{\{user\}\}`;
    expect(applyMacros(`${escaped} {{user}}`, vars)).toBe("{{user}} Bob");
    expect(applyMacros("{{description}}", { ...vars, card: { description: escaped } })).toBe("{{user}}");
    expect(applyMacros(`{{reverse::${escaped}}}`, vars)).toBe("}}resu{{");
    expect(applyMacros(String.raw`\{\{reverse::{{user}} <USER>\}\}`, vars)).toBe("{{reverse::{{user}} <USER>}}");
  });

  it("removes inline and scoped comments without evaluating their bodies", () => {
    expect(applyMacros("a{{// {{char}} hidden}}b{{ // }}{{description}}{{ /// }}c", vars)).toBe("abc");
    expect(applyMacros("a{{//}}outer{{//}}inner{{///}}tail{{///}}b", vars)).toBe("ab");
    expect(applyMacros("a{{//comment without separating whitespace}}b", vars)).toBe("ab");
  });

  it("supports scoped reverse with dedent and whitespace preservation", () => {
    expect(applyMacros("{{reverse}}\n  Hello\n  Bob\n{{/reverse}}", vars)).toBe("boB\nolleH");
    expect(applyMacros("{{#reverse}}\n a \n{{/reverse}}", vars)).toBe("\n a \n");
  });

  it("preserves unknown, unsupported, malformed and context-free macros intact", () => {
    const text = "{{unknown::{{char}}}} {{setvar::x::{{user}}}} {{time}} {{description}} {{persona}} {{lastMessage}}";
    expect(applyMacros(text, vars)).toBe(text);
    expect(applyMacros("{{unknown}}hi {{char}}{{/unknown}} {{char}}", vars))
      .toBe("{{unknown}}hi {{char}}{{/unknown}} Alice");
    expect(applyMacros("{{char {{user}}", vars)).toBe("{{char {{user}}");
    expect(applyMacros("{{char::oops}} {{space::-1}} {{newline::Infinity}}", vars))
      .toBe("{{char::oops}} {{space::-1}} {{newline::Infinity}}");
  });

  it("recursively resolves card fields while preserving missing and known empty fields", () => {
    const context: MacroVars = { ...vars, persona: "", authorsNote: "{{charAuthorsNote}}", original: "original",
      card: { description: "{{personality}} / {{char}}", personality: "{{scenario}}", scenario: "quiet",
        system_prompt: "{{original}}", post_history_instructions: "{{persona}}", author_note: "{{user}}",
        character_version: "1", mes_example: "<START>\n<USER>: Hi", first_mes: "Hi {{user}}",
        alternate_greetings: ["Hey {{char}}"], extensions: { depth_prompt: { prompt: "depth" },
          _unmapped: { creator_notes: "notes" } } } };
    expect(applyMacros("{{description}}|{{persona}}|{{charPrompt}}|{{charInstruction}}|{{charDepthPrompt}}|{{charCreatorNotes}}|{{charVersion}}|{{mesExamplesRaw}}|{{charFirstMessage}}|{{charFirstMessage::1}}|{{authorsNote}}|{{charAuthorsNote}}", context))
      .toBe("quiet / Alice||original||depth|notes|1|<START>\nBob: Hi|Hi Bob|Hey Alice|Bob|Bob");
    expect(applyMacros("{{description}}|{{personality}}", { ...vars, card: { description: "" } }))
      .toBe("|{{personality}}");
    expect(applyMacros("{{mesExamples}}", context)).toBe("{{mesExamples}}");
    expect(applyMacros("{{mesExamples}}", { ...context, mesExamples: "formatted {{char}}" })).toBe("formatted Alice");
    expect(applyMacros("{{charFirstMessage::2}}", context)).toBe("{{charFirstMessage::2}}");
  });

  it("resolves group participants without interpreting their names", () => {
    const context = { ...vars, group: [{ name: "Alice" }, { name: "{{user}}", muted: true }, { name: "Carol" }] };
    expect(applyMacros("{{group}}|{{groupNotMuted}}|{{charIfNotGroup}}|{{notChar}}", context))
      .toBe("Alice, {{user}}, Carol|Alice, Carol||Bob, {{user}}, Carol");
  });

  it("reads history without recursively interpreting message bodies", () => {
    const context = { ...vars, history: [{ role: "user", content: "{{char}}" }, { role: "assistant", content: "$&" },
      { role: "system", content: "last" }], summary: "summary", input: "input" };
    expect(applyMacros("{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}|{{lastMessageId}}|{{summary}}|{{input}}", context))
      .toBe("last|{{char}}|$&|2|summary|input");
    expect(applyMacros("{{lastMessage}}/{{lastUserMessage}}/{{lastCharMessage}}/{{lastMessageId}}", { ...vars, history: [] }))
      .toBe("///-1");
  });

  it("bounds cyclic fields, nesting, repeated expansion and output sizes", () => {
    expect(applyMacros("{{description}}", { ...vars, card: { description: "{{personality}}", personality: "{{description}}" } }))
      .toBe("{{description}}");
    const nested = "{{reverse::".repeat(2000) + "x" + "}}".repeat(2000);
    expect(() => applyMacros(nested, vars)).not.toThrow();
    expect(() => applyMacros("x".repeat(1_048_577), vars)).toThrow(RangeError);
    expect(() => applyMacros("{{space::1048577}}", vars)).toThrow(RangeError);
    expect(() => applyMacros("{{char}}{{char}}", { ...vars, char: "x".repeat(600_000) })).toThrow(RangeError);
    expect(() => applyMacros("<CHAR>".repeat(100), { ...vars, char: "x".repeat(600_000) })).toThrow(RangeError);
    expect(() => applyMacros("{{noop}}".repeat(10_001), vars)).toThrow(RangeError);
    expect(() => applyMacros("{{description}}", { ...vars, card: { description: "{{personality}}".repeat(200),
      personality: "{{scenario}}".repeat(200), scenario: "x" } })).toThrow(RangeError);
  });
});
