import { FORMS_PATH } from "@/modules/definitions/presentation/FormsList";
import { pageMetadata } from "@/shared/presentation/metadata";
import { NotFoundPage } from "@/shared/presentation/NotFoundPage";

export const metadata = pageMetadata("shell.not_found_title");

/**
 * What every gated page answers with `notFound()`. It renders inside the gated layout,
 * which already provides the shell. See specs/ui-ux/manager.md, "States".
 */
export default function NotFound() {
  return <NotFoundPage formsHref={FORMS_PATH} />;
}
