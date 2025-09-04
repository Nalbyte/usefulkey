import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Ensure the static file is cached indefinitely during static export
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
	// https://docs.orama.com/open-source/supported-languages
	language: "english",
});
