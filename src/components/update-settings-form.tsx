"use client";
import { useActionState, useEffect, useState } from "react";
import { Button, Card, Chip, InputField, Notice } from "@/components/ui";
import { Checkbox } from "@heroui/react";
import { UpdateDetails } from "@/components/update-details";
import { saveUpdateSettingsAction } from "@/app/admin/updates/actions";
import {
  DEFAULT_REPOSITORY,
  type UpdateCheck,
  type UpdateSettingsView,
} from "@/lib/updates/shared";

export function UpdateSettingsForm({
  initial,
  currentSha,
}: {
  initial: UpdateSettingsView;
  currentSha: string;
}) {
  const [repository, setRepository] = useState(initial.repositoryUrl);
  const [branch, setBranch] = useState(initial.branch);
  const [hook, setHook] = useState("");
  const [clearHook, setClearHook] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof saveUpdateSettingsAction>>,
      form: FormData,
    ) => {
      const saved = await saveUpdateSettingsAction(previous, form);
      if (saved.ok) {
        setRepository(saved.settings.repositoryUrl);
        setBranch(saved.settings.branch);
        setHook("");
        setClearHook(false);
        setResult(null);
        setError("");
        window.dispatchEvent(new Event("ow-update-settings-saved"));
      }
      return saved;
    },
    { ok: false, message: "", settings: initial },
  );
  const dirty =
    repository.trim() !== state.settings.repositoryUrl ||
    branch.trim() !== state.settings.branch ||
    Boolean(hook) ||
    clearHook;
  useEffect(() => {
    function receive(event: Event) {
      setResult((event as CustomEvent<UpdateCheck>).detail);
    }
    window.addEventListener("ow-update-result", receive);
    return () => window.removeEventListener("ow-update-result", receive);
  }, []);
  async function check() {
    if (checking || pending) return;
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/admin/updates?force=1", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "检查失败，请稍后重试。");
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="admin-setting-section grid gap-5">
      <Card className="gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">版本状态</h2>
            <p className="mt-1 text-sm text-muted">
              登录后台后自动检查，有更新时主动提示。
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={pending || checking || dirty}
            isPending={checking}
            onPress={check}
          >
            {checking ? "正在检查…" : "立即检查"}
          </Button>
        </div>
        {error ? <Notice tone="warning">{error}</Notice> : null}
        {!currentSha ? (
          <Notice tone="warning">
            当前构建没有版本号，无法列出和部署更新。用 CLI
            发布时请传入本次 commit，例如{" "}
            <code>npm run deploy:prod</code>。
          </Notice>
        ) : null}
        {dirty ? (
          <p className="text-sm text-muted">
            更新来源有未保存的修改，保存后可重新检查。
          </p>
        ) : null}
        {result ? (
          <UpdateDetails
            key={`${result.revision}:${result.latestSha}:${result.checkedAt}`}
            result={result}
          />
        ) : (
          <p className="text-sm leading-6 text-muted">
            当前部署：<code>{currentSha.slice(0, 7) || "未识别"}</code>
            。点击“立即检查”查看最新状态。
          </p>
        )}
      </Card>
      <Card className="gap-3 px-6 py-3">
        <details className="admin-disclosure" open={!initial.hasDeployHook}>
          <summary>
            <span>更新设置</span>
            <Chip
              size="sm"
              variant="soft"
              color={state.settings.hasDeployHook ? "success" : "default"}
            >
              {state.settings.hasDeployHook
                ? "已配置一键部署"
                : "未配置一键部署"}
            </Chip>
          </summary>
          <form
            action={action}
            onResetCapture={(event) => event.preventDefault()}
            className="admin-disclosure-body grid gap-5"
          >
            <input
              type="hidden"
              name="revision"
              value={state.settings.revision}
            />
            <fieldset disabled={pending} className="grid min-w-0 gap-5">
              <InputField
                label="GitHub 仓库链接"
                name="repositoryUrl"
                type="url"
                required
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                maxLength={300}
                description="填写实际出站的公开仓库。默认是上游 XiaoshengQIU/ow-activity-site。"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  isDisabled={pending}
                  onPress={() => {
                    setRepository(DEFAULT_REPOSITORY);
                    setBranch("");
                  }}
                >
                  恢复默认仓库
                </Button>
              </div>
              <InputField
                label="监测分支（可选）"
                name="branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                maxLength={200}
                placeholder="留空使用仓库默认分支"
              />
              <InputField
                label="Vercel Deploy Hook"
                name="deployHook"
                type="password"
                autoComplete="new-password"
                value={hook}
                onChange={(event) => setHook(event.target.value)}
                maxLength={1000}
                placeholder={
                  state.settings.hasDeployHook
                    ? "已配置，留空保留"
                    : "填写后才能一键更新"
                }
                description="链接加密保存，不会回显。更换仓库或分支时需重新填写对应 Hook，否则会清除旧 Hook。"
              />
              <details className="admin-disclosure border-t border-border">
                <summary>
                  部署配置说明{state.settings.hasDeployHook ? "与清除选项" : ""}
                </summary>
                <div className="admin-disclosure-body grid gap-3 text-sm leading-6 text-muted">
                  <p>
                    在 Vercel 项目的 Settings → Git → Deploy Hooks
                    中创建上游生产分支的 Hook，复制到上方。Hook
                    必须绑定到实际出站的那个仓库和分支。
                  </p>
                  <p>
                    本站从上游仓库部署。fork 上的提交要先合进上游，这里才会看成更新。
                  </p>
                  <a
                    href="https://vercel.com/docs/deploy-hooks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    查看 Vercel 配置说明
                  </a>
                  {state.settings.hasDeployHook ? (
                    <Checkbox
                      name="clearDeployHook"
                      value="on"
                      isSelected={clearHook}
                      isDisabled={pending}
                      onChange={setClearHook}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        清除已保存的 Deploy Hook
                      </Checkbox.Content>
                    </Checkbox>
                  ) : null}
                </div>
              </details>
            </fieldset>
            <div className="admin-settings-footer">
              <p className="text-xs text-muted">
                {dirty
                  ? "有未保存的修改"
                  : state.settings.revision > 0
                    ? "更新设置已保存"
                    : "使用默认更新设置"}
              </p>
              <Button
                type="submit"
                isPending={pending}
                isDisabled={pending || !dirty}
              >
                {pending ? "正在保存…" : "保存设置"}
              </Button>
            </div>
            {state.message && (!state.ok || !dirty) ? (
              <Notice tone={state.ok ? "success" : "danger"}>
                {state.message}
              </Notice>
            ) : null}
          </form>
        </details>
      </Card>
    </div>
  );
}
