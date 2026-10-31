import { z } from "zod";
export const id = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,200}$/)
	.refine(
		(value) => value !== "root",
		"Use a concrete folder ID, not the root alias.",
	);
export const configSchema = z.strictObject({
	permittedRootIds: z
		.string()
		.min(1)
		.describe(
			"Comma-separated permitted concrete folder IDs; maximum 20. Descendants require ancestry verification.",
		),
	sharedDriveId: id
		.optional()
		.describe(
			"When set, every retrieved file must belong to this shared drive.",
		),
});
export function parseConfig(input: unknown) {
	const config = configSchema.parse(input);
	return {
		...config,
		permittedRootIds: z
			.array(id)
			.min(1)
			.max(20)
			.parse(config.permittedRootIds.split(",").map((value) => value.trim())),
	};
}
