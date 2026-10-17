import { describe, expect, it } from "vitest";
import { renderSubmitterConfirmation } from "./confirmation";
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
