/** 浏览器里没有文件系统。ejs 被 jepub 用来渲染字符串模板，不会真的去读盘。 */
export function readFileSync(): never {
  throw new Error("浏览器里不能读文件");
}

export function existsSync(): boolean {
  return false;
}
