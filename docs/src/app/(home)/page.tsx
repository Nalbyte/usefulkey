import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import Link from "next/link";
import { GitHubIcon } from "@/components/icons";

export default function HomePage() {
	return (
		<main className="flex flex-1 flex-col items-center justify-center text-center px-6 py-16 gap-14">
			<section className="max-w-3xl">
				<div className="mb-4 flex items-center justify-center">
					<svg
						viewBox="0 0 512 512"
						aria-hidden="true"
						focusable="false"
						className="h-12 w-12 text-fd-foreground"
					>
						<path
							d="M218.1 167.17c0 13 0 25.6 4.1 37.4-43.1 50.6-156.9 184.3-167.5 194.5a20.17 20.17 0 00-6.7 15c0 8.5 5.2 16.7 9.6 21.3 6.6 6.9 34.8 33 40 28 15.4-15 18.5-19 24.8-25.2 9.5-9.3-1-28.3 2.3-36s6.8-9.2 12.5-10.4 15.8 2.9 23.7 3c8.3.1 12.8-3.4 19-9.2 5-4.6 8.6-8.9 8.7-15.6.2-9-12.8-20.9-3.1-30.4s23.7 6.2 34 5 22.8-15.5 24.1-21.6-11.7-21.8-9.7-30.7c.7-3 6.8-10 11.4-11s25 6.9 29.6 5.9c5.6-1.2 12.1-7.1 17.4-10.4 15.5 6.7 29.6 9.4 47.7 9.4 68.5 0 124-53.4 124-119.2S408.5 48 340 48s-121.9 53.37-121.9 119.17zM400 144a32 32 0 11-32-32 32 32 0 0132 32z"
							fill="currentColor"
						/>
					</svg>
				</div>
				<h1 className="text-4xl md:text-6xl font-bold tracking-tight">
					UsefulKey
				</h1>
				<p className="mt-4 text-base md:text-lg text-fd-muted-foreground">
					Open‑source, Self‑hostable, Typescript toolkit for API keys and rate
					limiting. Designed to be simple to adopt and easy to extend.
				</p>

				<div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
					<Link
						href="/docs"
						className="inline-flex items-center rounded-md bg-fd-foreground px-4 py-2 text-sm font-semibold text-fd-background hover:opacity-90"
					>
						Get Started
					</Link>
					<Link
						href="https://github.com/nalbyte/usefulkey"
						className="inline-flex items-center rounded-md border border-fd-border px-4 py-2 text-sm font-semibold hover:bg-fd-muted"
					>
						<GitHubIcon className="mr-2 size-4" />
						Star on GitHub
					</Link>
				</div>
			</section>

			<section className="grid w-full max-w-5xl grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<FeatureCard
					title="Adapters"
					description="Use Postgres, Redis, SQLite, Cloudflare D1/KV, or HTTP backends."
					href="/docs/adapters/overview"
				/>
				<FeatureCard
					title="Plugins"
					description="Enable scopes, IP access control, usage caps, and more."
					href="/docs/plugins/overview"
				/>
				<FeatureCard
					title="Rate limiting"
					description="Global and token bucket strategies with persistent stores."
					href="/docs/concepts/rate-limiting"
				/>
				<FeatureCard
					title="Examples"
					description="Next.js, Hono, and service‑to‑service usage patterns."
					href="/docs/examples"
				/>
			</section>

			<section className="w-full max-w-3xl text-left">
				<div className="prose prose-invert max-w-none">
					<h2>What is UsefulKey?</h2>
					<p>
						UsefulKey provides the building blocks for managing API access in
						your apps and services. It comes with storage adapters,
						middleware-friendly helpers, and pluggable features so you can
						choose only what you need.
					</p>
					<ul>
						<li>
							Issue and verify API keys with optional expiration and metadata.
						</li>
						<li>
							Apply global or token bucket rate limits backed by persistent
							stores.
						</li>
						<li>
							Enable scopes, usage caps, and IP access control via plugins.
						</li>
						<li>
							Use your preferred backend: Postgres, Redis, SQLite, Cloudflare,
							or HTTP.
						</li>
					</ul>
				</div>
			</section>

			<section className="w-full max-w-5xl text-left">
				<div className="rounded-lg border border-fd-border p-5 text-left">
					<h2 className="text-xl font-semibold">Quick Example</h2>
					<p className="mt-2 text-sm text-fd-muted-foreground">
						Swap in any adapter (Postgres, Redis, SQLite, Cloudflare) when
						you’re ready.
					</p>
					<HighlightedExample />
					<div className="mt-4">
						<Link
							href="/docs"
							className="inline-flex items-center rounded-md border border-fd-border px-3 py-1.5 text-sm font-semibold hover:bg-fd-muted"
						>
							Get Started →
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}

function FeatureCard(props: {
	title: string;
	description: string;
	href: string;
}) {
	const { title, description, href } = props;
	return (
		<Link
			href={href}
			className="group rounded-lg border border-fd-border p-5 text-left transition-colors hover:bg-fd-muted"
		>
			<h3 className="font-semibold text-lg">{title}</h3>
			<p className="mt-2 text-sm text-fd-muted-foreground">{description}</p>
			<span className="mt-3 inline-block text-sm font-medium text-fd-foreground group-hover:underline">
				Learn more →
			</span>
		</Link>
	);
}

function HighlightedExample() {
	const code = `import { usefulkey, MemoryKeyStore, MemoryRateLimitStore, ConsoleAnalytics } from "usefulkey";

// in your server code (e.g. Next.js Route Handler, Hono, etc.)
const uk = usefulkey({
  keyPrefix: "uk",
  adapters: {
    keyStore: new MemoryKeyStore(),
    rateLimitStore: new MemoryRateLimitStore(),
    analytics: new ConsoleAnalytics(),
  },
});

const create = await uk.createKey({
  metadata: {
    plan: "pro",
  },
});

// app/api/protected/route.ts
export async function GET(req: Request) {
  const key = req.headers.get("x-api-key") ?? "";

  const verify = await uk.verifyKey({ key });
  if (!verify.result?.valid) return new Response("unauthorized", { status: 401 });
  return new Response("ok");
}`;

	return (
		<div className="mt-4">
			<DynamicCodeBlock lang="ts" code={code} />
		</div>
	);
}
