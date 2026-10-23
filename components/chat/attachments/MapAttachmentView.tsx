"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { GeneratedMap, MapArea } from "@/lib/attachments";
import { Sheet } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { AttachmentWorkspace, type AttachmentWorkspaceMode } from "./AttachmentWorkspace";

export interface MapAttachmentViewProps {
  map: GeneratedMap;
  mode?: AttachmentWorkspaceMode;
  open?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  selectedRegionId?: string;
  onRegionSelect?: (region: MapArea) => void;
  onRegionClear?: () => void;
  onClose?: () => void;
  onBackToChat?: () => void;
  onAskCharacter?: (region?: MapArea) => void;
  tabs?: Array<{ id: string; label: ReactNode }>;
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  className?: string;
}

export function MapAttachmentView({
  map,
  mode = "desktop",
  open = true,
  title = "地图",
  subtitle,
  selectedRegionId,
  onRegionSelect,
  onRegionClear,
  onClose,
  onBackToChat,
  onAskCharacter,
  tabs,
  activeTabId,
  onTabChange,
  className,
}: MapAttachmentViewProps) {
  const [internalSelectedRegionId, setInternalSelectedRegionId] = useState<string>();
  const regionById = useMemo(
    () => new Map(map.regions.map((region) => [region.id, region])),
    [map.regions],
  );
  const activeRegionId = selectedRegionId ?? internalSelectedRegionId;
  const activeRegion = activeRegionId ? regionById.get(activeRegionId) : undefined;

  const selectRegion = (regionId: string) => {
    const region = regionById.get(regionId);
    if (!region) return;
    if (selectedRegionId === undefined) setInternalSelectedRegionId(region.id);
    onRegionSelect?.(region);
  };

  const clearRegion = () => {
    if (selectedRegionId === undefined) setInternalSelectedRegionId(undefined);
    onRegionClear?.();
  };

  const askCharacter = onAskCharacter
    ? () => onAskCharacter(activeRegion)
    : undefined;

  return (
    <AttachmentWorkspace
      mode={mode}
      open={open}
      title={title}
      subtitle={subtitle ?? `${map.width} × ${map.height} · ${map.stats.regionCount} 区域`}
      onClose={onClose}
      onBackToChat={onBackToChat}
      onAskCharacter={askCharacter}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      className={className}
    >
      <div className="relative flex min-h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2">
            {map.fingerprint}
          </span>
          <span className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2">
            陆地 {map.stats.landCells}
          </span>
          <span className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2">
            水域 {map.stats.waterCells}
          </span>
        </div>

        <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(150px,220px)] md:items-start">
          <div className="min-w-0">
            <div className="overflow-hidden rounded-card border border-line bg-surface-2">
              <MapCanvas
                map={map}
                selectedRegionId={activeRegionId}
                onRegionSelect={selectRegion}
              />
            </div>
            <p className="m-0 mt-2 text-[11.5px] text-ink-3">点击区域查看信息</p>
          </div>

          <RegionDetails region={activeRegion} className="hidden md:block" />
        </div>

        <Sheet
          open={Boolean(activeRegion)}
          title="区域信息"
          description={activeRegion?.id}
          onClose={clearRegion}
          closeLabel="关闭区域信息"
          className="md:hidden"
        >
          <RegionDetailsBody region={activeRegion} />
        </Sheet>
      </div>
    </AttachmentWorkspace>
  );
}

export function MapCanvas({
  map,
  selectedRegionId,
  onRegionSelect,
}: {
  map: GeneratedMap;
  selectedRegionId?: string;
  onRegionSelect: (regionId: string) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<SVGRectElement>, regionId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRegionSelect(regionId);
  };

  return (
    <svg
      viewBox={`0 0 ${map.width} ${map.height}`}
      role="img"
      aria-label="地图画布"
      className="block h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>地图画布</title>
      <desc>
        {map.width} × {map.height} 网格，{map.stats.regionCount} 个区域
      </desc>
      {map.cells.map((cell) => {
        const selected = cell.regionId === selectedRegionId;
        return (
          <rect
            key={cell.id}
            x={cell.x}
            y={cell.y}
            width="1"
            height="1"
            role="button"
            tabIndex={0}
            aria-label={`选择区域 ${cell.regionId}`}
            aria-pressed={selected}
            data-region-id={cell.regionId}
            fill={selected ? "var(--selected-line)" : cell.terrain === "land" ? "var(--surface-3)" : "var(--surface-2)"}
            stroke="var(--line)"
            strokeWidth="0.025"
            onClick={() => onRegionSelect(cell.regionId)}
            onKeyDown={(event) => handleKeyDown(event, cell.regionId)}
          />
        );
      })}
    </svg>
  );
}

function RegionDetails({ region, className }: { region?: MapArea; className?: string }) {
  return (
    <section
      aria-label="区域信息"
      data-region-details={region?.id ?? "empty"}
      className={cn("rounded-card border border-line bg-surface-2 p-3", className)}
    >
      <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">区域信息</h3>
      <RegionDetailsBody region={region} />
    </section>
  );
}

function RegionDetailsBody({ region }: { region?: MapArea }) {
  if (!region) {
    return <p className="m-0 text-[12px] leading-relaxed text-ink-3">选择地图区域</p>;
  }

  return (
    <dl className="m-0 space-y-2 text-[12px]">
      <div>
        <dt className="text-ink-3">ID</dt>
        <dd className="m-0 break-all font-mono text-ink">{region.id}</dd>
      </div>
      <div>
        <dt className="text-ink-3">单元格</dt>
        <dd className="m-0 text-ink">{region.cellCount}</dd>
      </div>
      <div>
        <dt className="text-ink-3">边界</dt>
        <dd className="m-0 font-mono text-ink">
          {region.bounds.minX},{region.bounds.minY} – {region.bounds.maxX},{region.bounds.maxY}
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">中心</dt>
        <dd className="m-0 font-mono text-ink">
          {region.center.x}, {region.center.y}
        </dd>
      </div>
    </dl>
  );
}
