import type { ReactElement } from "react";
import { Badge, type BadgeTone } from "@/shared/presentation/Badge";
import type { ReviewStatus } from "../application";
import { T, type ReviewCopyKey } from "./copy";

/** The tone of each review status (design-system/components.md, "Badge"). */
const STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  new: "neutral",
  viewed: "neutral",
  edited: "warning",
  published: "success",
};

/** The copy row naming each review status, shared by the badge and the list's filter chips. */
export const STATUS_LABEL: Record<ReviewStatus, ReviewCopyKey> = {
  new: "sub.status_new",
  viewed: "sub.status_viewed",
  edited: "sub.status_edited",
  published: "sub.status_published",
};

/** A story's status as a badge: its tone and its words, shared by the list and the story page. */
export function StatusBadge(props: { status: ReviewStatus }): ReactElement {
  return (
    <Badge tone={STATUS_TONE[props.status]}>
      <T k={STATUS_LABEL[props.status]} />
    </Badge>
  );
}
