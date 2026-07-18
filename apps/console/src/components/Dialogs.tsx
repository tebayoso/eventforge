import { Check, FileCode2, X } from "lucide-react";
import { useCallback } from "react";
import type { ActionItem, ForgeItem } from "../api";
import { useDialog } from "../use-dialog";

type DecisionProps = {
  busy: boolean;
  onClose: () => void;
  onDecide: (approved: boolean) => void;
};

export function ApprovalDialog({
  action,
  busy,
  onClose,
  onDecide,
}: DecisionProps & { action: ActionItem }) {
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  const dialogRef = useDialog(close);
  return (
    <div className="dialog-backdrop fixed inset-0 z-20 grid place-items-center p-5">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-description"
        className="dialog-panel w-full max-w-2xl rounded-2xl p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="warning-label mb-2 text-xs font-medium uppercase tracking-[.18em]">
              Approval required
            </p>
            <h2 id="approval-title" className="text-xl font-semibold">
              {action.title}
            </h2>
            <p id="approval-description" className="muted-text mt-2 text-sm">
              This action has not been executed. Review its proposed capabilities and diff before
              deciding.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="icon-button"
            disabled={busy}
            onClick={close}
          >
            <X />
          </button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="dialog-detail rounded-lg p-4">
            <p className="dim-text text-xs uppercase tracking-wider">Requested capabilities</p>
            <p className="secondary-text mt-2 text-sm">{action.requiredCapabilities.join(", ")}</p>
          </div>
          <div className="dialog-detail rounded-lg p-4">
            <p className="dim-text text-xs uppercase tracking-wider">Risk assessment</p>
            <p className="warning-label mt-2 text-sm capitalize">{action.risk} risk</p>
          </div>
        </div>
        <pre className="dialog-diff secondary-text mt-4 max-h-56 overflow-auto rounded-lg p-4 text-xs leading-5">
          {action.diff ?? "No code diff supplied."}
        </pre>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            <X size={15} /> Reject
          </button>
          <button
            type="button"
            className="action-button"
            disabled={busy}
            onClick={() => onDecide(true)}
          >
            <Check size={15} /> {busy ? "Recording…" : "Approve action"}
          </button>
        </div>
      </section>
    </div>
  );
}

type ForgeReviewProps = DecisionProps & {
  forge: ForgeItem;
  selectedFilePath?: string;
  onSelectFile: (path: string) => void;
};

export function ForgeReviewDialog({
  forge,
  busy,
  selectedFilePath,
  onSelectFile,
  onClose,
  onDecide,
}: ForgeReviewProps) {
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  const dialogRef = useDialog(close);
  const selectedFile =
    forge.generatedFiles.find((file) => file.path === selectedFilePath) ?? forge.generatedFiles[0];
  const selectAdjacent = (currentIndex: number, offset: number) => {
    if (forge.generatedFiles.length === 0) return;
    const nextIndex =
      (currentIndex + offset + forge.generatedFiles.length) % forge.generatedFiles.length;
    const next = forge.generatedFiles[nextIndex];
    if (next) {
      onSelectFile(next.path);
      window.requestAnimationFrame(() =>
        document.getElementById(`forge-tab-${nextIndex}`)?.focus(),
      );
    }
  };

  return (
    <div className="dialog-backdrop fixed inset-0 z-20 grid place-items-center p-5">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="forge-review-title"
        aria-describedby="forge-review-description"
        className="dialog-panel forge-review-panel w-full max-w-5xl rounded-2xl p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="eyebrow mb-2 text-xs font-medium uppercase tracking-[.18em]">
              Forge safety review
            </p>
            <h2 id="forge-review-title" className="text-xl font-semibold">
              Generated connector artifact
            </h2>
            <p id="forge-review-description" className="muted-text mt-2 max-w-3xl text-sm">
              Review the requested capabilities, validation results, and every generated file.
              Approval records the artifact; it does not install or execute it.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close forge review"
            className="icon-button"
            disabled={busy}
            onClick={close}
          >
            <X />
          </button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_.8fr]">
          <div className="dialog-detail rounded-lg p-4">
            <p className="dim-text text-xs uppercase tracking-wider">Requested capabilities</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {forge.requestedScopes.map((scope) => (
                <span className="forge-scope" key={scope}>
                  {scope}
                </span>
              ))}
            </div>
          </div>
          <div
            className={`forge-validation rounded-lg p-4 ${forge.validation.passed ? "forge-validation-pass" : "forge-validation-fail"}`}
          >
            <p className="dim-text text-xs uppercase tracking-wider">Validation report</p>
            <p className="mt-2 text-sm font-medium">
              {forge.validation.passed
                ? "Scanner passed — no blocked patterns found."
                : "Scanner blocked this artifact."}
            </p>
            {forge.validation.findings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                {forge.validation.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="forge-review-grid mt-4">
          <div role="tablist" aria-label="Generated files" className="forge-file-list">
            {forge.generatedFiles.map((file, index) => (
              <button
                key={file.path}
                id={`forge-tab-${index}`}
                role="tab"
                aria-controls="forge-source"
                aria-selected={file.path === selectedFile?.path}
                tabIndex={file.path === selectedFile?.path ? 0 : -1}
                className="forge-file-tab"
                onClick={() => onSelectFile(file.path)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    event.preventDefault();
                    selectAdjacent(index, 1);
                  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    selectAdjacent(index, -1);
                  }
                }}
              >
                <FileCode2 size={15} />
                {file.path}
              </button>
            ))}
          </div>
          <pre
            id="forge-source"
            role="tabpanel"
            aria-labelledby={`forge-tab-${Math.max(
              0,
              forge.generatedFiles.findIndex((file) => file.path === selectedFile?.path),
            )}`}
            className="dialog-diff forge-source secondary-text overflow-auto rounded-lg p-4 text-xs leading-5"
          >
            {selectedFile?.content ?? "No generated files were returned."}
          </pre>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            <X size={15} /> Reject artifact
          </button>
          <button
            type="button"
            className="action-button"
            disabled={busy || !forge.validation.passed}
            onClick={() => onDecide(true)}
          >
            <Check size={15} /> {busy ? "Recording…" : "Approve artifact"}
          </button>
        </div>
      </section>
    </div>
  );
}
