import Link from "next/link";

export default function Footer() {
	return (
		<footer className="border-t border-fd-border text-sm text-fd-muted-foreground">
			<div className="mx-auto w-full max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
				<p>© {new Date().getFullYear()} Nalbyte. All rights reserved.</p>
				<div className="flex items-center gap-4">
					<Link href="/docs" className="hover:underline">
						Docs
					</Link>
					<a
						href="https://github.com/nalbyte/usefulkey"
						target="_blank"
						rel="noreferrer"
						className="hover:underline"
					>
						GitHub
					</a>
				</div>
			</div>
		</footer>
	);
}
