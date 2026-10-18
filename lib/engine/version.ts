/**
 * 提示词版本指纹。
 *
 * 基线只有在「同一套提示词」之间才有可比性。规则、输出契约或导演提示一改，
 * 这个值就变，报告里会带上它，翻旧数据时能立刻看出是换规则之前还是之后。
 *
 * 用 FNV-1a 而不是 crypto：检查器要在浏览器和 Node 里跑同一份代码，
 * 不能依赖任何一端的加密模块，也不能有异步。
 */
import { hashString } from "@/lib/prompt/cache";
import { DIRECTOR_SYSTEM_PROMPT } from "@/lib/prompt/turn-plan";
import { BASE_RULES, OUTPUT_CONTRACT, STYLE_PROMPTS } from "@/lib/prompt/system";

export function promptVersion(): string {
  return hashString(
    [BASE_RULES, OUTPUT_CONTRACT, DIRECTOR_SYSTEM_PROMPT, STYLE_PROMPTS.haruhi, STYLE_PROMPTS.mushoku].join(
      "\u0000",
    ),
  );
}
