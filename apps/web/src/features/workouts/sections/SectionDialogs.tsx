import type { WorkoutSection } from "@sin/core";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { SECTION_COPY, removeTitle } from "./sectionCopy";
import { SectionSheet } from "./SectionSheet";
import type { SectionActions } from "./useSectionActions";

/**
 * Spec 10.6 §6.3 — the New / Edit section sheet and the remove confirm, drawn from `useSectionActions`'
 * state. The sheet is keyed per opening, so its text starts fresh each time and is dropped on close.
 */
export function SectionDialogs({ actions, sections }: { actions: SectionActions; sections: readonly WorkoutSection[] }) {
  const view = actions.sheetView;
  if (view === null) return null;
  const section = view.sectionId === null ? undefined : sections.find((s) => s.id === view.sectionId);
  return (
    <>
      <SectionSheet
        key={view.session}
        open={actions.sheet !== null}
        mode={view.mode}
        {...(section ? { section } : {})}
        busy={actions.busy}
        errors={actions.errors}
        onSubmit={(values) => void actions.submitSheet(values)}
        onClose={actions.closeSheet}
        {...(view.mode === "edit" ? { onRemove: actions.requestRemove, removeRef: actions.removeRef } : {})}
      />
      {view.mode === "edit" && section ? (
        <ConfirmDialog
          open={actions.removeOpen}
          title={removeTitle(section.name)}
          confirmLabel={SECTION_COPY.removeConfirm}
          cancelLabel={SECTION_COPY.cancel}
          variant="danger"
          busy={actions.busy}
          onConfirm={() => void actions.confirmRemove()}
          onCancel={actions.cancelRemove}
        >
          <p>{SECTION_COPY.removeLine}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
