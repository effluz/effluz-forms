import { describe, expect, it } from "vitest";
import {
  errorSummaryHeading,
  fileIssueMessage,
  filesCount,
  issueMessage,
  uploadRefusalMessage,
} from "./messages";

const limits = { kinds: ["image", "video"] as const, maxFiles: 10, maxSizeMb: 10 };

describe("messages", () => {
  it("builds each message from the rule and the label, in the locale", () => {
    expect(issueMessage({ code: "required" }, "Celular", "es")).toBe("Celular es obligatorio");
    expect(issueMessage({ code: "email_syntax" }, "E-mail", "en")).toBe(
      "Enter a valid email address, like name@example.com",
    );
    expect(issueMessage({ code: "date_min", params: { date: "2026-01-31" } }, "Birth", "en")).toBe(
      "Birth must be on or after January 31, 2026",
    );
  });

  it("uses the singular row when n is one", () => {
    expect(issueMessage({ code: "files_min", params: { n: 1 } }, "Fotos", "es")).toBe(
      "Sube al menos 1 archivo en Fotos",
    );
    expect(issueMessage({ code: "files_min", params: { n: 2 } }, "Fotos", "es")).toBe(
      "Sube al menos 2 archivos en Fotos",
    );
    expect(issueMessage({ code: "max_length", params: { n: 1 } }, "Code", "en")).toBe(
      "Code must have no more than 1 character",
    );
    expect(errorSummaryHeading(1, "en")).toBe("Please fix 1 problem before continuing");
    expect(errorSummaryHeading(3, "es")).toBe("Corrige 3 problemas para continuar");
    expect(filesCount(0, 1, "en")).toBe("0 of 1 file");
    expect(filesCount(2, 10, "es")).toBe("2 de 10 archivos");
  });

  it("falls back to the plain row when a code has no singular row", () => {
    expect(issueMessage({ code: "number_min", params: { n: 1 } }, "Age", "en")).toBe(
      "Age must be at least 1",
    );
  });

  it("names the file, the size and the kinds in file messages", () => {
    expect(fileIssueMessage({ code: "file_too_large", name: "a.jpg" }, limits, "en")).toBe(
      "a.jpg is larger than 10 MB",
    );
    expect(
      fileIssueMessage(
        { code: "file_too_large", name: "a.jpg", params: { maxMb: 5 } },
        limits,
        "en",
      ),
    ).toBe("a.jpg is larger than 5 MB");
    expect(fileIssueMessage({ code: "file_wrong_type", name: "a.txt" }, limits, "es")).toBe(
      "a.txt no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV",
    );
    expect(fileIssueMessage({ code: "submission_too_large", name: "v.mp4" }, limits, "en")).toBe(
      "v.mp4 would take this form's files past 100 MB in total",
    );
    expect(uploadRefusalMessage("files_max", { file: "a.jpg", label: "Fotos", limits }, "es")).toBe(
      "Puedes subir hasta 10 archivos en Fotos",
    );
    expect(uploadRefusalMessage("expired", { file: "a.jpg", label: "Fotos", limits }, "en")).toBe(
      "a.jpg did not upload. Check your connection and retry",
    );
    expect(
      uploadRefusalMessage("not_allowed", { file: "a.jpg", label: "Fotos", limits }, "en"),
    ).toBe("a.jpg did not upload. Check your connection and retry");
    expect(
      uploadRefusalMessage("file_unreadable", { file: "a.jpg", label: "Fotos", limits }, "en"),
    ).toBe("a.jpg could not be read. Try another file");
  });
});
