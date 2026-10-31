import type { PluginContext, SafeFunction } from "@orgsdk/plugins";
import { z } from "zod";
import { createClient, exportMime } from "./client";
import { id, parseConfig } from "./config";
import type { Fetch } from "./transport";
export function createFunctions(
	store: PluginContext["stores"]["config"],
	fetcher?: Fetch,
): SafeFunction[] {
	function tool<T>(
		name: string,
		description: string,
		schema: z.ZodType<T>,
		parameters: NonNullable<SafeFunction["parameters"]>,
		result: string,
		run: (
			client: ReturnType<typeof createClient>,
			input: T,
		) => Promise<unknown>,
	): SafeFunction {
		return {
			name,
			description,
			parameters,
			returnType: `Promise<${result}>`,
			requiredCredentials: ["google-oauth"],
			metadata: {
				readonly: true,
				category: "google-drive",
				tags: ["readonly"],
			},
			handler: async (credentials: unknown, input: unknown = {}) => {
				const parsed = schema.parse(input);
				const config = parseConfig(
					(await store.get("plugin:google-drive"))?.value ?? {},
				);
				return run(createClient(config, credentials, fetcher), parsed);
			},
		};
	}
	const fileParameter = { name: "fileId", type: "string" };
	return [
		tool(
			"listFiles",
			"List or search a single permitted folder's direct children, one bounded page at a time.",
			z.strictObject({
				folderId: id,
				nameContains: z.string().min(1).max(200).optional(),
				pageSize: z.number().int().min(1).max(100).default(50),
				pageToken: z.string().min(1).max(2048).optional(),
			}),
			[
				{ name: "folderId", type: "string" },
				{ name: "nameContains", type: "string", optional: true },
				{ name: "pageSize", type: "number", optional: true },
				{ name: "pageToken", type: "string", optional: true },
			],
			"{ files: Record<string, unknown>[]; nextPageToken: string | null; incompleteSearch: boolean }",
			(client, input) =>
				client.files(
					input.folderId,
					input.nameContains,
					input.pageSize,
					input.pageToken,
				),
		),
		tool(
			"getFile",
			"Read selected file metadata after verifying folder ancestry.",
			z.strictObject({ fileId: id }),
			[fileParameter],
			"Record<string, unknown>",
			(client, input) => client.file(input.fileId),
		),
		tool(
			"readFile",
			"Read up to 5000000 bytes of a permitted binary file as text or base64.",
			z.strictObject({ fileId: id }),
			[fileParameter],
			"{ fileId: string; mimeType: string; byteLength: number; text?: string; base64?: string }",
			(client, input) => client.content(input.fileId),
		),
		tool(
			"exportFile",
			"Export a permitted Workspace document to a supported text or binary format, up to 5000000 bytes.",
			z.strictObject({ fileId: id, mimeType: exportMime }),
			[
				fileParameter,
				{
					name: "mimeType",
					type: '"text/plain" | "text/csv" | "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation"',
				},
			],
			"{ fileId: string; mimeType: string; byteLength: number; text?: string; base64?: string }",
			(client, input) => client.content(input.fileId, input.mimeType),
		),
	];
}
