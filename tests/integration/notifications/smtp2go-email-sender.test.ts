import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Smtp2goEmailSender } from "@/modules/notifications/infrastructure/smtp2go-email-sender";
import { startHttpStub, type HttpStub } from "../../fakes/http-stub";

const message = {
  to: ["family@example.com"],
  subject: "Gracias",
  text: "Hola",
  html: "<p>Hola</p>",
};

describe("Smtp2goEmailSender", () => {
  let stub: HttpStub;
  let sender: Smtp2goEmailSender;
  beforeEach(async () => {
    stub = await startHttpStub();
    sender = new Smtp2goEmailSender({
      apiKey: "api-key",
      apiUrl: stub.url,
      from: "Effluz Forms <forms@forms.example.com>",
      replyTo: "team@example.com",
    });
  });
  afterEach(() => stub.close());

  it("posts the message with the key header and returns the email id", async () => {
    stub.reply(200, {
      request_id: "r1",
      data: { succeeded: 1, failed: 0, failures: [], email_id: "1qHg2-abc" },
    });
    expect(await sender.send(message)).toEqual({ providerMessageId: "1qHg2-abc" });
    const [req] = stub.requests;
    expect(req?.path).toBe("/email/send");
    expect(req?.headers["x-smtp2go-api-key"]).toBe("api-key");
    expect(JSON.parse(req?.body ?? "{}")).toEqual({
      sender: "Effluz Forms <forms@forms.example.com>",
      to: ["family@example.com"],
      subject: "Gracias",
      text_body: "Hola",
      html_body: "<p>Hola</p>",
      custom_headers: [{ header: "Reply-To", value: "team@example.com" }],
    });
  });

  it("classes a 400 and a failed recipient as permanent, 429 and 5xx as retryable, without addresses in messages", async () => {
    stub.reply(400, { data: { error_code: "E_ApiResponseCodes.NON_VALIDATING_IN_PAYLOAD" } });
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: true });
    stub.reply(200, { data: { succeeded: 0, failed: 1, failures: ["family@example.com"] } });
    const failed = await sender.send(message).catch((e: unknown) => e);
    expect(failed).toMatchObject({ permanent: true });
    expect((failed as Error).message).not.toContain("@");
    stub.reply(429, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: false });
    stub.reply(503, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: false });
  });

  it("classes an unreachable provider as retryable", async () => {
    const offline = new Smtp2goEmailSender({
      apiKey: "k",
      apiUrl: "http://127.0.0.1:1",
      from: "a@example.com",
      replyTo: "b@example.com",
    });
    await expect(offline.send(message)).rejects.toMatchObject({ permanent: false });
  });

  it("classes 401 and 403 as retryable and keeps the key out of error messages", async () => {
    stub.reply(401, {});
    const unauthorized = await sender.send(message).catch((e: unknown) => e);
    expect(unauthorized).toMatchObject({ permanent: false });
    expect((unauthorized as Error).message).not.toContain("api-key");
    stub.reply(403, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: false });
  });
});
