/* 没有立绘资源时的头像：取名字第一个字，衬线字重压满。
   换成真图时只要把这里换成 <img>，调用方不用动。 */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-full w-full place-items-center bg-surface-3 font-serif text-sm font-black text-ink-2">
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}
