export function resolveOnlineCardStartAction({
  localId,
  done,
  onSelectLocal,
  onAdd,
}: {
  localId?: string;
  done: boolean;
  onSelectLocal?: (cardId: string) => void;
  onAdd: () => void;
}): (() => void) | undefined {
  if (localId && onSelectLocal) return () => onSelectLocal(localId);
  return done ? undefined : onAdd;
}
