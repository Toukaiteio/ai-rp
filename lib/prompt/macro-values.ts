import type { MacroVars } from "./macros";

export interface MacroValue {
  text: string;
  recursive: boolean;
}

const literal = (text: string): MacroValue => ({ text, recursive: false });
const field = (value: unknown): MacroValue | undefined =>
  typeof value === "string" ? { text: value, recursive: true } : undefined;

function property(value: unknown, key: string): unknown {
  return value && typeof value === "object" && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key] : undefined;
}

export function macroValue(name: string, args: string[], vars: MacroVars): MacroValue | undefined {
  if (args.length && name !== "charfirstmessage") return undefined;
  const card = vars.card;
  switch (name) {
    case "char": return literal(vars.char);
    case "user": return literal(vars.user);
    case "group": return literal(vars.group?.map((member) => member.name).join(", ") ?? vars.char);
    case "groupnotmuted":
      return literal(vars.group?.filter((member) => !member.muted).map((member) => member.name).join(", ") ?? vars.char);
    case "charifnotgroup": return literal(vars.group === undefined ? vars.char : "");
    case "notchar":
      return literal([vars.user, ...(vars.group?.filter((member) => member.name !== vars.char).map((member) => member.name) ?? [])].join(", "));
    case "description": return field(card?.description);
    case "personality": return field(card?.personality);
    case "scenario": return field(card?.scenario);
    case "persona": return field(vars.persona);
    case "charprompt": return field(card?.system_prompt);
    case "charinstruction": return field(card?.post_history_instructions);
    case "chardepthprompt": return field(property(card?.extensions?.depth_prompt, "prompt"));
    case "charcreatornotes":
      return field(property(card, "creator_notes") ?? property(card?.extensions?._unmapped, "creator_notes"));
    case "charversion": return field(card?.character_version);
    case "mesexamplesraw": return field(card?.mes_example);
    case "mesexamples": return field(vars.mesExamples);
    case "charfirstmessage": {
      if (args.length > 1 || (args.length && !/^\d+$/.test(args[0]))) return undefined;
      const index = args.length ? Number(args[0]) : 0;
      return field(index === 0 ? card?.first_mes : card?.alternate_greetings?.[index - 1]);
    }
    case "authorsnote": return field(vars.authorsNote);
    case "charauthorsnote": return field(card?.author_note ?? card?.extensions?.chara_note);
    case "original": return field(vars.original);
    case "summary": return vars.summary === undefined ? undefined : literal(vars.summary);
    case "input": return vars.input === undefined ? undefined : literal(vars.input);
    case "lastmessageid": return vars.history === undefined ? undefined : literal(String(vars.history.length - 1));
    case "lastmessage":
    case "lastusermessage":
    case "lastcharmessage": {
      if (vars.history === undefined) return undefined;
      for (let i = vars.history.length - 1; i >= 0; i--) {
        const message = vars.history[i];
        if (name === "lastmessage" || (name === "lastusermessage" && message.role === "user") ||
          (name === "lastcharmessage" && ["assistant", "char", "bot"].includes(message.role))) return literal(message.content);
      }
      return literal("");
    }
    default: return undefined;
  }
}
