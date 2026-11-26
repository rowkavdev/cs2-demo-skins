import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-extension-hook.mjs", import.meta.url);
