import { expect, test } from "bun:test";
import type { PluginContext } from "@orgsdk/plugins";
import createPlugin from "../plugin";
import { createFunctions } from "../plugin/functions";
import type { Fetch } from "../plugin/transport";

const folderMime = "application/vnd.google-apps.folder";
const config = { permittedRootIds: "permitted", sharedDriveId: "drive1" };
const store = {
	get: async () => ({ value: config }),
} as unknown as PluginContext["stores"]["config"];
const credentials = {
	"google-oauth": { source: "byo", secret_accessToken: "sentinel" },
};
function tool(name: string, fetcher: Fetch) {
	const fn = createFunctions(store, fetcher).find((fn) => fn.name === name);
	if (!fn) throw new Error("Missing test tool");
	return fn;
}
function file(id: string, parents: string[] = [], mimeType = "text/plain") {
	return {
		id,
		name: id,
		mimeType,
		parents,
		driveId: "drive1",
		capabilities: { canDownload: true },
	};
}
function fixture(rows: ReturnType<typeof file>[], seen: URL[] = []): Fetch {
	return async (url, init) => {
		seen.push(url);
		expect(init.headers).toEqual({ Authorization: "Bearer sentinel" });
		const id = url.pathname.split("/").at(-1);
		return Response.json(rows.find((row) => row.id === id) ?? {});
	};
}
test("factory provides no OAuth lifecycle and requires folder boundaries", async () => {
	const module = await createPlugin({
		stores: { config: store },
	} as PluginContext);
	expect(module).not.toHaveProperty("authProvider");
	expect(module).not.toHaveProperty("httpEndpoints");
	expect(() => module.config?.schema.parse({})).toThrow();
	expect(() =>
		module.config?.schema.parse({ ...config, secret_accessToken: "bad" }),
	).toThrow();
});
test("rejects retired or untagged credentials before network", async () => {
	let requests = 0;
	const fn = tool("getFile", async () => {
		requests++;
		return Response.json({});
	});
	for (const source of ["first-party", undefined])
		await expect(
			fn.handler(
				{ "google-oauth": { source, secret_accessToken: "x" } },
				{ fileId: "allowed" },
			),
		).rejects.toThrow("source byo");
	expect(requests).toBe(0);
});
test("checks ancestry before content, strips resource keys and sensitive URLs", async () => {
	const seen: URL[] = [];
	const rows = [
		file("document", ["nested"]),
		file("nested", ["permitted"], folderMime),
		file("permitted", [], folderMime),
	];
	const result = await tool("getFile", async (url) => {
		seen.push(url);
		const row = rows.find((row) => row.id === url.pathname.split("/").at(-1));
		return Response.json({
			...row,
			resourceKey: "secret",
			webContentLink: "signed",
		});
	}).handler(credentials, { fileId: "document" });
	expect(result).toMatchObject({ id: "document" });
	expect(result).not.toHaveProperty("resourceKey");
	expect(result).not.toHaveProperty("webContentLink");
	expect(seen).toHaveLength(3);
});
test("denies outside root, different shared drive and cyclic ancestry", async () => {
	await expect(
		tool("getFile", fixture([file("outside")])).handler(credentials, {
			fileId: "outside",
		}),
	).rejects.toThrow("permitted root");
	await expect(
		tool("getFile", async () =>
			Response.json({ ...file("wrong"), driveId: "other" }),
		).handler(credentials, { fileId: "wrong" }),
	).rejects.toThrow("outside configured");
	await expect(
		tool("getFile", fixture([file("loop", ["loop"])])).handler(credentials, {
			fileId: "loop",
		}),
	).rejects.toThrow("cycle");
});
test("folder search escapes input, constrains corpus and rejects provider boundary violations", async () => {
	const seen: URL[] = [];
	const fetcher: Fetch = async (url) => {
		seen.push(url);
		if (url.pathname.endsWith("/files"))
			return Response.json({
				files: [file("child", ["permitted"])],
				nextPageToken: "next",
				incompleteSearch: true,
			});
		return Response.json(file("permitted", [], folderMime));
	};
	expect(
		await tool("listFiles", fetcher).handler(credentials, {
			folderId: "permitted",
			nameContains: "tax' or trashed = true",
		}),
	).toMatchObject({ nextPageToken: "next", incompleteSearch: true });
	const query = seen.at(-1)?.searchParams;
	expect(query?.get("q")).toContain("name contains 'tax\\' or trashed = true'");
	expect(query?.get("driveId")).toBe("drive1");
	expect(query?.get("corpora")).toBe("drive");
	const bad: Fetch = async (url) =>
		Response.json(
			url.pathname.endsWith("/files")
				? { files: [file("other", ["outside"])] }
				: file("permitted", [], folderMime),
		);
	await expect(
		tool("listFiles", bad).handler(credentials, { folderId: "permitted" }),
	).rejects.toThrow("outside requested folder");
});
test("reads permitted binary content only from Drive API and exports Workspace content", async () => {
	const seen: URL[] = [];
	const fetcher: Fetch = async (url) => {
		seen.push(url);
		if (url.searchParams.get("alt") === "media") return new Response("receipt");
		if (url.pathname.endsWith("/export")) return new Response("document");
		return Response.json(
			url.pathname.endsWith("/permitted")
				? file("permitted", [], folderMime)
				: file("evidence", ["permitted"], "text/plain"),
		);
	};
	expect(
		await tool("readFile", fetcher).handler(credentials, {
			fileId: "evidence",
		}),
	).toMatchObject({ text: "receipt", byteLength: 7 });
	expect(seen.at(-1)?.hostname).toBe("www.googleapis.com");
	const workspace: Fetch = async (url) =>
		url.pathname.endsWith("/export")
			? new Response("document")
			: Response.json(
					url.pathname.endsWith("/permitted")
						? file("permitted", [], folderMime)
						: file(
								"evidence",
								["permitted"],
								"application/vnd.google-apps.document",
							),
				);
	expect(
		await tool("exportFile", workspace).handler(credentials, {
			fileId: "evidence",
			mimeType: "text/plain",
		}),
	).toMatchObject({ text: "document" });
});
test("refuses shortcuts and download restrictions before fetching bytes", async () => {
	for (const row of [
		{
			...file("evidence", ["permitted"]),
			capabilities: { canDownload: false },
		},
		file("evidence", ["permitted"], "application/vnd.google-apps.shortcut"),
	]) {
		const seen: URL[] = [];
		await expect(
			tool(
				"readFile",
				fixture([row, file("permitted", [], folderMime)], seen),
			).handler(credentials, { fileId: "evidence" }),
		).rejects.toThrow();
		expect(seen.some((url) => url.searchParams.has("alt"))).toBe(false);
	}
});
