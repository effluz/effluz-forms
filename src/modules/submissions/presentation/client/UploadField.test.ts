import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefusedFilesContext } from "./refused-files";
import { UploadField, type UploadFieldProps } from "./UploadField";

const FILE_ID = "00000000-0000-4000-8000-000000000001";

function props(over: Partial<UploadFieldProps> = {}): UploadFieldProps {
  return {
    slug: "story-form",
    fieldKey: "f_photos",
    inputId: "f-f_photos",
    errorId: "f_photos-error",
    countId: "f_photos-count",
    describedBy: "f_photos-limits f_photos-count",
    accept: "image/jpeg",
    required: true,
    maxFiles: 3,
    maxBytes: 10 * 1024 * 1024,
    kinds: ["image"],
    error: null,
    initial: [{ id: FILE_ID, kind: "image", label: "File 1, 12 kB", size: "12 kB" }],
    initialCount: "1 of 3 files",
    text: {
      chooseFiles: "Choose files",
      uploading: "Uploading {percent}%",
      uploaded: "Uploaded",
      remove: "Remove",
      retry: "Retry",
      removed: "{file} removed",
      removeFailed: "{file} was not removed. Check your connection and try again",
      count: "{count} of {max} files",
      countOne: "{count} of 1 file",
      failed: "{file} did not upload. Check your connection and retry",
      tooLarge: "{file} is larger than 10 MB",
      wrongType: "{file} is not a supported type. Use JPEG, PNG, WebP or HEIC photos",
    },
    locale: "en",
    ...over,
  };
}

describe("UploadField without script", () => {
  it("renders the native input, the count and a Remove submit button per staged file", () => {
    const html = renderToStaticMarkup(createElement(UploadField, props()));
    expect(html).toMatch(
      /<input[^>]*type="file"[^>]*multiple[^>]*name="f_photos"|<input[^>]*name="f_photos"[^>]*type="file"/,
    );
    expect(html).toContain('aria-describedby="f_photos-limits f_photos-count"');
    expect(html).toContain("1 of 3 files");
    expect(html).toContain("File 1, 12 kB");
    // React writes `name` after the other attributes of a button, so the order is not asserted.
    const remove = /<button[^>]*>/.exec(html)?.[0] ?? "";
    expect(remove).toContain('type="submit"');
    expect(remove).toContain('name="_action"');
    expect(remove).toContain('value="remove:00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('id="f_photos-error"');
  });

  it("shows this field's refused files, which the page read from the state cookie, in its error slot instead of the stored error", () => {
    const html = renderToStaticMarkup(
      createElement(
        RefusedFilesContext.Provider,
        {
          value: [
            { fieldKey: "f_photos", message: "notes.txt is not a supported type." },
            { fieldKey: "f_other", message: "x" },
          ],
        },
        createElement(UploadField, props({ error: "Photos is required" })),
      ),
    );
    expect(html).toMatch(/id="f_photos-error"[^>]*>[\s\S]*notes\.txt is not a supported type\./);
    expect(html).not.toContain("Photos is required");
    expect(html).toContain('aria-invalid="true"');
  });

  it("falls back to the stored error when no refused file belongs to the field", () => {
    const html = renderToStaticMarkup(
      createElement(UploadField, props({ error: "Photos is required" })),
    );
    expect(html).toMatch(/id="f_photos-error"[^>]*>[\s\S]*Photos is required/);
    expect(html).toContain('aria-invalid="true"');
  });
});
