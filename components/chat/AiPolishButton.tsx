"use client";

export function AiPolishButton({
  onClick,
  busy = false,
  label,
  workingLabel,
}: {
  onClick: () => void;
  busy?: boolean;
  label: string;
  workingLabel: string;
}) {
  return (
    <button
      type="button"
      className="shrink-0 rounded-pill border border-line px-2 py-1 text-[11px] font-normal text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-50"
      onClick={onClick}
      disabled={busy}
      data-ai-polish
    >
      {busy ? workingLabel : label}
    </button>
  );
}
