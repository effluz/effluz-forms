import { useId, type ReactElement } from "react";
import { cx, styles as ui } from "@/shared/presentation/styles";
import type { StoryView } from "../../application";
import { T, type ReviewCopyKey } from "../copy";
import { storyActionPath, type StoryParams } from "../story-params";
import { StoryFields } from "./parts";
import { story } from "./styles";

/** What a dead job of `type` means for the story, in plain words. */
function jobLine(type: string): ReviewCopyKey {
  if (type === "media.upload") return "st.job_media_upload";
  if (type === "media.delete") return "st.job_media_delete";
  if (type.startsWith("email.")) return "st.job_email";
  return "st.job_other";
}

/**
 * The warning that a background job of this story stopped retrying: one line per kind of
 * failure, never the job's error (it may name a file), and Try again, which retries every dead
 * job of the story. See specs/ui-ux/manager.md, "Story page", item 4.
 */
export function JobWarning(props: {
  view: StoryView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement | null {
  const { view } = props;
  const titleId = useId();
  if (view.deadJobs.length === 0) return null;
  const lines = [...new Set(view.deadJobs.map((job) => jobLine(job.type)))];
  return (
    <section aria-labelledby={titleId} className={cx(ui.banner, ui.warning, story.jobWarning)}>
      <h2 id={titleId} className={story.jobTitle}>
        <T k="st.jobs_warning" />
      </h2>
      <ul className={story.jobList}>
        {lines.map((line) => (
          <li key={line}>
            <T k={line} />
          </li>
        ))}
      </ul>
      <form
        className={story.jobForm}
        method="post"
        action={storyActionPath(view.ctx.form.id, view.reference, "retry")}
      >
        <StoryFields csrfToken={props.csrfToken} query={props.params.query} />
        <button className={ui.button} type="submit">
          <T k="st.retry" />
        </button>
      </form>
    </section>
  );
}
