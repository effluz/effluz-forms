import type { AlertSource, JobAlertData } from "@/modules/notifications/application";
import type { ReviewDeps } from "./deps";
import { storyResolver } from "./operations";

/** The alert lists at most this many story references, then "and {n} more". */
export const ALERT_REFERENCES_MAX = 20;

/** The newest dead jobs of the type read for their stories; the count itself has no limit. */
export const ALERT_SCAN_LIMIT = 500;

/**
 * Review's answer to notifications' `AlertSource`: how many jobs of the type are dead now and
 * the stories among them, with a link to Operations. Identifiers only, never content. Null when
 * no address is configured or no job of the type is dead any more (retried or discarded since).
 * See specs/use-cases/operate-jobs.md, "Alerts", and specs/decisions/0029-dead-job-alerts.md.
 */
export class ReviewAlertSource implements AlertSource {
  private readonly link: string;

  constructor(
    private readonly deps: ReviewDeps,
    private readonly opts: { to: string | null; publicBaseUrl: string },
  ) {
    this.link = `${opts.publicBaseUrl.replace(/\/+$/, "")}/admin/operations`;
  }

  async jobAlert(jobType: string): Promise<{ to: string[]; data: JobAlertData } | null> {
    if (this.opts.to === null) return null;
    const { count, jobs } = await this.deps.jobs.deadOfType(jobType, ALERT_SCAN_LIMIT);
    if (count === 0) return null;
    const resolve = storyResolver(this.deps);
    const stories = await Promise.all(jobs.map((job) => resolve(job)));
    const references = [
      ...new Set(stories.flatMap((story) => (story ? [story.reference] : []))),
    ].sort();
    return {
      to: [this.opts.to],
      data: {
        jobType,
        count,
        references: references.slice(0, ALERT_REFERENCES_MAX),
        moreCount: Math.max(0, references.length - ALERT_REFERENCES_MAX),
        link: this.link,
      },
    };
  }
}
