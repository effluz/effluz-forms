import { describe, expect, it } from "vitest";
import { keySchema } from "@/shared/domain/form-model";
import { STAFF_PHOTOS_FIELD_KEY, parseSource } from "./staff-photos";

describe("staff photos", () => {
  it("the reserved field key can never be a form field key", () => {
    expect(keySchema.safeParse(STAFF_PHOTOS_FIELD_KEY).success).toBe(false);
  });

  it("parses only the known sources, exactly", () => {
    expect(parseSource("instagram")).toBe("instagram");
    expect(parseSource("Instagram")).toBeNull();
    expect(parseSource("sms")).toBeNull();
  });
});
