import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve(new Headers({ "accept-language": "es" })),
}));
vi.mock("./view", () => ({ loadView: vi.fn() }));
vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { getContainer, type Container } from "@/app/container";
import { RecordingLogger } from "@/shared/application/testing/fakes";
import RendererPage, { generateMetadata } from "./page";
import { loadView } from "./view";

let logger: RecordingLogger;

beforeEach(() => {
  logger = new RecordingLogger();
  vi.mocked(getContainer).mockReturnValue({ logger } as unknown as Container);
  vi.mocked(loadView).mockReset();
});

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ slug: "story-form" }),
  searchParams: Promise.resolve(query),
});

async function render(query: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await RendererPage(props(query)));
}

describe("the renderer page", () => {
  it("renders the error screen as real HTML when the view cannot be loaded, logging once", async () => {
    vi.mocked(loadView).mockRejectedValue(new TypeError("connection lost"));
    const html = await render();
    expect(html).toContain("Algo salió mal");
    expect(html).toContain("Something went wrong");
    expect(html).toContain('href="/f/story-form"');
    expect(logger.lines).toEqual([
      expect.objectContaining({
        level: "error",
        msg: "form render failed",
        fields: { slug: "story-form", error: "TypeError" },
      }),
    ]);
    const metadata = await generateMetadata(props());
    expect(metadata).toEqual({
      title: "Algo salió mal / Something went wrong",
      robots: { index: false },
    });
    expect(logger.lines).toHaveLength(1);
  });

  it("renders the error screen a failed page post redirected to, without loading the view", async () => {
    const html = await render({ error: "1" });
    expect(html).toContain("Algo salió mal");
    expect(html).toContain('href="/f/story-form"');
    expect(loadView).not.toHaveBeenCalled();
    expect(logger.lines).toEqual([]);
    expect(await generateMetadata(props({ error: "1" }))).toEqual({
      title: "Algo salió mal / Something went wrong",
      robots: { index: false },
    });
  });
});
