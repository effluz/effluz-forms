import { describe, expect, it } from "vitest";
import { deadAlertSlots } from "./dead-alert";

describe("deadAlertSlots", () => {
  it("names the current and next hour slots", () => {
    expect(
      deadAlertSlots("email.job_alert", "media.upload", new Date("2026-10-18T10:59:59Z")),
    ).toEqual({
      current: {
        key: "email.job_alert:media.upload:2026-10-18T10",
        runAt: new Date("2026-10-18T10:59:59Z"),
      },
      next: {
        key: "email.job_alert:media.upload:2026-10-18T11",
        runAt: new Date("2026-10-18T11:00:00Z"),
      },
    });
    expect(
      deadAlertSlots("email.job_alert", "media.upload", new Date("2026-12-31T23:30:00Z")).next,
    ).toEqual({
      key: "email.job_alert:media.upload:2027-01-01T00",
      runAt: new Date("2027-01-01T00:00:00Z"),
    });
  });
});
