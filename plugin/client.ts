import { z } from "zod";
import { id, type parseConfig } from "./config";
import { type Fetch, object, token, transport } from "./transport";

const folderMime = "application/vnd.google-apps.folder";
const metadata = z.object({
	id,
	name: z.string(),
	mimeType: z.string(),
	parents: z.array(id).optional(),
	driveId: id.optional(),
	trashed: z.boolean().optional(),
	size: z.string().optional(),
	modifiedTime: z.string().optional(),
	createdTime: z.string().optional(),
	description: z.string().optional(),
	md5Checksum: z.string().optional(),
	capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
});
const fields =
	"id,name,mimeType,parents,driveId,trashed,size,modifiedTime,createdTime,description,md5Checksum,capabilities/canDownload";
export const exportMime = z.enum([
	"text/plain",
	"text/csv",
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
export function createClient(
	config: ReturnType<typeof parseConfig>,
	credentials: unknown,
	fetcher?: Fetch,
) {
	const api = transport(
		"https://www.googleapis.com/drive/v3/",
		{ Authorization: `Bearer ${token(credentials, "google-oauth", true)}` },
		fetcher,
	);
	const cache = new Map<string, z.infer<typeof metadata>>();
	async function raw(fileId: string) {
		const cached = cache.get(fileId);
		if (cached) return cached;
		const file = metadata.parse(
			(await api.json(`files/${fileId}`, { fields, supportsAllDrives: "true" }))
				.data,
		);
		if (
			file.id !== fileId ||
			file.trashed ||
			(config.sharedDriveId && file.driveId !== config.sharedDriveId)
		)
			throw new Error("File is outside configured boundary or unavailable.");
		cache.set(fileId, file);
		return file;
	}
	async function allowed(fileId: string) {
		const file = await raw(fileId);
		let current = file;
		const visited = new Set<string>();
		for (let depth = 0; depth < 32; depth++) {
			if (visited.has(current.id))
				throw new Error("Folder ancestry contains a cycle.");
			visited.add(current.id);
			if (config.permittedRootIds.includes(current.id)) {
				if (current.mimeType !== folderMime)
					throw new Error("Configured root must be a folder.");
				return file;
			}
			if (current.parents?.length !== 1) break;
			current = await raw(current.parents[0]);
		}
		throw new Error(
			"File ancestry does not establish a permitted root within 32 levels.",
		);
	}
	async function content(fileId: string, mimeType?: string) {
		const file = await allowed(fileId);
		if (file.capabilities?.canDownload !== true)
			throw new Error("File does not allow downloading.");
		if (
			file.mimeType === folderMime ||
			file.mimeType === "application/vnd.google-apps.shortcut"
		)
			throw new Error("Folders and shortcuts cannot be read as file content.");
		const isWorkspace = file.mimeType.startsWith(
			"application/vnd.google-apps.",
		);
		if (isWorkspace !== !!mimeType)
			throw new Error(
				"Use exportFile for Workspace documents and readFile for binary files.",
			);
		const maxBytes = 5_000_000;
		if (file.size && Number(file.size) > maxBytes)
			throw new Error("File exceeds 5000000 byte content limit.");
		const result = await api.request(
			`files/${fileId}${mimeType ? "/export" : ""}`,
			mimeType ? { mimeType } : { alt: "media", supportsAllDrives: "true" },
			maxBytes,
		);
		const type = mimeType ?? file.mimeType;
		return {
			fileId,
			mimeType: type,
			byteLength: result.bytes.byteLength,
			...(type.startsWith("text/")
				? { text: new TextDecoder().decode(result.bytes) }
				: { base64: Buffer.from(result.bytes).toString("base64") }),
		};
	}
	return {
		file: allowed,
		async files(
			folderId: string,
			nameContains: string | undefined,
			pageSize: number,
			pageToken?: string,
		) {
			const folder = await allowed(folderId);
			if (folder.mimeType !== folderMime)
				throw new Error("folderId must identify a folder.");
			const escapeQuery = (value: string) =>
				value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
			const query: Record<string, string> = {
				q: `'${escapeQuery(folderId)}' in parents and trashed = false${nameContains ? ` and name contains '${escapeQuery(nameContains)}'` : ""}`,
				fields: `nextPageToken,incompleteSearch,files(${fields})`,
				pageSize: String(pageSize),
				supportsAllDrives: "true",
				includeItemsFromAllDrives: "true",
				...(pageToken ? { pageToken } : {}),
				...(config.sharedDriveId
					? { corpora: "drive", driveId: config.sharedDriveId }
					: { corpora: "user" }),
			};
			const result = object.parse((await api.json("files", query)).data);
			const files = z
				.array(metadata)
				.max(100)
				.parse(result.files ?? []);
			for (const file of files)
				if (
					!file.parents?.includes(folderId) ||
					file.trashed ||
					(config.sharedDriveId && file.driveId !== config.sharedDriveId)
				)
					throw new Error("Provider returned files outside requested folder.");
			return {
				files,
				nextPageToken:
					z.string().max(2048).optional().parse(result.nextPageToken) ?? null,
				incompleteSearch:
					z.boolean().optional().parse(result.incompleteSearch) ?? false,
			};
		},
		content,
	};
}
