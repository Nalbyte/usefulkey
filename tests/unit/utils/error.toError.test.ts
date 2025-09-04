import { describe, expect, it } from "vitest";
import { toError } from "../../../src/utils/error";

describe("toError", () => {
	it("preserves code/message for Error with string code and merges meta", () => {
		const err = new Error("boom") as unknown as Error & { code: string };
		(err as any).code = "E_FOO";
		const meta = { a: 1 } as const;
		const out = toError(err, "FALLBACK", meta);
		expect(out.code).toBe("E_FOO");
		expect(out.message).toBe("boom");
		expect(out.cause).toBe(err);
		expect(out.meta).toBe(meta);
	});

	it("uses fallback code for Error without code", () => {
		const err = new Error("oops");
		const out = toError(err, "FALL");
		expect(out.code).toBe("FALL");
		expect(out.message).toBe("oops");
		expect(out.cause).toBe(err);
	});

	it("handles plain object with string code and message", () => {
		const obj = { code: "X", message: "msg" };
		const out = toError(obj, "FALL");
		expect(out.code).toBe("X");
		expect(out.message).toBe("msg");
		expect(out.cause).toBe(obj);
	});

	it("falls back when code is non-string", () => {
		const obj = { code: 123, message: "m" } as unknown as {
			code: unknown;
			message: string;
		};
		const out = toError(obj, "FB");
		expect(out.code).toBe("FB");
		expect(out.message).toBe("m");
	});

	it("normalizes primitive throws and preserves value in cause", () => {
		const s = toError("boom", "FB");
		expect(s.code).toBe("FB");
		expect(s.message).toBe("boom");
		expect(s.cause).toBe("boom");

		const n = toError(42 as unknown as never, "FB");
		expect(n.code).toBe("FB");
		expect(n.message).toBe("42");
		expect(n.cause).toBe(42);

		const b = toError(true as unknown as never, "FB");
		expect(b.code).toBe("FB");
		expect(b.message).toBe("true");
		expect(b.cause).toBe(true);

		const nul = toError(null as unknown as never, "FB");
		expect(nul.code).toBe("FB");
		expect(nul.message).toBe("null");
		expect(nul.cause).toBe(null);

		const und = toError(undefined as unknown as never, "FB");
		expect(und.code).toBe("FB");
		expect(und.message).toBe("undefined");
		expect(und.cause).toBe(undefined);
	});
});
