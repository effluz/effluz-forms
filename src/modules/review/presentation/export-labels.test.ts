import { describe, expect, it } from "vitest";
import { exportLabels } from "./export-labels";

describe("exportLabels", () => {
  it("builds Spanish and English export labels", () => {
    expect(exportLabels("es").reference).toBe("Referencia");
    expect(exportLabels("es").corrected("Nombre")).toBe("Nombre (corregida)");
    expect(exportLabels("es").statuses.published).toBe("Publicada");
    expect(exportLabels("en").received).toBe("Received (UTC)");
  });

  it("fills every fixed header and status in each language", () => {
    const en = exportLabels("en");
    expect(en.corrected("Name")).toBe("Name (corrected)");
    expect(en.statuses).toEqual({
      new: "New",
      viewed: "Viewed",
      edited: "Edited",
      published: "Published",
    });
    expect([en.status, en.version, en.language, en.planned, en.postLink, en.files]).toEqual([
      "Status",
      "Version",
      "Language",
      "Planned date",
      "Post link",
      "File paths",
    ]);
    expect(en.staffPhotos).toBe("Added photos");
    const es = exportLabels("es");
    expect([es.received, es.planned, es.postLink, es.files, es.staffPhotos]).toEqual([
      "Recibida (UTC)",
      "Fecha planificada",
      "Enlace de la publicación",
      "Rutas de archivos",
      "Fotos agregadas",
    ]);
  });

  it("keeps a label with braces as typed", () => {
    expect(exportLabels("en").corrected("{label}")).toBe("{label} (corrected)");
  });
});
