import { describe, expect, it } from "vitest";
import { renderSubmitterConfirmation } from "./confirmation";
import { renderJobAlert } from "./job-alert";
import { renderStaffNotification } from "./staff-notification";

const base = {
  formTitle: "Historias <de prueba>",
  subject: "Gracias\r\nBcc: someone@example.com",
  body: "Recibimos tu historia.\n\n- Revisaremos las **fotos**\n- [Ejemplo](https://example.com/post)",
  receivedOn: "10 de octubre de 2026",
  reference: "HP-0001",
  retentionMonths: 12,
  contact: "privacy@example.com",
};

describe("renderSubmitterConfirmation", () => {
  for (const locale of ["en", "es"] as const) {
    it(`renders the ${locale} message, text and HTML with the same words`, () => {
      const email = renderSubmitterConfirmation({ ...base, locale });
      expect(email).toMatchSnapshot();
      expect(email.subject).toBe("Gracias Bcc: someone@example.com");
      expect(email.html).not.toContain("<de prueba>");
      expect(email.html).toContain("Historias &lt;de prueba&gt;");
      expect(email.html).not.toMatch(/<img|<script|tracking/i);
      expect(email.html).toContain(`lang="${locale}"`);
      for (const words of ["HP-0001", "12", "privacy@example.com", "Revisaremos las"]) {
        expect(email.text).toContain(words);
        expect(email.html).toContain(words);
      }
    });
  }
});

describe("renderStaffNotification", () => {
  it("renders the English notification with no answers", () => {
    const email = renderStaffNotification({
      formTitle: "Stories",
      reference: "HP-0001",
      receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC",
      link: "https://forms.example.com/admin/forms/f1",
    });
    expect(email).toMatchSnapshot();
    expect(email.subject).toBe("New submission to Stories: HP-0001");
    expect(email.text).toContain(
      "Open it in the manager: https://forms.example.com/admin/forms/f1",
    );
    expect(email.html).toContain('href="https://forms.example.com/admin/forms/f1"');
  });
});

describe("renderJobAlert", () => {
  const data = {
    jobType: "media.upload",
    count: 3,
    references: ["HP-0001"],
    moreCount: 0,
    link: "https://forms.example.com/admin/operations",
  };

  it("renders the alert with references and more", () => {
    const references = Array.from({ length: 20 }, (_, i) => `HP-${String(i + 1).padStart(4, "0")}`);
    const email = renderJobAlert({ ...data, references, moreCount: 4 });
    expect(email).toMatchSnapshot();
    expect(email.subject).toBe("Jobs need attention: media.upload (3)");
    expect(email.text).toContain("Stories affected: HP-0001, HP-0002");
    expect(email.text).toContain("HP-0020 and 4 more");
    expect(email.html).toContain("HP-0020 and 4 more");
    expect(email.text).not.toContain("@");
    expect(email.html).not.toContain("@");
    expect(email.html).toContain('href="https://forms.example.com/admin/operations"');
  });

  it("renders the alert without references", () => {
    const email = renderJobAlert({ ...data, references: [], moreCount: 0 });
    expect(email).toMatchSnapshot();
    expect(email.text).not.toContain("Stories affected");
    expect(email.html).not.toContain("Stories affected");
    expect(email.text).not.toContain("more");
    expect(email.text).not.toContain("@");
    expect(email.html).not.toContain("@");
  });

  it("escapes markup in the job type and keeps the subject on one line", () => {
    const email = renderJobAlert({ ...data, jobType: "x<script>\r\nBcc: y" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("x&lt;script&gt;");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
