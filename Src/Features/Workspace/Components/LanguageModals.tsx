import { useEffect, useRef, useState } from "react";
import { DocumentSymbolService } from "../../../Core/Language/DocumentSymbolService";
import { LspClient } from "../../../Core/Language/LspClient";
import {
  type DocumentSymbolNode,
  type FlattenedSymbol,
  flattenDocumentSymbols,
} from "../../../Core/Language/SymbolUtils";
import { LanguageConfigurationService } from "../../../Core/LanguageConfigurationService";
import {
  type LanguageCodeAction,
  LanguageFeatureService,
  type WorkspaceEdit,
  type WorkspaceEditPreview,
} from "../../../Core/LanguageFeatureService";
import { EventBus } from "../../../Foundation/EventBus";
import { useLocale } from "../../../Foundation/I18n";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Button } from "../../../UI/Components/Button";
import { Input } from "../../../UI/Components/Input";
import { Modal } from "../../../UI/Components/Modal";
import { Icons } from "../../../UI/Icons/IconManager";
import { WorkspaceEditPreviewList } from "../../Language/WorkspaceEditPreviewList";

export function LanguageModals() {
  const { t } = useLocale();
  const openFile = useWorkbenchStore((state) => state.openFile);
  const requestReveal = useWorkbenchStore((state) => state.requestReveal);

  // 1. 重命名状态
  const [renameRequest, setRenameRequest] = useState<{
    path: string;
    language: string;
    line: number;
    character: number;
  } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamePreview, setRenamePreview] = useState<WorkspaceEditPreview | null>(null);
  const [renameEdit, setRenameEdit] = useState<WorkspaceEdit | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // 2. Code Action 状态
  const [codeActions, setCodeActions] = useState<LanguageCodeAction[] | null>(null);
  const [codeActionLanguage, setCodeActionLanguage] = useState<string | null>(null);
  const [codeActionError, setCodeActionError] = useState<string | null>(null);
  const [codeActionPreview, setCodeActionPreview] = useState<{
    edit: WorkspaceEdit;
    preview: WorkspaceEditPreview;
  } | null>(null);
  const [codeActionPreviewBusy, setCodeActionPreviewBusy] = useState(false);
  const [codeActionPreviewError, setCodeActionPreviewError] = useState<string | null>(null);

  // 3. 符号搜索状态
  const [symbolSearch, setSymbolSearch] = useState<{ path: string; language: string } | null>(null);
  const [symbols, setSymbols] = useState<FlattenedSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const symbolInputRef = useRef<HTMLInputElement>(null);

  // 4. 工作区信任状态
  const [trustRequest, setTrustRequest] = useState<{ root: string; language: string } | null>(null);

  useEffect(() => {
    return EventBus.on("workspace:trust-request", setTrustRequest);
  }, []);

  useEffect(() => {
    return EventBus.on("language:code-actions-request", (request) => {
      setCodeActionLanguage(request.language);
      setCodeActions([]);
      setCodeActionError(null);
      void LanguageFeatureService.getCodeActions(
        request.path,
        request.language,
        request.line,
        request.character,
      )
        .then(setCodeActions)
        .catch((error) => {
          setCodeActions(null);
          setCodeActionError(error instanceof Error ? error.message : String(error));
        });
    });
  }, []);

  useEffect(() => {
    return EventBus.on("language:rename-request", (request) => {
      setRenameRequest(request);
      setRenameName("");
      setRenamePreview(null);
      setRenameEdit(null);
      setRenameError(null);
    });
  }, []);

  useEffect(() => {
    return EventBus.on("language:symbol-search-request", ({ path, language }) => {
      setSymbolSearch({ path, language });
      setSymbolQuery("");
      setSymbolIndex(0);
      setSymbolError(null);
      void DocumentSymbolService.get(language, path)
        .then((raw: unknown) => {
          setSymbols(
            flattenDocumentSymbols(Array.isArray(raw) ? (raw as DocumentSymbolNode[]) : []),
          );
        })
        .catch((error: unknown) => {
          setSymbols([]);
          setSymbolError(error instanceof Error ? error.message : String(error));
        });
    });
  }, []);

  useEffect(() => {
    if (symbolSearch) symbolInputRef.current?.focus();
  }, [symbolSearch]);

  const filteredSymbols = symbolQuery.trim()
    ? symbols.filter((symbol) =>
        `${symbol.name} ${symbol.detail ?? ""}`
          .toLocaleLowerCase("zh-CN")
          .includes(symbolQuery.trim().toLocaleLowerCase("zh-CN")),
      )
    : symbols;

  return (
    <>
      {/* 重命名弹窗 */}
      <Modal
        isOpen={renameRequest !== null}
        onClose={() => setRenameRequest(null)}
        title={t("language.renameTitle")}
        icon={<Icons.Typography size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameRequest(null)}>
              {t("language.cancel")}
            </Button>
            {renamePreview && renameEdit ? (
              <Button
                variant="primary"
                disabled={renameBusy}
                onClick={async () => {
                  setRenameBusy(true);
                  setRenameError(null);
                  try {
                    await LanguageFeatureService.applyWorkspaceEditWithFingerprints(
                      renameEdit,
                      renamePreview.fingerprints,
                    );
                    setRenameRequest(null);
                  } catch (error) {
                    setRenameError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRenameBusy(false);
                  }
                }}
              >
                {renameBusy
                  ? t("language.applying")
                  : t("language.applyChanges").replace("{count}", String(renamePreview.totalEdits))}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!renameName.trim() || renameBusy}
                onClick={async () => {
                  if (!renameRequest) return;
                  setRenameBusy(true);
                  setRenameError(null);
                  try {
                    const result = await LanguageFeatureService.previewRename(
                      renameRequest.path,
                      renameRequest.language,
                      renameRequest.line,
                      renameRequest.character,
                      renameName.trim(),
                    );
                    setRenameEdit(result.edit);
                    setRenamePreview(result.preview);
                  } catch (error) {
                    setRenameError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRenameBusy(false);
                  }
                }}
              >
                {renameBusy ? t("language.checking") : t("language.previewChanges")}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          {!renamePreview && (
            <Input
              fullWidth
              inputSize="md"
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              placeholder={t("language.renamePlaceholder")}
            />
          )}
          {renamePreview && <WorkspaceEditPreviewList preview={renamePreview} />}
          {renameError && (
            <div className="text-[12px] text-[var(--StatusError)]">{renameError}</div>
          )}
        </div>
      </Modal>

      {/* Code Action 列表弹窗 */}
      <Modal
        isOpen={codeActionLanguage !== null}
        onClose={() => setCodeActionLanguage(null)}
        title={t("language.codeActionsTitle")}
        icon={<Icons.Sparkles size={18} />}
      >
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {codeActionError && (
            <div className="p-3 text-[12px] text-[var(--StatusError)]">{codeActionError}</div>
          )}
          {codeActions?.length === 0 && !codeActionError && (
            <div className="p-6 text-center text-[12px] text-[var(--color-text-muted)]">
              {t("language.noActions")}
            </div>
          )}
          {codeActions?.map((action) => (
            <button
              type="button"
              key={`${action.title}-${action.kind ?? ""}-${action.command?.command ?? JSON.stringify(action.edit ?? {})}`}
              disabled={Boolean(action.disabled)}
              aria-label={
                action.disabled ? `${action.title}：${action.disabled.reason}` : action.title
              }
              onClick={async () => {
                if (!codeActionLanguage) return;
                try {
                  const prepared = await LanguageFeatureService.previewCodeAction(
                    codeActionLanguage,
                    action,
                  );
                  if (prepared) {
                    setCodeActionLanguage(null);
                    setCodeActionPreview(prepared);
                    setCodeActionPreviewError(null);
                  } else {
                    await LanguageFeatureService.applyCodeAction(codeActionLanguage, action);
                    setCodeActionLanguage(null);
                  }
                } catch (error) {
                  setCodeActionError(error instanceof Error ? error.message : String(error));
                }
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--material-interactive-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span>{action.title}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {action.disabled?.reason ?? action.kind ?? "action"}
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Code Action 预览弹窗 */}
      <Modal
        isOpen={codeActionPreview !== null}
        onClose={() => setCodeActionPreview(null)}
        title={t("language.previewTitle")}
        icon={<Icons.Sparkles size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCodeActionPreview(null)}>
              {t("language.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={codeActionPreviewBusy}
              onClick={async () => {
                if (!codeActionPreview) return;
                setCodeActionPreviewBusy(true);
                setCodeActionPreviewError(null);
                try {
                  await LanguageFeatureService.applyWorkspaceEditWithFingerprints(
                    codeActionPreview.edit,
                    codeActionPreview.preview.fingerprints,
                  );
                  setCodeActionPreview(null);
                } catch (error) {
                  setCodeActionPreviewError(error instanceof Error ? error.message : String(error));
                } finally {
                  setCodeActionPreviewBusy(false);
                }
              }}
            >
              {codeActionPreviewBusy
                ? t("language.applying")
                : t("language.applyChanges").replace(
                    "{count}",
                    String(codeActionPreview?.preview.totalEdits ?? 0),
                  )}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {codeActionPreview && <WorkspaceEditPreviewList preview={codeActionPreview.preview} />}
          {codeActionPreviewError && (
            <div className="text-[12px] text-[var(--StatusError)]">{codeActionPreviewError}</div>
          )}
        </div>
      </Modal>

      {/* 符号搜索弹窗 */}
      <Modal
        isOpen={symbolSearch !== null}
        onClose={() => setSymbolSearch(null)}
        title={t("language.symbolSearchTitle")}
        icon={<Icons.Sparkles size={18} />}
      >
        <div className="space-y-3">
          <Input
            ref={symbolInputRef}
            fullWidth
            inputSize="md"
            value={symbolQuery}
            onChange={(event) => {
              setSymbolQuery(event.target.value);
              setSymbolIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSymbolIndex((index) =>
                  Math.min(index + 1, Math.max(0, filteredSymbols.length - 1)),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSymbolIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const symbol = filteredSymbols[symbolIndex];
                if (symbol && symbolSearch) {
                  openFile(symbolSearch.path);
                  requestReveal(symbolSearch.path, symbol.line);
                  setSymbolSearch(null);
                }
              }
            }}
            placeholder={t("language.symbolSearchPlaceholder")}
          />
          {symbolError && (
            <div className="text-[12px] text-[var(--StatusError)]">{symbolError}</div>
          )}
          {filteredSymbols.length === 0 && !symbolError && (
            <div className="p-6 text-center text-[12px] text-[var(--color-text-muted)]">
              {t("language.noSymbols")}
            </div>
          )}
          <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl bg-[var(--material-surface)] p-1.5 aurona-scroll">
            {filteredSymbols.map((symbol, index) => (
              <button
                type="button"
                key={`${symbol.line}-${symbol.depth}-${symbol.name}`}
                onClick={() => {
                  if (!symbolSearch) return;
                  openFile(symbolSearch.path);
                  requestReveal(symbolSearch.path, symbol.line);
                  setSymbolSearch(null);
                }}
                onMouseMove={() => setSymbolIndex(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] transition-colors ${
                  index === symbolIndex
                    ? "bg-[var(--material-interactive-active)]"
                    : "hover:bg-[var(--material-interactive-hover)]"
                }`}
                style={{ paddingLeft: `${8 + symbol.depth * 14}px` }}
              >
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-highlight)]">
                  {symbol.name}
                </span>
                {symbol.detail && (
                  <span className="truncate text-[10px] text-[var(--color-text-muted)]">
                    {symbol.detail}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {symbol.line}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* 工作区信任弹窗 */}
      <Modal
        isOpen={trustRequest !== null}
        onClose={() => setTrustRequest(null)}
        title={t("workspace.trustTitle")}
        icon={<Icons.AlertTriangle size={18} className="text-[var(--StatusWarning)]" />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrustRequest(null)}>
              {t("workspace.trustNo")}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!trustRequest) return;
                const request = trustRequest;
                await LanguageConfigurationService.trust(request.root);
                setTrustRequest(null);
                await LspClient.getInstance()
                  .startServer(request.language)
                  .catch(() => undefined);
              }}
            >
              {t("workspace.trustYes")}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
          <p>{t("workspace.trustBody")}</p>
          <p className="rounded-lg bg-[var(--material-surface)] p-2 font-mono text-[11px]">
            {trustRequest?.root}
          </p>
          <p className="text-[12px] text-[var(--color-text-muted)]">{t("workspace.trustHint")}</p>
        </div>
      </Modal>
    </>
  );
}
