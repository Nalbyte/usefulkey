import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "@/app/layout.config";
import { Provider } from "@/app/provider";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
	const { links: _omit, ...rest } = baseOptions;
	const iconLinks = (baseOptions.links ?? []).filter((link) => "type" in link);

	return (
		<Provider>
			<DocsLayout tree={source.pageTree} {...rest} links={iconLinks}>
				{children}
			</DocsLayout>
		</Provider>
	);
}
