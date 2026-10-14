"use client";

import { useEffect, useState } from "react";
import {
  Field,
  FieldAction,
  FieldInput,
  FormGroup,
  PillButton,
  ScreenHead,
  VaultStatus,
  VaultWarn,
} from "@/components/ui";
import { IconEye, IconLayers } from "@/components/icons";
import {
  MAX_ATTEMPTS,
  MIN_PASSPHRASE_LENGTH,
  probeVault,
  setupVault,
  unlockVault,
  type VaultStatus as VaultState,
} from "@/lib/vault";

/**
 * 未解锁时的唯一入口。
 *
 * 这个画面不加载任何聊天内容、不显示任何配置，
 * 因为那些数据全在密文里，没有密钥本来也读不出来。
 */

const BACKEND_LABEL: Record<string, string> = {
  indexeddb: "IndexedDB",
  localstorage: "localStorage（本机不支持 IndexedDB）",
  memory: "内存（本机不可用持久化存储）",
};

export function VaultGate({
  status,
  attemptsLeft,
  backend,
  notice,
}: {
  status: VaultState;
  attemptsLeft: number;
  backend: string | null;
  notice: string | null;
}) {
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void probeVault();
  }, []);

  const isSetup = status === "uninitialized";

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (isSetup) {
        await setupVault(value, confirm);
        setValue("");
        setConfirm("");
      } else {
        await unlockVault(value);
        setValue("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
      setValue("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-[520px] px-6 py-10">
        <ScreenHead
          title={isSetup ? "设置一个密钥" : "输入密钥解锁"}
          subtitle="密钥不会存在任何地方，只能靠你自己记住"
        />

        <div className="flex flex-col gap-6">
          {notice ? (
            <VaultStatus>
              <VaultWarn>{notice}</VaultWarn>
            </VaultStatus>
          ) : null}

          {isSetup ? (
            <VaultStatus>
              <b>这台设备上还没有密钥。</b>
              <br />
              设一个，之后聊天记录、角色卡、API Key 都会用它加密后存本机。
              <br />
              密钥只在你脑子里：<VaultWarn>不存在 localStorage、不存在 IndexedDB、不存在 Cookie、不打日志</VaultWarn>。
              忘了就只能清除本机数据重来，没有任何找回方式。
            </VaultStatus>
          ) : (
            <VaultStatus>
              本机数据已加密。解锁后才能读。
              <br />
              还剩 <VaultWarn>{attemptsLeft} 次</VaultWarn>机会，连续错 {MAX_ATTEMPTS} 次会
              <VaultWarn>清除本机全部数据</VaultWarn>。
            </VaultStatus>
          )}

          <FormGroup title={isSetup ? "密钥" : "密钥"}>
            <Field>
              <FieldInput
                type={show ? "text" : "password"}
                autoFocus
                autoComplete={isSetup ? "new-password" : "current-password"}
                spellCheck={false}
                placeholder={`至少 ${MIN_PASSPHRASE_LENGTH} 个字符`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) void submit();
                }}
              />
              <FieldAction
                aria-label={show ? "隐藏密钥" : "显示密钥"}
                onClick={() => setShow((next) => !next)}
              >
                <IconEye className="size-[17px]" />
              </FieldAction>
            </Field>
          </FormGroup>

          {isSetup ? (
            <FormGroup title="再输一遍">
              <Field>
                <FieldInput
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="确认密钥"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !busy) void submit();
                  }}
                />
              </Field>
            </FormGroup>
          ) : null}

          {error ? (
            <div className="rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
              {error}
            </div>
          ) : null}

          <PillButton
            variant="primary"
            block
            disabled={busy || !value || (isSetup && !confirm)}
            onClick={() => void submit()}
          >
            {busy ? "正在派生密钥……" : isSetup ? "设定密钥" : "解锁"}
          </PillButton>

          {backend ? (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <IconLayers className="size-[15px]" />
              聊天与角色卡存储：{BACKEND_LABEL[backend] ?? backend}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
