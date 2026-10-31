import type { PluginContext, PluginFactory } from "@orgsdk/plugins";
import { configSchema } from "./config";
import { createFunctions } from "./functions";

const createPlugin: PluginFactory = (context: PluginContext) => ({
	safeFunctions: createFunctions(context.stores.config),
	config: { title: "Read-only evidence boundaries", schema: configSchema },
});
export default createPlugin;
