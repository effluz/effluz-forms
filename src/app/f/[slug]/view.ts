import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getContainer, type Container } from "@/app/container";
import { viewForm, type ViewResult } from "@/modules/submissions/application";
import { FILL_COOKIE, parseFillState } from "@/modules/submissions/presentation/cookies";

/**
 * The view of one public link for this request, shared by the renderer's root layout (for
 * `<html lang>`) and its page through React's `cache`, so one request calls `viewForm` once
 * for the same arguments. The layout cannot read `?expired=1`, so that render asks twice.
 */
export const loadView = cache(
  async (slug: string, expired: boolean): Promise<{ view: ViewResult; container: Container }> => {
    // The request reads come first: the build's prerender stops at them, before any database.
    const jar = await cookies();
    const acceptLanguage = (await headers()).get("accept-language");
    const container = getContainer();
    const view = await viewForm(container.submissions, {
      slug,
      state: parseFillState(jar.get(FILL_COOKIE)?.value ?? null),
      acceptLanguage,
      expired,
    });
    return { view, container };
  },
);
