/**
 * API Key 进请求头之前的清洗。
 *
 * 为什么必须有这一步：HTTP 头字段值只能是 ISO-8859-1 的字节。
 * 只要 Key 里混进一个码点大于 0xFF 的字符（中文、全角空格、零宽字符、BOM、
 * 智能引号……），浏览器在 fetch 里读 RequestInit.headers 时就会直接抛
 *
 *   Failed to read the 'headers' property from 'RequestInit':
 *   String contains non ISO-8859-1 code point.
 *
 * 这个错发生在请求发出之前，服务端根本收不到，所以前端只会看到一句
 * 「网络请求失败」，完全指不到 Key 上。粘贴 Key 时带上尾随换行、
 * 从聊天软件复制带全角空格、从中继站复制带上零宽字符，都很常见。
 *
 * 这里按「API Key 只可能是可见 ASCII」来清洗：清掉一切非可见 ASCII，
 * 普通空白静默丢弃（粘贴尾巴，无害），其余非法字符计数上报，
 * 界面据此提醒用户回去改 Key，而不是让人对着「检查网络」发呆。
 */

/** 可见 ASCII：0x21 到 0x7E。Key 只可能落在这个范围。 */
const NON_ASCII_KEY_CHARS = /[^\x21-\x7E]/g;
/** 普通 ASCII 空白。粘贴时最常见的尾巴，静默清掉。 */
const ASCII_WHITESPACE = /[ \t\r\n\f\v]+/g;

export interface ApiKeyCheck {
  /** 清洗后的 Key，可以直接放进请求头 */
  value: string;
  /** 被清掉的「可疑」字符数（不含普通空白）。大于 0 时界面要提示用户 */
  removed: number;
}

/** 清洗一个 Key。空输入返回空结果，不会凭空造出内容。 */
export function cleanApiKey(raw: string): ApiKeyCheck {
  if (!raw) return { value: "", removed: 0 };
  const value = raw.replace(NON_ASCII_KEY_CHARS, "");
  // 去掉普通空白后仍多出来的长度，就是中文/全角/零宽这类真正该提醒的字符
  const suspicious = raw.replace(ASCII_WHITESPACE, "").length - value.length;
  return { value, removed: Math.max(0, suspicious) };
}

/**
 * 生成 Authorization 头。
 * Key 为空就返回空对象，调用方展开即可，不需要自己判断。
 */
export function authHeaders(apiKey: string): Record<string, string> {
  const { value } = cleanApiKey(apiKey);
  return value ? { Authorization: `Bearer ${value}` } : {};
}

/**
 * 把任意值变成能安全放进响应头的字符串。
 *
 * 服务端也会踩同一个坑：Response 的头值同样只能是 ISO-8859-1。
 * 提供商名走的是 safeHost()，URL 解析失败时会给一句中文兜底文案，
 * 那一下就会在构造 Response 时抛异常，整条路由变成 500。
 *
 * 这里按 ISO-8859-1 的上限（0xFF）来清，而不是 ASCII：
 * 分隔用的「·」是 0xB7，本来就合法，没必要一起清掉。
 */
export function headerSafeValue(raw: string): string {
  return raw.replace(/[^\x20-\xFF]/g, "");
}
