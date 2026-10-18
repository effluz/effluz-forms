import type { ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { styles as ui } from "@/shared/presentation/styles";
import type { ListQuery } from "../application";
import { T } from "./copy";
import { listHref } from "./list-view";

/**
 * The story page of a submission that does not exist (deleted while open, or an old link),
 * rendered by the page itself inside the shell rather than thrown (ADR 0027): a breadcrumb,
 * the one `<h1>`, one sentence and a link back to the submissions with the list's query. See
 * specs/ui-ux/manager.md, "States".
 */
export function StoryNotFound(props: { formId: string; query: ListQuery }): ReactElement {
  const back = listHref(props.formId, props.query);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: <Bilingual k="nav.forms" />, href: "/admin/forms" },
          { label: <T k="st.not_found_title" /> },
        ]}
      />
      <h1 className={ui.pageTitle}>
        <T k="st.not_found_title" />
      </h1>
      <p>
        <T k="st.not_found_body" />
      </p>
      <p>
        <a className={ui.button} href={back}>
          <T k="st.not_found_back" />
        </a>
      </p>
    </>
  );
}
