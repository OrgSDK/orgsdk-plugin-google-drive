import { describe, expect, test } from "bun:test";
import { token, transport } from "../plugin/transport";

describe("transport security", () => {
	test("uses GET, manual redirects and an abort signal only on the fixed API origin", async () => {
		const api = transport(
			"https://api.example.com/v1/",
			{ Authorization: "Bearer sentinel" },
			async (url, init) => {
				expect(url.origin).toBe("https://api.example.com");
				expect(init.method).toBe("GET");
				expect(init.redirect).toBe("manual");
				expect(init.signal).toBeInstanceOf(AbortSignal);
				return Response.json({ ok: true });
			},
		);
		expect((await api.json("items")).data).toEqual({ ok: true });
		await expect(api.json("https://evil.example/v1/")).rejects.toThrow(
			"Invalid API path",
		);
		await expect(api.json("../other")).rejects.toThrow("Invalid API path");
	});
	test("does not follow redirects or expose provider bodies and signed URLs", async () => {
		const api = transport(
			"https://api.example.com/",
			{},
			async () =>
				new Response("private sentinel", {
					status: 302,
					headers: { location: "https://evil.example/?token=private" },
				}),
		);
		await expect(api.json("item")).rejects.toThrow(
			"Provider request failed (HTTP 302).",
		);
	});
	test("sanitizes network failures", async () => {
		const api = transport("https://api.example.com/", {}, async () => {
			throw new Error("Bearer private");
		});
		await expect(api.json("item")).rejects.toThrow(
			"Provider request or response stream failed; check connection and credentials.",
		);
	});
	test("rejects declared oversized bodies", async () => {
		const api = transport(
			"https://api.example.com/",
			{},
			async () =>
				new Response("", { headers: { "content-length": "2000001" } }),
		);
		await expect(api.json("item")).rejects.toThrow("byte limit");
	});
	test("bounds streamed bytes even without content-length and cancels the stream", async () => {
		let cancelled = false;
		const api = transport(
			"https://api.example.com/",
			{},
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(9));
						},
						cancel() {
							cancelled = true;
						},
					}),
				),
		);
		await expect(api.request("item", {}, 8)).rejects.toThrow("byte limit");
		expect(cancelled).toBe(true);
	});
	test("rejects malformed JSON and redacts upstream HTTP error text", async () => {
		const invalid = transport(
			"https://api.example.com/",
			{},
			async () => new Response("private"),
		);
		await expect(invalid.json("item")).rejects.toThrow(
			"Provider returned invalid JSON.",
		);
		const denied = transport(
			"https://api.example.com/",
			{},
			async () => new Response("private secret", { status: 401 }),
		);
		await expect(denied.json("item")).rejects.toThrow(
			"Provider request failed (HTTP 401).",
		);
	});
	test("requires injected secrets and rejects header injection and retired OAuth", () => {
		expect(() => token({}, "asana")).toThrow("Attach");
		expect(() =>
			token({ asana: { secret_apiKey: "a\r\nb" } }, "asana"),
		).toThrow("Attach");
		expect(() =>
			token(
				{
					"google-oauth": {
						source: "first-party",
						secret_accessToken: "private",
					},
				},
				"google-oauth",
				true,
			),
		).toThrow("source byo");
	});
});

test("abort deadline covers a stalled body, not only response headers", async () => {
	const api = transport(
		"https://api.example.com/",
		{},
		async (_url, init) =>
			new Response(
				new ReadableStream({
					start(controller) {
						init.signal?.addEventListener("abort", () =>
							controller.error(new Error("private body error")),
						);
					},
				}),
			),
		5,
	);
	await expect(api.json("item")).rejects.toThrow(
		"Provider request or response stream failed; check connection and credentials.",
	);
});
