/**
 * 加密层与各数据模块之间的注册表。
 *
 * 为什么绕一圈：加密层不能 import 存储模块（那些模块反过来要用加密层），
 * 直接互相 import 会成环。这里只放两个集合，谁都不依赖谁。
 */

type Loader = () => Promise<void>;
type Resetter = () => void;

const loaders = new Set<Loader>();
const resetters = new Set<Resetter>();

/** 数据模块在模块加载时登记：解锁后怎么灌内存，锁定或清除后怎么清空。 */
export function registerVaultData(loader: Loader, resetter: Resetter): void {
  loaders.add(loader);
  resetters.add(resetter);
}

/** 解锁成功后把所有加密数据读回内存。 */
export async function hydrateVaultData(): Promise<void> {
  for (const loader of loaders) await loader();
}

/** 锁定或清除本机数据后，内存里不许留东西。 */
export function resetVaultData(): void {
  for (const resetter of resetters) resetter();
}
