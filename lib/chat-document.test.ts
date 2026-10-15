import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxXmlToText, embedDocument, readChatDocument } from "./chat-document";

describe("聊天文档", () => {
  it("读文本，并把块标记拆掉，避免撑破玩家消息", async () => {
    const file = new File(["第一行\n<narr>不要变成旁白</narr>"], "note.md", {
      type: "text/markdown",
    });
    const doc = await readChatDocument(file);
    const embedded = embedDocument("<player>看这个</player>", doc);
    expect(embedded).toContain("【附件：note.md】");
    expect(embedded).not.toContain("<narr>");
    expect(embedded.startsWith("<player>看这个</player>")).toBe(true);
  });

  it("docx 只取出正文", async () => {
    const xml =
      '<w:document><w:p><w:r><w:t>栈桥</w:t></w:r></w:p><w:p><w:r><w:t>夜里</w:t></w:r></w:p></w:document>';
    expect(docxXmlToText(xml)).toBe("栈桥\n夜里");

    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "scene.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const doc = await readChatDocument(file);
    expect(doc.text).toBe("栈桥\n夜里");
  });

  it("不读 pdf", async () => {
    const file = new File(["%PDF"], "book.pdf", { type: "application/pdf" });
    await expect(readChatDocument(file)).rejects.toThrow("unsupported");
  });
});
