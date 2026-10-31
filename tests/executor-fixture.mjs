import assert from "node:assert/strict";

const folder = {
	id: "folder",
	name: "Evidence",
	mimeType: "application/vnd.google-apps.folder",
};
const file = {
	id: "file",
	name: "Evidence.txt",
	mimeType: "text/plain",
	parents: ["folder"],
	capabilities: { canDownload: true },
};
const document = {
	...file,
	id: "doc",
	mimeType: "application/vnd.google-apps.document",
};
export default async function createFixture() {
	return {
		configuration: { permittedRootIds: "folder" },
		provider: "google-oauth",
		secret: { source: "byo", secret_accessToken: "synthetic-drive" },
		async fetch(request) {
			const url = new URL(request.url);
			assert.equal(url.origin, "https://www.googleapis.com");
			assert.equal(request.method, "GET");
			assert.equal(
				request.headers.get("authorization"),
				"Bearer synthetic-drive",
			);
			if (
				url.searchParams.get("alt") === "media" ||
				url.pathname.endsWith("/export")
			)
				return new Response("Synthetic document");
			const responses = {
				"/drive/v3/files/folder": folder,
				"/drive/v3/files/file": file,
				"/drive/v3/files/doc": document,
				"/drive/v3/files": { files: [file], incompleteSearch: false },
			};
			assert(Object.hasOwn(responses, url.pathname), url.pathname);
			return Response.json(responses[url.pathname]);
		},
		async run(call) {
			assert.equal(
				(await call("listFiles", { folderId: "folder" })).files[0].id,
				"file",
			);
			assert.equal((await call("getFile", { fileId: "file" })).id, "file");
			assert.equal(
				(await call("readFile", { fileId: "file" })).text,
				"Synthetic document",
			);
			assert.equal(
				(await call("exportFile", { fileId: "doc", mimeType: "text/plain" }))
					.text,
				"Synthetic document",
			);
		},
	};
}
