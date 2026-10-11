import { describe, expect, it } from "vitest";
import {
  asKey,
  buildDefaultRegistry,
  LIMITS,
  parseDraft,
  type Field,
  type Version,
} from "@/shared/domain/form-model";
import {
  applyCommand,
  applyCommands,
  commandSchema,
  COMPATIBLE_TYPE_CHANGES,
  type CommandResult,
  type DraftCommand,
} from "./commands";
import type { IdSource } from "./draft";

const registry = buildDefaultRegistry();

function sequentialIds(): IdSource {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
    },
  };
}

const k = asKey;

/** A synthetic bilingual draft: page two and its story field depend on page one. */
function fixture(): Version {
  const result = parseDraft(
    {
      title: { en: "Camp sign-up", es: "Inscripción al campamento" },
      languages: "bilingual",
      headerImage: { ref: "media_0001", alt: { en: "A tent", es: "Una carpa" } },
      pages: [
        {
          key: "p_first",
          title: { en: "About you", es: "Sobre ti" },
          description: { en: "Basics", es: "Lo básico" },
          fields: [
            {
              key: "f_name",
              type: "short_text",
              label: { en: "Name", es: "Nombre" },
              help: { en: "As on file", es: "Como en el registro" },
              required: true,
              personal: true,
              validation: [
                { rule: "max_length", value: 80 },
                { rule: "pattern", value: "^[a-z]+$" },
              ],
              settings: { placeholder: { en: "Your name", es: "Tu nombre" } },
            },
            {
              key: "f_kids",
              type: "single_choice",
              label: { en: "Children?", es: "¿Hijos?" },
              settings: {
                options: [
                  { key: "o_yes", label: { en: "Yes", es: "Sí" } },
                  { key: "o_no_", label: { en: "No", es: "No" } },
                ],
              },
            },
          ],
        },
        {
          key: "p_second",
          title: { en: "Your story", es: "Tu historia" },
          visibility: { field: "f_name", op: "is_not_empty" },
          fields: [
            {
              key: "f_story",
              type: "long_text",
              label: { en: "Story", es: "Historia" },
              visibility: { field: "f_kids", op: "equals", value: "o_yes" },
            },
            { key: "f_age", type: "number", label: { en: "Age", es: "Edad" } },
          ],
        },
      ],
      confirmation: {
        screen: { en: "Thanks", es: "Gracias" },
        email: { subject: { en: "Received", es: "Recibido" }, body: { en: "Hi", es: "Hola" } },
      },
    },
    registry,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.version;
}

const deps = () => ({ registry, ids: sequentialIds() });

function run(command: DraftCommand, document: Version = fixture()): CommandResult {
  return applyCommand(document, command, deps());
}

function ok(result: CommandResult): Version {
  if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.rejection)}`);
  return result.document;
}

function rejection(result: CommandResult) {
  if (result.ok) throw new Error("expected a rejection");
  return result.rejection;
}

function field(doc: Version, key: string): Field {
  for (const page of doc.pages) for (const f of page.fields) if (f.key === key) return f;
  throw new Error(`no field ${key}`);
}

const pageKeys = (doc: Version) => doc.pages.map((p) => p.key);
const fieldKeys = (doc: Version, pi: number) => doc.pages[pi]?.fields.map((f) => f.key);

/** A document whose first page holds `count` input fields. */
function withInputs(count: number): Version {
  const doc = fixture();
  const first = doc.pages[0];
  if (!first) throw new Error("no page");
  first.fields = Array.from({ length: count }, (_, i) => ({
    key: k(`f_fill${String(i).padStart(2, "0")}`),
    type: "phone",
    label: { en: "Phone", es: "Teléfono" },
    required: false,
    personal: false,
    validation: [],
    settings: {},
  }));
  doc.pages[1] = { key: k("p_second"), title: {}, fields: [] };
  return doc;
}

describe("rename_form", () => {
  it("replaces the title", () => {
    const doc = ok(run({ kind: "rename_form", title: { en: "Retreat", es: "Retiro" } }));
    expect(doc.title).toEqual({ en: "Retreat", es: "Retiro" });
  });
});

describe("set_languages", () => {
  it("drops the other locale from every localized text when going single-language", () => {
    const doc = ok(run({ kind: "set_languages", languages: "es", keep: "es" }));
    expect(doc.languages).toBe("es");
    expect(doc.title).toEqual({ es: "Inscripción al campamento" });
    expect(doc.headerImage?.alt).toEqual({ es: "Una carpa" });
    expect(doc.pages[0]?.title).toEqual({ es: "Sobre ti" });
    expect(doc.pages[0]?.description).toEqual({ es: "Lo básico" });
    const name = field(doc, "f_name");
    expect(name.label).toEqual({ es: "Nombre" });
    expect(name.help).toEqual({ es: "Como en el registro" });
    expect(name.settings).toEqual({ placeholder: { es: "Tu nombre" } });
    expect(field(doc, "f_kids").settings).toEqual({
      options: [
        { key: "o_yes", label: { es: "Sí" } },
        { key: "o_no_", label: { es: "No" } },
      ],
      display: "radio",
    });
    expect(doc.confirmation).toEqual({
      screen: { es: "Gracias" },
      email: { subject: { es: "Recibido" }, body: { es: "Hola" } },
    });
  });

  it("never touches strings that are not localized texts", () => {
    const doc = ok(run({ kind: "set_languages", languages: "en", keep: "en" }));
    expect(doc.headerImage?.ref).toBe("media_0001");
    expect(field(doc, "f_name").validation).toEqual([
      { rule: "max_length", value: 80 },
      { rule: "pattern", value: "^[a-z]+$" },
    ]);
    expect(field(doc, "f_story").visibility).toEqual({
      field: "f_kids",
      op: "equals",
      value: "o_yes",
    });
  });

  it("requires keep to equal the target language when texts would be dropped", () => {
    expect(rejection(run({ kind: "set_languages", languages: "es" })).code).toBe(
      "invalid_document",
    );
    const wrong = rejection(run({ kind: "set_languages", languages: "es", keep: "en" }));
    expect(wrong.code).toBe("invalid_document");
    expect(wrong.issues?.[0]?.path).toBe("keep");
  });

  it("drops nothing when going bilingual", () => {
    const single = ok(run({ kind: "set_languages", languages: "es", keep: "es" }));
    const doc = ok(run({ kind: "set_languages", languages: "bilingual" }, single));
    expect(doc.languages).toBe("bilingual");
    expect(doc.title).toEqual({ es: "Inscripción al campamento" });
    expect(field(doc, "f_name").label).toEqual({ es: "Nombre" });
  });
});

describe("add_page", () => {
  it("appends at the end and returns the created key", () => {
    const result = run({ kind: "add_page" });
    const doc = ok(result);
    expect(result.ok && result.createdKey).toBe("p_00000001");
    expect(pageKeys(doc)).toEqual(["p_first", "p_second", "p_00000001"]);
    expect(doc.pages[2]).toEqual({ key: "p_00000001", title: {}, fields: [] });
  });

  it("inserts after a given page", () => {
    const doc = ok(run({ kind: "add_page", afterPageKey: k("p_first") }));
    expect(pageKeys(doc)).toEqual(["p_first", "p_00000001", "p_second"]);
  });

  it("refuses an unknown page", () => {
    expect(rejection(run({ kind: "add_page", afterPageKey: k("p_nowhere") })).code).toBe(
      "unknown_page",
    );
  });

  it("refuses at the page limit", () => {
    const shared = deps();
    let doc = fixture();
    while (doc.pages.length < LIMITS.pagesPerForm)
      doc = ok(applyCommand(doc, { kind: "add_page" }, shared));
    expect(rejection(run({ kind: "add_page" }, doc))).toMatchObject({
      code: "limit_pages",
      params: { max: LIMITS.pagesPerForm },
    });
  });
});

describe("update_page", () => {
  it("changes title and description and clears the description with null", () => {
    const doc = ok(
      run({ kind: "update_page", pageKey: k("p_first"), title: { en: "You", es: "Tú" } }),
    );
    expect(doc.pages[0]?.title).toEqual({ en: "You", es: "Tú" });
    expect(doc.pages[0]?.description).toEqual({ en: "Basics", es: "Lo básico" });
    const cleared = ok(run({ kind: "update_page", pageKey: k("p_first"), description: null }));
    expect(cleared.pages[0]).not.toHaveProperty("description");
  });

  it("refuses an unknown page", () => {
    expect(rejection(run({ kind: "update_page", pageKey: k("p_nowhere") })).code).toBe(
      "unknown_page",
    );
  });

  it("refuses a visibility that references an unknown field", () => {
    const result = run({
      kind: "update_page",
      pageKey: k("p_second"),
      visibility: { field: k("f_ghost"), op: "is_empty" },
    });
    expect(rejection(result)).toMatchObject({
      code: "condition_unknown_field",
      params: { key: "p_second", ref: "f_ghost" },
    });
  });

  it("refuses a visibility that references a field on the same or a later page", () => {
    const result = run({
      kind: "update_page",
      pageKey: k("p_second"),
      visibility: { field: k("f_story"), op: "is_empty" },
    });
    expect(rejection(result)).toMatchObject({
      code: "condition_forward_reference",
      params: { key: "p_second", ref: "f_story" },
    });
  });

  it("clears the visibility with null", () => {
    const doc = ok(run({ kind: "update_page", pageKey: k("p_second"), visibility: null }));
    expect(doc.pages[1]).not.toHaveProperty("visibility");
  });
});

describe("move_page", () => {
  it("moves a page to a new index", () => {
    const base = ok(run({ kind: "add_page" }));
    const doc = ok(run({ kind: "move_page", pageKey: k("p_00000001"), toIndex: 0 }, base));
    expect(pageKeys(doc)).toEqual(["p_00000001", "p_first", "p_second"]);
  });

  it("refuses an index outside the page list", () => {
    expect(rejection(run({ kind: "move_page", pageKey: k("p_first"), toIndex: 2 })).code).toBe(
      "bad_index",
    );
    expect(rejection(run({ kind: "move_page", pageKey: k("p_first"), toIndex: -1 })).code).toBe(
      "bad_index",
    );
  });

  it("refuses a move that leaves a condition referencing a later field", () => {
    const result = run({ kind: "move_page", pageKey: k("p_second"), toIndex: 0 });
    expect(rejection(result)).toMatchObject({
      code: "condition_forward_reference",
      params: { key: "p_second", ref: "f_name" },
    });
  });
});

describe("delete_page", () => {
  it("removes a page nothing depends on", () => {
    const doc = ok(run({ kind: "delete_page", pageKey: k("p_second") }));
    expect(pageKeys(doc)).toEqual(["p_first"]);
  });

  it("refuses to delete the only page", () => {
    const single = ok(run({ kind: "delete_page", pageKey: k("p_second") }));
    expect(rejection(run({ kind: "delete_page", pageKey: k("p_first") }, single)).code).toBe(
      "last_page",
    );
  });

  it("refuses when other conditions reference a field on the page", () => {
    expect(rejection(run({ kind: "delete_page", pageKey: k("p_first") }))).toMatchObject({
      code: "referenced_by_conditions",
      params: { keys: "p_second,f_story" },
    });
  });

  it("refuses an unknown page", () => {
    expect(rejection(run({ kind: "delete_page", pageKey: k("p_nowhere") })).code).toBe(
      "unknown_page",
    );
  });
});

describe("add_field", () => {
  it("adds an empty field at the end of the page and returns the created key", () => {
    const result = run({ kind: "add_field", pageKey: k("p_second"), type: "email" });
    const doc = ok(result);
    expect(result.ok && result.createdKey).toBe("f_00000001");
    expect(fieldKeys(doc, 1)).toEqual(["f_story", "f_age", "f_00000001"]);
    expect(field(doc, "f_00000001")).toEqual({
      key: "f_00000001",
      type: "email",
      label: {},
      required: false,
      personal: false,
      validation: [],
      settings: { isSubmitterAddress: false },
    });
  });

  it("inserts after a given field", () => {
    const doc = ok(
      run({ kind: "add_field", pageKey: k("p_first"), type: "date", afterFieldKey: k("f_name") }),
    );
    expect(fieldKeys(doc, 0)).toEqual(["f_name", "f_00000001", "f_kids"]);
  });

  it("refuses an unknown page or an anchor field that is not on the page", () => {
    expect(rejection(run({ kind: "add_field", pageKey: k("p_nowhere"), type: "date" })).code).toBe(
      "unknown_page",
    );
    expect(
      rejection(
        run({ kind: "add_field", pageKey: k("p_first"), type: "date", afterFieldKey: k("f_age") }),
      ).code,
    ).toBe("unknown_field");
  });

  it("refuses an input field when the page is at the input limit", () => {
    const result = run(
      { kind: "add_field", pageKey: k("p_first"), type: "date" },
      withInputs(LIMITS.inputFieldsPerPage),
    );
    expect(rejection(result)).toMatchObject({
      code: "limit_fields",
      params: { max: LIMITS.inputFieldsPerPage },
    });
  });

  it("leaves settings a type cannot default to the document check", () => {
    const result = run({ kind: "add_field", pageKey: k("p_first"), type: "single_choice" });
    const r = rejection(result);
    expect(r.code).toBe("invalid_document");
    expect(r.issues?.[0]?.path).toBe("pages/0/fields/2/settings/options");
  });
});

describe("update_field", () => {
  it("applies a partial patch and keeps untouched properties", () => {
    const before = field(fixture(), "f_name");
    const doc = ok(
      run({ kind: "update_field", fieldKey: k("f_name"), patch: { required: false } }),
    );
    expect(field(doc, "f_name")).toEqual({ ...before, required: false });
  });

  it("clears help with null and replaces validation", () => {
    const doc = ok(
      run({
        kind: "update_field",
        fieldKey: k("f_name"),
        patch: { help: null, validation: [{ rule: "min_length", value: 2 }] },
      }),
    );
    expect(field(doc, "f_name")).not.toHaveProperty("help");
    expect(field(doc, "f_name").validation).toEqual([{ rule: "min_length", value: 2 }]);
  });

  it("returns the registry's settings issue as invalid_document", () => {
    const result = run({
      kind: "update_field",
      fieldKey: k("f_kids"),
      patch: { settings: { options: [] } },
    });
    const r = rejection(result);
    expect(r.code).toBe("invalid_document");
    expect(r.issues?.map((i) => i.path)).toContain("pages/0/fields/1/settings/options");
  });

  it("refuses an unknown field", () => {
    expect(rejection(run({ kind: "update_field", fieldKey: k("f_ghost"), patch: {} })).code).toBe(
      "unknown_field",
    );
  });

  it("refuses a visibility that references an unknown field", () => {
    const result = run({
      kind: "update_field",
      fieldKey: k("f_age"),
      patch: { visibility: { any: [{ field: k("f_ghost"), op: "is_empty" }] } },
    });
    expect(rejection(result)).toMatchObject({
      code: "condition_unknown_field",
      params: { key: "f_age", ref: "f_ghost" },
    });
  });

  it("refuses a visibility that references the field itself or a later one", () => {
    const self = run({
      kind: "update_field",
      fieldKey: k("f_story"),
      patch: { visibility: { field: k("f_story"), op: "is_empty" } },
    });
    expect(rejection(self).code).toBe("condition_forward_reference");
    const later = run({
      kind: "update_field",
      fieldKey: k("f_story"),
      patch: { visibility: { field: k("f_age"), op: "is_empty" } },
    });
    expect(rejection(later)).toMatchObject({
      code: "condition_forward_reference",
      params: { key: "f_story", ref: "f_age" },
    });
  });

  it("accepts an earlier field and clears the visibility with null", () => {
    const set = ok(
      run({
        kind: "update_field",
        fieldKey: k("f_age"),
        patch: { visibility: { all: [{ field: k("f_story"), op: "is_not_empty" }] } },
      }),
    );
    expect(field(set, "f_age").visibility).toEqual({
      all: [{ field: "f_story", op: "is_not_empty" }],
    });
    const cleared = ok(
      run({ kind: "update_field", fieldKey: k("f_story"), patch: { visibility: null } }),
    );
    expect(field(cleared, "f_story")).not.toHaveProperty("visibility");
  });
});

describe("change_field_type", () => {
  it("lists compatible pairs once and treats them symmetrically", () => {
    expect(COMPATIBLE_TYPE_CHANGES).toEqual([["short_text", "long_text"]]);
    const back = ok(run({ kind: "change_field_type", fieldKey: k("f_story"), type: "short_text" }));
    expect(field(back, "f_story").type).toBe("short_text");
  });

  it("keeps texts, flags and visibility, drops disallowed rules and resets settings", () => {
    // Put the choice first so the name field may depend on it.
    const reordered = ok(
      run({ kind: "move_field", fieldKey: k("f_kids"), toPageKey: k("p_first"), toIndex: 0 }),
    );
    const moved = ok(
      run(
        {
          kind: "update_field",
          fieldKey: k("f_name"),
          patch: { visibility: { field: k("f_kids"), op: "is_empty" } },
        },
        reordered,
      ),
    );
    const doc = ok(
      run({ kind: "change_field_type", fieldKey: k("f_name"), type: "long_text" }, moved),
    );
    const changed = field(doc, "f_name");
    const before = field(moved, "f_name");
    expect(changed.type).toBe("long_text");
    expect(changed.label).toEqual(before.label);
    expect(changed.help).toEqual(before.help);
    expect(changed.required).toBe(true);
    expect(changed.personal).toBe(true);
    expect(changed.visibility).toEqual(before.visibility);
    expect(changed.validation).toEqual([{ rule: "max_length", value: 80 }]);
    expect(changed.settings).toEqual({ rows: 4 });
  });

  it("refuses any other change, in either direction", () => {
    expect(
      rejection(run({ kind: "change_field_type", fieldKey: k("f_name"), type: "email" })),
    ).toMatchObject({ code: "incompatible_type", params: { from: "short_text", to: "email" } });
    expect(
      rejection(run({ kind: "change_field_type", fieldKey: k("f_age"), type: "short_text" })).code,
    ).toBe("incompatible_type");
    expect(
      rejection(run({ kind: "change_field_type", fieldKey: k("f_name"), type: "short_text" })).code,
    ).toBe("incompatible_type");
  });

  it("refuses an unknown field", () => {
    expect(
      rejection(run({ kind: "change_field_type", fieldKey: k("f_ghost"), type: "long_text" })).code,
    ).toBe("unknown_field");
  });
});

describe("move_field", () => {
  it("moves a field within its page", () => {
    const doc = ok(
      run({ kind: "move_field", fieldKey: k("f_age"), toPageKey: k("p_second"), toIndex: 0 }),
    );
    expect(fieldKeys(doc, 1)).toEqual(["f_age", "f_story"]);
  });

  it("moves a field to another page, including its end", () => {
    const doc = ok(
      run({ kind: "move_field", fieldKey: k("f_age"), toPageKey: k("p_first"), toIndex: 2 }),
    );
    expect(fieldKeys(doc, 0)).toEqual(["f_name", "f_kids", "f_age"]);
    expect(fieldKeys(doc, 1)).toEqual(["f_story"]);
  });

  it("refuses an index outside the destination list", () => {
    const sameEnd = run({
      kind: "move_field",
      fieldKey: k("f_age"),
      toPageKey: k("p_second"),
      toIndex: 2,
    });
    expect(rejection(sameEnd).code).toBe("bad_index");
    const otherPast = run({
      kind: "move_field",
      fieldKey: k("f_age"),
      toPageKey: k("p_first"),
      toIndex: 3,
    });
    expect(rejection(otherPast).code).toBe("bad_index");
  });

  it("refuses an unknown field or page", () => {
    expect(
      rejection(
        run({ kind: "move_field", fieldKey: k("f_ghost"), toPageKey: k("p_first"), toIndex: 0 }),
      ).code,
    ).toBe("unknown_field");
    expect(
      rejection(
        run({ kind: "move_field", fieldKey: k("f_age"), toPageKey: k("p_nowhere"), toIndex: 0 }),
      ).code,
    ).toBe("unknown_page");
  });

  it("refuses a move that leaves a condition referencing a later field", () => {
    const result = run({
      kind: "move_field",
      fieldKey: k("f_kids"),
      toPageKey: k("p_second"),
      toIndex: 1,
    });
    expect(rejection(result)).toMatchObject({
      code: "condition_forward_reference",
      params: { key: "f_story", ref: "f_kids" },
    });
  });

  it("refuses an input field into a page at the input limit", () => {
    const full = withInputs(LIMITS.inputFieldsPerPage);
    const withAge = ok(run({ kind: "add_field", pageKey: k("p_second"), type: "number" }, full));
    const result = run(
      { kind: "move_field", fieldKey: k("f_00000001"), toPageKey: k("p_first"), toIndex: 0 },
      withAge,
    );
    expect(rejection(result).code).toBe("limit_fields");
  });
});

describe("delete_field", () => {
  it("removes a field nothing references", () => {
    const doc = ok(run({ kind: "delete_field", fieldKey: k("f_age") }));
    expect(fieldKeys(doc, 1)).toEqual(["f_story"]);
  });

  it("refuses when another field's or page's condition references it", () => {
    expect(rejection(run({ kind: "delete_field", fieldKey: k("f_kids") }))).toMatchObject({
      code: "referenced_by_conditions",
      params: { keys: "f_story" },
    });
    expect(rejection(run({ kind: "delete_field", fieldKey: k("f_name") }))).toMatchObject({
      code: "referenced_by_conditions",
      params: { keys: "p_second" },
    });
  });

  it("refuses an unknown field", () => {
    expect(rejection(run({ kind: "delete_field", fieldKey: k("f_ghost") })).code).toBe(
      "unknown_field",
    );
  });
});

describe("set_header_image", () => {
  it("sets and clears the header image", () => {
    const image = { ref: "media_0002", alt: { en: "A lake", es: "Un lago" } };
    expect(ok(run({ kind: "set_header_image", image })).headerImage).toEqual(image);
    expect(ok(run({ kind: "set_header_image", image: null }))).not.toHaveProperty("headerImage");
  });

  it("returns a malformed media reference as invalid_document", () => {
    const result = run({ kind: "set_header_image", image: { ref: "bad ref", alt: {} } });
    expect(rejection(result).code).toBe("invalid_document");
  });
});

describe("update_confirmation", () => {
  it("replaces the screen and keeps the email when it is not given", () => {
    const doc = ok(run({ kind: "update_confirmation", screen: { en: "Done", es: "Listo" } }));
    expect(doc.confirmation.screen).toEqual({ en: "Done", es: "Listo" });
    expect(doc.confirmation.email?.subject).toEqual({ en: "Received", es: "Recibido" });
  });

  it("replaces and removes the email", () => {
    const email = { subject: { en: "Got it", es: "Recibido" }, body: { en: "Bye", es: "Chao" } };
    expect(ok(run({ kind: "update_confirmation", email })).confirmation.email).toEqual(email);
    expect(ok(run({ kind: "update_confirmation", email: null })).confirmation).not.toHaveProperty(
      "email",
    );
  });
});

describe("commandSchema", () => {
  it("parses a well-formed command and leaves settings unchecked", () => {
    const parsed = commandSchema.safeParse({
      kind: "update_field",
      fieldKey: "f_name",
      patch: { settings: { anything: 1 } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown kind and a malformed key", () => {
    expect(commandSchema.safeParse({ kind: "explode" }).success).toBe(false);
    expect(commandSchema.safeParse({ kind: "delete_field", fieldKey: "X" }).success).toBe(false);
  });
});

describe("applyCommands", () => {
  it("applies commands in order and collects created keys", () => {
    const result = applyCommands(
      fixture(),
      [
        { kind: "add_page" },
        { kind: "add_field", pageKey: k("p_00000001"), type: "date" },
        { kind: "rename_form", title: { en: "Retreat", es: "Retiro" } },
      ],
      deps(),
    );
    if (!result.ok) throw new Error("rejected");
    expect(result.createdKeys).toEqual(["p_00000001", "f_00000002"]);
    expect(fieldKeys(result.document, 2)).toEqual(["f_00000002"]);
    expect(result.document.title).toEqual({ en: "Retreat", es: "Retiro" });
  });

  it("stops at the first rejection and reports its index", () => {
    const result = applyCommands(
      fixture(),
      [
        { kind: "rename_form", title: { en: "Retreat", es: "Retiro" } },
        { kind: "delete_field", fieldKey: k("f_ghost") },
        { kind: "delete_page", pageKey: k("p_nowhere") },
      ],
      deps(),
    );
    expect(result).toEqual({
      ok: false,
      index: 1,
      rejection: { code: "unknown_field", params: { key: "f_ghost" } },
    });
  });
});

describe("immutability", () => {
  it("never mutates the input document", () => {
    const commands: DraftCommand[] = [
      { kind: "set_languages", languages: "es", keep: "es" },
      { kind: "add_page", afterPageKey: k("p_first") },
      { kind: "add_field", pageKey: k("p_first"), type: "date" },
      { kind: "update_field", fieldKey: k("f_name"), patch: { help: null, required: false } },
      { kind: "change_field_type", fieldKey: k("f_name"), type: "long_text" },
      { kind: "move_field", fieldKey: k("f_age"), toPageKey: k("p_first"), toIndex: 0 },
      { kind: "move_page", pageKey: k("p_first"), toIndex: 0 },
      { kind: "delete_field", fieldKey: k("f_age") },
      { kind: "delete_page", pageKey: k("p_second") },
      { kind: "update_page", pageKey: k("p_first"), description: null },
      { kind: "set_header_image", image: null },
      { kind: "update_confirmation", email: null },
    ];
    for (const command of commands) {
      const input = fixture();
      const snapshot = structuredClone(input);
      run(command, input);
      expect(input, command.kind).toEqual(snapshot);
    }
  });
});
