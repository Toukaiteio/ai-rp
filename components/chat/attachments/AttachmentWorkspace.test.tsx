import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentWorkspace } from "./AttachmentWorkspace";
import { MapAttachmentView } from "./MapAttachmentView";
import { CodexAttachmentEditor } from "./editor/CodexAttachmentEditor";
import type { GeneratedMap } from "@/lib/attachments";

const map: GeneratedMap = {
  generator: { id: "test-generator", version: "1" },
  seed: "test-seed",
  fingerprint: "test-map",
  width: 3,
  height: 2,
  grid: [
    [
      { id: "cell-0-0", x: 0, y: 0, terrain: "land", regionId: "region-a" },
      { id: "cell-1-0", x: 1, y: 0, terrain: "land", regionId: "region-a" },
      { id: "cell-2-0", x: 2, y: 0, terrain: "water", regionId: "region-b" },
    ],
    [
      { id: "cell-0-1", x: 0, y: 1, terrain: "land", regionId: "region-a" },
      { id: "cell-1-1", x: 1, y: 1, terrain: "water", regionId: "region-b" },
      { id: "cell-2-1", x: 2, y: 1, terrain: "water", regionId: "region-b" },
    ],
  ],
  cells: [
    { id: "cell-0-0", x: 0, y: 0, terrain: "land", regionId: "region-a" },
    { id: "cell-1-0", x: 1, y: 0, terrain: "land", regionId: "region-a" },
    { id: "cell-2-0", x: 2, y: 0, terrain: "water", regionId: "region-b" },
    { id: "cell-0-1", x: 0, y: 1, terrain: "land", regionId: "region-a" },
    { id: "cell-1-1", x: 1, y: 1, terrain: "water", regionId: "region-b" },
    { id: "cell-2-1", x: 2, y: 1, terrain: "water", regionId: "region-b" },
  ],
  regions: [
    {
      id: "region-a",
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      center: { x: 0.333, y: 0.333 },
      cellCount: 3,
    },
    {
      id: "region-b",
      bounds: { minX: 1, minY: 0, maxX: 2, maxY: 1 },
      center: { x: 1.667, y: 0.667 },
      cellCount: 3,
    },
  ],
  islands: [],
  continents: [],
  stats: {
    width: 3,
    height: 2,
    totalCells: 6,
    landCells: 3,
    waterCells: 3,
    landRatio: 0.5,
    regionCount: 2,
    islandCount: 0,
    continentCount: 0,
  },
};

describe("AttachmentWorkspace", () => {
  it("renders the desktop sidebar shell and actions", () => {
    const html = renderToStaticMarkup(
      <AttachmentWorkspace
        mode="desktop"
        title="地图"
        onClose={() => {}}
        onBackToChat={() => {}}
        onAskCharacter={() => {}}
      >
        <span>内容</span>
      </AttachmentWorkspace>,
    );

    expect(html).toContain('data-mode="desktop"');
    expect(html).toContain("地图");
    expect(html).toContain("返回聊天");
    expect(html).toContain("询问角色");
    expect(html).toContain("关闭附件");
  });

  it("renders the fullscreen shell", () => {
    const html = renderToStaticMarkup(
      <AttachmentWorkspace mode="fullscreen" title="附件">
        <span>内容</span>
      </AttachmentWorkspace>,
    );

    expect(html).toContain('data-mode="fullscreen"');
    expect(html).toContain('role="dialog"');
  });
});

describe("MapAttachmentView", () => {
  it("renders the selected region details and selected cells", () => {
    const html = renderToStaticMarkup(
      <MapAttachmentView map={map} mode="fullscreen" selectedRegionId="region-b" />,
    );

    expect(html).toContain("区域信息");
    expect(html).toContain("region-b");
    expect(html).toContain('data-region-id="region-b"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("边界");
  });
});

describe("CodexAttachmentEditor", () => {
  it("renders editable entries and the add-entry action", () => {
    const html = renderToStaticMarkup(
      <CodexAttachmentEditor
        attachment={{
          id: "codex-1",
          kind: "codex",
          version: "1",
          title: "资料",
          entries: [{ id: "entry-1", title: "港口", content: "潮汐", tags: ["地理"], enabled: true }],
        }}
        onChange={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(html).toContain("Codex 设置");
    expect(html).toContain("新增条目");
    expect(html).toContain("潮汐");
    expect(html).toContain("启用这个 Codex");
  });
});
