import type { ReactElement } from "react";
import type { StoryView } from "../application";
import type { StoryParams } from "./story-params";
import { ActivityCard } from "./story/ActivityCard";
import { AnswersCard } from "./story/AnswersCard";
import { RevertDialog } from "./story/CompareView";
import { ConsentCard } from "./story/ConsentCard";
import { DeleteDialog, DeleteLink } from "./story/DeleteDialog";
import { Flash } from "./story/Flash";
import { JobWarning } from "./story/JobWarning";
import { PhotosCard, RemovePhotoDialog } from "./story/PhotosCard";
import { PhotoViewer } from "./story/PhotoViewer";
import { PublishDialog, PublishPanel, UnpublishDialog } from "./story/PublishPanel";
import { ReadinessPanel } from "./story/ReadinessPanel";
import { StoryHeader } from "./story/StoryHeader";
import { story } from "./story/styles";

type StoryProps = { view: StoryView; params: StoryParams; csrfToken: string };

/** A part of the page mounted in one of its slots; it renders nothing when it does not apply. */
type StorySlot = (props: StoryProps) => ReactElement | null;

// The photos card, the readiness panel (with the planned date) and the publishing card.
const PhotosSlot: StorySlot = PhotosCard;
const ReadinessSlot: StorySlot = ReadinessPanel;
const PublishingSlot: StorySlot = PublishPanel;

/**
 * The confirmation opened with `?action=`, when it applies to this story. The plan conflict
 * opens inside the planned date form instead, where the route returns (`#plan`).
 */
function Confirmation(props: StoryProps): ReactElement | null {
  const { view, params } = props;
  if (params.action === "delete") return <DeleteDialog {...props} />;
  if (params.action === "revert") {
    const answer = view.pages
      .flatMap((page) => page.answers)
      .find((a) => a.field.key === params.field && a.corrected !== null);
    return answer === undefined ? null : <RevertDialog {...props} answer={answer} />;
  }
  if (params.action === "remove_photo") return <RemovePhotoDialog {...props} />;
  // The route sends a refused post link back with `action=publish`; the error alone reopens it too.
  if (params.action === "publish" || params.error === "post_url_invalid") {
    return <PublishDialog {...props} />;
  }
  if (params.action === "unpublish") return <UnpublishDialog {...props} />;
  return null;
}

/**
 * The story page body, inside the shell: the header with Newer, Older and Back, the banners
 * (flash, refusal, dead jobs), the confirmation opened by `?action=`, then the cards in the
 * order of specs/ui-ux/manager.md, "Story page". Every change is a plain POST form with the
 * CSRF token and the list query, so the page works without JavaScript; links are plain
 * `<a href>`, never prefetched.
 */
export function StoryPage(props: StoryProps): ReactElement {
  return (
    <>
      <StoryHeader view={props.view} params={props.params} />
      <Flash view={props.view} params={props.params} />
      <JobWarning {...props} />
      <Confirmation {...props} />
      <PhotoViewer {...props} />
      <div className={story.cards}>
        <AnswersCard {...props} />
        <PhotosSlot {...props} />
        <ReadinessSlot {...props} />
        <PublishingSlot {...props} />
        <ConsentCard view={props.view} />
        <ActivityCard view={props.view} />
        <DeleteLink view={props.view} params={props.params} />
      </div>
    </>
  );
}
