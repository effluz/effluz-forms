import { ConfirmForm } from "@/shared/presentation/ConfirmForm";
import type { LifecycleAction } from "../application";
import { formHref } from "./view-models";

/** What the overview can ask to confirm: a lifecycle action, or deletion. */
export type OverviewDialog = LifecycleAction | "delete";

/** Where a lifecycle action is posted. */
export function lifecyclePath(formId: string): string {
  return `${formHref(formId)}/lifecycle`;
}

/** Where a deletion is posted. */
export function deletePath(formId: string): string {
  return `${formHref(formId)}/delete`;
}

/**
 * The confirmation of a lifecycle action or of deleting a form, stating its
 * effect in one sentence; deleting asks for the slug to be typed. See
 * specs/ui-ux/manager.md, "Form overview".
 */
export function LifecycleDialog(props: {
  formId: string;
  action: OverviewDialog;
  slug: string;
  csrfToken: string;
}) {
  const cancelHref = formHref(props.formId);
  if (props.action === "delete") {
    return (
      <ConfirmForm
        action={deletePath(props.formId)}
        csrfToken={props.csrfToken}
        hidden={{}}
        title="life.delete"
        body="life.delete_body"
        confirmLabel="life.delete"
        cancelHref={cancelHref}
        typeToConfirm={{ name: "slug", expected: props.slug, label: "new.slug" }}
      />
    );
  }
  return (
    <ConfirmForm
      action={lifecyclePath(props.formId)}
      csrfToken={props.csrfToken}
      hidden={{ action: props.action }}
      title={`life.${props.action}`}
      body={`life.${props.action}_body`}
      confirmLabel={`life.${props.action}`}
      cancelHref={cancelHref}
    />
  );
}
