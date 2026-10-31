import { z } from "zod";

export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;
export const object = z.record(z.string(), z.unknown());
export function token(credentials: unknown, provider: string, oauth = false) {
	const bundle = object.safeParse(credentials);
	const secret = object.safeParse(
		bundle.success ? bundle.data[provider] : undefined,
	);
	const key = secret.success
		? secret.data[oauth ? "secret_accessToken" : "secret_apiKey"]
		: undefined;
	if (
		typeof key !== "string" ||
		!key.trim() ||
		/[\r\n]/.test(key) ||
		(oauth && secret.success && secret.data.source !== "byo")
	) {
		throw new Error(
			`Attach a ${provider} credential with ${oauth ? "source byo and secret_accessToken" : "secret_apiKey"}.`,
		);
	}
	return key;
}
export function transport(
	base: string,
	headers: Record<string, string>,
	fetcher: Fetch = fetch,
	timeoutMs = 15_000,
) {
	async function request(
		path: string,
		query: Record<string, string> = {},
		maxBytes = 2_000_000,
	) {
		const url = new URL(path, base);
		if (
			url.origin !== new URL(base).origin ||
			!url.pathname.startsWith(new URL(base).pathname)
		)
			throw new Error("Invalid API path.");
		for (const [key, value] of Object.entries(query))
			url.searchParams.set(key, value);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		try {
			const response = await fetcher(url, {
				method: "GET",
				headers,
				redirect: "manual",
				signal: controller.signal,
			});
			if (!response.ok)
				throw new Error(`Provider request failed (HTTP ${response.status}).`);
			if (Number(response.headers.get("content-length")) > maxBytes)
				throw new Error("Provider response exceeds byte limit.");
			reader = response.body?.getReader();
			const chunks: Uint8Array[] = [];
			let length = 0;
			if (reader)
				while (true) {
					const part = await reader.read();
					if (part.done) break;
					length += part.value.byteLength;
					if (length > maxBytes)
						throw new Error("Provider response exceeds byte limit.");
					chunks.push(part.value);
				}
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return { bytes, headers: response.headers };
		} catch (error) {
			if (
				error instanceof Error &&
				/^Provider (request failed \(HTTP \d+\)\.|response exceeds byte limit\.)$/.test(
					error.message,
				)
			)
				throw error;
			throw new Error(
				"Provider request or response stream failed; check connection and credentials.",
			);
		} finally {
			clearTimeout(timer);
			controller.abort();
			await reader?.cancel().catch(() => {});
		}
	}
	return {
		request,
		async json(path: string, query: Record<string, string> = {}) {
			const result = await request(path, query);
			try {
				return {
					data: JSON.parse(new TextDecoder().decode(result.bytes)) as unknown,
					headers: result.headers,
				};
			} catch {
				throw new Error("Provider returned invalid JSON.");
			}
		},
	};
}
export function pick(row: Record<string, unknown>, fields: readonly string[]) {
	return Object.fromEntries(
		fields
			.filter((key) => row[key] !== undefined)
			.map((key) => [key, row[key]]),
	);
}
