import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailpitEmailSender } from "@/modules/notifications/infrastructure/mailpit-email-sender";
import { startHttpStub, type HttpStub } from "../../fakes/http-stub";

describe("MailpitEmailSender", () => {
  let stub: HttpStub;
  beforeEach(async () => {
    stub = await startHttpStub();
  });
  afterEach(() => stub.close());

  it("sends through Mailpit's API and returns its message id", async () => {
    stub.reply(200, { ID: "mailpit-1" });
    const sender = new MailpitEmailSender({
      url: stub.url,
      from: "Effluz Forms <forms@forms.example.com>",
      replyTo: "team@example.com",
    });
    const result = await sender.send({
      to: ["a@example.com", "b@example.com"],
      subject: "S",
      text: "T",
      html: "<p>H</p>",
    });
    expect(result).toEqual({ providerMessageId: "mailpit-1" });
    const [req] = stub.requests;
    expect(req?.path).toBe("/api/v1/send");
    expect(JSON.parse(req?.body ?? "{}")).toEqual({
      From: { Email: "forms@forms.example.com", Name: "Effluz Forms" },
      To: [{ Email: "a@example.com" }, { Email: "b@example.com" }],
      ReplyTo: [{ Email: "team@example.com" }],
      Subject: "S",
      Text: "T",
      HTML: "<p>H</p>",
    });
  });

  it("omits the sender name for a bare address and classes failures", async () => {
    const sender = new MailpitEmailSender({
      url: stub.url,
      from: "forms@forms.example.com",
      replyTo: "team@example.com",
    });
    const message = { to: ["a@example.com"], subject: "S", text: "T", html: "<p>H</p>" };
    stub.reply(200, { ID: "m2" });
    await sender.send(message);
    const body = JSON.parse(stub.requests[0]?.body ?? "{}") as { From: unknown };
    expect(body.From).toEqual({ Email: "forms@forms.example.com" });
    stub.reply(400, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: true });
    stub.reply(500, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: false });
    const offline = new MailpitEmailSender({
      url: "http://127.0.0.1:1",
      from: "a@example.com",
      replyTo: "b@example.com",
    });
    await expect(offline.send(message)).rejects.toMatchObject({ permanent: false });
  });

  it("gives the call a timeout, so a hung provider fails the attempt as retryable", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const spy: typeof fetch = (input, init) => {
      signals.push(init?.signal);
      return fetch(input, init);
    };
    stub.reply(200, { ID: "m1" });
    const sender = new MailpitEmailSender({
      url: stub.url,
      from: "Effluz Forms <forms@forms.example.com>",
      replyTo: "team@example.com",
      fetch: spy,
    });
    await sender.send({ to: ["family@example.com"], subject: "S", text: "T", html: "<p>T</p>" });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});
